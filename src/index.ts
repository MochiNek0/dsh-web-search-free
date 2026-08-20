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
  jinaApiKey: Schema.string().description('API key for Jina AI.'),
  exaApiKey: Schema.string().description('API key for Exa (Metaphor).'),
  tavilyApiKey: Schema.string().description('API key for Tavily.'),
  firecrawlApiKey: Schema.string().description('API key for Firecrawl.'),
  braveApiKey: Schema.string().description('API key for Brave Search.'),
  providerOrder: Schema.array(Schema.union(['jina', 'exa', 'tavily', 'firecrawl', 'brave']))
    .default(['jina', 'exa', 'tavily', 'firecrawl', 'brave'])
    .description('定义 Provider 的调用顺序。排在前面的服务会优先执行，如果请求失败（或额度用尽），会自动按照该顺序 fallback 到下一个可用服务。')
})

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
    const activeProviders: { provider: MyProvider; key: string }[] = []
    
    const orderedNames = Array.from(new Set([
      ...(current.providerOrder || []),
      ...Object.keys(availableProviders)
    ]))

    for (const name of orderedNames) {
      const provider = availableProviders[name]
      if (!provider) continue

      const configKey = `${name}ApiKey` as keyof Config
      const apiKey = current[configKey]
      if (apiKey && typeof apiKey === 'string') {
        activeProviders.push({ provider, key: apiKey })
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
      
      for (const { provider, key } of activeProviders) {
        try {
          const result = await provider.search(request.query, key, signal)
          if (typeof result === 'string') {
            return { content: result, sources: [], truncated: false }
          }
          return { content: result.content || '', sources: result.sources || [], truncated: false }
        } catch (err: any) {
          lastError = err
          if (logger && logger.warn) {
            logger.warn(`Provider ${provider.name} search failed: ${err.message}. Trying next provider if available...`)
          }
          continue
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

      for (const { provider, key } of activeProviders) {
        try {
          const resultStr = await provider.fetch(request.url, key, signal)
          return { url: request.url, statusCode: 200, body: { kind: 'text', content: resultStr }, truncated: false }
        } catch (err: any) {
          lastError = err
          if (logger && logger.warn) {
            logger.warn(`Provider ${provider.name} fetch failed: ${err.message}. Trying next provider if available...`)
          }
          continue
        }
      }
      throw new Error(`All configured fetch providers failed. Last error: ${lastError?.message}`)
    }
  })
}
