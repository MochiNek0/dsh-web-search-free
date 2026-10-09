import * as React from "react";

/**
 * Must equal the namespace the Host half registers. Up to dsh 0.1.5 the Plugins
 * settings tab dispatched `settings.plugin.item` once per served namespace,
 * using it as the keyed slot's entry key.
 */
const NAMESPACE = "web-search-free";

/**
 * This package's npm name. Since dsh 0.1.6 the sidebar Plugins page keys
 * `plugins.bundle.config` on the BUNDLE's package name — not on the settings
 * namespace — so the two strings are both needed and must not be conflated.
 */
const PACKAGE_NAME = "dsh-web-search-free";

/**
 * All backends the host half knows about; the order here is the default fallback.
 * Sorted by sustainable free volume (searches per month: unlimited, then daily,
 * then monthly resets, one-time grants last), ties broken by ease of signup —
 * no card, no account beats either. Keep `providerOrder`'s default and
 * `availableProviders` in the Host half in the same order.
 *
 * The free-tier hint shown under each engine is NOT stored here: it is copy, so
 * it lives in the dictionaries below under `free.<key>`, keyed by `key`. Keep it
 * terse — it's a one-line badge, not a pricing table.
 *
 * `caps.search` / `caps.fetch` drive the small capability chips on each row:
 * a search-only engine (Brave, Serping API, SerpApi) shows just "搜索", one that also
 * fetches shows "搜索 · 抓取". This mirrors `supportsFetch` on the host side.
 *
 * `placeholder` / `signupLabel` replace the key box's hint and the link text
 * for an engine whose "key" is not an API key (SearXNG takes instance URLs).
 */
type ProviderMeta = {
  key: string;
  field: string;
  label: string;
  signup: string;
  caps: { search: true; fetch?: true };
  placeholder?: TKey;
  signupLabel?: TKey;
};

const PROVIDERS: ProviderMeta[] = [
  {
    key: "tinyfish",
    field: "tinyfishApiKey",
    label: "TinyFish",
    signup: "https://www.tinyfish.ai/pricing",
    caps: { search: true, fetch: true },
  },
  {
    key: "searxng",
    field: "searxngApiKey",
    label: "SearXNG",
    signup: "https://docs.searxng.org/admin/installation.html",
    caps: { search: true },
    placeholder: "row.placeholder.searxng",
    signupLabel: "row.signup.searxng",
  },
  {
    key: "anysearch",
    field: "anysearchApiKey",
    label: "AnySearch",
    signup: "https://anysearch.com/pricing",
    caps: { search: true, fetch: true },
  },
  {
    key: "baidu",
    field: "baiduApiKey",
    label: "Baidu Qianfan",
    signup: "https://console.bce.baidu.com/iam/#/iam/apikey/list",
    caps: { search: true },
  },
  {
    key: "tavily",
    field: "tavilyApiKey",
    label: "Tavily",
    signup: "https://app.tavily.com/",
    caps: { search: true, fetch: true },
  },
  {
    key: "brave",
    field: "braveApiKey",
    label: "Brave Search",
    signup: "https://api-dashboard.search.brave.com/register",
    caps: { search: true },
  },
  {
    key: "exa",
    field: "exaApiKey",
    label: "Exa (Metaphor)",
    signup: "https://dashboard.exa.ai/",
    caps: { search: true, fetch: true },
  },
  {
    key: "firecrawl",
    field: "firecrawlApiKey",
    label: "Firecrawl",
    signup: "https://www.firecrawl.dev/",
    caps: { search: true, fetch: true },
  },
  {
    key: "volcengine",
    field: "volcengineApiKey",
    label: "Volcengine (Doubao)",
    signup: "https://console.volcengine.com/search-infinity/api-key",
    caps: { search: true },
  },
  {
    key: "serpapi",
    field: "serpapiApiKey",
    label: "SerpApi",
    signup: "https://serpapi.com/users/sign_up",
    caps: { search: true },
  },
  {
    key: "jina",
    field: "jinaApiKey",
    label: "Jina AI",
    signup: "https://jina.ai/api-key",
    caps: { search: true, fetch: true },
  },
  {
    key: "serpingapi",
    field: "serpingapiApiKey",
    label: "Serping API",
    signup: "https://serpingapi.com/signup?ref=dsh-web-search-free",
    caps: { search: true },
  },
];
const DEFAULT_ORDER = PROVIDERS.map((p) => p.key);
const byKey = (key: string) => PROVIDERS.find((p) => p.key === key)!;

/** Split a multi-key field into trimmed, non-empty lines. */
const parseKeys = (raw: string): string[] =>
  (raw || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

/** Canonical storage form: one key per line, no blanks, trimmed. */
const normalizeKeys = (raw: string): string => parseKeys(raw).join("\n");

/**
 * The Host half's card routes (`STATS_ROUTE` / `TEST_ROUTE` in src/index.ts),
 * written relative so they resolve against the page — dsh may be mounted
 * below a path prefix. Same-origin, so the browser's dsh session cookie
 * authenticates them.
 */
const STATS_PATH = "api/web-search-free/stats";
const TEST_PATH = "api/web-search-free/test-keys";
const UPDATE_PATH = "api/web-search-free/check-update";

/** A host without the routes (dsh older than its exact-route registry). */
class RoutesUnavailable extends Error {}

/** Call one card route; a 404 means the host does not serve them at all. */
async function callRoute(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(path, {
    cache: "no-store",
    credentials: "same-origin",
    ...init,
  });
  if (res.status === 404) throw new RoutesUnavailable(path);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
  return body;
}

type KeyTest = {
  key: string;
  ok: boolean;
  ms: number;
  results?: number;
  error?: string;
};
type Tally = {
  calls: number;
  ok: number;
  failed: number;
  totalMs: number;
  lastError?: string;
};
type StatsRow = {
  engine: string;
  key: string | null;
  search: Tally;
  fetch: Tally;
  benchedForMs: number;
};
type Stats = {
  since: number;
  cacheHits: { search: number; fetch: number };
  rows: StatsRow[];
  /** The Host half's package version; absent before 1.8.0. */
  version?: string;
};
type UpdateCheck = { current: string; latest: string; updateAvailable: boolean };

/**
 * The "Advanced" fields, mirroring the Host half's Config one for one (names,
 * option lists and defaults must match `src/index.ts`). Labels and hints live
 * in the dictionaries as `adv.<field>` / `adv.<field>.hint`, option labels as
 * `opt.<field>.<value>` — except `numeric` selects, whose options print as-is.
 */
type AdvancedField =
  | {
      field: string;
      kind: "select";
      options: readonly string[];
      def: string | number;
      numeric?: boolean;
    }
  | {
      field: string;
      kind: "number";
      min: number;
      max: number;
      step: number;
      def: number;
    }
  | { field: string; kind: "domains"; def: string }
  | { field: string; kind: "toggle"; def: boolean };

const ADVANCED: AdvancedField[] = [
  {
    field: "searchStrategy",
    kind: "select",
    options: ["fallback", "race", "merge"],
    def: "fallback",
  },
  {
    field: "parallelEngines",
    kind: "select",
    options: ["2", "3", "4"],
    def: 2,
    numeric: true,
  },
  {
    field: "region",
    kind: "select",
    options: ["auto", "CN", "HK", "TW", "SG", "JP", "KR", "US", "GB"],
    def: "auto",
  },
  {
    field: "language",
    kind: "select",
    options: ["auto", "zh-CN", "zh-TW", "en", "ja", "ko"],
    def: "auto",
  },
  {
    field: "freshness",
    kind: "select",
    options: ["any", "day", "week", "month", "year"],
    def: "any",
  },
  { field: "blockedDomains", kind: "domains", def: "" },
  { field: "preferredDomains", kind: "domains", def: "" },
  {
    field: "snippetLength",
    kind: "number",
    min: 100,
    max: 1000,
    step: 50,
    def: 300,
  },
  {
    field: "tavilySearchDepth",
    kind: "select",
    options: ["basic", "advanced"],
    def: "basic",
  },
  {
    field: "fetchSource",
    kind: "select",
    options: ["providers", "dsh"],
    def: "providers",
  },
  { field: "keylessJinaFetch", kind: "toggle", def: true },
  { field: "cacheMinutes", kind: "number", min: 0, max: 60, step: 5, def: 10 },
];

/**
 * One-click starting points for the advanced fields. A preset only fills the
 * drafts — nothing is stored until Save — and touches only the fields it
 * names, so two can be combined (a language preset plus a quality one).
 * `reset` puts every advanced field back to its default.
 */
const PRESETS: { id: string; patch: Record<string, unknown> }[] = [
  {
    id: "saver",
    patch: {
      searchStrategy: "fallback",
      tavilySearchDepth: "basic",
      snippetLength: 300,
      cacheMinutes: 30,
    },
  },
  { id: "speed", patch: { searchStrategy: "race", parallelEngines: 2 } },
  {
    id: "quality",
    patch: {
      searchStrategy: "merge",
      parallelEngines: 2,
      tavilySearchDepth: "advanced",
      snippetLength: 500,
    },
  },
  { id: "chinese", patch: { region: "CN", language: "zh-CN" } },
  {
    id: "reset",
    patch: Object.fromEntries(ADVANCED.map((spec) => [spec.field, spec.def])),
  },
];

/**
 * Bring a draft into the stored shape: numbers clamped to their range (an
 * emptied number box falls back to the default), domain lists normalized to
 * one trimmed entry per line, like the key fields.
 */
const coerceAdvanced = (spec: AdvancedField, raw: unknown): unknown => {
  if (spec.kind === "number") {
    const n = Math.round(Number(raw));
    if (raw === "" || !Number.isFinite(n)) return spec.def;
    return Math.min(spec.max, Math.max(spec.min, n));
  }
  if (spec.kind === "domains") return normalizeKeys(String(raw ?? ""));
  return raw;
};

/** The two languages dsh ships; `LocaleSnapshot.active` is one of these. */
type Lang = "zh" | "en";

/**
 * Every user-visible string in this card, flat keys with `{name}` placeholders.
 *
 * zh is the key-set source of truth (the repo convention `dsh-client-locale`
 * follows); `en` is typed against it, so a missing or extra English key is a
 * compile error rather than a string that silently falls back at runtime.
 */
const zh = {
  "body.loading": "正在读取设置…",
  "body.unavailable": "该连接不同步设置，无法在此配置。",
  "legacy.title": "从旧版 dsh 升级上来、Key 不见了？",
  "legacy.body":
    "dsh 0.1.7 起配置改存到 profile 的 cordis.patch.yml，它的一次性导入会跳过当时不在运行组合里的插件——升级时本插件起不来的话正好会被跳过。你原来的 Key 没有丢，还在 dsh 主目录（默认 ~/.dsh）的 settings.yaml.imported 里。把下面这段话发给 dsh，它就会帮你搬过去：",
  "legacy.prompt":
    "把 dsh 主目录（默认 ~/.dsh）下 settings.yaml.imported 里 web-search-free 段的所有字段，原样写进当前 profile 的 cordis.patch.yml，作为 id 为 web-search-free 的 entry 的 config；该 entry 不存在就新增。保留原文件的注释和格式，改动前先备份。",
  "legacy.copy": "复制指令",
  "legacy.copied": "已复制",
  intro:
    "填了 Key 的引擎进入「调用顺序」：排在前面的优先调用，失败则 fallback 到下一个，拖 ⋮⋮ 可改顺序。每个引擎可填多个 Key（每行一个），同一引擎内也按顺序轮换。",
  "fetch.label": "启用 web_fetch（URL 抓取）",
  "fetch.on":
    "已开启：模型可调用 web_fetch，抓取来源见「高级设置」里的「web_fetch 抓取来源」。",
  "fetch.off":
    "已关闭：模型调用 web_fetch 时会收到明确的错误提示（web_fetch 由 dsh 统一挂载，不再从工具表移除）。切换即时生效，无需重启。",
  "caps.searchFetch": "搜索 · 抓取",
  "caps.searchOnly": "仅搜索",
  "row.rotating": "{count} 个 Key · 按顺序轮换",
  "row.cleared": "已清空 · 保存后移出调用链",
  "row.joining": "{count} 个 Key · 保存后加入调用链",
  "row.unconfigured": "未配置",
  "row.hint": "点击填入 Key 启用",
  "row.dragTitle": "拖动调整调用顺序",
  "row.placeholder": "每行一个 API Key，支持多 Key 轮换",
  "row.signup": "获取 API Key ↗",
  "row.placeholder.searxng":
    "每行一个实例地址，例如 https://searx.example.com（实例需在 settings.yml 的 search.formats 里开启 json）",
  "row.signup.searxng": "部署说明 ↗",
  "chain.label": "调用顺序",
  "chain.labelCount": "调用顺序 · {count} 个引擎（拖 ⋮⋮ 排序）",
  "chain.empty":
    "还没有引擎进入调用链。在下面挑一个填入 API Key，保存后它就会出现在这里。",
  "rest.label": "其他可用引擎 ({count})",
  "clear.title":
    "删除本插件在 dsh 设置文件中的全部配置，卸载前用它可以不留残留",
  "clear.idle": "清空全部配置",
  "clear.armed": "确认清空？不可撤销",
  "clear.busy": "清空中…",
  "action.discard": "放弃",
  "action.save": "保存",
  "action.saving": "保存中…",
  "error.save": "部分字段未保存成功，请重试。",
  "error.clear": "未能清空：{names}，请重试。",
  /** Joins the engine names in `error.clear`; zh uses the enumeration comma. */
  "list.separator": "、",
  "summary.configured": "{count} 个引擎已配置",
  "summary.none": "尚未配置任何引擎",
  /** The card's own name, as it appears in the Plugins list. */
  "header.title": "免费网页搜索",
  // Deliberately does NOT repeat the title: the two lines sit one above the
  // other, so the subtitle carries what the name does not — how it works.
  "header.subtitle": "多引擎自动 fallback · {summary}",
  "header.unsaved": "未保存",
  "header.engines": "{count} 引擎",
  "free.tinyfish": "搜索/抓取免费",
  "free.anysearch": "1000 次/天（每日重置）",
  "free.exa": "$10 credit/月（约 700 次，累积不清零）",
  "free.tavily": "1000 credits/月",
  "free.firecrawl": "1000 credits/月（约 500 次）",
  "free.serpingapi": "1000 次（一次性，无需绑卡）",
  "free.brave": "$5 额度/月（约 1000 次，需绑卡）",
  "free.serpapi": "250 次/月",
  "free.jina": "10M tokens（一次性）",
  "free.searxng": "自建实例，免费不限量",
  "free.baidu": "每日免费额度（每日重置）",
  "free.volcengine": "500 次/月",
  "version.label": "版本 v{version}",
  "version.check": "检查更新",
  "version.checking": "检查中…",
  "version.latest": "已是最新版本",
  "version.available": "有新版本 v{latest}，运行 dsh plugin --profile web update dsh-web-search-free 升级",
  "version.error": "检查失败：{error}",
  "adv.label": "高级设置",
  "test.button": "测试 Key",
  "test.busy": "测试中…",
  "test.title":
    "用框里的 Key 各做一次小搜索（没保存也能测），每个 Key 消耗一次搜索额度",
  "test.ok": "✓ {key} · {count} 条结果 · {ms} ms",
  "test.fail": "✗ {key} · {error}",
  "test.error": "测试失败：{error}",
  "stats.label": "用量统计（本次启动以来）",
  "stats.refresh": "刷新",
  "stats.loading": "读取中…",
  "stats.empty": "还没有配置引擎。",
  "stats.cache": "缓存命中：搜索 {search} 次 · 抓取 {fetch} 次",
  "stats.search": "搜索",
  "stats.fetch": "抓取",
  "stats.tally": "{ok}/{calls} 成功 · 平均 {avg} ms",
  "stats.unused": "未调用",
  "stats.benched": "冷却中 · 还剩 {min} 分钟",
  "stats.lastError": "最近错误：{error}",
  "stats.keyless": "无 Key",
  "stats.error": "读取统计失败：{error}",
  "preset.label": "快捷预设",
  "preset.hint":
    "预设只改下面对应的选项，点保存才生效；可以叠加，比如「中文优先」+「质量优先」。",
  "preset.saver": "省额度",
  "preset.speed": "速度优先",
  "preset.quality": "质量优先",
  "preset.chinese": "中文优先",
  "preset.reset": "恢复默认",
  "adv.cacheMinutes": "缓存时长（分钟）",
  "adv.cacheMinutes.hint":
    "相同的搜索或抓取在这段时间内直接返回上次的结果，不消耗额度。0 为关闭。只存在内存里，重启即清空。",
  "adv.searchStrategy": "搜索策略",
  "adv.searchStrategy.hint":
    "逐个 fallback 最省额度；并发取最快会同时调用前 N 个引擎，用最先返回的；并发合并会同时调用前 N 个引擎并合并去重，结果最全，但每次搜索消耗 N 个引擎的额度。",
  "opt.searchStrategy.fallback": "逐个 fallback（默认）",
  "opt.searchStrategy.race": "并发取最快",
  "opt.searchStrategy.merge": "并发合并结果",
  "adv.parallelEngines": "同时调用的引擎数",
  "adv.parallelEngines.hint": "取「调用顺序」里排在最前的 N 个引擎。",
  "adv.region": "结果地区",
  "adv.region.hint": "只对支持地区参数的引擎生效，其余引擎忽略。",
  "opt.region.auto": "自动（引擎默认）",
  "opt.region.CN": "中国大陆",
  "opt.region.HK": "中国香港",
  "opt.region.TW": "中国台湾",
  "opt.region.SG": "新加坡",
  "opt.region.JP": "日本",
  "opt.region.KR": "韩国",
  "opt.region.US": "美国",
  "opt.region.GB": "英国",
  "adv.language": "结果语言",
  "adv.language.hint": "只对支持语言参数的引擎生效，其余引擎忽略。",
  "opt.language.auto": "自动（引擎默认）",
  "opt.language.zh-CN": "简体中文",
  "opt.language.zh-TW": "繁体中文",
  "opt.language.en": "English",
  "opt.language.ja": "日本語",
  "opt.language.ko": "한국어",
  "adv.freshness": "时间范围",
  "adv.freshness.hint":
    "作用于所有搜索，只对支持时间过滤的引擎生效。主要搜新闻、动态时再开。",
  "opt.freshness.any": "不限",
  "opt.freshness.day": "一天内",
  "opt.freshness.week": "一周内",
  "opt.freshness.month": "一个月内",
  "opt.freshness.year": "一年内",
  "adv.blockedDomains": "屏蔽域名",
  "adv.blockedDomains.hint":
    "每行一个，子域名一并屏蔽，可直接粘贴网址。某个引擎的结果全被屏蔽时，会换下一个引擎。",
  "adv.preferredDomains": "优先域名",
  "adv.preferredDomains.hint":
    "每行一个：来自这些域名的结果排到最前，其他结果照常保留。",
  "adv.domains.placeholder": "每行一个域名，例如 example.com",
  "adv.snippetLength": "摘要长度",
  "adv.snippetLength.hint":
    "每条结果给模型看的摘要字符数（100–1000）。越长信息越多，也越费 token。",
  "adv.tavilySearchDepth": "Tavily 搜索深度",
  "adv.tavilySearchDepth.hint": "advanced 结果更相关，但每次消耗 2 credits。",
  "opt.tavilySearchDepth.basic": "basic（1 credit）",
  "opt.tavilySearchDepth.advanced": "advanced（2 credits）",
  "adv.fetchSource": "web_fetch 抓取来源",
  "adv.fetchSource.hint":
    "providers：用填了 Key 的引擎按顺序抓取，都没有或都失败时退回 dsh 自带的本地抓取。dsh：直接用 dsh 自带的本地抓取（免费、URL 不发给第三方，但不渲染 JS，部分站点会被拦）。",
  "opt.fetchSource.providers": "插件引擎（失败退回 dsh 本地）",
  "opt.fetchSource.dsh": "dsh 本地抓取",
  "adv.keylessJinaFetch": "无 Key 抓取兜底",
  "adv.keylessJinaFetch.hint":
    "带 Key 的抓取都失败时，改用不带 Key 的 Jina Reader（有速率限制，URL 会发给 Jina）。没配任何抓取引擎时，它就是唯一的抓取通道。",
};

const en: Record<keyof typeof zh, string> = {
  "body.loading": "Loading settings…",
  "body.unavailable":
    "This connection does not sync settings, so it cannot be configured here.",
  "legacy.title": "Upgraded from an older dsh and your keys are gone?",
  "legacy.body":
    "Since dsh 0.1.7 settings live in the profile's cordis.patch.yml, and its one-shot import skips any plugin that was not in the running composition at the time — which is exactly what happens when this plugin could not start during the upgrade. Your keys are not lost: they are still in settings.yaml.imported under the dsh home (~/.dsh by default). Hand the line below to dsh and it will move them across:",
  "legacy.prompt":
    "Move every field of the web-search-free section in settings.yaml.imported (under the dsh home, ~/.dsh by default) into the current profile's cordis.patch.yml, as the config of the entry with id web-search-free; add that entry if it is missing. Preserve the file's existing comments and formatting, and back it up first.",
  "legacy.copy": "Copy instruction",
  "legacy.copied": "Copied",
  intro:
    "Engines with a key join the call order: the first one is tried first, and a failure falls back to the next. Drag ⋮⋮ to reorder. Each engine takes several keys (one per line), rotated in order too.",
  "fetch.label": "Enable web_fetch (URL fetching)",
  "fetch.on":
    "On: the model can call web_fetch; where pages are fetched from is set by \"web_fetch source\" under Advanced.",
  "fetch.off":
    "Off: calling web_fetch returns a clear error instead of fetching (the tool stays mounted by dsh). Takes effect immediately, no restart.",
  "caps.searchFetch": "Search · Fetch",
  "caps.searchOnly": "Search only",
  "row.rotating": "{count} key(s) · rotated in order",
  "row.cleared": "Cleared · leaves the call order on save",
  "row.joining": "{count} key(s) · joins the call order on save",
  "row.unconfigured": "Not configured",
  "row.hint": "Click to add a key",
  "row.dragTitle": "Drag to change the call order",
  "row.placeholder": "One API key per line, rotated across keys",
  "row.signup": "Get an API key ↗",
  "row.placeholder.searxng":
    "One instance URL per line, e.g. https://searx.example.com (the instance must enable json under search.formats in settings.yml)",
  "row.signup.searxng": "Setup guide ↗",
  "chain.label": "Call order",
  "chain.labelCount": "Call order · {count} engine(s) (drag ⋮⋮ to sort)",
  "chain.empty":
    "No engine is in the call order yet. Pick one below, add an API key, and it appears here once saved.",
  "rest.label": "Other available engines ({count})",
  "clear.title":
    "Delete every setting this plugin holds in the dsh settings file — run it before uninstalling to leave nothing behind",
  "clear.idle": "Clear all settings",
  "clear.armed": "Confirm clear? Cannot be undone",
  "clear.busy": "Clearing…",
  "action.discard": "Discard",
  "action.save": "Save",
  "action.saving": "Saving…",
  "error.save": "Some fields were not saved. Please try again.",
  "error.clear": "Could not clear: {names}. Please try again.",
  "list.separator": ", ",
  "summary.configured": "{count} engine(s) configured",
  "summary.none": "No engine configured yet",
  "header.title": "Web Search Free",
  "header.subtitle": "Multi-engine automatic fallback · {summary}",
  "header.unsaved": "Unsaved",
  "header.engines": "{count} engine(s)",
  "free.tinyfish": "Search & fetch free",
  "free.anysearch": "1000 calls/day (resets daily)",
  "free.exa": "$10 credit/month (≈700 calls, rolls over)",
  "free.tavily": "1000 credits/month",
  "free.firecrawl": "1000 credits/month (≈500 calls)",
  "free.serpingapi": "1000 calls (one-time, no card)",
  "free.brave": "$5 credit/month (≈1000 calls, card required)",
  "free.serpapi": "250 calls/month",
  "free.jina": "10M tokens (one-time)",
  "free.searxng": "Self-hosted, free and unlimited",
  "free.baidu": "Free daily quota (resets daily)",
  "free.volcengine": "500 calls/month",
  "version.label": "Version v{version}",
  "version.check": "Check for updates",
  "version.checking": "Checking…",
  "version.latest": "Up to date",
  "version.available": "v{latest} is available — run dsh plugin --profile web update dsh-web-search-free",
  "version.error": "Check failed: {error}",
  "adv.label": "Advanced",
  "test.button": "Test keys",
  "test.busy": "Testing…",
  "test.title":
    "Run one small search with each key in the box (saved or not); each key uses one search of quota",
  "test.ok": "✓ {key} · {count} results · {ms} ms",
  "test.fail": "✗ {key} · {error}",
  "test.error": "Test failed: {error}",
  "stats.label": "Usage (since start)",
  "stats.refresh": "Refresh",
  "stats.loading": "Loading…",
  "stats.empty": "No engine configured yet.",
  "stats.cache": "Cache hits: {search} search · {fetch} fetch",
  "stats.search": "Search",
  "stats.fetch": "Fetch",
  "stats.tally": "{ok}/{calls} succeeded · avg {avg} ms",
  "stats.unused": "Not called",
  "stats.benched": "Benched · {min} min left",
  "stats.lastError": "Last error: {error}",
  "stats.keyless": "keyless",
  "stats.error": "Could not load usage: {error}",
  "preset.label": "Presets",
  "preset.hint":
    "A preset only changes the fields it covers, and nothing applies until you Save. They combine — e.g. Chinese first + Best quality.",
  "preset.saver": "Save quota",
  "preset.speed": "Fastest",
  "preset.quality": "Best quality",
  "preset.chinese": "Chinese first",
  "preset.reset": "Reset to defaults",
  "adv.cacheMinutes": "Cache (minutes)",
  "adv.cacheMinutes.hint":
    "An identical search or fetch within this window returns the previous result without using quota. 0 turns it off. Memory only; cleared on restart.",
  "adv.searchStrategy": "Search strategy",
  "adv.searchStrategy.hint":
    "Fallback tries one engine at a time and uses the least quota. Race queries the first N engines at once and takes the fastest. Merge queries the first N engines at once and fuses their results — the best coverage, at N engines' quota per search.",
  "opt.searchStrategy.fallback": "Fallback (default)",
  "opt.searchStrategy.race": "Race: fastest wins",
  "opt.searchStrategy.merge": "Merge results",
  "adv.parallelEngines": "Engines queried at once",
  "adv.parallelEngines.hint": "The first N engines in the call order.",
  "adv.region": "Region",
  "adv.region.hint": "Applied by engines that take a region; others ignore it.",
  "opt.region.auto": "Auto (engine default)",
  "opt.region.CN": "Mainland China",
  "opt.region.HK": "Hong Kong",
  "opt.region.TW": "Taiwan",
  "opt.region.SG": "Singapore",
  "opt.region.JP": "Japan",
  "opt.region.KR": "South Korea",
  "opt.region.US": "United States",
  "opt.region.GB": "United Kingdom",
  "adv.language": "Language",
  "adv.language.hint":
    "Applied by engines that take a language; others ignore it.",
  "opt.language.auto": "Auto (engine default)",
  "opt.language.zh-CN": "Simplified Chinese",
  "opt.language.zh-TW": "Traditional Chinese",
  "opt.language.en": "English",
  "opt.language.ja": "Japanese",
  "opt.language.ko": "Korean",
  "adv.freshness": "Time range",
  "adv.freshness.hint":
    "Applies to every search, on engines that support a time filter. Worth turning on only if you mostly search news.",
  "opt.freshness.any": "Any time",
  "opt.freshness.day": "Past day",
  "opt.freshness.week": "Past week",
  "opt.freshness.month": "Past month",
  "opt.freshness.year": "Past year",
  "adv.blockedDomains": "Blocked domains",
  "adv.blockedDomains.hint":
    "One per line; subdomains are blocked too, and pasted URLs work. If every result from an engine is blocked, the next engine is tried.",
  "adv.preferredDomains": "Preferred domains",
  "adv.preferredDomains.hint":
    "One per line: results from these domains move to the top; the rest stay.",
  "adv.domains.placeholder": "One domain per line, e.g. example.com",
  "adv.snippetLength": "Snippet length",
  "adv.snippetLength.hint":
    "Characters of snippet the model sees per result (100–1000). Longer means more context and more tokens.",
  "adv.tavilySearchDepth": "Tavily search depth",
  "adv.tavilySearchDepth.hint":
    "Advanced returns more relevant results but costs 2 credits per search.",
  "opt.tavilySearchDepth.basic": "basic (1 credit)",
  "opt.tavilySearchDepth.advanced": "advanced (2 credits)",
  "adv.fetchSource": "web_fetch source",
  "adv.fetchSource.hint":
    "providers: the keyed engines fetch in call order, falling back to dsh's own local fetcher when none is configured or all fail. dsh: always use dsh's own local fetcher (free, the URL goes to no third party, but no JS rendering, and some sites block it).",
  "opt.fetchSource.providers": "Plugin engines (dsh local as fallback)",
  "opt.fetchSource.dsh": "dsh local fetch",
  "adv.keylessJinaFetch": "Keyless fetch fallback",
  "adv.keylessJinaFetch.hint":
    "When every keyed fetch fails, fall back to Jina Reader without a key (rate-limited; the URL is sent to Jina). With no fetch engine configured, it is the only way to fetch.",
};

const DICTS: Record<Lang, Record<string, string>> = { zh, en };

type TKey = keyof typeof zh;
type Translate = (key: TKey, params?: Record<string, unknown>) => string;

/**
 * Language to stand in wherever the host has no locale service to ask — the
 * same primary-subtag rule `dsh-client-locale` uses for a fresh browser.
 */
const browserLang = (): Lang =>
  typeof navigator !== "undefined" &&
  (navigator.language || "").toLowerCase().split("-")[0] === "en"
    ? "en"
    : "zh";

/**
 * Follow the host's Language preference (Settings → General), re-rendering on
 * every switch.
 *
 * `locale` is read WITHOUT declaring it in `inject`, so a host that does not
 * ship `@deepseek-ai/dsh-client-locale` leaves the card working on the
 * browser-derived language instead of never mounting it at all.
 */
const useLang = (locale: any): Lang => {
  const active = React.useSyncExternalStore(
    React.useCallback(
      (listener: () => void) =>
        locale ? locale.subscribe(listener) : () => {},
      [locale],
    ),
    React.useCallback(
      () => (locale ? locale.getSnapshot().active : null),
      [locale],
    ),
  );
  return active === "en" || active === "zh" ? active : browserLang();
};

/** Look a key up in the active language, falling back to zh, then to the key. */
const translate =
  (lang: Lang): Translate =>
  (key, params) => {
    const raw = DICTS[lang][key] ?? zh[key] ?? key;
    if (!params) return raw;
    return raw.replace(/\{(\w+)\}/g, (whole, name) =>
      name in params ? String(params[name]) : whole,
    );
  };

/**
 * Every slot this card knows how to live in, most preferred first.
 *
 * dsh moves this seat between releases (0.1.5 dispatched `settings.plugin.item`
 * from the Settings → Plugins tab; 0.1.6 deleted that tab and moved plugin
 * configuration to the sidebar Plugins page), so one hard-coded name makes the
 * card invisible on every version but the one it was built against.
 *
 * `ctx.slots.inject(name, cb)` is what makes a list workable: it WAITS for a
 * declaration instead of throwing, so naming a slot the host has never heard of
 * costs nothing. Only `slots.register()` into an undeclared slot throws — which
 * is why the registration below happens inside the injection callback, never at
 * apply time.
 *
 * `plugins.item` is deliberately NOT a candidate: its contract reserves it for
 * the host-plane pages `ui-settings-plugins` ships ("a bundle's configuration
 * belongs in `plugins.bundle.config` or `plugins.row.config` instead"), and a
 * bundle registering there gets a card in the Official group ON TOP of the page
 * its own bundle already has — two configuration pages for one plugin.
 */
const SLOT_CANDIDATES: { name: string; options: Record<string, unknown> }[] = [
  // dsh >= 0.1.6: the bundle's own configuration, rendered on the bundle's page
  // between its description and its rows. Keyed by package name; the page asks
  // for `view: 'page'` only, and draws the title, icon and crumb itself.
  { name: "plugins.bundle.config", options: { key: PACKAGE_NAME } },
  // dsh <= 0.1.5: one card per served settings namespace in Settings → Plugins.
  // No `view` prop there, so the card falls back to its own collapsible header.
  { name: "settings.plugin.item", options: { key: NAMESPACE } },
];

/** Flatten the live declaration tree into the slot names it contains. */
const declaredSlotNames = (nodes: any[], into: string[] = []): string[] => {
  for (const node of nodes || []) {
    if (node?.name) into.push(node.name);
    declaredSlotNames(node?.children ?? [], into);
  }
  return into;
};

/**
 * Every service that can carry this plugin's settings section, most preferred
 * first. Each entry names the services it needs and how to bind the face.
 *
 * - dsh >= 0.1.7 deleted `settingsScope` and replaced it with `configForms`,
 *   the settings domain base. `get(entryId)` is keyed by the profile ENTRY id
 *   rather than a registered namespace — for this plugin the same string, since
 *   its bundle patch names the row `web-search-free`.
 * - dsh <= 0.1.6 provides `settingsScope`, bound to the namespace the host half
 *   registers. `bind()` reads `connection` and `remote` off the CALLING
 *   context, so those two travel with it.
 *
 * Both faces expose the same `getSnapshot` / `subscribe` / `set` / `unset`
 * (only the write return type differs, and this card reads back rather than
 * trusting it), so everything below is written against either one without
 * knowing which it got.
 *
 * NEITHER may be named in the top-level `inject`. A service the host does not
 * provide leaves the entry PENDING forever, and web boot treats an entry that
 * did not activate as FATAL — it throws `web boot: 1 entry did not activate`
 * and the whole UI stops at "Failed to load plugins". One optional service
 * would therefore take dsh down, which is exactly what 0.1.7-alpha.1 did to
 * this plugin. A child `ctx.inject()` fiber is the version-tolerant form: it is
 * not a loader entry, so a wait that never resolves costs nothing.
 */
const SCOPE_PROVIDERS: { services: string[]; bind: (ctx: any) => any }[] = [
  // dsh >= 0.1.7
  { services: ["configForms"], bind: (ctx) => ctx.configForms.get(NAMESPACE) },
  // dsh <= 0.1.6
  {
    services: ["settingsScope", "connection", "remote"],
    bind: (ctx) => ctx.settingsScope.bind({ namespace: NAMESPACE }),
  },
];

export const inject = ["slots"];

export function apply(ctx: any) {
  // A release providing both faces at once would otherwise mount two cards into
  // one slot cell, the second silently replacing the first. First one wins.
  let claimed = false;

  for (const provider of SCOPE_PROVIDERS) {
    ctx.inject(provider.services, (sctx: any) => {
      if (claimed) return;
      claimed = true;
      mountCard(sctx, provider.bind(sctx));
    });
  }

  // A dsh generation providing neither face leaves the plugin silently
  // unconfigurable, which reads as "the plugin is broken". Say so once.
  const timer = setTimeout(() => {
    if (claimed) return;
    console.warn(
      `[${NAMESPACE}] no settings service found: this dsh provides none of ${SCOPE_PROVIDERS.map((p) => p.services[0]).join(", ")}.` +
        ` Keys can still be set in the profile's cordis.patch.yml; please report this at https://github.com/MochiNek0/dsh-web-search-free/issues`,
    );
  }, 5000);
  ctx.effect(() => () => clearTimeout(timer));
}

/**
 * Put the card in the best slot this dsh declares, and keep it there.
 * @param ctx - the settings-service fiber the card's registrations belong to.
 * @param scope - the bound settings face, whichever generation supplied it.
 */
function mountCard(ctx: any, scope: any) {
  // Which candidates the host currently declares, and which one is mounted.
  // A host that declares two of them at once (an overlap release) must still
  // show exactly one card, so the arbiter always keeps the best one alone.
  const declared = new Set<string>();
  let mounted: { name: string; dispose: () => void } | null = null;

  const reconcile = () => {
    const best = SLOT_CANDIDATES.find((slot) => declared.has(slot.name));
    if (mounted?.name === best?.name) return;
    mounted?.dispose();
    mounted = null;
    if (!best) return;
    mounted = {
      name: best.name,
      dispose: ctx.slots.register(
        {
          ...best.options,
          name: best.name,
          // `reflect.get` is the read that does not require an `inject` entry: it
          // returns undefined rather than throwing when no locale plugin is loaded.
          inject: () => ({ scope, locale: ctx.reflect.get("locale") }),
        },
        WebSearchFreeCard,
      ),
    };
  };

  for (const slot of SLOT_CANDIDATES) {
    ctx.slots.inject(slot.name, () => {
      declared.add(slot.name);
      reconcile();
      return () => {
        declared.delete(slot.name);
        reconcile();
      };
    });
  }

  // A dsh that renamed the seat again leaves the card silently invisible, which
  // reads as "the plugin is broken". Say so once, with the slot names this dsh
  // actually declares, so the next rename is a one-line bug report.
  const timer = setTimeout(() => {
    if (mounted) return;
    const names = declaredSlotNames(ctx.slots.snapshot?.() ?? [])
      .filter((name) => name.includes("plugin"))
      .sort();
    console.warn(
      `[${NAMESPACE}] no settings card mounted: this dsh declares none of ${SLOT_CANDIDATES.map((s) => s.name).join(", ")}.` +
        ` Plugin-related slots it does declare: ${names.join(", ") || "(none)"}.` +
        ` Keys can still be set in the profile's cordis.patch.yml; please report this list at https://github.com/MochiNek0/dsh-web-search-free/issues`,
    );
  }, 5000);
  ctx.effect(() => () => clearTimeout(timer));
}

type Snapshot = {
  status: "loading" | "ready" | "unavailable";
  value?: {
    jinaApiKey?: string;
    exaApiKey?: string;
    tavilyApiKey?: string;
    firecrawlApiKey?: string;
    braveApiKey?: string;
    anysearchApiKey?: string;
    tinyfishApiKey?: string;
    serpapiApiKey?: string;
    serpingapiApiKey?: string;
    searxngApiKey?: string;
    baiduApiKey?: string;
    volcengineApiKey?: string;
    enableFetch?: boolean;
    providerOrder?: string[];
    /** The {@link ADVANCED} fields, read through `storedAdvanced`. */
    [field: string]: unknown;
  };
  /**
   * The raw user layer, as opposed to `value`'s base+user resolution. Only this
   * says whether a field is actually stored: `value` always carries the
   * schema's defaults, so it can never distinguish "saved" from "defaulted".
   */
  user?: unknown;
  writable?: boolean;
};

/**
 * A provider field is "configured" if either a draft holds a non-empty value or
 * the resolved value does. Centralizing this keeps the collapsed summary count
 * and the per-row badge on the same page about what counts as active.
 */
const isConfigured = (
  field: string,
  snapshot: Snapshot,
  drafts: Record<string, string>,
): boolean => {
  const draft = drafts[field];
  if (draft !== undefined) return parseKeys(draft).length > 0;
  const stored =
    snapshot.value?.[field as keyof NonNullable<Snapshot["value"]>];
  return typeof stored === "string" && parseKeys(stored).length > 0;
};

/**
 * `view` is the owner share of the dsh >= 0.1.6 configuration slots: `'page'`
 * means the Plugins page already drew the title, icon and crumb and wants the
 * form alone. It is absent on the dsh <= 0.1.5 seat, where the card owns its
 * whole chrome — so undefined keeps the original collapsible card.
 */
function WebSearchFreeCard({
  scope,
  locale,
  view,
}: {
  scope: any;
  locale?: any;
  view?: "summary" | "page";
}) {
  const snapshot: Snapshot = React.useSyncExternalStore(
    React.useCallback(
      (listener: () => void) => scope.subscribe(listener),
      [scope],
    ),
    () => scope.getSnapshot(),
  );
  const lang = useLang(locale);
  const t = React.useMemo(() => translate(lang), [lang]);
  const [open, setOpen] = React.useState(false);
  const [expandedRows, setExpandedRows] = React.useState<
    Record<string, boolean>
  >({});
  const [keyDrafts, setKeyDrafts] = React.useState<Record<string, string>>({});
  const [orderDraft, setOrderDraft] = React.useState<string[] | null>(null);
  const [enableFetchDraft, setEnableFetchDraft] = React.useState<
    boolean | null
  >(null);
  const [advDrafts, setAdvDrafts] = React.useState<Record<string, unknown>>(
    {},
  );
  const [advOpen, setAdvOpen] = React.useState(false);
  // Card routes on the Host half. `null` until the first probe answers;
  // `false` on a dsh that does not serve them, which hides tests and stats.
  const [routesOk, setRoutesOk] = React.useState<boolean | null>(null);
  const [stats, setStats] = React.useState<Stats | null>(null);
  const [statsError, setStatsError] = React.useState("");
  const [statsOpen, setStatsOpen] = React.useState(false);
  const [statsLoading, setStatsLoading] = React.useState(false);
  // The update check's answer, or its error text; `null` until asked.
  const [update, setUpdate] = React.useState<UpdateCheck | string | null>(
    null,
  );
  const [checkingUpdate, setCheckingUpdate] = React.useState(false);
  const [testing, setTesting] = React.useState<Record<string, boolean>>({});
  const [tests, setTests] = React.useState<
    Record<string, KeyTest[] | string>
  >({});
  const [dragKey, setDragKey] = React.useState<string | null>(null);
  const [dropTarget, setDropTarget] = React.useState<string | null>(null);
  // Which row, if any, has its drag armed. Rows are NOT permanently
  // `draggable`: with the flag hard-on, dragging to select text inside a row's
  // textarea starts a row drag instead, so keys cannot be edited with a mouse.
  // Pressing the ⋮⋮ handle arms the row for the drag that immediately follows.
  const [dragArmed, setDragArmed] = React.useState<string | null>(null);
  // `null` = follow the default: collapsed once something is in the chain,
  // expanded while nothing is, so a fresh install still shows every engine.
  const [restOpen, setRestOpen] = React.useState<boolean | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [clearing, setClearing] = React.useState(false);
  // Two-click arm for the destructive clear. Deliberately NOT `window.confirm`:
  // this bundle runs in whatever webview the host embeds, and an embedded
  // webview may make `confirm()` a no-op returning false — which would leave
  // the button silently dead. An in-page arm behaves the same everywhere and
  // needs no UI primitive from the host.
  const [armed, setArmed] = React.useState(false);
  // Feedback for the legacy-migration copy button.
  const [copied, setCopied] = React.useState(false);
  const [failed, setFailed] = React.useState("");

  const loadStats = React.useCallback(async () => {
    setStatsLoading(true);
    try {
      setStats(await callRoute(STATS_PATH));
      setStatsError("");
      setRoutesOk(true);
    } catch (err: any) {
      if (err instanceof RoutesUnavailable) setRoutesOk(false);
      else setStatsError(String(err?.message ?? err));
    } finally {
      setStatsLoading(false);
    }
  }, []);
  // One probe on mount decides whether this dsh serves the routes at all.
  // The summary view is a single line that never shows either, so it skips it.
  React.useEffect(() => {
    if (view !== "summary") void loadStats();
  }, [loadStats, view]);

  const checkUpdate = async () => {
    setCheckingUpdate(true);
    try {
      setUpdate(await callRoute(UPDATE_PATH));
    } catch (err: any) {
      setUpdate(t("version.error", { error: err?.message ?? err }));
    } finally {
      setCheckingUpdate(false);
    }
  };

  const testKeys = async (provider: ProviderMeta) => {
    setTesting((s) => ({ ...s, [provider.key]: true }));
    try {
      // Test what is in the box: a key being typed in is exactly the one the
      // user wants checked before saving. An untouched box sends nothing and
      // the Host tests the stored keys.
      const draft = keyDrafts[provider.field];
      const body = await callRoute(TEST_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          engine: provider.key,
          ...(draft !== undefined ? { keys: parseKeys(draft) } : {}),
        }),
      });
      setTests((s) => ({ ...s, [provider.key]: body.results ?? [] }));
      if (statsOpen) void loadStats();
    } catch (err: any) {
      if (err instanceof RoutesUnavailable) setRoutesOk(false);
      setTests((s) => ({
        ...s,
        [provider.key]: t("test.error", { error: err?.message ?? err }),
      }));
    } finally {
      setTesting((s) => ({ ...s, [provider.key]: false }));
    }
  };

  // Let go of the arm if the user walks away from it.
  React.useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), 5000);
    return () => window.clearTimeout(timer);
  }, [armed]);

  const storedKey = (field: string) => {
    const value =
      snapshot.value?.[field as keyof NonNullable<Snapshot["value"]>];
    return typeof value === "string" ? value : "";
  };
  // A stored order was written against the provider set of its day, so it is a
  // subset, not the whole list — an engine added afterwards is simply absent
  // from it. Rendering the stored array verbatim therefore hides every new
  // engine forever. Union it with the current defaults, exactly as the Host's
  // own `getActiveProviders` does, so the card and the fallback chain always
  // agree on which engines exist.
  const storedOrder = (): string[] => {
    const raw = snapshot.value?.providerOrder;
    const known = Array.isArray(raw)
      ? raw.filter((k) => PROVIDERS.some((p) => p.key === k))
      : [];
    return Array.from(new Set([...known, ...DEFAULT_ORDER]));
  };
  const order = orderDraft ?? storedOrder();
  // enableFetch defaults to true (schema default); only an explicit false is "off".
  const storedEnableFetch = (): boolean =>
    snapshot.value?.enableFetch !== false;
  const enableFetch = enableFetchDraft ?? storedEnableFetch();

  // Every advanced field has a schema default, and `value` may or may not
  // carry it depending on the host generation, so a missing value IS the
  // default.
  const storedAdvanced = (spec: AdvancedField): unknown =>
    snapshot.value?.[spec.field] ?? spec.def;
  const advancedValue = (spec: AdvancedField): unknown =>
    spec.field in advDrafts ? advDrafts[spec.field] : storedAdvanced(spec);
  const advDirty = ADVANCED.filter(
    (spec) =>
      spec.field in advDrafts &&
      JSON.stringify(coerceAdvanced(spec, advDrafts[spec.field])) !==
        JSON.stringify(storedAdvanced(spec)),
  );

  const keyDirty = PROVIDERS.filter(
    (p) =>
      p.field in keyDrafts &&
      normalizeKeys(keyDrafts[p.field]) !== normalizeKeys(storedKey(p.field)),
  );
  const orderDirty =
    orderDraft !== null &&
    JSON.stringify(orderDraft) !== JSON.stringify(storedOrder());
  const enableFetchDirty =
    enableFetchDraft !== null && enableFetchDraft !== storedEnableFetch();
  const dirty =
    keyDirty.length > 0 ||
    orderDirty ||
    enableFetchDirty ||
    advDirty.length > 0;
  const disabled = saving || clearing || snapshot.writable === false;
  // Anything to erase? Read the user layer, not the resolved value: the latter
  // always carries the schema defaults and would report "configured" forever.
  const userLayer =
    typeof snapshot.user === "object" && snapshot.user !== null
      ? (snapshot.user as Record<string, unknown>)
      : {};
  const configuredCount = PROVIDERS.filter((p) =>
    isConfigured(p.field, snapshot, keyDrafts),
  ).length;
  const configured = Object.keys(userLayer).length > 0;

  const toggleRow = (key: string) =>
    setExpandedRows((s) => ({ ...s, [key]: !s[key] }));

  const save = async () => {
    setSaving(true);
    setFailed("");
    const pending = keyDirty.map((p) => ({
      field: p.field,
      value: normalizeKeys(keyDrafts[p.field]),
    }));
    for (const { field, value } of pending) {
      if (value === "") await scope.unset(field);
      else await scope.set(field, value);
    }
    if (orderDirty && orderDraft !== null)
      await scope.set("providerOrder", orderDraft);
    if (enableFetchDirty && enableFetchDraft !== null)
      await scope.set("enableFetch", enableFetchDraft);
    // A value equal to its default is unset rather than written, so the
    // profile file only ever lists what the user actually changed.
    const advPending = advDirty.map((spec) => ({
      spec,
      value: coerceAdvanced(spec, advDrafts[spec.field]),
    }));
    for (const { spec, value } of advPending) {
      if (JSON.stringify(value) === JSON.stringify(spec.def))
        await scope.unset(spec.field);
      else await scope.set(spec.field, value);
    }
    // Writes swallow wire and revision failures and reload instead of throwing,
    // so the Host's readback is the only authority on what actually landed.
    const after = scope.getSnapshot();
    const rejectedKeys = pending.filter(
      ({ field, value }) =>
        (after.value?.[
          field as keyof NonNullable<Snapshot["value"]> as string
        ] ?? "") !== value,
    );
    const orderLanded =
      JSON.stringify(after.value?.providerOrder ?? DEFAULT_ORDER) ===
      JSON.stringify(orderDraft ?? storedOrder());
    const enableFetchLanded =
      (after.value?.enableFetch !== false) ===
      (enableFetchDraft ?? storedEnableFetch());
    setKeyDrafts(
      Object.fromEntries(
        rejectedKeys.map(({ field, value }) => [field, value]),
      ),
    );
    if (!orderLanded) setOrderDraft(null);
    if (!enableFetchLanded) setEnableFetchDraft(null);
    const rejectedAdv = advPending.filter(
      ({ spec, value }) =>
        JSON.stringify(after.value?.[spec.field] ?? spec.def) !==
        JSON.stringify(value),
    );
    setAdvDrafts(
      Object.fromEntries(
        rejectedAdv.map(({ spec, value }) => [spec.field, value]),
      ),
    );
    if (
      rejectedKeys.length > 0 ||
      !orderLanded ||
      !enableFetchLanded ||
      rejectedAdv.length > 0
    )
      setFailed(t("error.save"));
    setSaving(false);
  };

  // Erase every stored value in this plugin's user layer.
  //
  // Uninstalling drops the bundle patch and every registration, but nothing in
  // dsh removes a namespace's stored section — without this, the API keys
  // outlive the plugin on disk. Run it before uninstalling.
  //
  // The section KEY survives: the file provider patches a namespace by diffing
  // its children (`patchNode`), so clearing every field leaves a bare
  // `web-search-free:` entry with nothing under it. No API exposed to a client
  // can delete the key itself, and an empty key carries no secret.
  //
  // Deliberately destructive, so it confirms first.
  const clearAll = async () => {
    setArmed(false);
    setClearing(true);
    setFailed("");
    for (const field of [
      ...PROVIDERS.map((p) => p.field),
      "providerOrder",
      "enableFetch",
      ...ADVANCED.map((spec) => spec.field),
    ]) {
      await scope.unset(field);
    }
    // Drop the drafts too: they were edits against a section that no longer
    // exists, and keeping them would re-show the cleared keys as unsaved.
    setKeyDrafts({});
    setOrderDraft(null);
    setEnableFetchDraft(null);
    setAdvDrafts({});
    const after = scope.getSnapshot();
    const leftover = PROVIDERS.filter((p) => {
      const value =
        after.value?.[p.field as keyof NonNullable<Snapshot["value"]>];
      return typeof value === "string" && value !== "";
    });
    if (leftover.length > 0)
      setFailed(
        t("error.clear", {
          names: leftover.map((p) => p.label).join(t("list.separator")),
        }),
      );
    setClearing(false);
  };

  const reorder = (from: number, to: number) => {
    if (from === to) return;
    const next = [...order];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setOrderDraft(next);
  };
  const indexOfKey = (key: string) => order.indexOf(key);

  const cardBody = () => {
    if (snapshot.status === "loading") return [text(t("body.loading"))];
    if (snapshot.status === "unavailable") return [text(t("body.unavailable"))];
    const children: React.ReactNode[] = [];
    children.push(
      React.createElement(
        "div",
        {
          style: {
            fontSize: 13,
            color: "var(--dsw-alias-label-tertiary)",
            lineHeight: 1.6,
          },
        },
        t("intro"),
      ),
    );
    // Nothing saved here yet. That is either a fresh install or an upgrade
    // whose section dsh's one-shot import left behind, and the card cannot tell
    // which (reading the harness home is the Host half's business, and it logs
    // the accurate version of this on startup). So the copy is written to be
    // true either way: it asks rather than asserts, and costs a first-time user
    // one line they can ignore.
    if (!configured) {
      children.push(
        React.createElement(
          "div",
          {
            key: "legacy",
            style: {
              display: "flex",
              flexDirection: "column",
              gap: 10,
              padding: "12px 14px",
              borderRadius: 10,
              fontSize: 12,
              lineHeight: 1.6,
              background: "var(--dsw-alias-fill-tertiary)",
              color: "var(--dsw-alias-label-secondary)",
            },
          },
          React.createElement(
            "div",
            { style: { fontWeight: 600 } },
            t("legacy.title"),
          ),
          React.createElement("div", null, t("legacy.body")),
          React.createElement(
            "code",
            {
              style: {
                display: "block",
                padding: "8px 10px",
                borderRadius: 6,
                background: "var(--dsw-alias-fill-secondary)",
                color: "var(--dsw-alias-label-primary)",
                fontSize: 11,
                lineHeight: 1.6,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                userSelect: "text",
              },
            },
            t("legacy.prompt"),
          ),
          React.createElement(
            "button",
            {
              type: "button",
              style: {
                alignSelf: "flex-start",
                padding: "4px 10px",
                borderRadius: 999,
                border: "1px solid var(--dsw-alias-border-secondary)",
                background: "transparent",
                color: "inherit",
                fontSize: 12,
                cursor: "pointer",
              },
              // Best effort: an embedded webview may withhold the clipboard, and
              // the instruction is selectable above either way, so a rejection
              // needs no error surface of its own.
              onClick: () => {
                void Promise.resolve(
                  navigator.clipboard?.writeText(t("legacy.prompt")),
                )
                  .then(() => setCopied(true))
                  .catch(() => {});
              },
            },
            copied ? t("legacy.copied") : t("legacy.copy"),
          ),
        ),
      );
    }
    // web_fetch on/off — a top-level switch above the engine list. Search is
    // always on. The Host half owns tool-web's mount, so this genuinely adds and
    // removes the tool from the model's catalog; the copy below can say so.
    children.push(
      React.createElement(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            gap: 16,
            fontSize: 13,
            borderRadius: 10,
            padding: "12px 14px",
            border: "1px solid var(--dsw-alias-border-l2)",
            background: "var(--dsw-alias-bg-layer-3)",
          },
        },
        React.createElement(
          "div",
          {
            style: {
              display: "flex",
              flexDirection: "column",
              gap: 4,
              flex: 1,
              minWidth: 0,
            },
          },
          React.createElement(
            "span",
            {
              style: {
                color: "var(--dsw-alias-label-primary)",
                fontWeight: 500,
              },
            },
            t("fetch.label"),
          ),
          React.createElement(
            "span",
            {
              style: {
                fontSize: 11,
                lineHeight: 1.5,
                color: "var(--dsw-alias-label-tertiary)",
              },
            },
            t(enableFetch ? "fetch.on" : "fetch.off"),
          ),
        ),
        toggleSwitch(enableFetch, disabled, () =>
          setEnableFetchDraft(!enableFetch),
        ),
      ),
    );
    // Grouping is decided by what is SAVED, never by the drafts: a row that
    // hopped to the other group on the first keystroke would move out from
    // under the cursor mid-typing. Typing leaves the row in place and its
    // sub-line says where it lands on save.
    const isInChain = (provider: ProviderMeta) =>
      parseKeys(storedKey(provider.field)).length > 0;
    const chain = order.map(byKey).filter(isInChain);
    const rest = order.map(byKey).filter((p) => !isInChain(p));
    const showRest = restOpen ?? chain.length === 0;

    // `position` is the row's 1-based place in the fallback chain, or null for
    // an engine that has no key stored: only chain rows carry a number and are
    // draggable, because reordering an engine that never gets called is noise.
    const providerRow = (provider: ProviderMeta, position: number | null) => {
      const key = provider.key;
      const hasKey = isConfigured(provider.field, snapshot, keyDrafts);
      const keyCount = parseKeys(
        keyDrafts[provider.field] ?? storedKey(provider.field),
      ).length;
      const isDragging = dragKey === key;
      const isDropTarget = dropTarget === key;
      const expanded = expandedRows[key] || false;
      const capsLabel = t(
        provider.caps.fetch ? "caps.searchFetch" : "caps.searchOnly",
      );
      const sortable = position !== null && !disabled;
      const status =
        position !== null
          ? keyCount > 0
            ? t("row.rotating", { count: keyCount })
            : t("row.cleared")
          : keyCount > 0
            ? t("row.joining", { count: keyCount })
            : t(expanded ? "row.unconfigured" : "row.hint");

      return React.createElement(
        "div",
        {
          key,
          draggable: sortable && dragArmed === key,
          onDragStart: (e: any) => {
            setDragKey(key);
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", key);
          },
          onDragEnd: () => {
            setDragKey(null);
            setDropTarget(null);
            setDragArmed(null);
          },
          // Releasing the handle without dragging must disarm too, or the row
          // stays draggable and swallows the next text selection inside it.
          onMouseUp: () => setDragArmed(null),
          onDragOver: sortable
            ? (e: any) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (dragKey && dragKey !== key) setDropTarget(key);
              }
            : undefined,
          onDrop: sortable
            ? (e: any) => {
                e.preventDefault();
                if (dragKey && dragKey !== key)
                  reorder(indexOfKey(dragKey), indexOfKey(key));
                setDragKey(null);
                setDropTarget(null);
              }
            : undefined,
          // A column, not a row: the expanded panel is a real second child that
          // stacks underneath. The previous `flexBasis: '100%'` on a nowrap row
          // could not wrap, so the panel was squeezed into the header line.
          style: {
            display: "flex",
            flexDirection: "column",
            gap: 10,
            fontSize: 13,
            borderRadius: 10,
            padding: "10px 14px",
            border: isDropTarget
              ? "1px dashed var(--dsw-alias-brand-primary)"
              : "1px solid var(--dsw-alias-border-l2)",
            background: isDragging
              ? "var(--dsw-alias-bg-layer-2)"
              : "var(--dsw-alias-bg-layer-3)",
            opacity: isDragging ? 0.5 : 1,
          },
        },
        // Header line: handle · order badge · label/meta · caret
        React.createElement(
          "div",
          { style: { display: "flex", alignItems: "center", gap: 10 } },
          sortable
            ? React.createElement(
                "span",
                {
                  onMouseDown: () => setDragArmed(key),
                  title: t("row.dragTitle"),
                  style: {
                    flex: "none",
                    color: "var(--dsw-alias-label-tertiary)",
                    fontSize: 13,
                    userSelect: "none",
                    cursor: "grab",
                  },
                },
                "⋮⋮",
              )
            : null,
          position !== null
            ? React.createElement(
                "span",
                {
                  style: {
                    whiteSpace: "nowrap",
                    borderRadius: 999,
                    ...roundCorners,
                    padding: "1px 8px",
                    fontSize: 11,
                    fontWeight: 500,
                    lineHeight: "17px",
                    flex: "none",
                    background: "var(--dsw-alias-bg-module-platform)",
                    color: "var(--dsw-alias-label-secondary)",
                  },
                },
                `#${position}`,
              )
            : null,
          // Label + meta (click to expand)
          React.createElement(
            "div",
            {
              onClick: () => !disabled && toggleRow(key),
              style: {
                display: "flex",
                flexDirection: "column",
                gap: 4,
                flex: 1,
                minWidth: 0,
                cursor: disabled ? "default" : "pointer",
              },
            },
            React.createElement(
              "div",
              {
                style: {
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  minWidth: 0,
                  flexWrap: "wrap",
                },
              },
              React.createElement(
                "span",
                {
                  style: {
                    color: hasKey
                      ? "var(--dsw-alias-label-primary)"
                      : "var(--dsw-alias-label-tertiary)",
                    fontWeight: 500,
                  },
                },
                provider.label,
              ),
              React.createElement(
                "span",
                {
                  style: {
                    whiteSpace: "nowrap",
                    borderRadius: 4,
                    padding: "0 5px",
                    fontSize: 10,
                    lineHeight: "15px",
                    flex: "none",
                    color: "var(--dsw-alias-label-tertiary)",
                    background: "var(--dsw-alias-bg-layer-2)",
                  },
                },
                capsLabel,
              ),
            ),
            // Free tier · row status. Kept off the title line, where three
            // pieces of metadata wrapped into a cramped second line anyway.
            React.createElement(
              "div",
              {
                style: {
                  fontSize: 11,
                  lineHeight: 1.5,
                  color: "var(--dsw-alias-label-tertiary)",
                },
              },
              `${t(`free.${provider.key}` as TKey)} · ${status}`,
            ),
          ),
          React.createElement(
            "span",
            {
              onClick: (e: any) => {
                e.stopPropagation();
                if (!disabled) toggleRow(key);
              },
              style: {
                color: "var(--dsw-alias-label-tertiary)",
                display: "inline-flex",
                flex: "none",
                transition: "transform .16s",
                transform: expanded ? "rotate(180deg)" : "none",
                cursor: disabled ? "default" : "pointer",
                padding: 4,
              },
            },
            caret(12),
          ),
        ),
        // Expanded key input, stacked under the header line.
        expanded
          ? React.createElement(
              "div",
              {
                style: {
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  borderTop: "1px solid var(--dsw-alias-border-l2)",
                  paddingTop: 12,
                  marginBottom: 2,
                },
              },
              React.createElement("textarea", {
                rows: 2,
                autoComplete: "off",
                spellCheck: false,
                value: keyDrafts[provider.field] ?? storedKey(provider.field),
                disabled,
                placeholder: t(provider.placeholder ?? "row.placeholder"),
                onChange: (event: any) =>
                  setKeyDrafts({
                    ...keyDrafts,
                    [provider.field]: event.target.value,
                  }),
                style: {
                  ...inputStyle,
                  width: "100%",
                  boxSizing: "border-box",
                  height: "auto",
                  minHeight: 30,
                  resize: "vertical",
                  padding: "8px 12px",
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  lineHeight: "20px",
                },
              }),
              // Actions: test on the left (only once there is a key to test),
              // the signup link pushed to the right.
              React.createElement(
                "div",
                {
                  style: {
                    display: "flex",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: 12,
                  },
                },
                routesOk && keyCount > 0
                  ? React.createElement(
                      "button",
                      {
                        type: "button",
                        disabled: testing[key] === true,
                        title: t("test.title"),
                        onClick: (e: any) => {
                          e.stopPropagation();
                          void testKeys(provider);
                        },
                        style: {
                          ...btnOutlineStyle,
                          fontSize: 12,
                          padding: "4px 12px",
                          ...(testing[key]
                            ? { opacity: 0.6, cursor: "default" }
                            : {}),
                        },
                      },
                      t(testing[key] ? "test.busy" : "test.button"),
                    )
                  : null,
                React.createElement(
                  "a",
                  {
                    href: provider.signup,
                    target: "_blank",
                    rel: "noreferrer",
                    onClick: (e: any) => e.stopPropagation(),
                    style: {
                      fontSize: 12,
                      color: "var(--dsw-alias-brand-primary)",
                      textDecoration: "none",
                      marginLeft: "auto",
                    },
                  },
                  t(provider.signupLabel ?? "row.signup"),
                ),
              ),
              routesOk && keyCount > 0 && (tests[key]?.length ?? 0) > 0
                ? React.createElement(
                    "div",
                    {
                      style: {
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                        padding: "8px 10px",
                        borderRadius: 8,
                        background: "var(--dsw-alias-bg-layer-2)",
                      },
                    },
                    ...(typeof tests[key] === "string"
                      ? [
                          React.createElement(
                            "div",
                            {
                              key: "error",
                              style: {
                                fontSize: 12,
                                color: "var(--dsw-alias-label-error)",
                              },
                            },
                            tests[key] as string,
                          ),
                        ]
                      : (tests[key] as KeyTest[]).map((r, i) =>
                          React.createElement(
                            "div",
                            {
                              key: i,
                              style: {
                                fontSize: 12,
                                lineHeight: 1.5,
                                wordBreak: "break-word",
                                fontFamily:
                                  "ui-monospace, SFMono-Regular, Menlo, monospace",
                                color: r.ok
                                  ? "var(--dsw-alias-label-secondary)"
                                  : "var(--dsw-alias-label-error)",
                              },
                            },
                            r.ok
                              ? t("test.ok", {
                                  key: r.key,
                                  count: r.results ?? 0,
                                  ms: r.ms,
                                })
                              : t("test.fail", { key: r.key, error: r.error }),
                          ),
                        )),
                  )
                : null,
            )
          : null,
      );
    };

    // Group 1 — the actual fallback chain. Usually one to three rows, so this
    // is the only part most users ever read.
    children.push(
      React.createElement(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: 10 } },
        React.createElement(
          "div",
          { style: groupLabelStyle },
          chain.length > 0
            ? t("chain.labelCount", { count: chain.length })
            : t("chain.label"),
        ),
        chain.length > 0
          ? React.createElement(
              "div",
              { style: { display: "flex", flexDirection: "column", gap: 8 } },
              ...chain.map((provider, index) =>
                providerRow(provider, index + 1),
              ),
            )
          : React.createElement(
              "div",
              {
                style: {
                  fontSize: 12,
                  color: "var(--dsw-alias-label-tertiary)",
                  lineHeight: 1.6,
                  borderRadius: 10,
                  padding: "14px 16px",
                  border: "1px dashed var(--dsw-alias-border-l2)",
                },
              },
              t("chain.empty"),
            ),
      ),
    );
    // Group 2 — everything without a key. Collapsed by default once the chain
    // has something in it: eight rows of engines the user is not using is the
    // bulk of the card, and none of it is actionable until they want a new key.
    if (rest.length > 0) {
      children.push(
        React.createElement(
          "div",
          { style: { display: "flex", flexDirection: "column", gap: 10 } },
          React.createElement(
            "button",
            {
              type: "button",
              onClick: () => setRestOpen(!showRest),
              style: {
                ...groupLabelStyle,
                appearance: "none",
                background: "none",
                border: 0,
                padding: 0,
                font: "inherit",
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
                textAlign: "left",
                display: "flex",
                alignItems: "center",
                gap: 4,
              },
            },
            t("rest.label", { count: rest.length }),
            React.createElement(
              "span",
              {
                style: {
                  display: "inline-flex",
                  transition: "transform .16s",
                  transform: showRest ? "rotate(180deg)" : "none",
                },
              },
              caret(11),
            ),
          ),
          showRest
            ? React.createElement(
                "div",
                { style: { display: "flex", flexDirection: "column", gap: 8 } },
                ...rest.map((provider) => providerRow(provider, null)),
              )
            : null,
        ),
      );
    }
    // Group 3 — Advanced. Collapsed by default: every field has a working
    // default and most users never need to open it.
    const advancedRow = (spec: AdvancedField) => {
      const value = advancedValue(spec);
      const id = `web-search-free-${spec.field}`;
      const setDraft = (next: unknown) =>
        setAdvDrafts({ ...advDrafts, [spec.field]: next });
      const label = React.createElement(
        "label",
        {
          htmlFor: id,
          style: {
            flex: 1,
            minWidth: 0,
            color: "var(--dsw-alias-label-primary)",
            fontWeight: 500,
          },
        },
        t(`adv.${spec.field}` as TKey),
      );
      let control: React.ReactNode;
      if (spec.kind === "select") {
        control = React.createElement(
          "select",
          {
            id,
            disabled,
            value: String(value),
            onChange: (e: any) =>
              setDraft(
                spec.numeric ? Number(e.target.value) : e.target.value,
              ),
            style: { ...inputStyle, height: 30, padding: "0 8px" },
          },
          ...spec.options.map((option) =>
            React.createElement(
              "option",
              { key: option, value: option },
              spec.numeric
                ? option
                : t(`opt.${spec.field}.${option}` as TKey),
            ),
          ),
        );
      } else if (spec.kind === "number") {
        control = React.createElement("input", {
          id,
          type: "number",
          min: spec.min,
          max: spec.max,
          step: spec.step,
          disabled,
          value: String(value),
          onChange: (e: any) => setDraft(e.target.value),
          style: { ...inputStyle, height: 30, width: 96 },
        });
      } else if (spec.kind === "toggle") {
        control = toggleSwitch(value !== false, disabled, () =>
          setDraft(value === false),
        );
      }
      const hint = React.createElement(
        "div",
        {
          style: {
            fontSize: 11,
            lineHeight: 1.6,
            color: "var(--dsw-alias-label-tertiary)",
          },
        },
        t(`adv.${spec.field}.hint` as TKey),
      );
      if (spec.kind === "domains")
        return React.createElement(
          "div",
          {
            key: spec.field,
            style: { display: "flex", flexDirection: "column", gap: 6 },
          },
          label,
          React.createElement("textarea", {
            id,
            rows: 2,
            spellCheck: false,
            disabled,
            value: String(value ?? ""),
            placeholder: t("adv.domains.placeholder"),
            onChange: (e: any) => setDraft(e.target.value),
            style: {
              ...inputStyle,
              width: "100%",
              boxSizing: "border-box",
              height: "auto",
              minHeight: 30,
              resize: "vertical",
              padding: "6px 12px",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              lineHeight: "20px",
            },
          }),
          hint,
        );
      return React.createElement(
        "div",
        {
          key: spec.field,
          style: { display: "flex", flexDirection: "column", gap: 6 },
        },
        React.createElement(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              gap: 16,
              fontSize: 13,
            },
          },
          label,
          control,
        ),
        hint,
      );
    };
    // The engine count only matters to the two parallel strategies.
    const strategy = advancedValue(ADVANCED[0]);
    const advancedRows = ADVANCED.filter(
      (spec) => spec.field !== "parallelEngines" || strategy !== "fallback",
    );
    children.push(
      React.createElement(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: 10 } },
        React.createElement(
          "button",
          {
            type: "button",
            onClick: () => setAdvOpen(!advOpen),
            style: {
              ...groupLabelStyle,
              appearance: "none",
              background: "none",
              border: 0,
              padding: 0,
              font: "inherit",
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
              textAlign: "left",
              display: "flex",
              alignItems: "center",
              gap: 4,
            },
          },
          t("adv.label"),
          React.createElement(
            "span",
            {
              style: {
                display: "inline-flex",
                transition: "transform .16s",
                transform: advOpen ? "rotate(180deg)" : "none",
              },
            },
            caret(11),
          ),
        ),
        advOpen
          ? React.createElement(
              "div",
              {
                style: {
                  display: "flex",
                  flexDirection: "column",
                  gap: 18,
                  borderRadius: 10,
                  padding: "14px 16px",
                  border: "1px solid var(--dsw-alias-border-l2)",
                  background: "var(--dsw-alias-bg-layer-3)",
                },
              },
              React.createElement(
                "div",
                {
                  key: "presets",
                  style: { display: "flex", flexDirection: "column", gap: 6 },
                },
                React.createElement(
                  "div",
                  {
                    style: {
                      display: "flex",
                      flexWrap: "wrap",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 13,
                    },
                  },
                  React.createElement(
                    "span",
                    {
                      style: {
                        color: "var(--dsw-alias-label-primary)",
                        fontWeight: 500,
                        marginRight: 4,
                      },
                    },
                    t("preset.label"),
                  ),
                  ...PRESETS.map((preset) =>
                    React.createElement(
                      "button",
                      {
                        key: preset.id,
                        type: "button",
                        disabled,
                        onClick: () =>
                          setAdvDrafts({ ...advDrafts, ...preset.patch }),
                        style: {
                          ...btnOutlineStyle,
                          fontSize: 12,
                          padding: "3px 10px",
                          borderRadius: 999,
                          ...roundCorners,
                          ...(disabled ? { opacity: 0.4, cursor: "default" } : {}),
                        },
                      },
                      t(`preset.${preset.id}` as TKey),
                    ),
                  ),
                ),
                React.createElement(
                  "div",
                  {
                    style: {
                      fontSize: 11,
                      lineHeight: 1.6,
                      color: "var(--dsw-alias-label-tertiary)",
                    },
                  },
                  t("preset.hint"),
                ),
              ),
              ...advancedRows.map(advancedRow),
            )
          : null,
      ),
    );
    // Group 4 — usage since the Host half started. Only on a dsh that serves
    // the card routes; fetched when opened and on demand, never polled.
    const tallyText = (tally: Tally) =>
      tally.calls === 0
        ? t("stats.unused")
        : t("stats.tally", {
            ok: tally.ok,
            calls: tally.calls,
            avg: Math.round(tally.totalMs / tally.calls),
          });
    const statsRow = (row: StatsRow, index: number) => {
      const label = PROVIDERS.find((p) => p.key === row.engine)?.label ?? row.engine;
      const lastError = row.search.lastError ?? row.fetch.lastError;
      return React.createElement(
        "div",
        {
          key: index,
          style: {
            display: "flex",
            flexDirection: "column",
            gap: 4,
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid var(--dsw-alias-border-l2)",
            fontSize: 12,
            color: "var(--dsw-alias-label-secondary)",
          },
        },
        React.createElement(
          "div",
          {
            style: {
              display: "flex",
              flexWrap: "wrap",
              gap: 10,
              alignItems: "baseline",
            },
          },
          React.createElement(
            "span",
            {
              style: {
                fontWeight: 600,
                fontSize: 13,
                color: "var(--dsw-alias-label-primary)",
              },
            },
            label,
          ),
          React.createElement(
            "span",
            {
              style: {
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              },
            },
            row.key ?? t("stats.keyless"),
          ),
          row.benchedForMs > 0
            ? React.createElement(
                "span",
                { style: { color: "var(--dsw-alias-label-error)" } },
                t("stats.benched", {
                  min: Math.max(1, Math.ceil(row.benchedForMs / 60_000)),
                }),
              )
            : null,
        ),
        React.createElement(
          "div",
          null,
          `${t("stats.search")}：${tallyText(row.search)}`,
          row.fetch.calls > 0
            ? `　${t("stats.fetch")}：${tallyText(row.fetch)}`
            : "",
        ),
        lastError
          ? React.createElement(
              "div",
              {
                style: {
                  color: "var(--dsw-alias-label-tertiary)",
                  wordBreak: "break-word",
                },
              },
              t("stats.lastError", { error: lastError }),
            )
          : null,
      );
    };
    if (routesOk)
      children.push(
        React.createElement(
          "div",
          { style: { display: "flex", flexDirection: "column", gap: 10 } },
          React.createElement(
            "div",
            { style: { display: "flex", alignItems: "center", gap: 8 } },
            React.createElement(
              "button",
              {
                type: "button",
                onClick: () => {
                  if (!statsOpen) void loadStats();
                  setStatsOpen(!statsOpen);
                },
                style: {
                  ...groupLabelStyle,
                  appearance: "none",
                  background: "none",
                  border: 0,
                  padding: 0,
                  font: "inherit",
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                  textAlign: "left",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                },
              },
              t("stats.label"),
              React.createElement(
                "span",
                {
                  style: {
                    display: "inline-flex",
                    transition: "transform .16s",
                    transform: statsOpen ? "rotate(180deg)" : "none",
                  },
                },
                caret(11),
              ),
            ),
            statsOpen
              ? React.createElement(
                  "button",
                  {
                    type: "button",
                    disabled: statsLoading,
                    onClick: () => void loadStats(),
                    style: {
                      ...btnOutlineStyle,
                      fontSize: 11,
                      padding: "1px 8px",
                      marginLeft: "auto",
                    },
                  },
                  t(statsLoading ? "stats.loading" : "stats.refresh"),
                )
              : null,
          ),
          statsOpen
            ? React.createElement(
                "div",
                { style: { display: "flex", flexDirection: "column", gap: 8 } },
                statsError
                  ? React.createElement(
                      "div",
                      {
                        style: {
                          fontSize: 12,
                          color: "var(--dsw-alias-label-error)",
                        },
                      },
                      t("stats.error", { error: statsError }),
                    )
                  : null,
                stats
                  ? React.createElement(
                      "div",
                      {
                        style: {
                          fontSize: 11,
                          color: "var(--dsw-alias-label-tertiary)",
                        },
                      },
                      t("stats.cache", stats.cacheHits),
                    )
                  : null,
                ...(stats && stats.rows.length === 0
                  ? [
                      React.createElement(
                        "div",
                        {
                          key: "empty",
                          style: {
                            fontSize: 12,
                            color: "var(--dsw-alias-label-tertiary)",
                          },
                        },
                        t("stats.empty"),
                      ),
                    ]
                  : (stats?.rows ?? []).map(statsRow)),
              )
            : null,
        ),
      );
    // Version and an on-demand update check. Needs the Host routes, and a
    // Host new enough to report its version in the stats it already serves.
    if (routesOk && stats?.version)
      children.push(
        React.createElement(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 10,
              fontSize: 12,
              color: "var(--dsw-alias-label-tertiary)",
            },
          },
          t("version.label", { version: stats.version }),
          React.createElement(
            "button",
            {
              type: "button",
              disabled: checkingUpdate,
              onClick: () => void checkUpdate(),
              style: {
                ...btnOutlineStyle,
                fontSize: 11,
                padding: "1px 8px",
                ...(checkingUpdate ? { opacity: 0.6, cursor: "default" } : {}),
              },
            },
            t(checkingUpdate ? "version.checking" : "version.check"),
          ),
          update === null
            ? null
            : React.createElement(
                "span",
                {
                  style:
                    typeof update === "string"
                      ? { color: "var(--dsw-alias-label-error)" }
                      : update.updateAvailable
                        ? { color: "var(--dsw-alias-brand-primary)" }
                        : {},
                },
                typeof update === "string"
                  ? update
                  : update.updateAvailable
                    ? t("version.available", { latest: update.latest })
                    : t("version.latest"),
              ),
        ),
      );
    children.push(
      React.createElement(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            gap: 10,
            justifyContent: "flex-end",
            borderTop: "1px solid var(--dsw-alias-border-l2)",
            paddingTop: 16,
          },
        },
        // Left-aligned and outlined, away from 保存: this one is for uninstalling
        // cleanly, not part of the edit/commit pair on the right.
        React.createElement(
          "button",
          {
            type: "button",
            disabled: disabled || !configured,
            onClick: () => (armed ? clearAll() : setArmed(true)),
            title: t("clear.title"),
            style: {
              ...btnOutlineStyle,
              marginRight: "auto",
              color: "var(--dsw-alias-label-error)",
              ...(armed
                ? {
                    borderColor: "var(--dsw-alias-label-error)",
                    fontWeight: 600,
                  }
                : {}),
              ...(disabled || !configured
                ? { opacity: 0.4, cursor: "default" }
                : {}),
            },
          },
          t(clearing ? "clear.busy" : armed ? "clear.armed" : "clear.idle"),
        ),
        failed === ""
          ? null
          : React.createElement(
              "span",
              {
                style: {
                  flex: 1,
                  minWidth: 0,
                  fontSize: 12,
                  color: "var(--dsw-alias-label-error)",
                },
              },
              failed,
            ),
        React.createElement(
          "button",
          {
            type: "button",
            disabled: disabled || !dirty,
            onClick: () => {
              setKeyDrafts({});
              setOrderDraft(null);
              setEnableFetchDraft(null);
              setAdvDrafts({});
              setArmed(false);
              setFailed("");
            },
            style: {
              ...btnOutlineStyle,
              ...(disabled || !dirty
                ? { opacity: 0.4, cursor: "default" }
                : {}),
            },
          },
          t("action.discard"),
        ),
        React.createElement(
          "button",
          {
            type: "button",
            disabled: disabled || !dirty,
            onClick: save,
            style: {
              ...btnPrimaryStyle,
              ...(disabled || !dirty
                ? { opacity: 0.4, cursor: "default" }
                : {}),
            },
          },
          t(saving ? "action.saving" : "action.save"),
        ),
      ),
    );
    return children;
  };

  // Collapsed summary: how many engines are configured, surfaced on the
  // header so the user can see at a glance whether the plugin is ready.
  const summary =
    configuredCount > 0
      ? t("summary.configured", { count: configuredCount })
      : t("summary.none");

  // The one-liner the Plugins page places under the title it drew itself.
  if (view === "summary") return text(t("header.subtitle", { summary }));

  // The page view: the surrounding page owns title, icon and crumb, so the
  // card contributes only its form — no card shell, no disclosure of its own.
  if (view === "page")
    return React.createElement(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "column",
          gap: 24,
        },
      },
      ...cardBody(),
    );

  return React.createElement(
    "li",
    {
      style: {
        listStyle: "none",
        borderRadius: 12,
        border: "1px solid var(--dsw-alias-border-l2)",
        background: open
          ? "var(--dsw-alias-bg-layer-2)"
          : "var(--dsw-alias-bg-layer-3)",
        transition: "border-color .16s, background .16s",
      },
    },
    React.createElement(
      "button",
      {
        type: "button",
        onClick: () => setOpen(!open),
        style: {
          appearance: "none",
          width: "100%",
          font: "inherit",
          textAlign: "left",
          cursor: "pointer",
          background: "none",
          border: "0",
          borderRadius: 12,
          color: "inherit",
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "14px 16px",
        },
      },
      React.createElement(
        "div",
        {
          style: {
            display: "flex",
            flexDirection: "column",
            flex: 1,
            gap: 2,
            minWidth: 0,
          },
        },
        React.createElement(
          "div",
          { style: { display: "flex", alignItems: "center", gap: 8 } },
          React.createElement(
            "span",
            {
              style: {
                fontSize: 15,
                fontWeight: 600,
                color: "var(--dsw-alias-label-primary)",
              },
            },
            t("header.title"),
          ),
          dirty
            ? React.createElement(
                "span",
                {
                  style: {
                    whiteSpace: "nowrap",
                    background: "var(--dsw-alias-bg-module-platform)",
                    color: "var(--dsw-alias-label-secondary)",
                    borderRadius: 999,
                    ...roundCorners,
                    padding: "1px 8px",
                    fontSize: 11,
                    fontWeight: 500,
                    lineHeight: "17px",
                  },
                },
                t("header.unsaved"),
              )
            : null,
          configuredCount > 0
            ? React.createElement(
                "span",
                {
                  style: {
                    whiteSpace: "nowrap",
                    background: "var(--dsw-alias-brand-primary)",
                    color: "#fff",
                    borderRadius: 999,
                    ...roundCorners,
                    padding: "1px 8px",
                    fontSize: 11,
                    fontWeight: 500,
                    lineHeight: "17px",
                  },
                },
                t("header.engines", { count: configuredCount }),
              )
            : null,
        ),
        React.createElement(
          "div",
          { style: { fontSize: 13, color: "var(--dsw-alias-label-tertiary)" } },
          t("header.subtitle", { summary }),
        ),
      ),
      React.createElement(
        "span",
        {
          style: {
            color: "var(--dsw-alias-label-tertiary)",
            display: "inline-flex",
            flex: "none",
            transition: "transform .16s",
            transform: open ? "rotate(180deg)" : "none",
          },
        },
        React.createElement(
          "svg",
          {
            width: 14,
            height: 14,
            viewBox: "0 0 14 14",
            fill: "none",
            "aria-hidden": true,
          },
          React.createElement("path", {
            d: "M3.5 5.5L7 9l3.5-3.5",
            stroke: "currentColor",
            strokeWidth: 1.5,
            strokeLinecap: "round",
            strokeLinejoin: "round",
          }),
        ),
      ),
    ),
    open
      ? React.createElement(
          "div",
          {
            style: {
              display: "flex",
              flexDirection: "column",
              gap: 24,
              margin: "0 16px 16px",
              borderTop: "1px solid var(--dsw-alias-border-l2)",
              paddingTop: 16,
            },
          },
          ...cardBody(),
        )
      : null,
  );
}

/**
 * dsh's theme applies `corner-shape: superellipse(1.5)` to `*`, so a
 * `border-radius` of 999px renders as a squircle instead of a pill, and 50% as
 * a squircle instead of a circle. Anything in this card that must be a TRUE
 * pill or circle opts back out, exactly as dsh's own pills do.
 */
const roundCorners = { cornerShape: "round" } as React.CSSProperties;

const inputStyle = {
  height: 34,
  padding: "0 12px",
  font: "inherit",
  fontSize: 13,
  borderRadius: 8,
  border: "1px solid var(--dsw-alias-border-l2)",
  background: "var(--dsw-alias-bg-layer-3)",
  color: "var(--dsw-alias-label-primary)",
};

const btnOutlineStyle = {
  font: "inherit",
  fontSize: 13,
  padding: "5px 14px",
  borderRadius: 8,
  cursor: "pointer",
  border: "1px solid var(--dsw-alias-border-l2)",
  background: "none",
  color: "var(--dsw-alias-label-secondary)",
};

const btnPrimaryStyle = {
  font: "inherit",
  fontSize: 13,
  padding: "5px 14px",
  borderRadius: 8,
  cursor: "pointer",
  border: "1px solid transparent",
  background: "var(--dsw-alias-label-primary)",
  color: "var(--dsw-alias-bg-layer-3)",
};

const groupLabelStyle = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: ".2px",
  color: "var(--dsw-alias-label-tertiary)",
};

/** The on/off switch shared by every boolean in this card. */
function toggleSwitch(on: boolean, disabled: boolean, onClick: () => void) {
  return React.createElement(
    "button",
    {
      type: "button",
      role: "switch",
      "aria-checked": on,
      disabled,
      onClick,
      style: {
        appearance: "none",
        flex: "none",
        width: 36,
        height: 20,
        borderRadius: 999,
        ...roundCorners,
        border: "none",
        cursor: disabled ? "default" : "pointer",
        padding: 0,
        position: "relative",
        background: on
          ? "var(--dsw-alias-brand-primary)"
          : "var(--dsw-alias-bg-module-platform)",
        transition: "background .16s",
      },
    },
    React.createElement("span", {
      style: {
        position: "absolute",
        top: 2,
        left: on ? 18 : 2,
        width: 16,
        height: 16,
        borderRadius: "50%",
        ...roundCorners,
        background: "#fff",
        transition: "left .16s",
        boxShadow: "0 1px 3px rgba(0,0,0,.2)",
      },
    }),
  );
}

/** The single chevron used by every expander in this card. */
function caret(size: number) {
  return React.createElement(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 14 14",
      fill: "none",
      "aria-hidden": true,
    },
    React.createElement("path", {
      d: "M3.5 5.5L7 9l3.5-3.5",
      stroke: "currentColor",
      strokeWidth: 1.5,
      strokeLinecap: "round",
      strokeLinejoin: "round",
    }),
  );
}

function text(value: string) {
  return React.createElement(
    "span",
    { style: { fontSize: 13, color: "var(--dsw-alias-label-tertiary)" } },
    value,
  );
}
