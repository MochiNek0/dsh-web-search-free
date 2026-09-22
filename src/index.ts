import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { availableProviders } from './providers/index.js'
import { WebSearchProvider as MyProvider } from './types.js'

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
  providerOrder: string[]
}

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
  enableFetch: Schema.boolean().default(true).description('是否允许模型调用 web_fetch（URL 内容抓取）。web_fetch 工具由 dsh 统一挂载，关闭后调用会返回明确的错误提示，而不是从工具表移除；切换即时生效，无需重启。'),
  providerOrder: Schema.array(Schema.union(['jina', 'exa', 'tavily', 'firecrawl', 'brave', 'anysearch', 'tinyfish', 'serpapi', 'serpingapi']))
    .default(['tinyfish', 'anysearch', 'exa', 'tavily', 'firecrawl', 'serpingapi', 'brave', 'serpapi', 'jina'])
    .description('定义 Provider 的调用顺序。排在前面的服务会优先执行，如果请求失败（或额度用尽），会自动按照该顺序 fallback 到下一个可用服务。')
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
  if (key.length <= 8) return '***'
  return `${key.slice(0, 4)}…${key.slice(-3)}`
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    web: any
    settings: any
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

  // Register into the seam. dsh-web's register* returns a disposer; wiring it
  // as an effect means disabling or HMR-reloading this plugin removes its
  // providers instead of tripping WEB_DUPLICATE_PROVIDER on the next apply.
  // The seam reads `available()` at execution time, so every setting below is
  // honored live — no watch/re-sync wiring is needed.
  ctx.effect(() => ctx.web?.registerSearchProvider({
    id: 'web-search-free',
    available: () => getActiveProviders('search').length > 0,
    async search(request: any, signal: any) {
      const activeProviders = getActiveProviders('search')
      if (activeProviders.length === 0) {
        throw new Error('No web search providers configured. Please set at least one API key in config.')
      }

      let lastError: Error | null = null

      for (const { provider, keys } of activeProviders) {
        for (const key of keys) {
          try {
            const result = await provider.search(request.query, key, signal)
            if (typeof result === 'string') {
              return { content: result, sources: [], truncated: false }
            }
            return { content: result.content || '', sources: result.sources || [], truncated: false }
          } catch (err: any) {
            lastError = err
            if (logger && logger.warn) {
              logger.warn(`Provider ${provider.name} (key ${maskKey(key)}) search failed: ${err.message}. Trying next key/provider...`)
            }
            continue
          }
        }
      }
      throw new Error(`All configured search providers failed. Last error: ${lastError?.message}`)
    }
  }))

  ctx.effect(() => ctx.web?.registerFetchProvider({
    id: 'web-search-free',
    // The single `enableFetch` switch, read at execution time: the tool itself
    // is mounted by the composition and stays registered, so "off" means the
    // seam answers WEB_PROVIDER_CONFIGURED_UNAVAILABLE — a structured error
    // naming this provider — rather than the tool vanishing from the model.
    available: () => resolved().enableFetch !== false && getActiveProviders('fetch').length > 0,
    async fetch(request: any, signal: any) {
      const activeProviders = getActiveProviders('fetch')
      if (activeProviders.length === 0) {
        throw new Error('No web fetch providers configured. Please set at least one API key in config.')
      }

      let lastError: Error | null = null

      for (const { provider, keys } of activeProviders) {
        for (const key of keys) {
          try {
            const result = await provider.fetch(request.url, key, signal)
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
          } catch (err: any) {
            lastError = err
            if (logger && logger.warn) {
              logger.warn(`Provider ${provider.name} (key ${maskKey(key)}) fetch failed: ${err.message}. Trying next key/provider...`)
            }
            continue
          }
        }
      }
      throw new Error(`All configured fetch providers failed. Last error: ${lastError?.message}`)
    }
  }))
}
