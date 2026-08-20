import { Context, Schema } from 'cordis'

export const name = 'web-search-free'

export interface Config {
  firecrawlApiKey?: string
  tavilyApiKey?: string
}

export const Config: Schema<Config> = Schema.object({
  firecrawlApiKey: Schema.string().description('API key for Firecrawl.').role('secret'),
  tavilyApiKey: Schema.string().description('API key for Tavily.').role('secret'),
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

  const getProviders = () => {
    const providers: { name: string; key: string }[] = []
    if (config.firecrawlApiKey) providers.push({ name: 'firecrawl', key: config.firecrawlApiKey })
    if (config.tavilyApiKey) providers.push({ name: 'tavily', key: config.tavilyApiKey })
    return providers
  }

  // Register web search tool
  ctx.tools?.register({
    name: 'web_search',
    description: 'Search the web for a given query to find up-to-date information.',
    parameters: {
      query: { type: 'string', required: true, description: 'The search query' }
    },
    async execute({ query }: { query: string }) {
      const providers = getProviders()
      if (providers.length === 0) {
        throw new Error('No web search providers configured. Please set firecrawlApiKey or tavilyApiKey.')
      }

      let lastError: Error | null = null
      
      for (const provider of providers) {
        try {
          if (provider.name === 'tavily') {
            const res = await fetch('https://api.tavily.com/search', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                api_key: provider.key,
                query: query,
                search_depth: 'basic',
                include_answer: true,
              }),
            })
            if (!res.ok) throw new Error(`Tavily search failed: ${res.status} ${res.statusText}`)
            const data = await res.json()
            return `Answer: ${data.answer || ''}\n\nResults:\n${data.results?.map((r: any) => `- ${r.title}: ${r.content} (${r.url})`).join('\n')}`
          } else if (provider.name === 'firecrawl') {
            const res = await fetch('https://api.firecrawl.dev/v1/search', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${provider.key}`
              },
              body: JSON.stringify({
                query: query,
                pageOptions: { fetchPageContent: true }
              }),
            })
            if (!res.ok) throw new Error(`Firecrawl search failed: ${res.status} ${res.statusText}`)
            const data = await res.json()
            if (data.success && data.data) {
              return data.data.map((r: any) => `- ${r.title}: ${r.markdown || r.description} (${r.url})`).join('\n')
            }
            return 'No results found.'
          }
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

  // Register web fetch tool
  ctx.tools?.register({
    name: 'web_fetch',
    description: 'Fetch the text or markdown content of a specific web page URL.',
    parameters: {
      url: { type: 'string', required: true, description: 'The URL of the web page to fetch' }
    },
    async execute({ url }: { url: string }) {
      const providers = getProviders()
      if (providers.length === 0) {
        throw new Error('No web fetch providers configured. Please set firecrawlApiKey or tavilyApiKey.')
      }

      let lastError: Error | null = null

      for (const provider of providers) {
        try {
          if (provider.name === 'tavily') {
            const res = await fetch('https://api.tavily.com/extract', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                api_key: provider.key,
                urls: [url],
              }),
            })
            if (!res.ok) throw new Error(`Tavily extract failed: ${res.status} ${res.statusText}`)
            const data = await res.json()
            if (data.results && data.results.length > 0) {
              return data.results[0].raw_content || 'No content found.'
            }
            return 'No results found.'
          } else if (provider.name === 'firecrawl') {
            const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${provider.key}`
              },
              body: JSON.stringify({
                url: url,
                formats: ['markdown']
              }),
            })
            if (!res.ok) throw new Error(`Firecrawl fetch failed: ${res.status} ${res.statusText}`)
            const data = await res.json()
            if (data.success && data.data) {
              return data.data.markdown || 'No markdown content available.'
            }
            return 'Failed to fetch content.'
          }
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
