import { Context, Schema } from 'cordis'
import { availableProviders } from './providers'
import { WebSearchProvider as MyProvider } from './types'

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
  providerOrder: ('jina' | 'exa' | 'tavily' | 'firecrawl' | 'brave')[]
}

export const Config: Schema<Config> = Schema.object({
  jinaApiKey: Schema.string().description('API key(s) for Jina AI. One key per line for multi-key rotation.'),
  exaApiKey: Schema.string().description('API key(s) for Exa (Metaphor). One key per line for multi-key rotation.'),
  tavilyApiKey: Schema.string().description('API key(s) for Tavily. One key per line for multi-key rotation.'),
  firecrawlApiKey: Schema.string().description('API key(s) for Firecrawl. One key per line for multi-key rotation.'),
  braveApiKey: Schema.string().description('API key(s) for Brave Search. One key per line for multi-key rotation.'),
  providerOrder: Schema.array(Schema.union(['jina', 'exa', 'tavily', 'firecrawl', 'brave']))
    .default(['jina', 'exa', 'tavily', 'firecrawl', 'brave'])
    .description('定义 Provider 的调用顺序。排在前面的服务会优先执行，如果请求失败（或额度用尽），会自动按照该顺序 fallback 到下一个可用服务。')
})

/** Short, non-leaking token for log lines so a failing key is identifiable without printing it. */
function maskKey(key: string): string {
  if (!key) return '***'
  if (key.length <= 8) return '***'
  return `${key.slice(0, 4)}…${key.slice(-3)}`
}

declare module 'cordis' {
  interface Context {
    web: any
    logger: any
    settings: any
  }
}

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

  const getActiveProviders = () => {
    const current = resolved()
    const activeProviders: { provider: MyProvider; keys: string[] }[] = []

    const orderedNames = Array.from(new Set([
      ...(current.providerOrder || []),
      ...Object.keys(availableProviders)
    ]))

    for (const name of orderedNames) {
      const provider = availableProviders[name]
      if (!provider) continue

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

  ctx.web?.registerSearchProvider({
    id: 'web-search-free',
    available: () => getActiveProviders().length > 0,
    async search(request: any, signal: any) {
      const activeProviders = getActiveProviders()
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
  })

  ctx.web?.registerFetchProvider({
    id: 'web-search-free',
    available: () => getActiveProviders().length > 0,
    async fetch(request: any, signal: any) {
      const activeProviders = getActiveProviders()
      if (activeProviders.length === 0) {
        throw new Error('No web fetch providers configured. Please set at least one API key in config.')
      }

      let lastError: Error | null = null

      for (const { provider, keys } of activeProviders) {
        for (const key of keys) {
          try {
            const resultStr = await provider.fetch(request.url, key, signal)
            return { url: request.url, statusCode: 200, body: { kind: 'text', content: resultStr }, truncated: false }
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
  })
}
