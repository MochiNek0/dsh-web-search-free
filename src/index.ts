import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { availableProviders } from './providers/index.js'
import { WebSearchProvider as MyProvider } from './types.js'

export const name = 'web-search-free'
export const inject = ['web']

/**
 * Settings namespace this plugin owns. The browser card in `./client` is keyed
 * on this string: the Plugins settings tab dispatches `settings.plugin.item`
 * per namespace the Host serves, so the two halves must spell it identically.
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

export const Config = Schema.object({
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
    .default(['tinyfish', 'anysearch', 'exa', 'tavily', 'firecrawl', 'brave', 'serpingapi', 'serpapi', 'jina'])
    .description('定义 Provider 的调用顺序。排在前面的服务会优先执行，如果请求失败（或额度用尽），会自动按照该顺序 fallback 到下一个可用服务。')
})

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
export function apply(ctx: Context, config: Config) {
  const logger = ctx.logger?.('web-search-free') || console

  // Register the settings namespace so the user layer (written by the Plugins
  // settings card) exists at all: a namespace the Host does not serve is never
  // dispatched to a card. Each call projects the section fresh, so a key saved
  // in the UI reaches the next search without a restart.
  let resolved: () => Config = () => config

  ctx.inject(['settings'], (sctx) => {
    const scope = sctx.settings.register(SETTINGS_NAMESPACE, Config, { base: config })
    resolved = () => scope.get()
    sctx.effect(() => () => {
      resolved = () => config
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
