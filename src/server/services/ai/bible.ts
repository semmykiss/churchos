/**
 * Shepherd AI — local Bible dataset (backend only).
 * Text: World English Bible (WEB) — public domain, no licensing constraints.
 * Covers well-known references so the bible_lookup tool can return EXACT text
 * with citation (never paraphrased as quotation). For references outside the
 * dataset the tool returns found:false and the assistant summarizes from
 * general knowledge WITHOUT presenting it as direct quotation.
 */

export interface BiblePassage {
  reference: string; // canonical display reference
  book: string;
  chapter: number;
  verseStart: number;
  verseEnd: number;
  text: string;
  topics: string[];
}

export const BIBLE_DATASET: BiblePassage[] = [
  { reference: "John 3:16", book: "John", chapter: 3, verseStart: 16, verseEnd: 16, topics: ["gospel", "love", "salvation", "eternal life"], text: "For God so loved the world, that he gave his one and only Son, that whoever believes in him should not perish, but have eternal life." },
  { reference: "Romans 8:28", book: "Romans", chapter: 8, verseStart: 28, verseEnd: 28, topics: ["hope", "trust", "purpose", "hard seasons"], text: "We know that all things work together for good for those who love God, for those who are called according to his purpose." },
  { reference: "Romans 8:38-39", book: "Romans", chapter: 8, verseStart: 38, verseEnd: 39, topics: ["assurance", "love", "nothing can separate"], text: "For I am persuaded that neither death, nor life, nor angels, nor rulers, nor things present, nor things to come, nor powers, nor height, nor depth, nor any other created thing will be able to separate us from God's love which is in Christ Jesus our Lord." },
  { reference: "Philippians 4:6-7", book: "Philippians", chapter: 4, verseStart: 6, verseEnd: 7, topics: ["anxiety", "worry", "peace", "prayer"], text: "In nothing be anxious, but in everything, by prayer and petition with thanksgiving, let your requests be made known to God. And the peace of God, which surpasses all understanding, will guard your hearts and your thoughts in Christ Jesus." },
  { reference: "Philippians 4:13", book: "Philippians", chapter: 4, verseStart: 13, verseEnd: 13, topics: ["strength", "contentment"], text: "I can do all things through Christ who strengthens me." },
  { reference: "Philippians 4:8", book: "Philippians", chapter: 4, verseStart: 8, verseEnd: 8, topics: ["thoughts", "mind", "peace"], text: "Finally, brothers, whatever things are true, whatever things are honorable, whatever things are just, whatever things are pure, whatever things are lovely, whatever things are of good report: if there is any virtue and if there is anything worthy of praise, think about these things." },
  { reference: "Proverbs 3:5-6", book: "Proverbs", chapter: 3, verseStart: 5, verseEnd: 6, topics: ["trust", "guidance", "decisions"], text: "Trust in the LORD with all your heart, and don't lean on your own understanding. In all your ways acknowledge him, and he will make your paths straight." },
  { reference: "Jeremiah 29:11", book: "Jeremiah", chapter: 29, verseStart: 11, verseEnd: 11, topics: ["hope", "future", "plans"], text: "For I know the thoughts that I think toward you,\" says the LORD, \"thoughts of peace, and not of evil, to give you hope and a future." },
  { reference: "Isaiah 41:10", book: "Isaiah", chapter: 41, verseStart: 10, verseEnd: 10, topics: ["fear", "courage", "strength"], text: "Don't you be afraid, for I am with you. Don't be dismayed, for I am your God. I will strengthen you. Yes, I will help you. I will uphold you with the right hand of my righteousness." },
  { reference: "Matthew 11:28-30", book: "Matthew", chapter: 11, verseStart: 28, verseEnd: 30, topics: ["rest", "burden", "weary", "burnout"], text: "Come to me, all you who labor and are heavily burdened, and I will give you rest. Take my yoke upon you and learn from me, for I am gentle and humble in heart; and you will find rest for your souls. For my yoke is easy, and my burden is light." },
  { reference: "Matthew 6:33", book: "Matthew", chapter: 6, verseStart: 33, verseEnd: 33, topics: ["priorities", "provision", "kingdom"], text: "But seek first God's Kingdom and his righteousness; and all these things will be given to you as well." },
  { reference: "Matthew 6:26", book: "Matthew", chapter: 6, verseStart: 26, verseEnd: 26, topics: ["worry", "provision", "value"], text: "Look at the birds of the air: they don't sow, neither do they reap, nor gather into barns; and your heavenly Father feeds them. Aren't you of much more value than they?" },
  { reference: "Psalm 23:1-4", book: "Psalm", chapter: 23, verseStart: 1, verseEnd: 4, topics: ["comfort", "shepherd", "dark valleys", "grief"], text: "The LORD is my shepherd; I shall not want. He makes me lie down in green pastures. He leads me beside still waters. He restores my soul. He guides me in the paths of righteousness for his name's sake. Even though I walk through the valley of the shadow of death, I will fear no evil, for you are with me. Your rod and your staff, they comfort me." },
  { reference: "Joshua 1:9", book: "Joshua", chapter: 1, verseStart: 9, verseEnd: 9, topics: ["courage", "fear", "strength"], text: "Haven't I commanded you? Be strong and courageous. Don't be afraid. Don't be dismayed, for the LORD your God is with you wherever you go." },
  { reference: "1 Corinthians 13:4-7", book: "1 Corinthians", chapter: 13, verseStart: 4, verseEnd: 7, topics: ["love", "marriage", "patience"], text: "Love is patient and is kind; love doesn't envy. Love doesn't brag, is not proud, doesn't behave itself inappropriately, doesn't seek its own way, is not provoked, takes no account of evil; doesn't rejoice in unrighteousness, but rejoices with the truth; bears all things, believes all things, hopes all things, endures all things." },
  { reference: "Galatians 5:22-23", book: "Galatians", chapter: 5, verseStart: 22, verseEnd: 23, topics: ["fruit of the spirit", "character"], text: "But the fruit of the Spirit is love, joy, peace, patience, kindness, goodness, faith, gentleness, and self-control. Against such things there is no law." },
  { reference: "Ephesians 2:8-9", book: "Ephesians", chapter: 2, verseStart: 8, verseEnd: 9, topics: ["grace", "salvation", "faith"], text: "For by grace you have been saved through faith, and that not of yourselves; it is the gift of God, not of works, that no one would boast." },
  { reference: "Hebrews 11:1", book: "Hebrews", chapter: 11, verseStart: 1, verseEnd: 1, topics: ["faith"], text: "Now faith is assurance of things hoped for, proof of things not seen." },
  { reference: "James 1:2-4", book: "James", chapter: 1, verseStart: 2, verseEnd: 4, topics: ["perseverance", "trials", "endurance"], text: "Count it all joy, my brothers, when you fall into various temptations, knowing that the testing of your faith produces endurance. Let endurance have its perfect work, that you may be perfect and complete, lacking in nothing." },
  { reference: "1 Peter 5:7", book: "1 Peter", chapter: 5, verseStart: 7, verseEnd: 7, topics: ["anxiety", "care", "worry"], text: "Casting all your worries on him, because he cares for you." },
  { reference: "Psalm 34:18", book: "Psalm", chapter: 34, verseStart: 18, verseEnd: 18, topics: ["broken heart", "grief", "depression", "comfort"], text: "The LORD is near to those who have a broken heart, and saves those who have a crushed spirit." },
  { reference: "Psalm 147:3", book: "Psalm", chapter: 147, verseStart: 3, verseEnd: 3, topics: ["healing", "heartbreak"], text: "He heals the broken in heart, and binds up their wounds." },
  { reference: "2 Corinthians 12:9", book: "2 Corinthians", chapter: 12, verseStart: 9, verseEnd: 9, topics: ["weakness", "grace", "strength"], text: "He has said to me, \"My grace is sufficient for you, for my power is made perfect in weakness.\" Most gladly therefore I will rather glory in my weaknesses, that the power of Christ may rest on me." },
  { reference: "Lamentations 3:22-23", book: "Lamentations", chapter: 3, verseStart: 22, verseEnd: 23, topics: ["mercy", "faithfulness", "new beginnings"], text: "It is because of the LORD's loving kindnesses that we are not consumed, because his compassions don't fail. They are new every morning. Great is your faithfulness." },
  { reference: "Romans 12:2", book: "Romans", chapter: 12, verseStart: 2, verseEnd: 2, topics: ["renewal", "mind", "transformation"], text: "Don't be conformed to this world, but be transformed by the renewing of your mind, so that you may prove what is the good, well-pleasing, and perfect will of God." },
  { reference: "Psalm 46:1", book: "Psalm", chapter: 46, verseStart: 1, verseEnd: 1, topics: ["refuge", "trouble", "strength"], text: "God is our refuge and strength, a very present help in trouble." },
  { reference: "Psalm 121:1-2", book: "Psalm", chapter: 121, verseStart: 1, verseEnd: 2, topics: ["help", "protection"], text: "I will lift up my eyes to the hills. Where does my help come from? My help comes from the LORD, who made heaven and earth." },
  { reference: "Isaiah 40:31", book: "Isaiah", chapter: 40, verseStart: 31, verseEnd: 31, topics: ["strength", "renewal", "weariness"], text: "But those who wait for the LORD will renew their strength. They will mount up with wings like eagles. They will run, and not be weary. They will walk, and not faint." },
  { reference: "Deuteronomy 31:6", book: "Deuteronomy", chapter: 31, verseStart: 6, verseEnd: 6, topics: ["courage", "loneliness"], text: "Be strong and courageous. Don't be afraid or scared of them; for the LORD your God himself is who goes with you. He will not fail you nor forsake you." },
  { reference: "Zephaniah 3:17", book: "Zephaniah", chapter: 3, verseStart: 17, verseEnd: 17, topics: ["joy", "love", "comfort"], text: "The LORD your God is among you, a mighty one who will save. He will rejoice over you with joy. He will calm you in his love. He will rejoice over you with singing." },
  { reference: "2 Corinthians 9:7", book: "2 Corinthians", chapter: 9, verseStart: 7, verseEnd: 7, topics: ["giving", "generosity", "money"], text: "Let each man give according as he has determined in his heart, not grudgingly or under compulsion, for God loves a cheerful giver." },
  { reference: "Malachi 3:10", book: "Malachi", chapter: 3, verseStart: 10, verseEnd: 10, topics: ["tithe", "giving", "blessing"], text: "Bring the whole tithe into the storehouse, that there may be food in my house, and test me now in this,\" says the LORD of Armies, \"if I will not open for you the windows of heaven and pour out on you a blessing, that there will not be room enough for." },
  { reference: "Luke 6:38", book: "Luke", chapter: 6, verseStart: 38, verseEnd: 38, topics: ["giving", "generosity"], text: "Give, and it will be given to you: good measure, pressed down, shaken together, and running over, will be given to you. For with the same measure you measure it will be measured back to you." },
  { reference: "Acts 20:35", book: "Acts", chapter: 20, verseStart: 35, verseEnd: 35, topics: ["giving", "service"], text: "In all things I gave you an example, that so laboring you ought to help the weak, and to remember the words of the Lord Jesus, that he himself said, 'It is more blessed to give than to receive.'" },
  { reference: "Romans 6:23", book: "Romans", chapter: 6, verseStart: 23, verseEnd: 23, topics: ["sin", "salvation", "eternal life"], text: "For the wages of sin is death, but the free gift of God is eternal life in Christ Jesus our Lord." },
  { reference: "Psalm 119:105", book: "Psalm", chapter: 119, verseStart: 105, verseEnd: 105, topics: ["bible", "guidance", "word"], text: "Your word is a lamp to my feet, and a light for my path." },
  { reference: "Matthew 5:16", book: "Matthew", chapter: 5, verseStart: 16, verseEnd: 16, topics: ["witness", "good works"], text: "Even so, let your light shine before men, that they may see your good works and glorify your Father who is in heaven." },
  { reference: "Colossians 3:23", book: "Colossians", chapter: 3, verseStart: 23, verseEnd: 23, topics: ["work", "service", "excellence"], text: "And whatever you do, work heartily, as for the Lord and not for men." },
  { reference: "1 Thessalonians 5:16-18", book: "1 Thessalonians", chapter: 5, verseStart: 16, verseEnd: 18, topics: ["gratitude", "thanksgiving", "joy", "prayer"], text: "Always rejoice. Pray without ceasing. In everything give thanks, for this is the will of God in Christ Jesus toward you." },
  { reference: "2 Timothy 1:7", book: "2 Timothy", chapter: 1, verseStart: 7, verseEnd: 7, topics: ["fear", "power", "self-control"], text: "For God didn't give us a spirit of fear, but of power, love, and self-control." },
  { reference: "Ephesians 4:32", book: "Ephesians", chapter: 4, verseStart: 32, verseEnd: 32, topics: ["forgiveness", "kindness"], text: "And be kind to one another, tender hearted, forgiving each other, just as God also in Christ forgave you." },
  { reference: "Romans 15:13", book: "Romans", chapter: 15, verseStart: 13, verseEnd: 13, topics: ["hope", "joy", "peace"], text: "Now may the God of hope fill you with all joy and peace in believing, that you may abound in hope by the power of the Holy Spirit." },
  { reference: "Psalm 139:14", book: "Psalm", chapter: 139, verseStart: 14, verseEnd: 14, topics: ["identity", "self-worth", "creation"], text: "I will give thanks to you, for I am fearfully and wonderfully made. Your works are wonderful. My soul knows that very well." },
  { reference: "Genesis 1:1", book: "Genesis", chapter: 1, verseStart: 1, verseEnd: 1, topics: ["creation", "beginnings"], text: "In the beginning, God created the heavens and the earth." },
  { reference: "John 1:1", book: "John", chapter: 1, verseStart: 1, verseEnd: 1, topics: ["jesus", "word", "divinity"], text: "In the beginning was the Word, and the Word was with God, and the Word was God." },
  { reference: "John 14:27", book: "John", chapter: 14, verseStart: 27, verseEnd: 27, topics: ["peace", "fear"], text: "Peace I leave with you. My peace I give to you; not as the world gives, I give to you. Don't let your heart be troubled, neither let it be fearful." },
  { reference: "Hebrews 10:25", book: "Hebrews", chapter: 10, verseStart: 25, verseEnd: 25, topics: ["church", "fellowship", "gathering"], text: "Not forsaking our own assembling together, as the custom of some is, but exhorting one another, and so much the more as you see the Day approaching." },
  { reference: "Micah 6:8", book: "Micah", chapter: 6, verseStart: 8, verseEnd: 8, topics: ["justice", "mercy", "humility"], text: "He has shown you, O man, what is good. What does the LORD require of you, but to act justly, to love mercy, and to walk humbly with your God?" },
  { reference: "Proverbs 22:6", book: "Proverbs", chapter: 22, verseStart: 6, verseEnd: 6, topics: ["parenting", "children"], text: "Train up a child in the way he should go, and when he is old he will not depart from it." },
  { reference: "Proverbs 16:3", book: "Proverbs", chapter: 16, verseStart: 3, verseEnd: 3, topics: ["plans", "work"], text: "Commit your deeds to the LORD, and your plans will succeed." },
];

// Book-name normalization (numerals, abbreviations, spacing)
const BOOK_ALIASES: Record<string, string> = {
  ps: "Psalm", psalm: "Psalm", psalms: "Psalm", gen: "Genesis", ex: "Exodus", exod: "Exodus",
  deut: "Deuteronomy", prov: "Proverbs", isa: "Isaiah", jer: "Jeremiah", lam: "Lamentations",
  matt: "Matthew", mt: "Matthew", jn: "John", rom: "Romans", cor: "Corinthians",
  eph: "Ephesians", phil: "Philippians", col: "Colossians", thess: "Thessalonians",
  tim: "Timothy", titus: "Titus", heb: "Hebrews", jas: "James", pet: "Peter", luke: "Luke",
  john: "John", acts: "Acts", james: "James", micah: "Micah", josh: "Joshua", zeph: "Zephaniah",
  "1 corinthians": "1 Corinthians", "2 corinthians": "2 Corinthians",
  "1 thessalonians": "1 Thessalonians", "2 thessalonians": "2 Thessalonians",
  "1 timothy": "1 Timothy", "2 timothy": "2 Timothy",
  "1 peter": "1 Peter", "2 peter": "2 Peter", "1 john": "1 John", "2 john": "2 John", "3 john": "3 John",
};

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Look up a reference like "Philippians 4:6-7", "phil 4:6", "psalm 23". */
export function lookupReference(input: string): BiblePassage | null {
  const q = normalize(input).replace(/:/g, " ").replace(/\s+/g, " ");
  for (const p of BIBLE_DATASET) {
    const canonical = normalize(p.reference).replace(/:/g, " ");
    if (q === canonical) return p;
  }
  // "book c:v-v" style with aliases
  const m = q.match(/^((?:\d\s?)?[a-z\s]+?)\s+(\d+)(?:\s+(\d+))?$/);
  if (!m) return null;
  const rawBook = m[1].trim();
  const chapter = Number(m[2]);
  const verse = m[3] ? Number(m[3]) : undefined;
  const book = BOOK_ALIASES[rawBook] ?? BOOK_ALIASES[rawBook.replace(/\s\d+$/, "").trim()] ?? rawBook;
  for (const p of BIBLE_DATASET) {
    if (normalize(p.book) !== normalize(book) || p.chapter !== chapter) continue;
    if (verse === undefined) return p; // chapter match without verse
    if (verse >= p.verseStart && verse <= p.verseEnd) return p;
  }
  return null;
}

/** Topic search over the curated dataset (keyword intersection). */
export function lookupTopic(topic: string): BiblePassage | null {
  const words = normalize(topic).split(/[^a-z]+/).filter((w) => w.length > 2);
  let best: { p: BiblePassage; score: number } | null = null;
  for (const p of BIBLE_DATASET) {
    const haystack = normalize([...p.topics, p.reference, p.text].join(" "));
    let score = 0;
    for (const w of words) if (haystack.includes(w)) score += w.length;
    if (score > 0 && (!best || score > best.score)) best = { p, score };
  }
  return best?.p ?? null;
}

export function lookup(input: string): BiblePassage | null {
  return lookupReference(input) ?? lookupTopic(input);
}
