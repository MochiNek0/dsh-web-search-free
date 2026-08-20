import { Context, Schema } from 'cordis'
import { availableProviders } from './providers'
import { WebSearchProvider as MyProvider } from './types'

export const name = 'web-search-free'
export const inject = ['web']

export interface Config {
  jinaApiKey?: string
  exaApiKey?: string
  tavilyApiKey?: string
  firecrawlApiKey?: string
  braveApiKey?: string
  providerOrder: ('jina' | 'exa' | 'tavily' | 'firecrawl' | 'brave')[]
}

export const Config: Schema<Config> = Schema.object({
  jinaApiKey: Schema.string().description('API key for Jina AI.').role('secret'),
  exaApiKey: Schema.string().description('API key for Exa (Metaphor).').role('secret'),
  tavilyApiKey: Schema.string().description('API key for Tavily.').role('secret'),
  firecrawlApiKey: Schema.string().description('API key for Firecrawl.').role('secret'),
  braveApiKey: Schema.string().description('API key for Brave Search.').role('secret'),
  providerOrder: Schema.array(Schema.union(['jina', 'exa', 'tavily', 'firecrawl', 'brave']))
    .default(['jina', 'exa', 'tavily', 'firecrawl', 'brave'])
    .description('定义 Provider 的调用顺序。排在前面的服务会优先执行，如果请求失败（或额度用尽），会自动按照该顺序 fallback 到下一个可用服务。')
})

declare module 'cordis' {
  interface Context {
    web: any
    logger: any
  }
}

export function apply(ctx: Context, config: Config) {
  const logger = ctx.logger?.('web-search-free') || console

  const getActiveProviders = () => {
    const activeProviders: { provider: MyProvider; key: string }[] = []
    
    const orderedNames = Array.from(new Set([
      ...(config.providerOrder || []),
      ...Object.keys(availableProviders)
    ]))

    for (const name of orderedNames) {
      const provider = availableProviders[name]
      if (!provider) continue

      const configKey = `${name}ApiKey` as keyof Config
      const apiKey = config[configKey]
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
          const resultStr = await provider.search(request.query, key)
          return { content: resultStr, sources: [], truncated: false }
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
          const resultStr = await provider.fetch(request.url, key)
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
