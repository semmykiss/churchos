import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { badRequest, forbidden, notFound } from "@/server/http";
import { can, type SessionUser } from "@/server/permissions";
import { assertFeature } from "@/server/services/features";
import { llmComplete, extractJson } from "@/server/services/ai/provider";
import { findCrossReferences, matchSongs, STARTER_WORSHIP_LIBRARY } from "@/server/services/sermon-data";

/**
 * Sermon Studio (backend only) — AI-assisted, human-owned sermon preparation.
 *
 *  • The LLM drafts the OUTLINE and ILLUSTRATIONS from the pastor's input and
 *    the deterministic cross-reference/song shortlists — it never invents
 *    cross-references (only annotates dataset results) and never invents songs
 *    (only writes a match_reason for REAL library entries).
 *  • Drafts are append-only version history: every generation or edit-save
 *    creates a new SermonDraft row; previous versions stay restorable.
 *  • Every block (outline / cross-refs / illustrations / songs) is
 *    independently regenerable and independently editable.
 */

export type DraftSection = "outline" | "crossRefs" | "illustrations" | "songs";

export interface OutlinePoint { title: string; scripture?: string; subpoints: string[]; application?: string }
export interface SermonOutline { intro: string; points: OutlinePoint[]; closing: string; bigIdea?: string }
export interface CrossRefItem { reference: string; relevance: string }
export interface IllustrationItem { type: "personal_story_prompt" | "historical" | "cultural" | "parable" | "scripture_scene"; title: string; text: string }

// ── permission helpers ───────────────────────────────────────────────────────

function assertView(user: SessionUser) {
  if (!can(user, "sermon.view")) throw forbidden('Requires "sermon.view" permission.');
}
function assertCreate(user: SessionUser) {
  if (!can(user, "sermon.create")) throw forbidden('Requires "sermon.create" permission.');
}
function assertEdit(user: SessionUser) {
  if (!can(user, "sermon.edit") && !can(user, "sermon.create")) throw forbidden('Requires "sermon.edit" permission.');
}
function assertManage(user: SessionUser) {
  if (!can(user, "sermon.manage") && !can(user, "sermon.create")) throw forbidden('Requires "sermon.manage" or "sermon.create" permission.');
}

// ── worship library ──────────────────────────────────────────────────────────

/** Lazily seed the shared global starter library once (orgId=null rows). */
export async function ensureStarterLibrary(): Promise<void> {
  const count = await db.worshipSong.count({ where: { orgId: null } });
  if (count > 0) return;
  await db.worshipSong.createMany({
    data: STARTER_WORSHIP_LIBRARY.map((s) => ({
      orgId: null,
      title: s.title,
      artist: s.artist ?? null,
      ccliNumber: s.ccliNumber ?? null,
      themeTags: JSON.stringify(s.themeTags),
      moodTags: JSON.stringify(s.moodTags),
      scriptureRefs: JSON.stringify(s.scriptureRefs),
      key: s.key ?? null,
      tempo: s.tempo ?? null,
      lyricsExcerpt: s.lyricsExcerpt ?? null,
      isPublicDomain: s.isPublicDomain,
    })),
  });
}

export async function listSongs(user: SessionUser, q: { search?: string } = {}) {
  assertView(user);
  await ensureStarterLibrary();
  const songs = await db.worshipSong.findMany({
    where: { OR: [{ orgId: user.orgId }, { orgId: null }] },
    orderBy: [{ title: "asc" }],
    take: 500,
  });
  const search = q.search?.trim().toLowerCase();
  const items = songs
    .filter((s) => {
      if (!search) return true;
      return (
        s.title.toLowerCase().includes(search) ||
        (s.artist ?? "").toLowerCase().includes(search) ||
        s.themeTags.toLowerCase().includes(search) ||
        s.scriptureRefs.toLowerCase().includes(search)
      );
    })
    .map((s) => ({
      id: s.id, title: s.title, artist: s.artist, ccliNumber: s.ccliNumber,
      themeTags: JSON.parse(s.themeTags) as string[], moodTags: JSON.parse(s.moodTags) as string[],
      scriptureRefs: JSON.parse(s.scriptureRefs) as string[], key: s.key, tempo: s.tempo,
      lyricsExcerpt: s.lyricsExcerpt, isPublicDomain: s.isPublicDomain, isChurchOwned: s.orgId === user.orgId,
    }));
  return { items };
}

export async function upsertSong(
  user: SessionUser,
  input: { id?: string; title: string; artist?: string; ccliNumber?: string; themeTags?: string[]; moodTags?: string[]; scriptureRefs?: string[]; key?: string; tempo?: string; lyricsExcerpt?: string },
  meta: { ip?: string; userAgent?: string },
) {
  if (!can(user, "sermon.library.manage")) throw forbidden('Requires "sermon.library.manage" permission.');
  if (!input.title?.trim()) throw badRequest("Song title is required.");
  const data = {
    title: input.title.trim(),
    artist: input.artist?.trim() || null,
    ccliNumber: input.ccliNumber?.trim() || null,
    themeTags: JSON.stringify(input.themeTags?.filter(Boolean) ?? []),
    moodTags: JSON.stringify(input.moodTags?.filter(Boolean) ?? []),
    scriptureRefs: JSON.stringify(input.scriptureRefs?.filter(Boolean) ?? []),
    key: input.key?.trim() || null,
    tempo: input.tempo?.trim() || null,
    lyricsExcerpt: input.lyricsExcerpt?.trim() || null,
    isPublicDomain: !!input.lyricsExcerpt, // excerpt allowed only where PD — enforced by reviewer
  };
  if (input.id) {
    const existing = await db.worshipSong.findFirst({ where: { id: input.id, orgId: user.orgId } });
    if (!existing) throw notFound("Song not found in your church library (shared entries are read-only).");
    await db.worshipSong.update({ where: { id: input.id }, data });
  } else {
    await db.worshipSong.create({ data: { ...data, orgId: user.orgId, addedByMembershipId: user.membershipId } });
  }
  await audit({ orgId: user.orgId, actor: user, action: "sermon.song_save", entityType: "worship_song", entityId: input.id ?? "new", after: { title: data.title }, ip: meta.ip, userAgent: meta.userAgent });
  return { ok: true };
}

export async function deleteSong(user: SessionUser, id: string, meta: { ip?: string; userAgent?: string }) {
  if (!can(user, "sermon.library.manage")) throw forbidden('Requires "sermon.library.manage" permission.');
  const song = await db.worshipSong.findFirst({ where: { id, orgId: user.orgId } });
  if (!song) throw notFound("Song not found in your church library.");
  await db.sermonSongSuggestion.deleteMany({ where: { songId: id } });
  await db.worshipSong.delete({ where: { id } });
  await audit({ orgId: user.orgId, actor: user, action: "sermon.song_delete", entityType: "worship_song", entityId: id, ip: meta.ip, userAgent: meta.userAgent });
  return { ok: true };
}

// ── series & sermons ─────────────────────────────────────────────────────────

export async function listSeries(user: SessionUser) {
  assertView(user);
  const series = await db.sermonSeries.findMany({
    where: { orgId: user.orgId },
    orderBy: { createdAt: "desc" },
    include: { sermons: { select: { id: true, title: true, targetDate: true, status: true }, orderBy: { targetDate: "asc" } } },
  });
  return {
    items: series.map((s) => ({
      id: s.id, title: s.title, description: s.description,
      themeTags: JSON.parse(s.themeTags) as string[],
      startDate: s.startDate, endDate: s.endDate, coverImageUrl: s.coverImageUrl,
      sermonCount: s.sermons.length,
      sermons: s.sermons.map((x) => ({ id: x.id, title: x.title, targetDate: x.targetDate, status: x.status })),
    })),
  };
}

export async function upsertSeries(
  user: SessionUser,
  input: { id?: string; title: string; description?: string; themeTags?: string[]; startDate?: string; endDate?: string },
  meta: { ip?: string; userAgent?: string },
) {
  assertManage(user);
  if (!input.title?.trim()) throw badRequest("Series title is required.");
  const data = {
    title: input.title.trim(),
    description: input.description?.trim() || null,
    themeTags: JSON.stringify(input.themeTags?.filter(Boolean) ?? []),
    startDate: input.startDate ? new Date(input.startDate) : null,
    endDate: input.endDate ? new Date(input.endDate) : null,
  };
  if (input.id) {
    const existing = await db.sermonSeries.findFirst({ where: { id: input.id, orgId: user.orgId } });
    if (!existing) throw notFound("Series not found.");
    await db.sermonSeries.update({ where: { id: input.id }, data });
  } else {
    await db.sermonSeries.create({ data: { ...data, orgId: user.orgId, createdByMembershipId: user.membershipId } });
  }
  await audit({ orgId: user.orgId, actor: user, action: "sermon.series_save", entityType: "sermon_series", entityId: input.id ?? "new", after: { title: data.title }, ip: meta.ip, userAgent: meta.userAgent });
  return { ok: true };
}

export async function listSermons(user: SessionUser, q: { seriesId?: string; status?: string } = {}) {
  assertView(user);
  const sermons = await db.sermon.findMany({
    where: { orgId: user.orgId, ...(q.seriesId ? { seriesId: q.seriesId } : {}), ...(q.status && q.status !== "all" ? { status: q.status } : {}) },
    orderBy: [{ targetDate: "desc" }, { createdAt: "desc" }],
    include: { series: { select: { id: true, title: true } }, drafts: { orderBy: { versionNumber: "desc" }, take: 1, select: { id: true, versionNumber: true, createdAt: true, generatedBy: true } } },
  });
  return {
    items: sermons.map((s) => ({
      id: s.id, title: s.title, primaryScriptureRef: s.primaryScriptureRef, theme: s.theme,
      targetDate: s.targetDate, status: s.status,
      series: s.series ? { id: s.series.id, title: s.series.title } : null,
      latestDraft: s.drafts[0] ?? null,
    })),
  };
}

export async function upsertSermon(
  user: SessionUser,
  input: { id?: string; title: string; primaryScriptureRef?: string; theme?: string; targetDate?: string; status?: string; seriesId?: string | null },
  meta: { ip?: string; userAgent?: string },
) {
  if (input.id) assertEdit(user); else assertCreate(user);
  if (!input.title?.trim()) throw badRequest("Sermon title is required.");
  const status = ["draft", "reviewed", "final", "preached"].includes(input.status ?? "") ? input.status! : undefined;
  const data = {
    title: input.title.trim(),
    primaryScriptureRef: input.primaryScriptureRef?.trim() || null,
    theme: input.theme?.trim() || null,
    targetDate: input.targetDate ? new Date(input.targetDate) : null,
    ...(status ? { status } : {}),
    seriesId: input.seriesId ?? null,
  };
  let sermonId = input.id;
  if (input.id) {
    const existing = await db.sermon.findFirst({ where: { id: input.id, orgId: user.orgId } });
    if (!existing) throw notFound("Sermon not found.");
    await db.sermon.update({ where: { id: input.id }, data });
  } else {
    const created = await db.sermon.create({ data: { ...data, orgId: user.orgId, createdByMembershipId: user.membershipId } });
    sermonId = created.id;
  }
  await audit({ orgId: user.orgId, actor: user, action: "sermon.save", entityType: "sermon", entityId: sermonId!, after: { title: data.title, status }, ip: meta.ip, userAgent: meta.userAgent });
  return { id: sermonId };
}

export async function deleteSermon(user: SessionUser, id: string, meta: { ip?: string; userAgent?: string }) {
  if (!can(user, "sermon.manage")) throw forbidden('Requires "sermon.manage" permission.');
  const sermon = await db.sermon.findFirst({ where: { id, orgId: user.orgId } });
  if (!sermon) throw notFound("Sermon not found.");
  await db.sermon.delete({ where: { id } });
  await audit({ orgId: user.orgId, actor: user, action: "sermon.delete", entityType: "sermon", entityId: id, ip: meta.ip, userAgent: meta.userAgent });
  return { ok: true };
}

// ── drafts ───────────────────────────────────────────────────────────────────

export interface DraftPayload {
  outline?: SermonOutline | null;
  crossRefs?: CrossRefItem[] | null;
  illustrations?: IllustrationItem[] | null;
}

export async function getSermon(user: SessionUser, sermonId: string) {
  assertView(user);
  const sermon = await db.sermon.findFirst({
    where: { id: sermonId, orgId: user.orgId },
    include: {
      series: { select: { id: true, title: true, themeTags: true } },
      drafts: { orderBy: { versionNumber: "desc" } },
      songSuggestions: { orderBy: { orderIndex: "asc" }, include: { song: true } },
    },
  });
  if (!sermon) throw notFound("Sermon not found.");

  const current = sermon.drafts[0] ?? null;
  const canEdit = can(user, "sermon.edit") || can(user, "sermon.create");

  return {
    sermon: {
      id: sermon.id, title: sermon.title, primaryScriptureRef: sermon.primaryScriptureRef, theme: sermon.theme,
      targetDate: sermon.targetDate, status: sermon.status,
      series: sermon.series ? { id: sermon.series.id, title: sermon.series.title } : null,
    },
    canEdit,
    canManage: can(user, "sermon.manage"),
    currentDraft: current
      ? {
          id: current.id, versionNumber: current.versionNumber, generatedBy: current.generatedBy,
          editedSections: JSON.parse(current.editedSections) as DraftSection[],
          outline: current.outlineJson ? (JSON.parse(current.outlineJson) as SermonOutline) : null,
          crossRefs: current.crossRefsJson ? (JSON.parse(current.crossRefsJson) as CrossRefItem[]) : null,
          illustrations: current.illustrationsJson ? (JSON.parse(current.illustrationsJson) as IllustrationItem[]) : null,
          promptInput: current.promptInputJson ? JSON.parse(current.promptInputJson) : null,
          createdAt: current.createdAt,
        }
      : null,
    songs: sermon.songSuggestions.map((s) => ({
      id: s.id, songId: s.songId, title: s.song.title, artist: s.song.artist, ccliNumber: s.song.ccliNumber,
      key: s.song.key, tempo: s.song.tempo, matchReason: s.matchReason, suggestedBy: s.suggestedBy, orderIndex: s.orderIndex,
    })),
    versions: sermon.drafts.map((d) => ({
      id: d.id, versionNumber: d.versionNumber, generatedBy: d.generatedBy,
      editedSections: JSON.parse(d.editedSections) as DraftSection[], createdAt: d.createdAt,
      promptInput: d.promptInputJson ? JSON.parse(d.promptInputJson) : null,
    })),
  };
}

/** Full content of a historical version (for diff view + restore). */
export async function getDraftVersion(user: SessionUser, sermonId: string, versionId: string) {
  assertView(user);
  const d = await db.sermonDraft.findFirst({ where: { id: versionId, sermonId, orgId: user.orgId } });
  if (!d) throw notFound("Draft version not found.");
  return {
    id: d.id, versionNumber: d.versionNumber, generatedBy: d.generatedBy, createdAt: d.createdAt,
    outline: d.outlineJson ? (JSON.parse(d.outlineJson) as SermonOutline) : null,
    crossRefs: d.crossRefsJson ? (JSON.parse(d.crossRefsJson) as CrossRefItem[]) : null,
    illustrations: d.illustrationsJson ? (JSON.parse(d.illustrationsJson) as IllustrationItem[]) : null,
  };
}

/** Restore a historical version as a NEW latest version (history is never rewritten). */
export async function restoreVersion(user: SessionUser, sermonId: string, versionId: string, meta: { ip?: string; userAgent?: string }) {
  assertEdit(user);
  const src = await getDraftVersion(user, sermonId, versionId);
  const sermon = await db.sermon.findFirst({ where: { id: sermonId, orgId: user.orgId } });
  if (!sermon) throw notFound("Sermon not found.");
  const maxV = await db.sermonDraft.aggregate({ where: { sermonId }, _max: { versionNumber: true } });
  const next = (maxV._max.versionNumber ?? 0) + 1;
  await db.sermonDraft.create({
    data: {
      orgId: user.orgId, sermonId, versionNumber: next,
      outlineJson: src.outline ? JSON.stringify(src.outline) : null,
      crossRefsJson: src.crossRefs ? JSON.stringify(src.crossRefs) : null,
      illustrationsJson: src.illustrations ? JSON.stringify(src.illustrations) : null,
      generatedBy: "human", editedSections: JSON.stringify(["outline", "crossRefs", "illustrations"]),
      promptInputJson: JSON.stringify({ restoredFromVersion: src.versionNumber }),
    },
  });
  await audit({ orgId: user.orgId, actor: user, action: "sermon.version_restore", entityType: "sermon_draft", entityId: sermonId, after: { restoredFrom: src.versionNumber, newVersion: next }, ip: meta.ip, userAgent: meta.userAgent });
  return { versionNumber: next };
}

/** Save inline human edits — appends a new version (never overwrites history). */
export async function saveDraftEdit(
  user: SessionUser,
  sermonId: string,
  input: { outline?: SermonOutline; crossRefs?: CrossRefItem[]; illustrations?: IllustrationItem[]; songs?: { songId: string; matchReason?: string; orderIndex?: number }[] },
  meta: { ip?: string; userAgent?: string },
) {
  assertEdit(user);
  const sermon = await db.sermon.findFirst({ where: { id: sermonId, orgId: user.orgId } });
  if (!sermon) throw notFound("Sermon not found.");

  const current = await db.sermonDraft.findFirst({ where: { sermonId }, orderBy: { versionNumber: "desc" } });
  const edited: DraftSection[] = [];
  if (input.outline !== undefined) edited.push("outline");
  if (input.crossRefs !== undefined) edited.push("crossRefs");
  if (input.illustrations !== undefined) edited.push("illustrations");

  const maxV = await db.sermonDraft.aggregate({ where: { sermonId }, _max: { versionNumber: true } });
  const next = (maxV._max.versionNumber ?? 0) + 1;

  await db.sermonDraft.create({
    data: {
      orgId: user.orgId, sermonId, versionNumber: next, generatedBy: "human",
      outlineJson: input.outline !== undefined ? JSON.stringify(input.outline) : current?.outlineJson ?? null,
      crossRefsJson: input.crossRefs !== undefined ? JSON.stringify(input.crossRefs) : current?.crossRefsJson ?? null,
      illustrationsJson: input.illustrations !== undefined ? JSON.stringify(input.illustrations) : current?.illustrationsJson ?? null,
      editedSections: JSON.stringify(edited),
      promptInputJson: current?.promptInputJson ?? null,
    },
  });

  if (input.songs) {
    await db.sermonSongSuggestion.deleteMany({ where: { sermonId } });
    await db.sermonSongSuggestion.createMany({
      data: input.songs.map((s, i) => ({
        orgId: user.orgId, sermonId, songId: s.songId,
        matchReason: s.matchReason ?? "", suggestedBy: "human", orderIndex: s.orderIndex ?? i,
      })),
    });
    edited.push("songs");
  }

  await audit({ orgId: user.orgId, actor: user, action: "sermon.draft_edit", entityType: "sermon_draft", entityId: sermonId, after: { version: next, edited }, ip: meta.ip, userAgent: meta.userAgent });
  return { versionNumber: next, editedSections: edited };
}

// ── AI generation (section-scoped) ───────────────────────────────────────────

export interface GenerateInput {
  theme?: string;
  scriptureRef?: string;
  seriesContext?: string;
  lengthMinutes?: number;
  audienceNotes?: string;
  sections: DraftSection[];
}

async function llmOutline(input: GenerateInput, crossRefs: string[]): Promise<SermonOutline> {
  const minutes = Math.min(90, Math.max(15, Math.round(input.lengthMinutes ?? 35)));
  const points = minutes >= 45 ? "4 to 5" : "3";
  const sys = `You are a homiletics assistant for a Nigerian evangelical pastor. Draft sermon outlines that are biblically faithful, warm, and practical. Return ONLY strict JSON, no prose. Shape:
{"bigIdea": string, "intro": string, "points": [{"title": string, "scripture": string, "subpoints": string[], "application": string}], "closing": string}
Rules: exactly ${points} points. Each subpoint is one sentence. Application is one concrete sentence suited to a Nigerian church congregation. Use the cross-reference shortlist where natural — you may cite a shortlisted reference per point but never invent new references.`;
  const user = `Sermon theme: ${input.theme ?? "(not given)"}
Primary scripture: ${input.scriptureRef ?? "(not given)"}
Series context: ${input.seriesContext ?? "(standalone)"}
Target length: about ${minutes} minutes.
Audience notes: ${input.audienceNotes ?? "(mixed congregation)"}
Cross-reference shortlist (curated, may be cited): ${crossRefs.join("; ") || "(none)"}`;
  const raw = await llmComplete([
    { role: "system", content: sys },
    { role: "user", content: user },
  ], { temperature: 0.6 });
  const parsed = extractJson(raw) as Partial<SermonOutline> | null;
  if (!parsed?.intro || !Array.isArray(parsed.points) || !parsed.points.length || !parsed.closing) {
    throw badRequest("The AI draft could not be parsed. Try generating again.");
  }
  return {
    bigIdea: parsed.bigIdea ?? "",
    intro: parsed.intro,
    points: parsed.points.slice(0, 6).map((p) => ({
      title: String(p.title ?? "").slice(0, 200),
      scripture: p.scripture ? String(p.scripture).slice(0, 120) : undefined,
      subpoints: (Array.isArray(p.subpoints) ? p.subpoints : []).slice(0, 4).map((s) => String(s).slice(0, 300)),
      application: p.application ? String(p.application).slice(0, 400) : undefined,
    })),
    closing: parsed.closing,
  };
}

async function llmIllustrations(input: GenerateInput): Promise<IllustrationItem[]> {
  const sys = `You are an illustration researcher for a Nigerian evangelical pastor. Return ONLY strict JSON:
{"items":[{"type":"personal_story_prompt"|"historical"|"cultural"|"parable"|"scripture_scene","title":string,"text":string}]}
Rules: 2 to 4 items. "personal_story_prompt" is a QUESTION prompting the preacher to share their own story (never fabricate a fake personal anecdote). "cultural" must be authentic Nigerian everyday-life imagery (market, danfo, NEPA/power outage, wedding, farming season, football) — never stereotype. "historical" must be real, verifiable events — no invented quotes. "text" is at most 3 sentences.`;
  const user = `Sermon theme: ${input.theme ?? "(not given)"}\nPrimary scripture: ${input.scriptureRef ?? "(not given)"}\nAudience notes: ${input.audienceNotes ?? "(mixed congregation)"}`;
  const raw = await llmComplete([
    { role: "system", content: sys },
    { role: "user", content: user },
  ], { temperature: 0.7 });
  const parsed = extractJson(raw) as { items?: IllustrationItem[] } | null;
  const items = (parsed?.items ?? []).slice(0, 4).filter((i) => i.title && i.text);
  return items.map((i) => ({
    type: ["personal_story_prompt", "historical", "cultural", "parable", "scripture_scene"].includes(i.type) ? i.type : "parable",
    title: String(i.title).slice(0, 140),
    text: String(i.text).slice(0, 600),
  }));
}

async function llmSongReasons(
  input: GenerateInput,
  matches: ReturnType<typeof matchSongs>,
): Promise<Record<string, string>> {
  if (!matches.length) return {};
  try {
    const sys = `You write one-line worship song fit reasons for a sermon planner. Return ONLY strict JSON: {"reasons": {"<songId>": "<one sentence>"}}. Ground every sentence in the sermon theme/scripture AND the song's matched tags given below. Never claim the song says something not listed.`;
    const user = `Sermon theme: ${input.theme ?? "(not given)"}; scripture: ${input.scriptureRef ?? "(none)"}\nMatched songs:\n${matches.map((m) => `- id=${m.song.id} "${m.song.title}" matchedOn: ${m.matchedOn.join(", ")}`).join("\n")}`;
    const raw = await llmComplete([
      { role: "system", content: sys },
      { role: "user", content: user },
    ], { temperature: 0.4 });
    const parsed = extractJson(raw) as { reasons?: Record<string, string> } | null;
    const out: Record<string, string> = {};
    if (parsed?.reasons) {
      for (const m of matches) {
        const r = parsed.reasons[m.song.id];
        if (typeof r === "string" && r.trim()) out[m.song.id] = r.trim().slice(0, 220);
      }
    }
    return out;
  } catch {
    // Non-fatal: fall back to deterministic match-reason text.
    return Object.fromEntries(matches.map((m) => [m.song.id, `Matched on ${m.matchedOn.join(" · ")}`]));
  }
}

/**
 * Section-scoped regeneration — appends a NEW draft version carrying forward
 * the untouched sections. Songs are matched DETERMINISTICALLY from the real
 * library; the AI only writes match_reason text for those real entries.
 */
export async function generateDraft(
  user: SessionUser,
  sermonId: string,
  input: GenerateInput,
  meta: { ip?: string; userAgent?: string },
) {
  assertEdit(user);
  await assertFeature(user.orgId, "featureSermonStudio");
  const sermon = await db.sermon.findFirst({ where: { id: sermonId, orgId: user.orgId } });
  if (!sermon) throw notFound("Sermon not found.");

  const sections = input.sections.length ? input.sections : (["outline", "crossRefs", "illustrations", "songs"] as DraftSection[]);
  const mergedInput: GenerateInput = {
    theme: input.theme ?? sermon.theme ?? undefined,
    scriptureRef: input.scriptureRef ?? sermon.primaryScriptureRef ?? undefined,
    seriesContext: input.seriesContext ?? undefined,
    lengthMinutes: input.lengthMinutes ?? 35,
    audienceNotes: input.audienceNotes ?? undefined,
    sections,
  };

  const current = await db.sermonDraft.findFirst({ where: { sermonId }, orderBy: { versionNumber: "desc" } });
  const prev = {
    outline: current?.outlineJson ? (JSON.parse(current.outlineJson) as SermonOutline) : null,
    crossRefs: current?.crossRefsJson ? (JSON.parse(current.crossRefsJson) as CrossRefItem[]) : null,
    illustrations: current?.illustrationsJson ? (JSON.parse(current.illustrationsJson) as IllustrationItem[]) : null,
  };

  const next: DraftPayload = { ...prev };
  let crossRefRefs: string[] = [];

  if (sections.includes("crossRefs")) {
    crossRefRefs = findCrossReferences({ theme: mergedInput.theme, scriptureRef: mergedInput.scriptureRef }, 5);
    // Relevance notes: deterministic one-liners (the AI is NOT required here;
    // annotations may be enriched by the pastor inline).
    next.crossRefs = crossRefRefs.map((reference) => ({
      reference,
      relevance: reference.toLowerCase().includes((mergedInput.theme ?? "").toLowerCase().split(" ")[0] ?? "___")
        ? `Speaks directly to the theme "${mergedInput.theme}".`
        : `Supporting passage frequently paired with ${mergedInput.scriptureRef ?? "this theme"}.`,
    }));
  } else {
    crossRefRefs = findCrossReferences({ theme: mergedInput.theme, scriptureRef: mergedInput.scriptureRef }, 5);
  }

  if (sections.includes("outline")) next.outline = await llmOutline(mergedInput, crossRefRefs);
  if (sections.includes("illustrations")) next.illustrations = await llmIllustrations(mergedInput);

  // Deterministic song matching against the REAL library first…
  await ensureStarterLibrary();
  const library = await db.worshipSong.findMany({
    where: { OR: [{ orgId: user.orgId }, { orgId: null }] },
    select: { id: true, title: true, artist: true, ccliNumber: true, themeTags: true, moodTags: true, scriptureRefs: true, key: true, tempo: true, isPublicDomain: true },
  });
  let matchReasons: Record<string, string> = {};
  let matched: ReturnType<typeof matchSongs> = [];
  if (sections.includes("songs")) {
    matched = matchSongs(library, { theme: mergedInput.theme, scriptureRef: mergedInput.scriptureRef }, 6);
    matchReasons = await llmSongReasons(mergedInput, matched);
    await db.sermonSongSuggestion.deleteMany({ where: { sermonId, suggestedBy: "ai" } });
    if (matched.length) {
      await db.sermonSongSuggestion.createMany({
        data: matched.map((m, i) => ({
          orgId: user.orgId, sermonId, songId: m.song.id,
          matchReason: matchReasons[m.song.id] ?? `Matched on ${m.matchedOn.join(" · ")}`,
          suggestedBy: "ai", orderIndex: i,
        })),
      });
    }
  }

  const maxV = await db.sermonDraft.aggregate({ where: { sermonId }, _max: { versionNumber: true } });
  const nextVersion = (maxV._max.versionNumber ?? 0) + 1;
  await db.sermonDraft.create({
    data: {
      orgId: user.orgId, sermonId, versionNumber: nextVersion, generatedBy: "ai",
      outlineJson: next.outline ? JSON.stringify(next.outline) : current?.outlineJson ?? null,
      crossRefsJson: next.crossRefs ? JSON.stringify(next.crossRefs) : current?.crossRefsJson ?? null,
      illustrationsJson: next.illustrations ? JSON.stringify(next.illustrations) : current?.illustrationsJson ?? null,
      editedSections: JSON.stringify([]),
      promptInputJson: JSON.stringify({ ...mergedInput, sections }),
    },
  });

  // If the sermon itself is still untitled/theme-less, adopt the input.
  if (!sermon.theme && mergedInput.theme) {
    await db.sermon.update({ where: { id: sermonId }, data: { theme: mergedInput.theme, primaryScriptureRef: sermon.primaryScriptureRef ?? mergedInput.scriptureRef ?? null } });
  }

  await audit({
    orgId: user.orgId, actor: user, action: "sermon.ai_generate", entityType: "sermon_draft", entityId: sermonId,
    after: { version: nextVersion, sections, songsMatched: matched.map((m) => m.song.title) }, ip: meta.ip, userAgent: meta.userAgent,
  });

  return {
    versionNumber: nextVersion,
    sections,
    outline: next.outline,
    crossRefs: next.crossRefs,
    illustrations: next.illustrations,
    songs: matched.map((m, i) => ({
      songId: m.song.id, title: m.song.title, artist: m.song.artist, ccliNumber: m.song.ccliNumber, key: m.song.key, tempo: m.song.tempo,
      matchReason: matchReasons[m.song.id] ?? `Matched on ${m.matchedOn.join(" · ")}`,
      suggestedBy: "ai" as const, orderIndex: i,
    })),
  };
}

// ── export (print-friendly preaching notes) ──────────────────────────────────

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

export async function exportSermonHtml(user: SessionUser, sermonId: string): Promise<string> {
  assertView(user);
  const data = await getSermon(user, sermonId);
  const d = data.currentDraft;
  const o = d?.outline;
  const parts: string[] = [];
  if (o) {
    parts.push(`<section><h2>Big idea</h2><p class="lead">${esc(o.bigIdea)}</p></section>`);
    parts.push(`<section><h2>Introduction</h2><p>${esc(o.intro)}</p></section>`);
    parts.push(`<section><h2>Outline</h2><ol class="points">${o.points.map((p) => `
      <li><strong>${esc(p.title)}</strong>${p.scripture ? ` <span class="ref">(${esc(p.scripture)})</span>` : ""}
        ${p.subpoints.length ? `<ul>${p.subpoints.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}
        ${p.application ? `<p class="app">Application: ${esc(p.application)}</p>` : ""}
      </li>`).join("")}</ol></section>`);
    parts.push(`<section><h2>Closing</h2><p>${esc(o.closing)}</p></section>`);
  } else {
    parts.push(`<section><p class="muted">No outline drafted yet.</p></section>`);
  }
  if (d?.crossRefs?.length) {
    parts.push(`<section><h2>Cross-references</h2><ul>${d.crossRefs.map((c) => `<li><strong>${esc(c.reference)}</strong> — ${esc(c.relevance)}</li>`).join("")}</ul></section>`);
  }
  if (d?.illustrations?.length) {
    parts.push(`<section><h2>Illustrations</h2><ul>${d.illustrations.map((i) => `<li><strong>${esc(i.title)}</strong> <span class="ref">[${esc(i.type.replace(/_/g, " "))}]</span><br>${esc(i.text)}</li>`).join("")}</ul></section>`);
  }
  if (data.songs.length) {
    parts.push(`<section><h2>Worship set</h2><ol>${data.songs.map((s) => `<li><strong>${esc(s.title)}</strong>${s.artist ? ` — ${esc(s.artist)}` : ""}${s.key ? ` <span class="ref">(${esc(s.key)})</span>` : ""}<br><span class="muted">${esc(s.matchReason)}</span></li>`).join("")}</ol></section>`);
  }

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(data.sermon.title)} — Preaching notes</title>
<style>
  body { font-family: Georgia, 'Times New Roman', serif; max-width: 760px; margin: 32px auto; padding: 0 28px; font-size: 17px; line-height: 1.6; color: #1c1917; }
  h1 { font-size: 30px; margin-bottom: 2px; }
  h2 { font-size: 15px; text-transform: uppercase; letter-spacing: 0.08em; color: #78716c; margin-top: 28px; }
  .meta { color: #57534e; font-size: 14px; margin-bottom: 18px; }
  .lead { font-size: 19px; font-weight: 600; }
  .ref { color: #6d28d9; font-size: 14px; }
  .app { font-style: italic; color: #44403c; }
  .muted { color: #78716c; }
  ul, ol { padding-left: 22px; }
  li { margin: 8px 0; }
  .ai-label { display:inline-block; background:#fef3c7; color:#92400e; border:1px solid #fde68a; border-radius:999px; padding:1px 10px; font-size:11px; font-weight:600; }
  @media print { body { margin: 10mm; font-size: 14pt; } }
</style></head>
<body>
  <h1>${esc(data.sermon.title)}</h1>
  <p class="meta">${data.sermon.series ? `${esc(data.sermon.series.title)} · ` : ""}${data.sermon.primaryScriptureRef ? esc(data.sermon.primaryScriptureRef) + " · " : ""}${data.sermon.targetDate ? new Date(data.sermon.targetDate).toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" }) : ""}<br>
  Version ${d?.versionNumber ?? "—"} · <span class="ai-label">AI-assisted draft — preached at your discretion</span></p>
  ${parts.join("\n")}
</body></html>`;
}
