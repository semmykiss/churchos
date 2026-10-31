/**
 * Sermon Studio — curated static datasets (backend only).
 *
 * 1. CROSS_REFS: curated public-domain cross-reference pairs keyed by book
 *    prefix + topical buckets. Used deterministically — the AI NEVER invents
 *    cross-references; it can only rank/annotate what this dataset returns.
 * 2. STARTER_WORSHIP_LIBRARY: shared global starter library (orgId = null).
 *    Public-domain hymns carry lyrics excerpts; copyrighted contemporary
 *    entries carry FACTUAL METADATA ONLY (title/artist/CCLI/themes — no lyrics).
 *    Song suggestions are matched deterministically from this library; the AI
 *    only writes the match_reason text. It can never fabricate a song.
 */

export interface CrossRefEntry {
  reference: string;
  topics: string[];
}

/** Curated canonical cross-reference graph (public domain knowledge). */
export const CROSS_REFS: CrossRefEntry[] = [
  { reference: "John 3:16", topics: ["gospel", "love", "salvation", "eternal life", "romans 5", "1 john 4", "ephesians 2"] },
  { reference: "Romans 8:28", topics: ["hope", "trust", "purpose", "providence", "jeremiah 29", "genesis 50", "psalm 23"] },
  { reference: "Romans 8:38-39", topics: ["assurance", "love", "perseverance", "psalm 46", "hebrews 13"] },
  { reference: "Philippians 4:6-7", topics: ["anxiety", "peace", "prayer", "1 peter 5", "matthew 6", "psalm 46"] },
  { reference: "Philippians 4:13", topics: ["strength", "contentment", "2 corinthians 12", "isaiah 40"] },
  { reference: "Proverbs 3:5-6", topics: ["trust", "guidance", "decisions", "psalm 37", "isaiah 55"] },
  { reference: "Jeremiah 29:11", topics: ["hope", "future", "plans", "exile", "romans 8", "psalm 121"] },
  { reference: "Isaiah 41:10", topics: ["fear", "courage", "strength", "joshua 1", "deuteronomy 31", "psalm 27"] },
  { reference: "Matthew 11:28-30", topics: ["rest", "burden", "weary", "burnout", "psalm 23", "1 peter 5"] },
  { reference: "Matthew 6:33", topics: ["priorities", "provision", "kingdom", "luke 12", "psalm 37"] },
  { reference: "Psalm 23:1-4", topics: ["comfort", "shepherd", "dark valleys", "grief", "john 10", "ezekiel 34", "1 peter 2"] },
  { reference: "Joshua 1:9", topics: ["courage", "fear", "strength", "isaiah 41", "2 timothy 1"] },
  { reference: "1 Corinthians 13:4-7", topics: ["love", "marriage", "patience", "1 john 4", "colossians 3"] },
  { reference: "Galatians 5:22-23", topics: ["fruit of the spirit", "character", "holy spirit", "john 15", "psalm 1"] },
  { reference: "Ephesians 2:8-9", topics: ["grace", "salvation", "faith", "romans 3", "titus 3", "john 3"] },
  { reference: "Hebrews 11:1", topics: ["faith", "abraham", "assurance", "romans 4", "james 2"] },
  { reference: "James 1:2-4", topics: ["perseverance", "trials", "endurance", "romans 5", "1 peter 1"] },
  { reference: "1 Peter 5:7", topics: ["anxiety", "care", "worry", "matthew 11", "psalm 55"] },
  { reference: "Psalm 34:18", topics: ["broken heart", "grief", "depression", "comfort", "psalm 147", "matthew 5"] },
  { reference: "Psalm 147:3", topics: ["healing", "heartbreak", "jeremiah 30", "isaiah 61"] },
  { reference: "2 Corinthians 12:9", topics: ["weakness", "grace", "strength", "philippians 4", "1 corinthians 1"] },
  { reference: "Lamentations 3:22-23", topics: ["mercy", "faithfulness", "new beginnings", "great is thy faithfulness", "psalm 51"] },
  { reference: "Romans 12:2", topics: ["renewal", "mind", "transformation", "ephesians 4", "colossians 3"] },
  { reference: "Psalm 46:1", topics: ["refuge", "trouble", "strength", "psalm 62", "psalm 91"] },
  { reference: "Psalm 121:1-2", topics: ["help", "protection", "pilgrimage", "psalm 91", "psalm 124"] },
  { reference: "Isaiah 40:31", topics: ["strength", "renewal", "weariness", "waiting", "2 corinthians 4"] },
  { reference: "Deuteronomy 31:6", topics: ["courage", "loneliness", "presence", "joshua 1", "hebrews 13"] },
  { reference: "Zephaniah 3:17", topics: ["joy", "love", "comfort", "psalm 16", "isaiah 62"] },
  { reference: "2 Corinthians 9:7", topics: ["giving", "generosity", "money", "proverbs 11", "luke 6"] },
  { reference: "Malachi 3:10", topics: ["tithe", "giving", "blessing", "storehouse", "proverbs 3", "luke 6"] },
  { reference: "Luke 6:38", topics: ["giving", "generosity", "measure", "2 corinthians 9"] },
  { reference: "Acts 20:35", topics: ["giving", "service", "work", "galatians 6"] },
  { reference: "Romans 6:23", topics: ["sin", "salvation", "eternal life", "romans 3", "ephesians 2", "john 3"] },
  { reference: "Psalm 119:105", topics: ["bible", "guidance", "word", "psalm 19", "2 timothy 3"] },
  { reference: "Matthew 5:16", topics: ["witness", "good works", "light", "philippians 2", "1 peter 2"] },
  { reference: "Colossians 3:23", topics: ["work", "service", "excellence", "diligence", "genesis 2", "ephesians 6"] },
  { reference: "1 Thessalonians 5:16-18", topics: ["gratitude", "thanksgiving", "joy", "prayer", "psalm 100"] },
  { reference: "2 Timothy 1:7", topics: ["fear", "power", "self-control", "joshua 1", "isaiah 41"] },
  { reference: "John 15:1-8", topics: ["abiding", "fruitfulness", "vine", "galatians 5", "psalm 1"] },
  { reference: "Psalm 1:1-3", topics: ["roots", "meditation", "fruitfulness", "jeremiah 17", "john 15"] },
  { reference: "Matthew 28:18-20", topics: ["great commission", "evangelism", "mission", "baptism", "acts 1"] },
  { reference: "Acts 1:8", topics: ["witness", "holy spirit", "mission", "jerusalem", "matthew 28"] },
  { reference: "Ephesians 4:11-16", topics: ["church", "ministry", "equipping", "unity", "growth", "1 corinthians 12"] },
  { reference: "1 Corinthians 12:12-27", topics: ["body of christ", "gifts", "unity", "church", "romans 12"] },
  { reference: "Nehemiah 1:1-11", topics: ["leadership", "prayer", "rebuilding", "vision", "nehemiah 2"] },
  { reference: "Exodus 3:1-14", topics: ["calling", "moses", "i am", "purpose", "exodus 4"] },
  { reference: "1 Samuel 17", topics: ["david", "goliath", "courage", "faith", "giants"] },
  { reference: "Daniel 6", topics: ["daniel", "faithfulness", "prayer", "lion", "integrity"] },
  { reference: "Ruth 1", topics: ["ruth", "loyalty", "redemption", "famine", "boaz"] },
  { reference: "Luke 15:11-32", topics: ["prodigal son", "forgiveness", "repentance", "father", "luke 15"] },
  { reference: "Luke 10:25-37", topics: ["good samaritan", "neighbor", "mercy", "compassion", "love"] },
  { reference: "John 11:1-44", topics: ["lazarus", "resurrection", "weeping", "jesus wept", "death"] },
  { reference: "Genesis 1:1-3", topics: ["creation", "beginnings", "word", "light", "genesis 2"] },
  { reference: "Psalm 139:1-18", topics: ["known by god", "wonderfully made", "omniscience", "identity", "value"] },
  { reference: "Isaiah 6:1-8", topics: ["isaiah", "holiness", "calling", "send me", "worship"] },
  { reference: "Habakkuk 3:17-19", topics: ["yet i will rejoice", "hard seasons", "faith", "strength"] },
  { reference: "Haggai 1:1-15", topics: ["priorities", "rebuilding", "temple", "neglect"] },
  { reference: "Philippians 2:1-11", topics: ["humility", "kenosis", "christ hymn", "servanthood", "unity"] },
  { reference: "Revelation 21:1-5", topics: ["new heaven", "new earth", "tears", "hope", "restoration"] },
  { reference: "Mark 4:35-41", topics: ["calming the storm", "fear", "faith", "peace be still", "trust"] },
];

/** Topic keyword → canonical dataset references (deterministic retrieval). */
export const TOPIC_BUCKETS: Record<string, string[]> = {
  love: ["1 Corinthians 13:4-7", "John 3:16", "1 John 4:7-12", "Romans 5:8"],
  faith: ["Hebrews 11:1", "Mark 4:35-41", "James 1:2-4", "Romans 4:20-21"],
  hope: ["Jeremiah 29:11", "Romans 8:28", "Revelation 21:1-5", "Isaiah 40:31"],
  fear: ["Joshua 1:9", "Isaiah 41:10", "2 Timothy 1:7", "Psalm 46:1"],
  comfort: ["Psalm 23:1-4", "Matthew 11:28-30", "Psalm 34:18", "2 Corinthians 1:3-4"],
  giving: ["2 Corinthians 9:7", "Malachi 3:10", "Luke 6:38", "Acts 20:35"],
  prayer: ["Philippians 4:6-7", "Matthew 6:9-13", "1 Thessalonians 5:16-18", "Daniel 6:10"],
  strength: ["Isaiah 40:31", "Philippians 4:13", "2 Corinthians 12:9", "Habakkuk 3:17-19"],
  forgiveness: ["Luke 15:11-32", "Matthew 6:14-15", "Colossians 3:13", "Psalm 103:8-12"],
  leadership: ["Nehemiah 1:1-11", "Exodus 3:1-14", "1 Samuel 17", "Mark 10:42-45"],
  service: ["Colossians 3:23", "Acts 20:35", "Mark 10:42-45", "Ephesians 4:11-16"],
  church: ["Ephesians 4:11-16", "1 Corinthians 12:12-27", "Matthew 16:18", "Acts 2:42-47"],
  mission: ["Matthew 28:18-20", "Acts 1:8", "Romans 10:14-15", "Jonah 1:1-3"],
  gratitude: ["1 Thessalonians 5:16-18", "Psalm 100:1-5", "Colossians 3:15-17", "Luke 17:11-19"],
  anxiety: ["Philippians 4:6-7", "1 Peter 5:7", "Matthew 6:25-34", "Psalm 94:19"],
  healing: ["Psalm 147:3", "James 5:14-16", "Isaiah 53:4-5", "Jeremiah 30:17"],
  identity: ["Psalm 139:1-18", "Ephesians 2:10", "1 Peter 2:9-10", "Genesis 1:27"],
  calling: ["Exodus 3:1-14", "Isaiah 6:1-8", "Jeremiah 1:4-10", "1 Samuel 3:1-10"],
  rest: ["Matthew 11:28-30", "Psalm 23:1-4", "Hebrews 4:9-11", "Genesis 2:2-3"],
  perseverance: ["James 1:2-4", "Romans 5:3-5", "Hebrews 12:1-3", "Habakkuk 3:17-19"],
  money: ["2 Corinthians 9:7", "Matthew 6:19-24", "Proverbs 3:9-10", "Luke 12:15-21"],
  family: ["Joshua 24:14-15", "Ephesians 5:22-6:4", "Psalm 127:1-5", "Proverbs 22:6"],
  wisdom: ["Proverbs 3:5-6", "James 1:5-8", "Proverbs 2:1-8", "1 Kings 3:9-12"],
};

export interface StarterSong {
  title: string;
  artist?: string;
  ccliNumber?: string;
  themeTags: string[];
  moodTags: string[];
  scriptureRefs: string[];
  key?: string;
  tempo?: string;
  lyricsExcerpt?: string;
  isPublicDomain: boolean;
}

/**
 * Starter worship library — factual metadata only for copyrighted entries
 * (title/artist/themes); lyric excerpts ONLY for public-domain hymns.
 */
export const STARTER_WORSHIP_LIBRARY: StarterSong[] = [
  { title: "Amazing Grace", artist: "John Newton (1779)", themeTags: ["grace", "salvation", "testimony"], moodTags: ["reflective", "triumphant"], scriptureRefs: ["Ephesians 2:8-9", "Luke 15:20"], key: "G", tempo: "moderate", lyricsExcerpt: "Amazing grace, how sweet the sound, that saved a wretch like me…", isPublicDomain: true },
  { title: "It Is Well with My Soul", artist: "Horatio Spafford (1873)", themeTags: ["peace", "trust", "hard seasons"], moodTags: ["reflective", "comforting"], scriptureRefs: ["Philippians 4:6-7", "Psalm 46:1"], key: "C", tempo: "slow", lyricsExcerpt: "When peace like a river attendeth my way… It is well with my soul.", isPublicDomain: true },
  { title: "Blessed Assurance", artist: "Fanny Crosby (1873)", themeTags: ["assurance", "testimony", "praise"], moodTags: ["triumphant"], scriptureRefs: ["Hebrews 11:1", "Romans 8:38-39"], key: "D", tempo: "moderate", lyricsExcerpt: "Blessed assurance, Jesus is mine! O what a foretaste of glory divine…", isPublicDomain: true },
  { title: "Great Is Thy Faithfulness", artist: "Thomas Chisholm (1923)", themeTags: ["faithfulness", "mercy", "new beginnings"], moodTags: ["reflective"], scriptureRefs: ["Lamentations 3:22-23"], key: "Db", tempo: "slow", lyricsExcerpt: "Great is Thy faithfulness, O God my Father; there is no shadow of turning with Thee…", isPublicDomain: true },
  { title: "How Great Thou Art", artist: "Carl Boberg (1885, tr. Hine)", themeTags: ["creation", "awe", "salvation"], moodTags: ["triumphant"], scriptureRefs: ["Genesis 1:1-3", "Psalm 19:1-4"], key: "Bb", tempo: "slow build", lyricsExcerpt: "O Lord my God, when I in awesome wonder consider all the worlds Thy hands have made…", isPublicDomain: true },
  { title: "To God Be the Glory", artist: "Fanny Crosby (1875)", themeTags: ["praise", "salvation", "grace"], moodTags: ["triumphant"], scriptureRefs: ["John 3:16", "Ephesians 2:8-9"], key: "Ab", tempo: "moderate", lyricsExcerpt: "To God be the glory, great things He hath done…", isPublicDomain: true },
  { title: "Praise to the Lord, the Almighty", artist: "Joachim Neander (1680)", themeTags: ["praise", "providence"], moodTags: ["triumphant"], scriptureRefs: ["Psalm 103:1-5", "Psalm 150"], key: "F", tempo: "moderate", lyricsExcerpt: "Praise to the Lord, the Almighty, the King of creation…", isPublicDomain: true },
  { title: "Be Thou My Vision", artist: "attrib. Dallán Forgaill (tr. 1905)", themeTags: ["guidance", "surrender", "priorities"], moodTags: ["reflective"], scriptureRefs: ["Proverbs 3:5-6", "Psalm 16:5-8"], key: "Eb", tempo: "slow", lyricsExcerpt: "Be Thou my Vision, O Lord of my heart…", isPublicDomain: true },
  { title: "Come Thou Fount of Every Blessing", artist: "Robert Robinson (1757)", themeTags: ["gratitude", "grace", "wandering"], moodTags: ["reflective"], scriptureRefs: ["1 Samuel 7:12", "Lamentations 3:22-23"], key: "D", tempo: "moderate", lyricsExcerpt: "Come Thou Fount of every blessing, tune my heart to sing Thy grace…", isPublicDomain: true },
  { title: "Rock of Ages", artist: "Augustus Toplady (1763)", themeTags: ["refuge", "salvation"], moodTags: ["reflective"], scriptureRefs: ["Psalm 46:1", "Isaiah 26:4"], key: "A", tempo: "slow", lyricsExcerpt: "Rock of Ages, cleft for me, let me hide myself in Thee…", isPublicDomain: true },
  { title: "What a Friend We Have in Jesus", artist: "Joseph Scriven (1855)", themeTags: ["prayer", "comfort", "anxiety"], moodTags: ["comforting"], scriptureRefs: ["Philippians 4:6-7", "1 Peter 5:7"], key: "Bb", tempo: "slow", lyricsExcerpt: "What a friend we have in Jesus, all our sins and griefs to bear…", isPublicDomain: true },
  { title: "Great Is Thy Faithfulness (Chorus Reprise)", artist: "Traditional", themeTags: ["faithfulness", "mercy"], moodTags: ["reflective"], scriptureRefs: ["Lamentations 3:22-23"], key: "Db", tempo: "slow", isPublicDomain: true },
  { title: "10,000 Reasons (Bless the Lord)", artist: "Matt Redman / Jonas Myrin", ccliNumber: "6016351", themeTags: ["gratitude", "praise", "worship"], moodTags: ["uplifting"], scriptureRefs: ["Psalm 103:1-5"], key: "C", tempo: "moderate", isPublicDomain: false },
  { title: "Way Maker", artist: "Osinachi Kalu Okoro Egbu (Sinach)", ccliNumber: "7115744", themeTags: ["trust", "miracles", "presence"], moodTags: ["worful", "uplifting"], scriptureRefs: ["Isaiah 43:16-19", "Psalm 121:1-2"], key: "A", tempo: "moderate", isPublicDomain: false },
  { title: "Yesus Yo (Naija Praise Medley)", artist: "Traditional Nigerian praise", themeTags: ["praise", "thanksgiving", "joy"], moodTags: ["upbeat"], scriptureRefs: ["Psalm 100:1-5"], key: "F", tempo: "fast", isPublicDomain: true },
  { title: "Oceans (Where Feet May Fail)", artist: "Hillsong United", ccliNumber: "6429930", themeTags: ["faith", "courage", "trust"], moodTags: ["reflective"], scriptureRefs: ["Matthew 14:22-33"], key: "D", tempo: "slow", isPublicDomain: false },
  { title: "Goodness of God", artist: "Bethel Music / Ed Cash", ccliNumber: "7117726", themeTags: ["faithfulness", "gratitude", "presence"], moodTags: ["reflective"], scriptureRefs: ["Psalm 23:6", "Lamentations 3:22-23"], key: "G", tempo: "moderate", isPublicDomain: false },
  { title: "Agalilao (Halleluyah Chorus)", artist: "Traditional Nigerian worship", themeTags: ["worship", "awe", "praise"], moodTags: ["worful"], scriptureRefs: ["Revelation 5:11-14"], key: "E", tempo: "moderate", isPublicDomain: true },
];

/** Deterministic topic keywords extracted from a sermon theme text. */
const STOP_WORDS = new Set(["the", "and", "for", "with", "that", "this", "from", "your", "you", "are", "not", "how", "when", "god", "jesus", "christ", "lord", "unto", "into", "will", "can", "our", "his", "her", "them", "they", "have", "has", "been", "being", "what", "why", "who", "all", "but", "was", "were", "a", "an", "in", "on", "of", "to", "is", "it", "as", "at", "be", "by", "or", "we", "us", "my", "me", "do", "does", "did", "so", "no", "yes", "new"]);

export function keywordsFromText(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s:]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
    .slice(0, 12);
}

/**
 * Deterministic cross-reference retrieval: curated pairs + topic buckets +
 * Bible dataset topic overlap. Returns de-duplicated references (max `limit`).
 */
export function findCrossReferences(input: { theme?: string | null; scriptureRef?: string | null }, limit = 5): string[] {
  const theme = (input.theme ?? "").toLowerCase();
  const ref = (input.scriptureRef ?? "").toLowerCase();
  const scored = new Map<string, number>();

  for (const entry of CROSS_REFS) {
    const hay = `${entry.reference.toLowerCase()} ${entry.topics.join(" ")}`;
    if (ref && (hay.includes(ref) || ref.includes(entry.reference.toLowerCase()))) {
      scored.set(entry.reference, (scored.get(entry.reference) ?? 0) + 3);
    }
    for (const t of entry.topics) {
      if (theme && (theme.includes(t) || t.includes(theme.split(" ")[0]))) {
        scored.set(entry.reference, (scored.get(entry.reference) ?? 0) + 1);
      }
    }
  }

  const keywords = keywordsFromText(`${input.theme ?? ""} ${input.scriptureRef ?? ""}`);
  for (const [topic, refs] of Object.entries(TOPIC_BUCKETS)) {
    if (keywords.some((k) => topic.startsWith(k) || k.startsWith(topic) || topic.includes(k))) {
      for (const r of refs) scored.set(r, (scored.get(r) ?? 0) + 1);
    }
  }

  return [...scored.entries()]
    .filter(([r]) => r.toLowerCase() !== ref)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([r]) => r);
}

export interface SongMatch {
  song: { id: string; title: string; artist?: string | null; ccliNumber?: string | null; key?: string | null; tempo?: string | null; isPublicDomain: boolean };
  score: number;
  matchedOn: string[];
}

/**
 * Deterministic song matching against the REAL library (org + shared global).
 * AI never invents songs — it only receives these matches and writes the
 * one-line `match_reason` for each.
 */
export function matchSongs(
  library: { id: string; title: string; artist: string | null; ccliNumber: string | null; themeTags: string; moodTags: string; scriptureRefs: string; key: string | null; tempo: string | null; isPublicDomain: boolean }[],
  input: { theme?: string | null; scriptureRef?: string | null; mood?: string | null },
  limit = 6,
): SongMatch[] {
  const keywords = new Set(keywordsFromText(`${input.theme ?? ""} ${input.scriptureRef ?? ""}`));
  const themeLower = (input.theme ?? "").toLowerCase();
  const moodLower = (input.mood ?? "").toLowerCase();
  const refLower = (input.scriptureRef ?? "").toLowerCase();

  const scored: SongMatch[] = [];
  for (const song of library) {
    const themeTags = parseTags(song.themeTags);
    const moodTags = parseTags(song.moodTags);
    const refs = parseTags(song.scriptureRefs);
    const matchedOn: string[] = [];
    let score = 0;

    for (const t of themeTags) {
      const tl = t.toLowerCase();
      if (keywords.has(tl) || themeLower.includes(tl) || [...keywords].some((k) => tl.includes(k))) {
        score += 3;
        matchedOn.push(`theme: ${t}`);
      }
    }
    for (const r of refs) {
      const rl = r.toLowerCase();
      if (refLower && (rl.includes(refLower) || refLower.includes(rl) || rl.split(/[\s:]/)[0] === refLower.split(/[\s:]/)[0])) {
        score += 2;
        matchedOn.push(`scripture: ${r}`);
      }
      if (keywords.has(rl.toLowerCase().split(/[\s:]/)[0])) {
        score += 1;
        matchedOn.push(`scripture: ${r}`);
      }
    }
    if (moodLower && moodTags.some((m) => m.toLowerCase().includes(moodLower) || moodLower.includes(m.toLowerCase()))) {
      score += 2;
      matchedOn.push(`mood: ${moodTags.join(", ")}`);
    }

    if (score > 0) {
      scored.push({
        song: { id: song.id, title: song.title, artist: song.artist, ccliNumber: song.ccliNumber, key: song.key, tempo: song.tempo, isPublicDomain: song.isPublicDomain },
        score,
        matchedOn: [...new Set(matchedOn)].slice(0, 3),
      });
    }
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

function parseTags(raw: string): string[] {
  try { return JSON.parse(raw) as string[]; } catch { return []; }
}
