import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { availableProviders } from './providers/index.js'
import { ProviderError } from './providers/fields.js'
import { WebSearchProvider as MyProvider, SearchOptions, SearchResult } from './types.js'
import { finalizeSources, matchesDomain, mergeResults, parseDomains } from './results.js'
import { TtlCache } from './cache.js'
import { UsageStats } from './usage.js'

export const name = 'web-search-free'
export const inject = ['web']

/**
 * Settings namespace this plugin owns. The browser card in `./client` binds its
 * settings scope to this string, so the two halves must spell it identically.
 * (Which SLOT that card occupies is a separate, dsh-version-dependent matter —
 * see `SLOT_CANDIDATES` there; only on dsh <= 0.1.5 was the slot key this
 * namespace.)
 */
export const SETTINGS_NAMESPACE = 'web-search-free'

export interface Config {
  jinaApiKey?: string
  exaApiKey?: string
  tavilyApiKey?: string
  firecrawlApiKey?: string
  braveApiKey?: string
  anysearchApiKey?: string
  tinyfishApiKey?: string
  serpapiApiKey?: string
  serpingapiApiKey?: string
  /** SearXNG instance base URLs, one per line — the "key" of a keyless engine. */
  searxngApiKey?: string
  baiduApiKey?: string
  volcengineApiKey?: string
  /**
   * Whether the model may use `web_fetch` at all. Search is always on.
   *
   * Since dsh 0.1.5 the tool itself is mounted by the composition — dsh-base's
   * `tool-web` row on TUI/headless, per-preset `tool-web` rows on the Web
   * surface — so this gates the fetch PROVIDER's availability instead of the
   * tool's registration: off, `web_fetch` stays listed and every call fails
   * with the seam's structured WEB_PROVIDER_CONFIGURED_UNAVAILABLE error.
   * Read live at execution time, so the switch needs no restart.
   */
  enableFetch?: boolean
  /** Who serves `web_fetch`; see `FETCH_SOURCES`. Only consulted while `enableFetch` is on. */
  fetchSource?: FetchSource
  providerOrder: string[]
  /** How the search chain is walked; see `SEARCH_STRATEGIES`. */
  searchStrategy?: SearchStrategy
  /** Engines queried at once under `race` / `merge`. */
  parallelEngines?: number
  /** Result region as an ISO 3166 alpha-2 code, or `auto` for each engine's default. */
  region?: string
  /** Result language as a BCP 47 tag from `LANGUAGES`, or `auto`. */
  language?: string
  /** Default recency window from `FRESHNESS`, or `any`. */
  freshness?: Freshness
  /** Domains never returned, one per line. */
  blockedDomains?: string
  /** Domains moved to the front of the results, one per line. */
  preferredDomains?: string
  /** Snippet length per source, in characters. */
  snippetLength?: number
  /** Tavily `search_depth`: `advanced` costs 2 credits instead of 1. */
  tavilySearchDepth?: 'basic' | 'advanced'
  /** Fall back to Jina Reader without a key (rate-limited) when every keyed fetch fails. */
  keylessJinaFetch?: boolean
  /** Minutes an identical search or fetch is answered from memory; 0 turns caching off. */
  cacheMinutes?: number
}

/**
 * - `fallback`: one engine at a time, next only on failure. Cheapest.
 * - `race`: the first `parallelEngines` engines at once, fastest answer wins.
 * - `merge`: the first `parallelEngines` engines at once, results fused and
 *   de-duplicated. Best recall; costs that many engines' quota per search.
 */
export const SEARCH_STRATEGIES = ['fallback', 'race', 'merge'] as const
export type SearchStrategy = typeof SEARCH_STRATEGIES[number]

/**
 * - `providers`: the keyed engines in call order, then keyless Jina when
 *   enabled, then dsh's own local fetcher when all of those are missing or
 *   failed.
 * - `dsh`: straight to dsh's own local fetcher (`@deepseek-ai/dsh-web-fetch-http`,
 *   the `http` provider dsh-base ships) — free, no URL leaves the machine for
 *   a third party, but no JS rendering.
 */
export const FETCH_SOURCES = ['providers', 'dsh'] as const
export type FetchSource = typeof FETCH_SOURCES[number]

/** The id `@deepseek-ai/dsh-web-fetch-http` registers its provider under. */
const DSH_FETCH_PROVIDER_ID = 'http'

export const REGIONS =['auto', 'CN', 'HK', 'TW', 'SG', 'JP', 'KR', 'US', 'GB'] as const
export const LANGUAGES = ['auto', 'zh-CN', 'zh-TW', 'en', 'ja', 'ko'] as const
export const FRESHNESS = ['any', 'day', 'week', 'month', 'year'] as const
export type Freshness = typeof FRESHNESS[number]

/**
 * The Config fields, as a factory so two schemas can be derived from one table.
 *
 * The two dsh generations disagree about where a plugin's editable values live,
 * and the disagreement is not bridgeable by a runtime check: a Config schema is
 * built at module load, long before any `ctx` exists to ask which host this is.
 *
 * - dsh >= 0.1.7 deleted the settings-namespace registry. A plugin entry's own
 *   Config IS its settings section, and `dsh-settings` projects the form from
 *   the fields marked `.volatile()`. Its `volatileForm()` returns undefined
 *   when NO field is marked, and an entry without a form never reaches the
 *   browser's describe mirror — so without these marks the card would read
 *   `unavailable` forever. They are mandatory, not an optimization.
 * - dsh <= 0.1.6 has no volatile machinery and is handed a schema of its own
 *   through `settings.register`. It must get the PLAIN one: the wrapping is
 *   done by schemastery at parse time, not by the host, so a volatile schema
 *   there would surface `{}` for every field.
 */
const configFields = () => ({
  jinaApiKey: Schema.string().description('API key(s) for Jina AI. One key per line for multi-key rotation.'),
  exaApiKey: Schema.string().description('API key(s) for Exa (Metaphor). One key per line for multi-key rotation.'),
  tavilyApiKey: Schema.string().description('API key(s) for Tavily. One key per line for multi-key rotation.'),
  firecrawlApiKey: Schema.string().description('API key(s) for Firecrawl. One key per line for multi-key rotation.'),
  braveApiKey: Schema.string().description('API key(s) for Brave Search. One key per line for multi-key rotation.'),
  anysearchApiKey: Schema.string().description('API key(s) for AnySearch. One key per line for multi-key rotation.'),
  tinyfishApiKey: Schema.string().description('API key(s) for TinyFish. One key per line for multi-key rotation.'),
  serpapiApiKey: Schema.string().description('API key(s) for SerpApi. One key per line for multi-key rotation.'),
  serpingapiApiKey: Schema.string().description('API key(s) for Serping API. One key per line for multi-key rotation.'),
  searxngApiKey: Schema.string().description('SearXNG instance URL(s), e.g. https://searx.example.com. One per line, tried in order. The instance must enable the JSON format.'),
  baiduApiKey: Schema.string().description('API key(s) for Baidu Qianfan AI Search (Qianfan V2 console). One key per line for multi-key rotation.'),
  volcengineApiKey: Schema.string().description('API key(s) for Volcengine web search (from the web-search console; Ark keys do not work). One key per line for multi-key rotation.'),
  enableFetch: Schema.boolean().default(true).description('是否允许模型调用 web_fetch（URL 内容抓取）。web_fetch 工具由 dsh 统一挂载，关闭后调用会返回明确的错误提示，而不是从工具表移除；切换即时生效，无需重启。'),
  fetchSource: Schema.union([...FETCH_SOURCES]).default('providers')
    .description('web_fetch 由谁抓取：providers 用填了 Key 的引擎（都没有或都失败时退回 dsh 自带的本地抓取）；dsh 直接用 dsh 自带的本地抓取（免费，不经第三方，但不渲染 JS）。'),
  providerOrder: Schema.array(Schema.union(['jina', 'exa', 'tavily', 'firecrawl', 'brave', 'anysearch', 'tinyfish', 'serpapi', 'serpingapi', 'searxng', 'baidu', 'volcengine']))
    .default(['tinyfish', 'searxng', 'anysearch', 'baidu', 'tavily', 'brave', 'exa', 'firecrawl', 'volcengine', 'serpapi', 'jina', 'serpingapi'])
    .description('定义 Provider 的调用顺序。排在前面的服务会优先执行，如果请求失败（或额度用尽），会自动按照该顺序 fallback 到下一个可用服务。'),
  searchStrategy: Schema.union([...SEARCH_STRATEGIES]).default('fallback')
    .description('搜索策略：fallback 逐个尝试（最省额度）；race 同时调用前 N 个引擎、取最快的；merge 同时调用前 N 个引擎并合并去重（召回最好，消耗 N 倍额度）。'),
  parallelEngines: Schema.natural().min(2).max(4).default(2)
    .description('race / merge 策略同时调用的引擎数。'),
  region: Schema.union([...REGIONS]).default('auto')
    .description('结果地区（ISO 3166 两位代码）。auto 使用各引擎默认值。'),
  language: Schema.union([...LANGUAGES]).default('auto')
    .description('结果语言。auto 使用各引擎默认值。'),
  freshness: Schema.union([...FRESHNESS]).default('any')
    .description('默认时间范围。只对支持时间过滤的引擎生效。'),
  blockedDomains: Schema.string().default('')
    .description('屏蔽的域名，每行一个，子域名一并屏蔽。'),
  preferredDomains: Schema.string().default('')
    .description('优先的域名，每行一个：结果中来自这些域名的条目排到前面。'),
  snippetLength: Schema.natural().min(100).max(1000).default(300)
    .description('每条结果的摘要长度（字符）。越长上下文越多，也越费模型 token。'),
  tavilySearchDepth: Schema.union(['basic', 'advanced']).default('basic')
    .description('Tavily 搜索深度：advanced 结果更相关，但每次消耗 2 credits。'),
  keylessJinaFetch: Schema.boolean().default(true)
    .description('所有带 Key 的抓取都失败时，用不带 Key 的 Jina Reader 兜底（有速率限制）。没配抓取引擎时它就是唯一的抓取通道。'),
  cacheMinutes: Schema.natural().max(60).default(10)
    .description('相同的搜索或抓取在这么多分钟内直接返回缓存，不再消耗额度。0 为关闭。缓存只在内存里，重启即清空。'),
})

/**
 * The entry's own Config, every field live-editable. On dsh >= 0.1.7 this is
 * what the settings form is projected from; on <= 0.1.6 the volatile marks are
 * inert meta the host ignores, and `liveConfig` below unwraps what schemastery
 * wrapped so the rest of the plugin never sees the difference.
 */
export const Config = Schema.object(
  (() => {
    const marked: Record<string, any> = {}
    for (const [key, schema] of Object.entries(configFields())) {
      marked[key] = (schema as any).volatile()
    }
    return marked
  })(),
)

/** The same fields unmarked, for dsh <= 0.1.6's `settings.register`. */
const SettingsConfig = Schema.object(configFields())

/**
 * One Config field as the host hands it over: a plain value on dsh <= 0.1.6, a
 * volatile reference on >= 0.1.7.
 */
type Live<T> = T | { get(): T }

/** The apply-time config shape, before {@link liveConfig} flattens it. */
type RawConfig = { [K in keyof Config]: Live<Config[K]> }

/** Read one field, whichever of the two forms the host supplied. */
function readLive<T>(value: Live<T>): T {
  return value !== null &&
    typeof value === 'object' &&
    typeof (value as { get?: unknown }).get === 'function'
    ? (value as { get(): T }).get()
    : (value as T)
}

/**
 * Flatten the entry config to plain values, read fresh at each call.
 *
 * On dsh >= 0.1.7 every read goes through the volatile reference, so a key
 * saved in the settings form reaches the next search without a restart — the
 * job `settings.register`'s scope did on older hosts.
 */
function liveConfig(raw: RawConfig): Config {
  const out: Partial<Config> = {}
  const sink = out as Record<string, unknown>
  for (const [key, value] of Object.entries(raw ?? {})) sink[key] = readLive(value)
  return out as Config
}

/**
 * One-line instruction the user can hand to dsh to move a stranded legacy
 * section across. Kept next to the card's copy of the same text.
 */
export const LEGACY_MIGRATION_PROMPT =
  '把 dsh 主目录（默认 ~/.dsh）下 settings.yaml.imported 里 web-search-free 段的所有字段，' +
  '原样写进当前 profile 的 cordis.patch.yml，作为 id 为 web-search-free 的 entry 的 config；' +
  '该 entry 不存在就新增。保留原文件的注释和格式，改动前先备份。'

/**
 * Point at settings dsh's one-shot legacy import left behind, once, at startup.
 *
 * dsh >= 0.1.7 renames `settings.yaml` to `settings.yaml.imported` and writes
 * each section into the entry of the same id — but only for sections the
 * RUNNING composition accepts, and only that once. A plugin that was broken or
 * uninstalled at upgrade time (every 1.5.x install, which could not boot the
 * 0.1.7 web UI at all) therefore misses its turn, and the keys stay in the
 * renamed file with nothing pointing at them.
 *
 * This only ever prints. Writing the section back is deliberately NOT done
 * here: the destination is the profile's Cordis patch, a file that carries the
 * user's own comments and `!!js` expressions, and the supported way in is
 * `settings.mutate` — a migration worth doing properly, not as a startup side
 * effect nobody asked for.
 *
 * @param settings - the host settings service, used only to read whether this
 * plugin's section already has a user layer.
 * @param logger - the plugin logger.
 */
function hintLegacySettings(settings: any, logger: any): void {
  let descriptor: any
  try {
    descriptor = settings.describe?.()?.find((d: any) => d?.ns === SETTINGS_NAMESPACE)
  } catch {
    return
  }
  // Anything configured here already — migrated, or typed in since — needs no hint.
  const user = descriptor?.user
  if (user !== null && typeof user === 'object' && Object.keys(user).length > 0) return

  const home = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  for (const name of ['settings.yaml', 'settings.yaml.imported']) {
    const file = join(home, name)
    let text: string
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    // A hint needs the section's PRESENCE, nothing more — so this never parses
    // YAML, which would drag a whole runtime dependency into every profile for
    // the sake of one message.
    if (!new RegExp(`^${SETTINGS_NAMESPACE}:`, 'm').test(text)) continue
    logger.warn(
      `找到一份未迁移的旧配置：${file} 里还有 ${SETTINGS_NAMESPACE} 段，而本插件当前没有任何已保存的设置。\n` +
        `dsh 0.1.7 起配置改存到 profile 的 cordis.patch.yml，它的一次性导入会跳过当时不在运行组合里的插件——升级时本插件起不来的话正好会被跳过。\n` +
        `把下面这段话发给 dsh，它就会帮你搬过去：\n${LEGACY_MIGRATION_PROMPT}`,
    )
    return
  }
}

/** Short, non-leaking token for log lines so a failing key is identifiable without printing it. */
function maskKey(key: string): string {
  if (!key) return '***'
  // A SearXNG "key" is an instance URL, not a secret: its host tells the
  // instances apart, and dropping the rest leaves out any user:pass@ part.
  if (/^https?:\/\//i.test(key)) {
    try {
      return new URL(key).host
    } catch {
      return '***'
    }
  }
  if (key.length <= 8) return '***'
  return `${key.slice(0, 4)}…${key.slice(-3)}`
}

/**
 * Budget for ONE (engine, key) attempt. Without it a hung engine spends the
 * whole tool-call budget dsh grants `web_search` / `web_fetch`, and the
 * fallback never gets to run. Fetch gets longer because scrapers render pages.
 */
const ATTEMPT_TIMEOUT_MS = { search: 10_000, fetch: 20_000 } as const

/**
 * A fetched body shorter than this is suspect — typically a JS-only shell
 * ("You need to enable JavaScript…") or a bot wall. It is kept as a last
 * resort while the remaining engines get a turn, so a genuinely short page
 * still comes back, just after the chain has tried for a better copy.
 */
const MIN_FETCH_CHARS = 100

/**
 * How long to bench a key after a failure that will keep failing. Benched keys
 * are not dropped: they move to the back of the chain, so a search still runs
 * when every key is benched — it just stops paying a dead round trip first.
 */
const COOLDOWN_MS = {
  /** 401 (and 403 on search): bad or revoked key. Long, but not until restart — the user may fix it on the provider's side. */
  auth: 30 * 60_000,
  /** 402, or a body that says the quota/credits are spent. */
  quota: 30 * 60_000,
  /** 429: may be a rate limit rather than a spent quota, so retry soon. */
  rate: 2 * 60_000,
} as const

const QUOTA_MESSAGE = /quota|credits?\b|run out of|insufficient|balance|exceeded/i

/**
 * Decide how long a failure benches its key, or `undefined` for a transient
 * failure (network, 5xx, timeout, empty result) that should not.
 *
 * A 403 on FETCH is left alone: it is as likely to be the target site refusing
 * the scraper as the key being bad, and benching a key for one site's wall
 * would cost every other URL.
 */
function cooldownFor(err: unknown, kind: 'search' | 'fetch'): number | undefined {
  const status = err instanceof ProviderError ? err.status : undefined
  if (status === 401 || (status === 403 && kind === 'search')) return COOLDOWN_MS.auth
  if (status === 402) return COOLDOWN_MS.quota
  if (status === 429) return QUOTA_MESSAGE.test(String((err as Error).message)) ? COOLDOWN_MS.quota : COOLDOWN_MS.rate
  // Envelope-style errors (AnySearch `code`, SerpApi `error`) arrive on a 200.
  if (status === undefined && err instanceof ProviderError && QUOTA_MESSAGE.test(err.message)) return COOLDOWN_MS.quota
  return undefined
}

/**
 * A signal that fires when the caller's does or after `ms`, whichever is
 * first. Hand-rolled rather than `AbortSignal.any` so the plugin still loads
 * on the Node 18 floor its typings target. `abort` cancels it early (a won
 * race cancelling its losers). Call `dispose` when the attempt settles so the
 * timer and listener do not outlive it.
 */
function attemptSignal(parent: AbortSignal | undefined, ms: number, label: string) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new ProviderError(`${label} timed out after ${ms}ms`)), ms)
  const onAbort = () => controller.abort(parent?.reason)
  if (parent?.aborted) onAbort()
  else parent?.addEventListener('abort', onAbort, { once: true })
  return {
    signal: controller.signal,
    abort() {
      controller.abort(new ProviderError(`${label} cancelled`))
    },
    dispose() {
      clearTimeout(timer)
      parent?.removeEventListener('abort', onAbort)
    },
  }
}

/** At most this many per-attempt reasons go into an all-failed error. */
const MAX_REPORTED_FAILURES = 6

/**
 * The error thrown when every attempt failed. It lists each attempt's reason
 * rather than only the last one: "tavily: 429, exa: timeout, brave: 401"
 * tells the user which key to look at, where the last error alone points at
 * whichever engine happened to be tried last.
 */
function chainFailure(kind: 'search' | 'fetch', trail: readonly string[]): Error {
  if (trail.length === 0) return new Error(`All configured ${kind} providers failed.`)
  const shown = trail.slice(0, MAX_REPORTED_FAILURES)
  const more = trail.length - shown.length
  return new Error(
    `All configured ${kind} providers failed (${trail.length} attempt${trail.length === 1 ? '' : 's'}): ` +
      shown.join('; ') +
      (more > 0 ? `; and ${more} more` : ''),
  )
}

/** Cache capacities: search results are small; fetched pages can run to 200k characters each. */
const SEARCH_CACHE_ENTRIES = 200
const FETCH_CACHE_ENTRIES = 30

/**
 * Routes the settings card calls, on dsh's shared `/api` channel. Registered
 * through `ctx.connection.fetch`, so every request has already passed the
 * Host/Origin fence and browser-cookie authentication before it reaches a
 * handler: a page on another site cannot read the stats or spend quota on
 * key tests.
 */
export const STATS_ROUTE = '/api/web-search-free/stats'
export const TEST_ROUTE = '/api/web-search-free/test-keys'
export const UPDATE_ROUTE = '/api/web-search-free/check-update'

/**
 * This build's version, read from the shipped package.json (one level above
 * `dist/`). Empty when unreadable, which only hides the version line.
 */
const PLUGIN_VERSION: string = (() => {
  try {
    return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version ?? ''
  } catch {
    return ''
  }
})()

/** Where the update check asks for the latest published version. */
const REGISTRY_LATEST_URL = 'https://registry.npmjs.org/dsh-web-search-free/latest'

/** Whether dotted version `a` is newer than `b`, comparing the numeric x.y.z part only. */
function isNewer(a: string, b: string): boolean {
  const parse = (v: string) => v.split('-')[0].split('.').map((n) => Number(n) || 0)
  const [x, y] = [parse(a), parse(b)]
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0)
  }
  return false
}

/** Query a key test runs. Neutral and certain to return results everywhere. */
const TEST_QUERY = 'DeepSeek'

/** Keys one test request may carry; each costs one search. */
const MAX_TEST_KEYS = 10

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })

declare module '@deepseek-ai/cordis' {
  interface Context {
    web: any
    settings: any
    connection: any
  }
}

/**
 * NOT mounting `@deepseek-ai/dsh-tool-web` here, deliberately.
 *
 * Up to dsh 0.1.2 this plugin mounted tool-web itself to own `web_fetch`'s
 * registration. Since 0.1.5 the composition mounts it everywhere — dsh-base's
 * `tool-web` row ships `fetch: true` (TUI/headless) and every shipped agent
 * preset mounts its own scoped row with `fetch: true` (the Web surface
 * disables the host row and composes per session) — so a global self-mount
 * would duplicate-register `web_fetch` against each of them, and a per-agent
 * scope SHADOWS a global registration, which means an unmount here could no
 * longer remove what a preset's row registered. The tool belongs to the
 * composition; this plugin only backs it through the seam, and `enableFetch`
 * gates the fetch PROVIDER's availability instead of the tool's registration.
 */
export function apply(ctx: Context, config: RawConfig) {
  const logger = ctx.logger?.('web-search-free') || console

  // Where the live values come from. The entry config already is the answer on
  // dsh >= 0.1.7; on <= 0.1.6 the settings scope below takes over.
  let resolved: () => Config = () => liveConfig(config)

  ctx.inject(['settings'], (sctx) => {
    // dsh >= 0.1.7 has no namespace registry: `SettingsForms` keys forms by
    // profile entry id and projects them from the entry's own volatile Config,
    // so there is nothing to register and `resolved` already reads live. It is
    // also the only generation whose one-shot import can strand a section.
    if (typeof sctx.settings?.register !== 'function') {
      hintLegacySettings(sctx.settings, logger)
      return
    }

    // dsh <= 0.1.6: register the namespace so the user layer (written by the
    // settings card) exists at all — a namespace the Host does not serve is
    // never dispatched to a card. Each `scope.get()` projects the section
    // fresh, so a key saved in the UI reaches the next search without a
    // restart.
    const scope = sctx.settings.register(SETTINGS_NAMESPACE, SettingsConfig, {
      base: liveConfig(config),
    })
    resolved = () => scope.get()
    sctx.effect(() => () => {
      resolved = () => liveConfig(config)
    })
  })

  const getActiveProviders = (capability?: 'search' | 'fetch') => {
    const current = resolved()
    const activeProviders: { provider: MyProvider; keys: string[] }[] = []

    const orderedNames = Array.from(new Set([
      ...(current.providerOrder || []),
      ...Object.keys(availableProviders)
    ]))

    for (const name of orderedNames) {
      const provider = availableProviders[name]
      if (!provider) continue
      // Brave (and any future search-only provider) declares
      // `supportsFetch: false`; keep it in the search chain but skip it for
      // fetch so the fetch fallback chain never wastes a round on a node that
      // can only throw.
      if (capability === 'fetch' && provider.supportsFetch === false) continue

      const configKey = `${name}ApiKey` as keyof Config
      const raw = current[configKey]
      if (typeof raw === 'string' && raw.trim() !== '') {
        // A key field may hold several keys, one per line. Empty lines and
        // surrounding whitespace are stripped; rotation tries them in order.
        const keys = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
        if (keys.length > 0) activeProviders.push({ provider, keys })
      }
    }
    return activeProviders
  }

  /** `${engine}:${key}` → epoch ms until which that key is benched. */
  const benchedUntil = new Map<string, number>()

  /** One (engine, key) pair to try. An empty `key` is a keyless call. */
  type Attempt = { provider: MyProvider; key: string }

  /**
   * Every configured (engine, key) pair for `kind`, in call order, with keys
   * benched by {@link cooldownFor} moved to the back rather than out — so a
   * fully benched chain still gets tried.
   */
  function orderedAttempts(kind: 'search' | 'fetch'): Attempt[] {
    const now = Date.now()
    const ready: Attempt[] = []
    const benched: Attempt[] = []
    for (const { provider, keys } of getActiveProviders(kind)) {
      for (const key of keys) {
        const until = benchedUntil.get(`${provider.name}:${key}`) ?? 0
        ;(until > now ? benched : ready).push({ provider, key })
      }
    }
    return [...ready, ...benched]
  }

  /**
   * The keyless Jina Reader attempt that ends the fetch chain, when enabled.
   * It reuses Jina's provider, so its failures log like any other Jina
   * failure, and a 429 once the anonymous rate limit is hit benches it under
   * the empty key like any other key.
   */
  function keylessFetchAttempt(current: Config): Attempt[] {
    return current.keylessJinaFetch === false ? [] : [{ provider: availableProviders.jina, key: '' }]
  }

  /**
   * Run one attempt under its own timeout. A failure benches the key when
   * {@link cooldownFor} says so, is logged, is added to `trail` for the
   * all-failed error, and is rethrown — except when
   * `signal` was aborted (the caller, or a won race, giving up), which is
   * rethrown quietly, neither logged nor benched.
   */
  async function tryAttempt<T>(
    kind: 'search' | 'fetch',
    { provider, key }: Attempt,
    signal: AbortSignal | undefined,
    attempt: (provider: MyProvider, key: string, signal: AbortSignal) => Promise<T>,
    trail?: string[],
  ): Promise<T> {
    if (signal?.aborted) throw signal.reason ?? new Error(`web ${kind} aborted`)
    const scoped = attemptSignal(signal, ATTEMPT_TIMEOUT_MS[kind], `${provider.name} ${kind}`)
    const who = `Provider ${provider.name} (${key ? `key ${maskKey(key)}` : 'keyless'})`
    const started = Date.now()
    try {
      const result = await attempt(provider, key, scoped.signal)
      benchedUntil.delete(`${provider.name}:${key}`)
      usage.record(provider.name, key, kind, Date.now() - started)
      return result
    } catch (err: any) {
      if (signal?.aborted) throw err
      usage.record(provider.name, key, kind, Date.now() - started, String(err?.message))
      const cooldown = cooldownFor(err, kind)
      if (cooldown !== undefined) benchedUntil.set(`${provider.name}:${key}`, Date.now() + cooldown)
      const benchNote = cooldown !== undefined ? ` Benched for ${Math.round(cooldown / 60_000)} min.` : ''
      const reason = String(err?.message).replace(/\.$/, '')
      logger.warn?.(`${who} ${kind} failed: ${reason}.${benchNote}`)
      trail?.push(`${provider.name} (${key ? maskKey(key) : 'keyless'}): ${reason}`)
      throw err
    } finally {
      scoped.dispose()
    }
  }

  /**
   * Walk `attempts` one at a time until one succeeds. A caller abort ends the
   * walk at once instead of cycling every remaining engine on a dead signal.
   *
   * @param weak - optional: returns true for a result that is usable but
   *   suspect. A weak result does not end the walk; the first one is
   *   returned only if no later attempt produces a non-weak result.
   * @param trail - failure reasons collected so far (a parallel search's
   *   leads); this walk appends to it.
   */
  async function runChain<T>(
    kind: 'search' | 'fetch',
    attempts: readonly Attempt[],
    signal: AbortSignal | undefined,
    attempt: (provider: MyProvider, key: string, signal: AbortSignal) => Promise<T>,
    weak?: (result: T) => boolean,
    trail: string[] = [],
  ): Promise<T> {
    let fallback: T | undefined
    for (const a of attempts) {
      try {
        const result = await tryAttempt(kind, a, signal, attempt, trail)
        if (!weak?.(result)) return result
        fallback ??= result
        logger.warn?.(`Provider ${a.provider.name} ${kind} returned a suspiciously short result. Trying next key/provider...`)
      } catch (err: any) {
        if (signal?.aborted) throw err
      }
    }
    if (fallback !== undefined) return fallback
    throw chainFailure(kind, trail)
  }

  /**
   * `race` / `merge`: query the first key of the first `width` distinct
   * engines at once. `race` returns the first success and cancels the rest;
   * `merge` waits for all and fuses what succeeded. If every lead fails, the
   * remaining attempts (other engines, and the leads' other keys) are walked
   * one at a time exactly as under `fallback`.
   */
  async function runParallel(
    mode: 'race' | 'merge',
    width: number,
    attempts: readonly Attempt[],
    signal: AbortSignal | undefined,
    attempt: (provider: MyProvider, key: string, signal: AbortSignal) => Promise<SearchResult>,
  ): Promise<SearchResult> {
    const leads: Attempt[] = []
    const rest: Attempt[] = []
    for (const a of attempts) {
      if (leads.length < width && !leads.some((l) => l.provider === a.provider)) leads.push(a)
      else rest.push(a)
    }
    // A child of the caller's signal: aborting it cancels a race's losers
    // without touching the caller, and a caller abort still reaches them all.
    const group = attemptSignal(signal, ATTEMPT_TIMEOUT_MS.search, 'parallel search')
    const trail: string[] = []
    const runs = leads.map((a) => tryAttempt('search', a, group.signal, attempt, trail))
    try {
      if (mode === 'race') {
        try {
          return await Promise.any(runs)
        } catch {
          // Every lead failed; `tryAttempt` logged each one.
        }
      } else {
        const settled = await Promise.allSettled(runs)
        const ok = settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []))
        if (ok.length > 0) return mergeResults(ok)
      }
    } finally {
      // Cancel a race's losers now rather than when their timers fire.
      group.abort()
      group.dispose()
      for (const run of runs) run.catch(() => {})
    }
    if (signal?.aborted) throw signal.reason ?? new Error('web search aborted')
    return runChain('search', rest, signal, attempt, undefined, trail)
  }

  /** Per-(engine, key) call counts since this plugin instance started, for the card. */
  const usage = new UsageStats()

  const searchCache = new TtlCache<{ content: string; sources: SearchResult['sources'] }>(SEARCH_CACHE_ENTRIES)
  const fetchCache = new TtlCache<{ content: string; truncated: boolean }>(FETCH_CACHE_ENTRIES)
  const cacheTtl = (current: Config) => Math.max(0, current.cacheMinutes ?? 10) * 60_000

  /** The per-search options every provider gets, from the live config. */
  function searchOptions(current: Config, maxResults: number | undefined): SearchOptions {
    const pick = (value: string | undefined, none: string) => (value && value !== none ? value : undefined)
    return {
      maxResults,
      region: pick(current.region, 'auto'),
      language: pick(current.language, 'auto'),
      freshness: pick(current.freshness, 'any') as SearchOptions['freshness'],
      excludeDomains: parseDomains(current.blockedDomains),
      searchDepth: current.tavilySearchDepth === 'advanced' ? 'advanced' : 'basic',
    }
  }

  // Register into the seam. dsh-web's register* returns a disposer; wiring it
  // as an effect means disabling or HMR-reloading this plugin removes its
  // providers instead of tripping WEB_DUPLICATE_PROVIDER on the next apply.
  // The seam reads `available()` at execution time, so every setting below is
  // honored live — no watch/re-sync wiring is needed.
  ctx.effect(() => ctx.web?.registerSearchProvider({
    id: 'web-search-free',
    available: () => getActiveProviders('search').length > 0,
    async search(request: any, signal: any) {
      const current = resolved()
      const attempts = orderedAttempts('search')
      if (attempts.length === 0) {
        throw new Error('No web search providers configured. Please set at least one API key in config.')
      }
      const options = searchOptions(current, request.maxResults)
      const blocked = options.excludeDomains ?? []
      const strategy = current.searchStrategy ?? 'fallback'
      const width = Math.min(4, Math.max(2, current.parallelEngines ?? 2))
      const preferred = parseDomains(current.preferredDomains)
      const snippetLength = current.snippetLength ?? 300

      // Everything that shapes the answer is in the key, so changing a
      // setting never serves a result produced under the old one. Engines go
      // in by configured order, not by `attempts`, whose order shifts as keys
      // are benched.
      const cacheKey = JSON.stringify([
        request.query, getActiveProviders('search').map((a) => a.provider.name),
        strategy, width, options, preferred, snippetLength,
      ])
      const cached = searchCache.get(cacheKey)
      if (cached) usage.cacheHit('search')
      if (cached) return { content: cached.content, sources: [...(cached.sources ?? [])], truncated: false }

      // Blocked domains are filtered per attempt, not after the fact: an
      // engine whose every hit was blocked has found nothing, and under
      // `fallback` that must hand over to the next engine.
      const attempt = async (provider: MyProvider, key: string, scoped: AbortSignal): Promise<SearchResult> => {
        const result = await provider.search(request.query, key, scoped, options)
        const sources = (result.sources ?? []).filter((s) => !matchesDomain(s.url, blocked))
        if (sources.length === 0) {
          throw new ProviderError(`${provider.name} search returned no results outside the blocked domains.`)
        }
        return { ...result, sources }
      }

      const result = strategy === 'race' || strategy === 'merge'
        ? await runParallel(strategy, width, attempts, signal, attempt)
        : await runChain('search', attempts, signal, attempt)

      const answer = {
        content: result.content || '',
        sources: finalizeSources(result.sources ?? [], preferred, snippetLength),
      }
      searchCache.set(cacheKey, answer, cacheTtl(current))
      return { ...answer, sources: [...answer.sources], truncated: false }
    }
  }))

  /**
   * dsh's own local fetcher, when the composition registered it and it is
   * usable. The bundle patch pins `fetchProvider` to this plugin, so that
   * provider is never selected by the seam itself; this plugin hands URLs to
   * it instead. The seam offers no public lookup by id, so this reads its
   * registry — a plain `Map` field on `WebRuntime` — and treats anything else
   * as "not there", which only costs the fallback, never the plugin.
   */
  function dshFetchProvider(): { available(): boolean; fetch(request: any, signal?: AbortSignal): Promise<any> } | undefined {
    const registry = (ctx.web as any)?.fetchProviders
    const provider = registry instanceof Map ? registry.get(DSH_FETCH_PROVIDER_ID) : undefined
    if (!provider || typeof provider.fetch !== 'function') return undefined
    try {
      return provider.available?.() === false ? undefined : provider
    } catch {
      return undefined
    }
  }

  ctx.effect(() => ctx.web?.registerFetchProvider({
    id: 'web-search-free',
    // The single `enableFetch` switch, read at execution time: the tool itself
    // is mounted by the composition and stays registered, so "off" means the
    // seam answers WEB_PROVIDER_CONFIGURED_UNAVAILABLE — a structured error
    // naming this provider — rather than the tool vanishing from the model.
    available: () => {
      const current = resolved()
      if (current.enableFetch === false) return false
      if (current.fetchSource === 'dsh') return dshFetchProvider() !== undefined
      return getActiveProviders('fetch').length > 0 ||
        keylessFetchAttempt(current).length > 0 ||
        dshFetchProvider() !== undefined
    },
    async fetch(request: any, signal: any) {
      const current = resolved()
      const local = dshFetchProvider()
      // Passed through untouched, so dsh's own WebError codes
      // (WEB_FETCH_TIMEOUT, WEB_REDIRECT_BLOCKED, …) reach the tool as-is.
      if (current.fetchSource === 'dsh') {
        if (!local) throw new Error(`dsh's local fetch provider "${DSH_FETCH_PROVIDER_ID}" is not registered in this composition.`)
        return local.fetch(request, signal)
      }
      const attempts = [...orderedAttempts('fetch'), ...keylessFetchAttempt(current)]
      if (attempts.length === 0) {
        if (local) return local.fetch(request, signal)
        throw new Error('No web fetch providers configured. Please set at least one API key in config.')
      }
      const weak = (r: { content: string }) => r.content.trim().length < MIN_FETCH_CHARS
      const hit = fetchCache.get(request.url)
      if (hit) usage.cacheHit('fetch')
      let result: { content: string; truncated: boolean }
      try {
        result = hit ?? await runChain(
          'fetch',
          attempts,
          signal,
          (provider, key, scoped) => provider.fetch(request.url, key, scoped),
          weak,
        )
      } catch (err: any) {
        if (!local || signal?.aborted) throw err
        logger.warn?.(`Every fetch engine failed; falling back to dsh's local fetch. ${String(err?.message)}`)
        try {
          return await local.fetch(request, signal)
        } catch (localErr: any) {
          throw new Error(`${String(err?.message).replace(/\.$/, '')}; dsh local fetch: ${String(localErr?.message)}`)
        }
      }
      // A weak result is the chain's last resort, not a good copy: leave it
      // out so the next fetch of this URL tries again.
      if (!weak(result)) fetchCache.set(request.url, result, cacheTtl(current))
      // Propagate the provider-reported truncation instead of a hardcoded
      // false: the official `dsh-tool-web` seam ORs this with its own
      // `fetchMaxOutputChars` cap and any source-character cut, so the
      // provider's own cap (e.g. Exa's 10000-char text limit, Firecrawl's
      // truncation warning) must be reflected here to be honest.
      return {
        url: request.url,
        statusCode: 200,
        body: { kind: 'text', content: result.content },
        truncated: result.truncated,
      }
    }
  }))

  /**
   * The card's view of usage: one row per configured (engine, key), keys
   * masked, plus the keyless fetch fallback once it has been used. Engines in
   * configured order, so the table reads like the call order above it.
   */
  function statsSnapshot() {
    const now = Date.now()
    const rows: unknown[] = []
    const seen = new Set<string>()
    const row = (provider: MyProvider, key: string) => {
      const id = `${provider.name}:${key}`
      if (seen.has(id)) return
      seen.add(id)
      const until = benchedUntil.get(id) ?? 0
      rows.push({
        engine: provider.name,
        key: key ? maskKey(key) : null,
        ...usage.tallies(provider.name, key),
        benchedForMs: until > now ? until - now : 0,
      })
    }
    for (const { provider, keys } of getActiveProviders('search')) for (const key of keys) row(provider, key)
    if (usage.has('jina', '')) row(availableProviders.jina, '')
    return { since: usage.since, cacheHits: usage.cacheHits, rows, version: PLUGIN_VERSION }
  }

  /**
   * Run one small search per key and report each outcome. Keys come from the
   * request (a key typed in the card but not saved yet) or, when none are
   * sent, from the stored config. Goes through `tryAttempt`, so a test also
   * benches a dead key and clears the bench of a revived one — and never
   * touches the cache.
   */
  async function testKeys(engine: string, requested: unknown) {
    const provider = availableProviders[engine]
    if (!provider) return jsonResponse(400, { error: `unknown engine ${JSON.stringify(engine)}` })
    const fromRequest = Array.isArray(requested)
      ? requested.filter((k): k is string => typeof k === 'string').map((k) => k.trim()).filter(Boolean)
      : []
    const stored = getActiveProviders('search').find((a) => a.provider === provider)?.keys ?? []
    const keys = (fromRequest.length > 0 ? fromRequest : stored).slice(0, MAX_TEST_KEYS)
    if (keys.length === 0) return jsonResponse(400, { error: 'no keys to test' })

    const results = await Promise.all(keys.map(async (key) => {
      const started = Date.now()
      try {
        const result = await tryAttempt('search', { provider, key }, undefined, (p, k, sig) =>
          p.search(TEST_QUERY, k, sig, { maxResults: 3 }),
        )
        return { key: maskKey(key), ok: true, ms: Date.now() - started, results: result.sources?.length ?? 0 }
      } catch (err: any) {
        return { key: maskKey(key), ok: false, ms: Date.now() - started, error: String(err?.message ?? err) }
      }
    }))
    return jsonResponse(200, { engine, results })
  }

  // The card's routes. Optional: a dsh without `connection.fetch` (older
  // than its exact-route registry) simply has no stats or key tests, and the
  // card hides both. Waited for in a child fiber, never in the top-level
  // `inject` — a missing service there would keep this entry pending forever
  // and fail the whole web boot (see the README's implementation notes).
  ctx.inject(['connection'], (cctx) => {
    const register = cctx.connection?.fetch?.register
    if (typeof register !== 'function') return
    cctx.effect(() => cctx.connection.fetch.register({
      path: STATS_ROUTE,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async () => jsonResponse(200, statsSnapshot()),
    }), 'web-search-free: stats route')
    cctx.effect(() => cctx.connection.fetch.register({
      path: TEST_ROUTE,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request: Request) => {
        let body: any
        try {
          body = await request.json()
        } catch {
          return jsonResponse(400, { error: 'expected a JSON body' })
        }
        return testKeys(String(body?.engine ?? ''), body?.keys)
      },
    }), 'web-search-free: key test route')
    // Asked from the Host rather than the browser, so the card itself still
    // sends no request beyond dsh's own origin. Only on demand — a click.
    cctx.effect(() => cctx.connection.fetch.register({
      path: UPDATE_ROUTE,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async () => {
        try {
          const res = await fetch(REGISTRY_LATEST_URL, { signal: AbortSignal.timeout(8_000) })
          if (!res.ok) throw new Error(`npm registry: ${res.status} ${res.statusText}`)
          const latest = String((await res.json())?.version ?? '')
          return jsonResponse(200, { current: PLUGIN_VERSION, latest, updateAvailable: isNewer(latest, PLUGIN_VERSION) })
        } catch (err: any) {
          return jsonResponse(502, { error: String(err?.message ?? err) })
        }
      },
    }), 'web-search-free: update check route')
  })
}
