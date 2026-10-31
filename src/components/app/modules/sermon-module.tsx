"use client";

/**
 * Sermon Studio — AI-assisted, human-owned sermon preparation (Feature 1).
 * Three-pane editor: left = generation input, center = editable outline
 * document, right = regenerable Cross-References / Illustrations / Worship
 * panels. Every AI block is editable; every save/regeneration appends a new
 * draft version (full history, restorable). Songs are matched deterministically
 * from the real worship library — the AI only writes the match reasoning.
 */
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, qs } from "@/lib/api";
import type { SessionUser } from "@/lib/types";
import { fmtDate, fmtDateShort } from "@/lib/types";
import { toast } from "sonner";
import { PageHeader, EmptyState, LoadingBlock, ErrorBlock, type ModuleProps } from "@/components/app/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  BookOpen, Plus, Sparkles, History, Printer, RefreshCw, Save, Trash2, Music4,
  Library, ChevronRight, ArrowLeft, RotateCcw, ListMusic, Download,
} from "lucide-react";
import { cn } from "@/lib/utils";

const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong.");

// ── DTOs ─────────────────────────────────────────────────────────────────────
interface OutlinePoint { title: string; scripture?: string; subpoints: string[]; application?: string }
interface SermonOutline { intro: string; points: OutlinePoint[]; closing: string; bigIdea?: string }
interface CrossRefItem { reference: string; relevance: string }
interface IllustrationItem { type: string; title: string; text: string }

interface SeriesDTO { id: string; title: string; description?: string | null; themeTags: string[]; startDate?: string | null; endDate?: string | null; sermonCount: number; sermons: { id: string; title: string; targetDate?: string | null; status: string }[] }
interface SermonRow { id: string; title: string; primaryScriptureRef?: string | null; theme?: string | null; targetDate?: string | null; status: string; series?: { id: string; title: string } | null; latestDraft?: { id: string; versionNumber: number; createdAt: string; generatedBy: string } | null }
interface SermonDetail {
  sermon: { id: string; title: string; primaryScriptureRef?: string | null; theme?: string | null; targetDate?: string | null; status: string; series?: { id: string; title: string } | null };
  canEdit: boolean;
  canManage: boolean;
  currentDraft: { id: string; versionNumber: number; generatedBy: string; editedSections: string[]; outline: SermonOutline | null; crossRefs: CrossRefItem[] | null; illustrations: IllustrationItem[] | null; createdAt: string } | null;
  songs: { id: string; songId: string; title: string; artist?: string | null; ccliNumber?: string | null; key?: string | null; tempo?: string | null; matchReason: string; suggestedBy: string; orderIndex: number }[];
  versions: { id: string; versionNumber: number; generatedBy: string; editedSections: string[]; createdAt: string; promptInput?: { theme?: string; scriptureRef?: string; lengthMinutes?: number; audienceNotes?: string } | null }[];
}
interface SongRow { id: string; title: string; artist?: string | null; ccliNumber?: string | null; themeTags: string[]; moodTags: string[]; scriptureRefs: string[]; key?: string | null; tempo?: string | null; lyricsExcerpt?: string | null; isPublicDomain: boolean; isChurchOwned: boolean }

const STATUS_TONE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  reviewed: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  final: "bg-teal-100 text-teal-900 dark:bg-teal-950 dark:text-teal-200",
  preached: "bg-muted text-muted-foreground",
};

// ── module ───────────────────────────────────────────────────────────────────
export default function SermonModule({ user }: ModuleProps) {
  const [tab, setTab] = useState<"sermons" | "series" | "library">("sermons");
  const [openSermonId, setOpenSermonId] = useState<string | null>(null);

  if (openSermonId) {
    return <SermonEditor user={user} sermonId={openSermonId} onBack={() => setOpenSermonId(null)} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sermon Studio"
        description="Draft outlines, cross-references, illustrations and worship sets with AI assistance — every block stays editable, versioned, and yours to approve."
      />
      <div role="tablist" aria-label="Sermon Studio sections" className="inline-flex h-9 items-center gap-1 rounded-lg bg-muted p-[3px] text-muted-foreground">
        {([
          { v: "sermons", label: "Sermons" },
          { v: "series", label: "Series" },
          { v: "library", label: "Song library" },
        ] as const).map((t) => (
          <button
            key={t.v} type="button" role="tab" aria-selected={tab === t.v}
            onClick={() => setTab(t.v)}
            className={cn(
              "inline-flex h-[calc(100%-1px)] items-center justify-center rounded-md border border-transparent px-3 py-1 text-sm font-medium whitespace-nowrap transition-[color,box-shadow]",
              tab === t.v ? "bg-background text-foreground shadow-sm" : "hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "sermons" ? <SermonsTab user={user} onOpen={setOpenSermonId} />
        : tab === "series" ? <SeriesTab user={user} />
        : <LibraryTab user={user} />}
    </div>
  );
}

// ── sermons list ─────────────────────────────────────────────────────────────
function SermonsTab({ user, onOpen }: ModuleProps & { onOpen: (id: string) => void }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("all");
  const [newOpen, setNewOpen] = useState(false);
  const canCreate = user.permissions.includes("sermon.create") || user.permissions.includes("*") || user.permissions.some((p) => p === "sermon.*");

  const sermonsQ = useQuery({
    queryKey: ["sermons", "list", status],
    queryFn: () => api.get<{ items: SermonRow[] }>(`/sermons${qs({ status })}`),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {["all", "draft", "reviewed", "final", "preached"].map((s) => (
          <button key={s} type="button" onClick={() => setStatus(s)} className={cn(
            "rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors",
            status === s ? "border-primary bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-accent",
          )}>{s}</button>
        ))}
        <Button className="ml-auto" onClick={() => setNewOpen(true)} disabled={!canCreate}>
          <Plus className="h-4 w-4" aria-hidden /> New sermon
        </Button>
      </div>

      {sermonsQ.isLoading ? <LoadingBlock label="Loading sermons…" />
        : sermonsQ.isError ? <ErrorBlock error={sermonsQ.error} />
        : !sermonsQ.data?.items.length ? (
          <EmptyState
            icon={BookOpen}
            title="No sermons yet"
            description="Create a sermon, then let AI draft an outline, cross-references, illustrations and a worship set you can edit."
            action={canCreate ? <Button onClick={() => setNewOpen(true)}><Plus className="h-4 w-4" aria-hidden /> New sermon</Button> : undefined}
          />
        ) : (
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2.5 font-semibold">Title</th>
                    <th className="hidden px-4 py-2.5 font-semibold sm:table-cell">Scripture</th>
                    <th className="hidden px-4 py-2.5 font-semibold md:table-cell">Date</th>
                    <th className="hidden px-4 py-2.5 font-semibold lg:table-cell">Series</th>
                    <th className="px-4 py-2.5 font-semibold">Status</th>
                    <th className="w-10 px-2 py-2.5" aria-hidden />
                  </tr>
                </thead>
                <tbody>
                  {sermonsQ.data.items.map((s) => (
                    <tr key={s.id} className="group cursor-pointer border-b transition-colors last:border-0 hover:bg-accent/50" onClick={() => onOpen(s.id)}>
                      <td className="px-4 py-3 font-medium">
                        {s.title}
                        {s.latestDraft ? <span className="ml-2 text-xs text-muted-foreground">v{s.latestDraft.versionNumber}</span> : null}
                      </td>
                      <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">{s.primaryScriptureRef ?? "—"}</td>
                      <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">{s.targetDate ? fmtDateShort(s.targetDate) : "—"}</td>
                      <td className="hidden px-4 py-3 text-muted-foreground lg:table-cell">{s.series?.title ?? "—"}</td>
                      <td className="px-4 py-3"><Badge variant="outline" className={cn("capitalize", STATUS_TONE[s.status])}>{s.status}</Badge></td>
                      <td className="px-2 py-3 text-muted-foreground"><ChevronRight className="h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}

      <NewSermonDialog open={newOpen} onClose={() => setNewOpen(false)} onCreated={(id) => { setNewOpen(false); onOpen(id); }} queryClient={queryClient} />
    </div>
  );
}

function NewSermonDialog({ open, onClose, onCreated, queryClient }: { open: boolean; onClose: () => void; onCreated: (id: string) => void; queryClient: ReturnType<typeof useQueryClient> }) {
  const [title, setTitle] = useState("");
  const [scripture, setScripture] = useState("");
  const [theme, setTheme] = useState("");
  const [date, setDate] = useState("");

  const createMut = useMutation({
    mutationFn: () => api.post<{ id: string }>("/sermons", { title, primaryScriptureRef: scripture || undefined, theme: theme || undefined, targetDate: date || undefined }),
    onSuccess: (res) => {
      toast.success("Sermon created");
      queryClient.invalidateQueries({ queryKey: ["sermons"] });
      onCreated(res.id);
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New sermon</DialogTitle>
          <DialogDescription>Set the basics now — AI drafting happens inside the editor.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label htmlFor="ns-title">Title *</Label><Input id="ns-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Roots in the Storm" /></div>
          <div className="space-y-1.5"><Label htmlFor="ns-ref">Primary scripture</Label><Input id="ns-ref" value={scripture} onChange={(e) => setScripture(e.target.value)} placeholder="e.g. Mark 4:35-41" /></div>
          <div className="space-y-1.5"><Label htmlFor="ns-theme">Theme</Label><Input id="ns-theme" value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="e.g. trusting Jesus when life is stormy" /></div>
          <div className="space-y-1.5"><Label htmlFor="ns-date">Target date</Label><Input id="ns-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!title.trim() || createMut.isPending} onClick={() => createMut.mutate()}>{createMut.isPending ? "Creating…" : "Create sermon"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── three-pane editor ────────────────────────────────────────────────────────
function SermonEditor({ user, sermonId, onBack }: ModuleProps & { sermonId: string; onBack: () => void }) {
  const queryClient = useQueryClient();
  const detailQ = useQuery({
    queryKey: ["sermons", "detail", sermonId],
    queryFn: () => api.get<SermonDetail>(`/sermons/${sermonId}`),
  });

  if (detailQ.isLoading) return <LoadingBlock label="Loading sermon…" />;
  if (detailQ.isError) return <ErrorBlock error={detailQ.error} />;
  const data = detailQ.data!;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4" aria-hidden /> All sermons</Button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-xl font-semibold tracking-[-0.01em]">{data.sermon.title}</h2>
          <p className="text-xs text-muted-foreground">
            {data.sermon.series ? `${data.sermon.series.title} · ` : ""}
            {data.sermon.primaryScriptureRef ?? "no scripture yet"} · {data.sermon.targetDate ? fmtDate(data.sermon.targetDate) : "no date"}
          </p>
        </div>
        <a href={`/api/v1/sermons/${sermonId}/export`} target="_blank" rel="noreferrer">
          <Button variant="outline" size="sm"><Printer className="h-4 w-4" aria-hidden /> Preaching notes</Button>
        </a>
        <VersionDrawer sermonId={sermonId} versions={data.versions} canEdit={data.canEdit} queryClient={queryClient} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)_340px]">
        <GeneratePane sermonId={sermonId} detail={data} queryClient={queryClient} user={user} />
        <OutlinePane sermonId={sermonId} detail={data} queryClient={queryClient} />
        <SidePane sermonId={sermonId} detail={data} queryClient={queryClient} user={user} />
      </div>
    </div>
  );
}

function GeneratePane({ sermonId, detail, queryClient, user }: { sermonId: string; detail: SermonDetail; queryClient: ReturnType<typeof useQueryClient>; user: SessionUser }) {
  const [theme, setTheme] = useState(detail.sermon.theme ?? "");
  const [scriptureRef, setScriptureRef] = useState(detail.sermon.primaryScriptureRef ?? "");
  const [lengthMinutes, setLengthMinutes] = useState(35);
  const [audienceNotes, setAudienceNotes] = useState("");

  const genMut = useMutation({
    mutationFn: (sections: string[]) =>
      api.post(`/sermons/${sermonId}/generate`, {
        theme: theme || undefined, scriptureRef: scriptureRef || undefined,
        lengthMinutes, audienceNotes: audienceNotes || undefined, sections,
      }),
    onSuccess: (_res, sections) => {
      toast.success(sections.length === 4 ? "Full draft generated — review every block before preaching" : "Section regenerated — previous version kept in history");
      queryClient.invalidateQueries({ queryKey: ["sermons", "detail", sermonId] });
      queryClient.invalidateQueries({ queryKey: ["sermons", "list"] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const canEdit = detail.canEdit;
  return (
    <Card className="h-fit">
      <CardContent className="space-y-3 p-4">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden /> Prepare with AI</p>
        <div className="space-y-1.5">
          <Label htmlFor="gen-theme">Theme</Label>
          <Input id="gen-theme" value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="What is this sermon about?" disabled={!canEdit} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="gen-ref">Primary scripture</Label>
          <Input id="gen-ref" value={scriptureRef} onChange={(e) => setScriptureRef(e.target.value)} placeholder="e.g. Psalm 23" disabled={!canEdit} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="gen-len">Length (minutes)</Label>
          <Input id="gen-len" type="number" min={15} max={90} value={lengthMinutes} onChange={(e) => setLengthMinutes(Number(e.target.value) || 35)} disabled={!canEdit} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="gen-aud">Audience notes</Label>
          <Textarea id="gen-aud" rows={3} value={audienceNotes} onChange={(e) => setAudienceNotes(e.target.value)} placeholder="e.g. young families, end-of-year fatigue" disabled={!canEdit} />
        </div>
        <Button className="w-full" disabled={!canEdit || genMut.isPending} onClick={() => genMut.mutate(["outline", "crossRefs", "illustrations", "songs"])}>
          {genMut.isPending ? <><RefreshCw className="h-4 w-4 animate-spin" aria-hidden /> Drafting…</> : <><Sparkles className="h-4 w-4" aria-hidden /> Generate full draft</>}
        </Button>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Songs are matched from your real worship library — AI never invents songs. Cross-references come from a curated dataset. You approve everything.
        </p>
        {detail.currentDraft ? (
          <p className="border-t pt-2 text-[11px] text-muted-foreground">
            Current: v{detail.currentDraft.versionNumber} · {detail.currentDraft.generatedBy === "ai" ? "AI draft" : "human edit"} · {fmtDateShort(detail.currentDraft.createdAt)}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function OutlinePane({ sermonId, detail, queryClient }: { sermonId: string; detail: SermonDetail; queryClient: ReturnType<typeof useQueryClient> }) {
  const [outline, setOutline] = useState<SermonOutline | null>(detail.currentDraft?.outline ?? null);
  const [dirty, setDirty] = useState(false);
  const o = outline ?? detail.currentDraft?.outline ?? null;

  const saveMut = useMutation({
    mutationFn: () => api.post<{ versionNumber: number }>(`/sermons/${sermonId}/drafts`, { outline }),
    onSuccess: (res) => {
      toast.success(`Edits saved as version ${res.versionNumber}`);
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ["sermons", "detail", sermonId] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  function edit(fn: (draft: SermonOutline) => void) {
    if (!o) return;
    const copy = JSON.parse(JSON.stringify(o)) as SermonOutline;
    fn(copy);
    setOutline(copy);
    setDirty(true);
  }

  if (!o) {
    return (
      <Card>
        <CardContent className="p-6">
          <EmptyState icon={BookOpen} title="No outline yet" description="Generate a full draft from the left pane, or start writing after your first generation." />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Outline document — editable</p>
          {dirty ? (
            <Button size="sm" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
              <Save className="h-4 w-4" aria-hidden /> {saveMut.isPending ? "Saving…" : "Save edits"}
            </Button>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label className="text-[11px] uppercase text-muted-foreground">Big idea</Label>
          <Input value={o.bigIdea ?? ""} onChange={(e) => edit((d) => { d.bigIdea = e.target.value; })} className="font-medium" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-[11px] uppercase text-muted-foreground">Introduction</Label>
          <Textarea rows={3} value={o.intro} onChange={(e) => edit((d) => { d.intro = e.target.value; })} />
        </div>
        <ol className="space-y-4 border-l-2 border-primary/20 pl-4">
          {o.points.map((p, i) => (
            <li key={i} className="space-y-2">
              <div className="flex gap-2">
                <Input value={p.title} onChange={(e) => edit((d) => { d.points[i].title = e.target.value; })} className="font-semibold" placeholder={`Point ${i + 1}`} />
                <Input value={p.scripture ?? ""} onChange={(e) => edit((d) => { d.points[i].scripture = e.target.value; })} className="w-36 shrink-0 text-sm" placeholder="Scripture" />
              </div>
              <Textarea rows={Math.max(2, p.subpoints.length || 2)} value={p.subpoints.join("\n")}
                onChange={(e) => edit((d) => { d.points[i].subpoints = e.target.value.split("\n").filter((s) => s.trim()); })}
                placeholder="One sub-point per line" className="text-sm" />
              <Input value={p.application ?? ""} onChange={(e) => edit((d) => { d.points[i].application = e.target.value; })} placeholder="Application…" className="text-sm italic" />
            </li>
          ))}
        </ol>
        <div className="space-y-1.5">
          <Label className="text-[11px] uppercase text-muted-foreground">Closing</Label>
          <Textarea rows={3} value={o.closing} onChange={(e) => edit((d) => { d.closing = e.target.value; })} />
        </div>
      </CardContent>
    </Card>
  );
}

function SidePane({ sermonId, detail, queryClient, user }: { sermonId: string; detail: SermonDetail; queryClient: ReturnType<typeof useQueryClient>; user: SessionUser }) {
  const [tab, setTab] = useState<"refs" | "ills" | "songs">("refs");
  return (
    <Card className="h-fit">
      <CardContent className="p-4">
        <div role="tablist" aria-label="Sermon resources" className="mb-3 flex gap-1 rounded-lg bg-muted p-[3px]">
          {([
            { v: "refs", label: "Cross-refs" }, { v: "ills", label: "Illustrations" }, { v: "songs", label: "Worship" },
          ] as const).map((t) => (
            <button key={t.v} type="button" role="tab" aria-selected={tab === t.v} onClick={() => setTab(t.v)}
              className={cn("flex-1 rounded-md px-2 py-1 text-xs font-medium", tab === t.v ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              {t.label}
            </button>
          ))}
        </div>
        {tab === "refs" ? <CrossRefsPanel sermonId={sermonId} detail={detail} queryClient={queryClient} />
          : tab === "ills" ? <IllustrationsPanel sermonId={sermonId} detail={detail} queryClient={queryClient} />
          : <SongsPanel sermonId={sermonId} detail={detail} queryClient={queryClient} user={user} />}
      </CardContent>
    </Card>
  );
}

function useRegenerate(sermonId: string, queryClient: ReturnType<typeof useQueryClient>) {
  return useMutation({
    mutationFn: (sections: string[]) => api.post(`/sermons/${sermonId}/generate`, { sections }),
    onSuccess: (_r, sections) => {
      toast.success(`Regenerated: ${sections.join(", ")} — prior version preserved`);
      queryClient.invalidateQueries({ queryKey: ["sermons", "detail", sermonId] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });
}

function CrossRefsPanel({ sermonId, detail, queryClient }: { sermonId: string; detail: SermonDetail; queryClient: ReturnType<typeof useQueryClient> }) {
  const refs = detail.currentDraft?.crossRefs ?? [];
  const [items, setItems] = useState(refs);
  const [dirty, setDirty] = useState(false);
  const regenMut = useRegenerate(sermonId, queryClient);
  const saveMut = useMutation({
    mutationFn: () => api.post<{ versionNumber: number }>(`/sermons/${sermonId}/drafts`, { crossRefs: items }),
    onSuccess: () => { toast.success("Cross-references saved"); setDirty(false); queryClient.invalidateQueries({ queryKey: ["sermons", "detail", sermonId] }); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const current = detail.currentDraft?.crossRefs ?? [];
  const shown = dirty ? items : current;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">Curated dataset — AI never invents references.</p>
        <div className="flex gap-1">
          {dirty ? <Button size="sm" variant="outline" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}><Save className="h-3.5 w-3.5" aria-hidden /> Save</Button> : null}
          <Button size="sm" variant="ghost" aria-label="Regenerate cross-references" disabled={regenMut.isPending || !detail.canEdit} onClick={() => regenMut.mutate(["crossRefs"])}>
            <RefreshCw className={cn("h-3.5 w-3.5", regenMut.isPending && "animate-spin")} aria-hidden />
          </Button>
        </div>
      </div>
      {!shown.length ? <p className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">No cross-references yet — generate a draft.</p> : null}
      {shown.map((c, i) => (
        <div key={i} className="rounded-lg border p-2.5">
          <p className="text-sm font-semibold text-primary">{c.reference}</p>
          <Textarea rows={2} className="mt-1 text-xs" value={c.relevance}
            onChange={(e) => { const copy = [...(dirty ? items : current)]; copy[i] = { ...copy[i], relevance: e.target.value }; setItems(copy); setDirty(true); }} />
        </div>
      ))}
    </div>
  );
}

function IllustrationsPanel({ sermonId, detail, queryClient }: { sermonId: string; detail: SermonDetail; queryClient: ReturnType<typeof useQueryClient> }) {
  const current = detail.currentDraft?.illustrations ?? [];
  const [items, setItems] = useState(current);
  const [dirty, setDirty] = useState(false);
  const regenMut = useRegenerate(sermonId, queryClient);
  const saveMut = useMutation({
    mutationFn: () => api.post<{ versionNumber: number }>(`/sermons/${sermonId}/drafts`, { illustrations: items }),
    onSuccess: () => { toast.success("Illustrations saved"); setDirty(false); queryClient.invalidateQueries({ queryKey: ["sermons", "detail", sermonId] }); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const shown = dirty ? items : current;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">Prompts & stories — edit anything before use.</p>
        <div className="flex gap-1">
          {dirty ? <Button size="sm" variant="outline" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}><Save className="h-3.5 w-3.5" aria-hidden /> Save</Button> : null}
          <Button size="sm" variant="ghost" aria-label="Regenerate illustrations" disabled={regenMut.isPending || !detail.canEdit} onClick={() => regenMut.mutate(["illustrations"])}>
            <RefreshCw className={cn("h-3.5 w-3.5", regenMut.isPending && "animate-spin")} aria-hidden />
          </Button>
        </div>
      </div>
      {!shown.length ? <p className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">No illustrations yet — generate a draft.</p> : null}
      {shown.map((il, i) => (
        <div key={i} className="rounded-lg border p-2.5">
          <div className="flex items-center justify-between gap-2">
            <Badge variant="outline" className="text-[10px] capitalize">{il.type.replace(/_/g, " ")}</Badge>
            <Input className="h-7 border-0 p-0 text-xs font-semibold shadow-none focus-visible:ring-0" value={il.title}
              onChange={(e) => { const copy = [...(dirty ? items : current)]; copy[i] = { ...copy[i], title: e.target.value }; setItems(copy); setDirty(true); }} />
          </div>
          <Textarea rows={3} className="mt-1.5 text-xs" value={il.text}
            onChange={(e) => { const copy = [...(dirty ? items : current)]; copy[i] = { ...copy[i], text: e.target.value }; setItems(copy); setDirty(true); }} />
        </div>
      ))}
    </div>
  );
}

function SongsPanel({ sermonId, detail, queryClient, user }: { sermonId: string; detail: SermonDetail; queryClient: ReturnType<typeof useQueryClient>; user: SessionUser }) {
  const [search, setSearch] = useState("");
  const regenMut = useRegenerate(sermonId, queryClient);
  const libraryQ = useQuery({
    queryKey: ["worship", "songs", search],
    queryFn: () => api.get<{ items: SongRow[] }>(`/worship-songs${qs({ search })}`),
    enabled: !!user.permissions.includes("sermon.library.manage") || user.permissions.includes("*") || search.length > 1,
  });
  const addMut = useMutation({
    mutationFn: (songId: string) => {
      const current = detail.songs.map((s, i) => ({ songId: s.songId, matchReason: s.matchReason, orderIndex: i }));
      return api.post<{ versionNumber: number }>(`/sermons/${sermonId}/drafts`, { songs: [...current, { songId }] });
    },
    onSuccess: () => { toast.success("Song added to the set"); queryClient.invalidateQueries({ queryKey: ["sermons", "detail", sermonId] }); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const removeMut = useMutation({
    mutationFn: (songId: string) => {
      const current = detail.songs.filter((s) => s.songId !== songId).map((s, i) => ({ songId: s.songId, matchReason: s.matchReason, orderIndex: i }));
      return api.post<{ versionNumber: number }>(`/sermons/${sermonId}/drafts`, { songs: current });
    },
    onSuccess: () => { toast.success("Song removed"); queryClient.invalidateQueries({ queryKey: ["sermons", "detail", sermonId] }); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const canManageLibrary = user.permissions.includes("sermon.library.manage") || user.permissions.includes("*");

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">Matched from your real library — AI only writes the reason.</p>
        <Button size="sm" variant="ghost" aria-label="Regenerate worship suggestions" disabled={regenMut.isPending || !detail.canEdit} onClick={() => regenMut.mutate(["songs"])}>
          <RefreshCw className={cn("h-3.5 w-3.5", regenMut.isPending && "animate-spin")} aria-hidden />
        </Button>
      </div>
      {!detail.songs.length ? <p className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">No songs matched yet — regenerate after setting a theme.</p> : null}
      {detail.songs.map((s, i) => (
        <div key={s.id} className="group flex items-start gap-2.5 rounded-lg border p-2.5">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10"><ListMusic className="h-3.5 w-3.5 text-primary" aria-hidden /></span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{i + 1}. {s.title}</p>
            <p className="truncate text-xs text-muted-foreground">{s.artist ?? "—"}{s.key ? ` · ${s.key}` : ""}{s.ccliNumber ? ` · CCLI ${s.ccliNumber}` : ""}</p>
            <p className="mt-1 text-xs italic text-muted-foreground">{s.matchReason}</p>
          </div>
          {detail.canEdit ? (
            <Button size="sm" variant="ghost" className="opacity-0 transition-opacity group-hover:opacity-100" aria-label={`Remove ${s.title}`} onClick={() => removeMut.mutate(s.songId)}>
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </Button>
          ) : null}
        </div>
      ))}
      {canManageLibrary ? (
        <div className="border-t pt-3">
          <div className="flex items-center gap-1.5 pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Library className="h-3.5 w-3.5" aria-hidden /> Add from library</div>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title, artist, theme…" className="h-8 text-sm" />
          <div className="scroll-slim mt-2 max-h-56 space-y-1 overflow-y-auto">
            {(libraryQ.data?.items ?? []).filter((s) => !detail.songs.some((x) => x.songId === s.id)).slice(0, 30).map((s) => (
              <button key={s.id} type="button" onClick={() => addMut.mutate(s.id)} disabled={addMut.isPending}
                className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent">
                <span className="min-w-0 truncate">{s.title}<span className="ml-1.5 text-xs text-muted-foreground">{s.artist ?? ""}</span></span>
                <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function VersionDrawer({ sermonId, versions, canEdit, queryClient }: { sermonId: string; versions: SermonDetail["versions"]; canEdit: boolean; queryClient: ReturnType<typeof useQueryClient> }) {
  const [open, setOpen] = useState(false);
  const restoreMut = useMutation({
    mutationFn: (versionId: string) => api.post<{ versionNumber: number }>(`/sermons/${sermonId}/versions/${versionId}/restore`, {}),
    onSuccess: (res) => {
      toast.success(`Restored as version ${res.versionNumber} — history preserved`);
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ["sermons", "detail", sermonId] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm"><History className="h-4 w-4" aria-hidden /> History ({versions.length})</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onClick={() => setOpen(true)}><History className="h-4 w-4" aria-hidden /> Browse & restore versions</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Version history</DialogTitle>
          <DialogDescription>Every generation and edit appends a version — nothing is overwritten. Restoring creates a new version.</DialogDescription>
        </DialogHeader>
        <div className="scroll-slim max-h-96 space-y-2 overflow-y-auto">
          {versions.map((v) => (
            <div key={v.id} className="flex items-center justify-between gap-2 rounded-lg border p-2.5">
              <div>
                <p className="text-sm font-semibold">v{v.versionNumber} <Badge variant="outline" className="ml-1 text-[10px] capitalize">{v.generatedBy === "ai" ? "AI draft" : "human edit"}</Badge></p>
                <p className="text-xs text-muted-foreground">{fmtDate(v.createdAt)}{v.editedSections.length ? ` · edited: ${v.editedSections.join(", ")}` : ""}</p>
                {v.promptInput?.theme ? <p className="mt-0.5 text-[11px] text-muted-foreground">input: “{v.promptInput.theme}”</p> : null}
              </div>
              {canEdit ? (
                <Button size="sm" variant="outline" disabled={restoreMut.isPending} onClick={() => restoreMut.mutate(v.id)}>
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Restore
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── series tab ───────────────────────────────────────────────────────────────
function SeriesTab({ user }: ModuleProps) {
  const queryClient = useQueryClient();
  const [newOpen, setNewOpen] = useState(false);
  const seriesQ = useQuery({ queryKey: ["sermons", "series"], queryFn: () => api.get<{ items: SeriesDTO[] }>("/sermons/series") });
  const canManage = user.permissions.includes("sermon.create") || user.permissions.includes("sermon.manage") || user.permissions.includes("*");

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setNewOpen(true)} disabled={!canManage}><Plus className="h-4 w-4" aria-hidden /> New series</Button>
      </div>
      {seriesQ.isLoading ? <LoadingBlock label="Loading series…" />
        : seriesQ.isError ? <ErrorBlock error={seriesQ.error} />
        : !seriesQ.data?.items.length ? (
          <EmptyState icon={Library} title="No series yet" description="Group sermons into a series — e.g. a teaching campaign through a book." />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {seriesQ.data.items.map((s) => (
              <Card key={s.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold">{s.title}</p>
                      <p className="line-clamp-2 text-sm text-muted-foreground">{s.description ?? "No description"}</p>
                    </div>
                    <Badge variant="outline">{s.sermonCount} sermon{s.sermonCount === 1 ? "" : "s"}</Badge>
                  </div>
                  {s.sermons.length ? (
                    <ul className="mt-3 space-y-1 border-t pt-2">
                      {s.sermons.slice(0, 4).map((x) => (
                        <li key={x.id} className="flex items-center justify-between text-sm">
                          <span className="truncate">{x.title}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">{x.targetDate ? fmtDateShort(x.targetDate) : ""}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      <NewSeriesDialog open={newOpen} onClose={() => setNewOpen(false)} queryClient={queryClient} />
    </div>
  );
}

function NewSeriesDialog({ open, onClose, queryClient }: { open: boolean; onClose: () => void; queryClient: ReturnType<typeof useQueryClient> }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const mut = useMutation({
    mutationFn: () => api.post("/sermons/series", { title, description: description || undefined, themeTags: tags.split(",").map((t) => t.trim()).filter(Boolean) }),
    onSuccess: () => { toast.success("Series created"); queryClient.invalidateQueries({ queryKey: ["sermons", "series"] }); onClose(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>New series</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label htmlFor="sr-title">Title *</Label><Input id="sr-title" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="sr-desc">Description</Label><Textarea id="sr-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="sr-tags">Theme tags (comma-separated)</Label><Input id="sr-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="faith, storms, trust" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!title.trim() || mut.isPending} onClick={() => mut.mutate()}>{mut.isPending ? "Creating…" : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── song library tab ─────────────────────────────────────────────────────────
function LibraryTab({ user }: ModuleProps) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const libQ = useQuery({ queryKey: ["worship", "library", search], queryFn: () => api.get<{ items: SongRow[] }>(`/worship-songs${qs({ search })}`) });
  const canManage = user.permissions.includes("sermon.library.manage") || user.permissions.includes("*");
  const delMut = useMutation({
    mutationFn: (id: string) => api.del(`/worship-songs/${id}`),
    onSuccess: () => { toast.success("Song removed from your church library"); queryClient.invalidateQueries({ queryKey: ["worship"] }); },
    onError: (e) => toast.error(errMsg(e)),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title, artist, theme, scripture…" className="max-w-sm" />
        <p className="text-xs text-muted-foreground">{libQ.data?.items.length ?? 0} songs · shared starter library is read-only</p>
      </div>
      {libQ.isLoading ? <LoadingBlock label="Loading library…" />
        : libQ.isError ? <ErrorBlock error={libQ.error} />
        : !libQ.data?.items.length ? (
          <EmptyState icon={Music4} title="No songs match" description="Try a different search — the shared starter library is always available for matching." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {libQ.data.items.map((s) => (
              <Card key={s.id} className="group">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{s.title}</p>
                      <p className="truncate text-xs text-muted-foreground">{s.artist ?? "—"}{s.ccliNumber ? ` · CCLI ${s.ccliNumber}` : ""}{s.key ? ` · ${s.key}` : ""}</p>
                    </div>
                    {s.isChurchOwned && canManage ? (
                      <Button size="sm" variant="ghost" className="opacity-0 transition-opacity group-hover:opacity-100" aria-label={`Delete ${s.title}`} onClick={() => delMut.mutate(s.id)}>
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                    ) : null}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {s.themeTags.slice(0, 4).map((t) => <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>)}
                  </div>
                  {s.lyricsExcerpt ? <p className="mt-2 line-clamp-2 border-l-2 pl-2 text-xs italic text-muted-foreground">{s.lyricsExcerpt}</p> : null}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
    </div>
  );
}
