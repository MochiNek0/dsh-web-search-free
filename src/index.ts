import { Context, Schema } from 'cordis'
import { availableProviders } from './providers'
import { WebSearchProvider } from './types'

export const name = 'web-search-free'

export interface Config {
  firecrawlApiKey?: string
  tavilyApiKey?: string
  jinaApiKey?: string
  exaApiKey?: string
  braveApiKey?: string
}

export const Config: Schema<Config> = Schema.object({
  firecrawlApiKey: Schema.string().description('API key for Firecrawl.').role('secret'),
  tavilyApiKey: Schema.string().description('API key for Tavily.').role('secret'),
  jinaApiKey: Schema.string().description('API key for Jina AI.').role('secret'),
  exaApiKey: Schema.string().description('API key for Exa (Metaphor).').role('secret'),
  braveApiKey: Schema.string().description('API key for Brave Search.').role('secret'),
})

declare module 'cordis' {
  interface Context {
    tools: {
      register(tool: any): void
    }
    logger: any
  }
}

export function apply(ctx: Context, config: Config) {
  const logger = ctx.logger?.('web-search-free') || console

  // 获取已配置了 API Key 的 Providers
  const getActiveProviders = () => {
    const activeProviders: { provider: WebSearchProvider; key: string }[] = []
    
    for (const [name, provider] of Object.entries(availableProviders)) {
      // 约定：配置项名为 providerName + 'ApiKey'
      const configKey = `${name}ApiKey` as keyof Config
      const apiKey = config[configKey]
      if (apiKey && typeof apiKey === 'string') {
        activeProviders.push({ provider, key: apiKey })
      }
    }
    return activeProviders
  }

  ctx.tools?.register({
    name: 'web_search',
    description: 'Search the web for a given query to find up-to-date information.',
    parameters: {
      query: { type: 'string', required: true, description: 'The search query' }
    },
    async execute({ query }: { query: string }) {
      const activeProviders = getActiveProviders()
      if (activeProviders.length === 0) {
        throw new Error('No web search providers configured. Please set at least one API key in config.')
      }

      let lastError: Error | null = null
      
      for (const { provider, key } of activeProviders) {
        try {
          return await provider.search(query, key)
        } catch (err: any) {
          lastError = err
          if (logger && logger.warn) {
            logger.warn(`Provider ${provider.name} search failed: ${err.message}. Trying next provider if available...`)
          } else {
            console.warn(`Provider ${provider.name} search failed: ${err.message}. Trying next provider if available...`)
          }
          continue
        }
      }
      throw new Error(`All configured search providers failed. Last error: ${lastError?.message}`)
    }
  })

  ctx.tools?.register({
    name: 'web_fetch',
    description: 'Fetch the text or markdown content of a specific web page URL.',
    parameters: {
      url: { type: 'string', required: true, description: 'The URL of the web page to fetch' }
    },
    async execute({ url }: { url: string }) {
      const activeProviders = getActiveProviders()
      if (activeProviders.length === 0) {
        throw new Error('No web fetch providers configured. Please set at least one API key in config.')
      }

      let lastError: Error | null = null

      for (const { provider, key } of activeProviders) {
        try {
          return await provider.fetch(url, key)
        } catch (err: any) {
          lastError = err
          if (logger && logger.warn) {
            logger.warn(`Provider ${provider.name} fetch failed: ${err.message}. Trying next provider if available...`)
          } else {
            console.warn(`Provider ${provider.name} fetch failed: ${err.message}. Trying next provider if available...`)
          }
          continue
        }
      }
      throw new Error(`All configured fetch providers failed. Last error: ${lastError?.message}`)
    }
  })
}
