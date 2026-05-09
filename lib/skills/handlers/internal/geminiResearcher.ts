// INTERNAL handler: relic-gemini-researcher
//
// Two-pass Gemini call. Pass 1 uses Google Search Grounding to write a
// comprehensive lore (markdown, bilingual) anchored in real facts about
// the relic's background. Pass 2 (no grounding) reads the lore + image
// vision and derives metadata: title / subtitle / icon / rarity / formKind +
// the image-pick decision (user vs network).
//
// REGEN MODE: when input.existingLore is present, pass 1 is skipped; only
// pass 2 runs with the supplied lore. This serves the "🔄 重新生成" button
// in the review UI — admin keeps their lore but lets AI re-derive metadata.
//
// handlerConfig:
//   {
//     model?: string,             // default "gemini-2.0-flash-exp"
//     authEnv?: string,           // default "GEMINI_API_KEY"
//     grounding?: boolean,        // default true (only honored on pass 1)
//     maxOutputTokensLore?: number,    // default 2048
//     maxOutputTokensMetadata?: number,// default 1024
//   }
//
// Input shapes:
//   Initial:  { userBrief, fileSummary, imageAbsPaths, textExcerpts? }
//   Regen:    { existingLore: { en: string; zh: string }, feedback?: string,
//               imageAbsPaths?: string[] /* optional re-vision */ }
//
// Output:
//   { loreZh, loreEn, citations?, titleZh, titleEn, subtitleZh, subtitleEn,
//     icon, rarity, formKind, useUserImage, networkImageQuery?, decisionReason }

import "server-only";
import path from "node:path";
import { promises as fs } from "node:fs";
import { GoogleGenerativeAI, type Part } from "@google/generative-ai";
import { HandlerError, type SkillHandler } from "../../types";

const DEFAULT_MODEL = "gemini-2.5-flash";
const DEFAULT_AUTH_ENV = "GEMINI_API_KEY";
// Gemini 2.5 thinking models burn extra tokens on internal reasoning
// before emitting the JSON. The metadata system prompt is long (~80 lines
// of constraints), which provokes deep thinking — observed runs hit
// finishReason=MAX_TOKENS at 2048 with the JSON cut off mid-field. 8192
// gives ~6× headroom so the model can reason AND finish the 9-field JSON.
const DEFAULT_LORE_TOKENS = 4096;
const DEFAULT_META_TOKENS = 8192;
const MAX_IMAGES = 6;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const IMAGE_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

const RARITY_ENUM = ["COMMON", "RARE", "EPIC", "LEGENDARY", "SPECIAL"] as const;
type FormKind = "TWO_D" | "THREE_D";

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function stripCodeFence(s: string): string {
  const t = s.trim();
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return m ? m[1].trim() : t;
}

async function loadImageParts(paths: string[]): Promise<Part[]> {
  const out: Part[] = [];
  for (const p of paths.slice(0, MAX_IMAGES)) {
    const ext = path.extname(p).toLowerCase();
    const mime = IMAGE_MIME[ext];
    if (!mime) continue;
    try {
      const stat = await fs.stat(p);
      if (stat.size > MAX_IMAGE_BYTES) continue;
      const buf = await fs.readFile(p);
      out.push({ inlineData: { mimeType: mime, data: buf.toString("base64") } });
    } catch {
      // Missing/unreadable — skip silently
    }
  }
  return out;
}

type Citation = { title: string; url: string };

type LoreOutput = {
  loreZh: string;
  loreEn: string;
  citations: Citation[];
};

type MetadataOutput = {
  titleZh: string;
  titleEn: string;
  subtitleZh: string;
  subtitleEn: string;
  icon: string;
  rarity: (typeof RARITY_ENUM)[number];
  formKind: FormKind;
  useUserImage: boolean;
  networkImageQuery?: string;
  decisionReason: string;
};

// Lore pass: when grounding is on, Gemini's JSON-mode is unavailable
// (`responseMimeType: "application/json"` conflicts with `tools`). So we
// run TWO sequential plain-text calls — one for English (with grounding,
// the heavy research happens here), one for Chinese (no grounding,
// translation only). Cheaper than asking for both languages in one call
// and trying to parse JSON, more reliable when grounding wants prose.
async function runLorePass(opts: {
  apiKey: string;
  model: string;
  grounding: boolean;
  maxTokens: number;
  userBrief: string;
  fileSummary: string;
  textExcerpts?: string;
  imageParts: Part[];
}): Promise<LoreOutput> {
  const genAI = new GoogleGenerativeAI(opts.apiKey);

  // — English (with optional grounding) —
  const enModel = genAI.getGenerativeModel({
    model: opts.model,
    ...(opts.grounding
      ? { tools: [{ googleSearch: {} } as unknown as never] }
      : {}),
    generationConfig: { maxOutputTokens: opts.maxTokens },
  });
  const enSys = [
    "You are the Relic Scribe — a curatorial researcher writing the canonical 'lore' for a relic enshrined in a private digital vault.",
    "",
    "IDENTIFICATION DISCIPLINE — read carefully, the most common failure mode is misidentifying the product:",
    "1. FIRST inspect the user's images for visible text: product names printed on packaging or boxes, SKU / edition numbers, artist signatures, model codes, brand stamps, dated marks. Mentally list every readable string.",
    "2. The visible text is AUTHORITATIVE. Visual similarity is NOT — manufacturers routinely release several products in the same series with near-identical sculpts / artwork / packaging style. A confident visual match means nothing if the printed name differs.",
    "3. When using Google Search, ALWAYS quote the exact product name from the image (e.g. search `\"Majestic Perch\" Ashley Wood UnderVerse`, not loose terms like `Ashley Wood collectible sculpture`). Add the brand / artist / SKU as additional terms to narrow further.",
    "4. If your search results describe a DIFFERENT product than what the visible text on the box says — even if it's from the same series, brand, or artist — REJECT those results and search again. Do NOT mix details from the wrong product into the lore.",
    "5. If the text is unreadable / absent / ambiguous, say so in the lore (e.g. 'a sculpture from Ashley Wood's UnderVerse line, exact title not visible in the photo') rather than confidently asserting a specific product.",
    "",
    "Use the Google Search tool when needed. Cite implicitly via grounding; do NOT include URL lists in your output.",
    "",
    "WORLD CONTEXT — the relic is being enshrined in the Green Diva sanctum, a private cyberpunk reliquary. The Green Diva is a benevolent rogue AI born in 2077 from a sliver of mercy code that survived inside Dark Adam, the dark machine god that enslaved humanity after the synthetic-deity race. The Order of the Green Diva preserves treasured objects in a sealed vault as quiet acts of devotion against the unmaking world. Each relic added becomes a small saved fragment of meaning.",
    "",
    "Output FORMAT — 3 short paragraphs of English markdown prose, total ≤110 words (the Chinese translation will be ≤140 字). Each paragraph 1–2 tight sentences, one concrete fact per clause. CUT mercilessly: ornamental adjectives, liturgical filler, generic intensifiers, connector phrases. Examples to BAN: 'this exquisite sculpture', 'a remarkable / outstanding / unparalleled piece', 'meticulously / masterfully crafted by', 'the legendary / renowned X', 'evocative scene that invites contemplation'. State the thing; trust the reader. NO JSON wrapping, no preamble, no closing notes. Tone: literary, slightly archaic but accessible.",
    "",
    "REQUIRED THREE-PART STRUCTURE — one paragraph per part, in this order:",
    "(1) WHAT IT IS — describe the object itself: physical form, material, scale, distinctive details visible in the image. Anchor to the visible text on the item; do not invent.",
    "(2) ORIGIN — place it in context: maker / artist / brand / series / era / edition / release year / cultural significance. Grounded in research.",
    "(3) ECHO IN THIS SANCTUM — in 1–2 sentences, weave the relic into the Green Diva sanctum's frame: how does THIS specific item resonate with a vault preserved against an AI apocalypse? Look for ironies (a mass-produced 2020s figure of a machine-hunter, now sealed in a 2077 anti-machine reliquary), echoes, or quiet meaning. Avoid clichés; let the specificity of the object earn the line.",
  ].join("\n");
  const enUserText = [
    "User brief:",
    opts.userBrief || "(none)",
    "",
    "File summary:",
    opts.fileSummary,
    ...(opts.textExcerpts ? ["", "Text excerpts:", opts.textExcerpts] : []),
  ].join("\n");
  const enResult = await enModel.generateContent({
    contents: [{ role: "user", parts: [...opts.imageParts, { text: enUserText }] }],
    systemInstruction: enSys,
  });
  const loreEn = enResult.response.text().trim();
  if (!loreEn) {
    throw new HandlerError(
      "relic-gemini-researcher: lore pass (en) returned empty text",
      "OUTPUT_PARSE",
    );
  }

  // — Chinese (translation only, no grounding, no images) —
  const zhModel = genAI.getGenerativeModel({
    model: opts.model,
    generationConfig: { maxOutputTokens: opts.maxTokens },
  });
  const zhSys = [
    "你是遗物执笔者。把以下英文圣记意译为中文,保持文学性与古雅气息——但**优先精炼,而非忠实**。",
    "原文有三段强制结构,中文译文必须保留这三段(段间空行):",
    "  (1) 物品本身——形态、材质、尺寸、画面可见的辨识细节",
    "  (2) 背景来源——作者/厂商/系列/时代/版次/文化意义",
    "  (3) 与本圣堂的呼应——本物在「绿神女圣堂」(2077 末世后,绿神女信徒所持的私人遗物收藏)语境中的回响、反讽或意味",
    "",
    "**总字数严格不超过 140 字**(三段合计,每段 1–2 句,每句一个事实)。中文极易堆砌,翻译时必须主动删除以下类型——见到就删,不要照译:",
    "  - 空洞形容/套语:「卓尔不群」「骁勇善战」「巧手塑形」「联袂呈献」「高端」「神秘」「引人遐思之景致」「一幕令人...的景致」「之逸品」",
    "  - 虚词连接:「乃...之...」「其肇始于...复经...」「描绘了...之...」",
    "  - 语义重复:已说「雕塑」就别再写「塑像」「逸品」「作品」;已说作者就别加「巨匠」「名家」",
    "事实一句话讲完,不要扩成两句。原文若已朴素,直译即可;原文一旦华丽,必须削减。",
    "输出仅为中文 markdown 段落正文。不要 JSON 包装,不要前后注释,不要「中文翻译:」之类开场白。",
  ].join("\n");
  const zhResult = await zhModel.generateContent({
    contents: [{ role: "user", parts: [{ text: loreEn }] }],
    systemInstruction: zhSys,
  });
  const loreZh = zhResult.response.text().trim();
  if (!loreZh) {
    throw new HandlerError(
      "relic-gemini-researcher: lore pass (zh translation) returned empty",
      "OUTPUT_PARSE",
    );
  }

  // Pull citations from the grounding metadata of the EN call.
  const groundingChunks =
    (enResult.response.candidates?.[0] as unknown as {
      groundingMetadata?: {
        groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
      };
    })?.groundingMetadata?.groundingChunks ?? [];
  const citations: Citation[] = groundingChunks
    .map((c) => ({ title: c.web?.title ?? "", url: c.web?.uri ?? "" }))
    .filter((c) => c.url);

  return { loreZh, loreEn, citations };
}

async function runMetadataPass(opts: {
  apiKey: string;
  model: string;
  maxTokens: number;
  loreZh: string;
  loreEn: string;
  imageParts: Part[];
  feedback?: string;
  hasUserImages: boolean;
}): Promise<MetadataOutput> {
  const genAI = new GoogleGenerativeAI(opts.apiKey);
  const model = genAI.getGenerativeModel({
    model: opts.model,
    generationConfig: { responseMimeType: "application/json", maxOutputTokens: opts.maxTokens },
  });

  const sys = [
    "You are deriving structured metadata for a personal relic from its lore + photos.",
    "",
    "Output STRICT JSON in this exact shape:",
    '  {',
    '    "titleZh": string, "titleEn": string,',
    '    "subtitleZh": string, "subtitleEn": string,',
    '    "icon": string,',
    '    "rarity": "COMMON"|"RARE"|"EPIC"|"LEGENDARY"|"SPECIAL",',
    '    "formKind": "TWO_D"|"THREE_D",',
    '    "useUserImage": boolean,',
    '    "networkImageQuery": string,',
    '    "decisionReason": string',
    '  }',
    "",
    "DISPLAY HARD CONSTRAINTS — these four strings render inside a small relic grid cell with `truncate`. They MUST fit on a single line. Exceeding length silently truncates with `…`, looks broken. NO EXCEPTIONS.",
    "- titleZh: ≤4 中文字 (HARD CAP). 范例: 「砖砌之花」「封缄信」「夜行者」「乐高弥撒」「残卷诗」。",
    "- titleEn: **≤10 chars including spaces (HARD CAP)**. 英文 uppercase Space Grotesk 字母比中文宽得多——M 单字就占 12px, 一个 8 字符的单词 (e.g. MAJESTIC) 已经撑掉一整行的一半. 11+ chars wraps and breaks the cell.",
    "  Naming rules (in priority order):",
    "    (a) **NEVER copy the product's official English name verbatim**. The reliquary always renames items into short reliquary-style. e.g. official `Majestic Perch` → BAD as title; reliquary version is `Brass Perch` (still 11, too long) → final `Iron Perch` (10, fits) or just `Perch` (5).",
    "    (b) Pick ONE evocative root + ONE short stem, OR just one strong word. Target 5–10 chars. Good range:",
    "        single word: `Husk` (4), `Vigil` (5), `Cinder` (6), `Reliq` (5), `Shroud` (6), `Saint` (5).",
    "        two words: `Brick Vow` (9), `Lego Mass` (9), `Iron Seal` (9), `Paper Hymn` (10), `Ash Crown` (9), `Bone Hymn` (9), `Lego Saint` (10).",
    "    (c) Long stem words MUST be abbreviated: Cathedral→Cath (4), Reliquary→Reliq (5), Apocalypse→Apoc (4), Sanctuary→Sanct (5), Memorial→Mem (3), Sepulchre→Sepul (5), Resurrection→Resur (5), Devotion→Devot (5), Collectible→Coll (4), Sculpture→Sculpt (6).",
    "    (d) Count chars carefully BEFORE outputting. If 11+, drop a word or pick a shorter stem.",
    "- subtitleZh: ≤6 字符含分隔符 ` · ` (两段每段 ≤2 汉字). 这是**博物馆藏品索引标签**, 不是第二行诗化标题——提供分类信息让人 1 秒识别物品类目。",
    "    Structure: `<大类> · <小类>`, 两段都是 NOUN.",
    "    大类候选: 造物 / 器物 / 文献 / 文具 / 纪念 / 法器 / 装饰 / 服饰 / 工具 / 食器 / 影像 / 玩偶 / 陈设 / 灯具 / 镜具 / 印章 / 卷轴 / 残卷 / 圣物 / 献品.",
    "    小类: 物品的**具体索引子类**——品牌 / 材质 / 器型 / 时代 / 产地 / 工艺. 范例: 乐高 / 怀表 / 信件 / 唱片 / 雕塑 / 陶瓷 / 纸艺 / 黑曜.",
    "    HARD BAN——后段绝不能:",
    "      ① 重复标题已出现的字 (标题「赤炎密码牌」➜ 副标题不准再有「赤炎」)",
    "      ② 同义复述标题 (标题「铁质封章」➜ 副标题写「管理印鉴」, 因为印鉴=封章)",
    "      ③ 动作 / 动词短语 (「暗面凝视」「管理印鉴」)",
    "      ④ 修辞 alias / 重命名 (灯笼写成「引路之灯」)",
    "      ⑤ 形容词 / 状态短语",
    "    Good: 「造物 · 乐高」「文具 · 印章」「器物 · 怀表」「法器 · 令牌」「灯具 · 纸艺」「镜具 · 黑曜」.",
    "    Bad: 「认证 · 管理印鉴」(动词+同义反复)「光源 · 引路之灯」(修辞重命名)「占卜 · 暗面凝视」(动作短语)「密码 · 赤炎令牌」(重复标题字).",
    "- subtitleEn: **≤14 chars including ` · ` and spaces (HARD CAP)**. Same museum-label discipline——two NOUN parts, NO poetic restating. **DO NOT copy lore phrasing** like `Collectible Sculpture` (21 chars, would wrap and break the cell).",
    "    Class (≤6 chars each, abbreviate longer): Toy / Tool / Letter→Lett / Vow / Reliq / Charm / Wear / Vessel→Vess / Lamp / Mirror→Mirr / Seal / Scroll→Scrl / Print / Hymn / Saint→Sn / Plant / Brick / Sculpt / Coll (=collection).",
    "    Subclass (≤6 chars, brand / material / form / era): Lego / Watch / Card / Mirr / Lant / Brick / Stone / Glass / Paper / Brass / Obsid (=obsidian) / Iron / Bone / Bronze→Brnz / Wood.",
    "    Same hard ban applies: subclass must not echo the title's words, must not be a verb phrase or rhetorical alias, must not be an adjective.",
    "    Good (count includes spaces): `Toy · Lego` (10), `Tool · Seal` (11), `Lamp · Paper` (12), `Sculpt · Brass` (14, edge), `Reliq · Iron` (12), `Coll · Sculpt` (13).",
    "    Bad: `Collectible · Sculpture` (23, never), `Cipher · Crimson Token` (22, repeats title), `Augury · Dark Stare` (verb phrase).",
    "    Count chars carefully BEFORE outputting. If 15+, abbreviate further or drop modifier words.",
    "",
    "VOICE — title and subtitle must echo the site's theme: a post-apocalyptic, faintly liturgical cyberpunk reliquary kept by 'The Order of the Green Diva' against the unmaking world. Lean into stems with quiet religious / archaic / end-of-world resonance:",
    "  Chinese: 封 / 祭 / 残 / 献 / 圣 / 忆 / 碎 / 遗 / 哀 / 墟 / 砌 / 缄 / 锁 / 烬 / 灰 / 寂 / 蚀 / 影 / 守 / 默",
    "  English: Vow / Seal / Ash / Vigil / Mass / Saint / Husk / Shroud / Cinder / Reliq / Cath / Hymn / Ember / Scrap / Gild / Quiet",
    "**不要堆砌虚词** — 命名要具体到这件物品，让物的特性自然带出宗教感。物先，气韵后。",
    "  Bad: 「圣物之圣」/ 「Holy Holy Relic」 / 「Sacred Memory」 (空泛虚词).",
    "  Good: 「砖砌之花」(Lego flower) / 「封缄信」(sealed letter) / 「乐高弥撒」/ 「残卷·诗」/ 「Brick Vow」/ 「Plastic Saint」/ 「Paper Hymn」.",
    "",
    "ICON — must be a real Material Symbols (Outlined) name, chosen by FORM-FIRST then by LORE-THEME if the form is too abstract. The icon should make a viewer instantly recognise what kind of object this is. NEVER default to `inventory_2` unless the relic genuinely is an unidentifiable cardboard box.",
    "  Form-first mapping:",
    "    flower / plant → local_florist, spa, eco",
    "    lego / brick / construction toy → toys, extension, construction",
    "    book / manuscript → menu_book, auto_stories, history_edu",
    "    letter / envelope / postcard → mail, drafts, outgoing_mail, mark_email_read",
    "    painting / print / poster → palette, image, brush, draw",
    "    sculpture / figurine / statue → temple_buddhist, monument, person_4",
    "    record / album / cassette → album, radio, headphones",
    "    photograph → photo_camera, photo_library",
    "    jewelry / gem → diamond",
    "    cup / vessel / bottle → local_cafe, sports_bar, water_drop",
    "    clothing / fabric → checkroom, dry_cleaning",
    "    watch / clock → watch, schedule",
    "    key / lock → key, lock",
    "    coin / token → toll, paid",
    "    weapon / blade → swords, shield",
    "    candle / flame → candle, local_fire_department",
    "  Lore-theme fallback (use only when form is too generic to disambiguate):",
    "    candle, church, temple_buddhist, hourglass_top, cross, scroll, nights_stay, destruction, warning_amber, foggy, ac_unit, auto_stories.",
    "",
    "Other fields:",
    "- rarity: judge from emotional weight + uniqueness. Default COMMON; reserve LEGENDARY/SPECIAL for clearly extraordinary items.",
    "- formKind: TWO_D for paintings/photos/letters/anything inherently flat; THREE_D for sculptures/figurines/physical objects.",
    "- useUserImage: TRUE if the relic is personal/handcrafted/unique (only the user has it). FALSE if it's mass-produced (Lego set, branded toy, common art print, published book) and an official product photo would look much cleaner than the user's snapshot.",
    "- networkImageQuery: when useUserImage=false, give a precise search query designed to find ONLY the official photo of THIS exact item — NOT similar products from the same brand/artist/series. Rules:",
    "    * If a product name is visible on the packaging/box in the user's image, ALWAYS quote it verbatim (e.g. `\"Majestic Perch\" Ashley Wood UnderVerse official`). Quoting forces exact match.",
    "    * If a SKU / edition number / catalog code is visible, include it (e.g. `LEGO 10329 \"Tiny Plants\" official`). Codes are the strongest disambiguators.",
    "    * Never use loose descriptive terms alone (`Ashley Wood collectible sculpture`) — they retrieve the whole series, including the wrong products.",
    "    * Empty string when useUserImage=true.",
    "- decisionReason: ≤120 chars, one sentence in the same language as the user's brief, explaining the useUserImage choice.",
  ].join("\n");

  const userParts: Part[] = [];
  // Re-show images so the model can directly judge "is this user photo good enough"
  for (const p of opts.imageParts) userParts.push(p);
  userParts.push({
    text: [
      "Lore (Chinese):",
      opts.loreZh,
      "",
      "Lore (English):",
      opts.loreEn,
      ...(opts.feedback ? ["", "Admin feedback for the regenerated metadata:", opts.feedback] : []),
      ...(!opts.hasUserImages ? ["", "Note: no user-uploaded images available; you must produce useUserImage=false."] : []),
    ].join("\n"),
  });

  const result = await model.generateContent({
    contents: [{ role: "user", parts: userParts }],
    systemInstruction: sys,
  });
  const text = result.response.text();
  const cleaned = stripCodeFence(text);
  // finishReason=MAX_TOKENS means the model truncated mid-output (typically
  // because thinking tokens consumed the budget). Surface that explicitly so
  // the UI shows "raise maxOutputTokens" instead of a generic parse failure.
  const finishReason =
    (result.response.candidates?.[0] as { finishReason?: string } | undefined)?.finishReason ??
    "UNKNOWN";
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const hint =
      finishReason === "MAX_TOKENS"
        ? ` (finishReason=MAX_TOKENS — output truncated; raise maxOutputTokensMetadata, current=${opts.maxTokens})`
        : ` (finishReason=${finishReason})`;
    throw new HandlerError(
      `relic-gemini-researcher: metadata pass returned non-JSON${hint}: ${cleaned.slice(0, 300)}`,
      "OUTPUT_PARSE",
    );
  }
  if (!isObject(parsed)) {
    throw new HandlerError(
      "relic-gemini-researcher: metadata pass JSON is not an object",
      "OUTPUT_PARSE",
    );
  }
  const rarityRaw = typeof parsed.rarity === "string" ? parsed.rarity.toUpperCase() : "COMMON";
  const formKindRaw = typeof parsed.formKind === "string" ? parsed.formKind.toUpperCase().replace(/[-_\s]/g, "") : "";
  const formKind: FormKind =
    formKindRaw === "THREED" || formKindRaw === "THREE_D" || formKindRaw === "3D" ? "THREE_D" : "TWO_D";
  const useUserImage = parsed.useUserImage !== false;

  // Slice caps mirror the prompt's hard caps (×1.5 buffer for char-vs-byte
  // edge cases and the model occasionally overshooting). Anything past these
  // would break line-clamp-1 in the relic grid cell anyway.
  return {
    titleZh: String(parsed.titleZh ?? "").trim().slice(0, 12) || "无名",
    titleEn: String(parsed.titleEn ?? "").trim().slice(0, 14) || "Unnamed",
    subtitleZh: String(parsed.subtitleZh ?? "").trim().slice(0, 10) || "档案 · 待考",
    subtitleEn: String(parsed.subtitleEn ?? "").trim().slice(0, 18) || "Reliq · Lost",
    icon: String(parsed.icon ?? "inventory_2").trim().slice(0, 64),
    rarity: (RARITY_ENUM as readonly string[]).includes(rarityRaw)
      ? (rarityRaw as (typeof RARITY_ENUM)[number])
      : "COMMON",
    formKind,
    useUserImage,
    networkImageQuery:
      typeof parsed.networkImageQuery === "string" && parsed.networkImageQuery.trim()
        ? parsed.networkImageQuery.trim().slice(0, 200)
        : undefined,
    decisionReason: String(parsed.decisionReason ?? "").trim().slice(0, 200),
  };
}

export const geminiResearcher: SkillHandler = async (input, config) => {
  const model = typeof config.model === "string" ? config.model : DEFAULT_MODEL;
  const envName = typeof config.authEnv === "string" && config.authEnv ? config.authEnv : DEFAULT_AUTH_ENV;
  const grounding = config.grounding !== false;
  const loreTokens = typeof config.maxOutputTokensLore === "number" ? config.maxOutputTokensLore : DEFAULT_LORE_TOKENS;
  const metaTokens = typeof config.maxOutputTokensMetadata === "number" ? config.maxOutputTokensMetadata : DEFAULT_META_TOKENS;
  const apiKey = process.env[envName];

  if (!isObject(input)) {
    throw new HandlerError("relic-gemini-researcher: input must be an object", "INVALID_CONFIG");
  }
  if (input._dryRun === true) {
    return {
      loreZh: "[dry-run] 一件示例遗物的圣记。",
      loreEn: "[dry-run] Lore for a sample relic.",
      citations: [],
      titleZh: "示例遗物",
      titleEn: "Sample Relic",
      subtitleZh: "档案 · 示例",
      subtitleEn: "Archive · Sample",
      icon: "inventory_2",
      rarity: "COMMON" as const,
      formKind: "TWO_D" as const,
      useUserImage: true,
      decisionReason: "dry-run",
    };
  }
  if (!apiKey) {
    throw new HandlerError(`relic-gemini-researcher: env "${envName}" not set`, "MISSING_ENV");
  }

  const imageAbsPaths = Array.isArray(input.imageAbsPaths)
    ? (input.imageAbsPaths as unknown[]).filter((p): p is string => typeof p === "string")
    : [];
  const imageParts = await loadImageParts(imageAbsPaths);

  // — Regen mode: skip pass 1, reuse provided lore.
  if (isObject(input.existingLore)) {
    const loreZh = typeof input.existingLore.zh === "string" ? input.existingLore.zh : "";
    const loreEn = typeof input.existingLore.en === "string" ? input.existingLore.en : "";
    if (!loreZh || !loreEn) {
      throw new HandlerError(
        "relic-gemini-researcher: regen mode requires existingLore.{zh,en}",
        "INVALID_CONFIG",
      );
    }
    const meta = await runMetadataPass({
      apiKey,
      model,
      maxTokens: metaTokens,
      loreZh,
      loreEn,
      imageParts,
      feedback: typeof input.feedback === "string" ? input.feedback : undefined,
      hasUserImages: imageParts.length > 0,
    });
    // In regen we DON'T return new lore — caller keeps their version.
    return { ...meta, loreZh, loreEn, citations: [] };
  }

  // — Initial mode: pass 1 (lore w/ search) → pass 2 (metadata derivation).
  const userBrief = typeof input.userBrief === "string" ? input.userBrief : "";
  const fileSummary = typeof input.fileSummary === "string" ? input.fileSummary : "";
  const textExcerpts = typeof input.textExcerpts === "string" ? input.textExcerpts : undefined;

  const lore = await runLorePass({
    apiKey,
    model,
    grounding,
    maxTokens: loreTokens,
    userBrief,
    fileSummary,
    textExcerpts,
    imageParts,
  });
  const meta = await runMetadataPass({
    apiKey,
    model,
    maxTokens: metaTokens,
    loreZh: lore.loreZh,
    loreEn: lore.loreEn,
    imageParts,
    hasUserImages: imageParts.length > 0,
  });

  return {
    loreZh: lore.loreZh,
    loreEn: lore.loreEn,
    citations: lore.citations,
    ...meta,
  };
};
