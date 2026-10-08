import { WebSearchProvider, SearchResult, FetchResult, SearchOptions } from '../types.js';
import { ProviderError, assertOk, clampCount, googleTbs, toSnippet } from './fields.js';

export const firecrawlProvider: WebSearchProvider = {
  name: 'firecrawl',
  supportsFetch: true,
  async search(query: string, apiKey: string, signal?: AbortSignal, options?: SearchOptions): Promise<SearchResult> {
    // Firecrawl bills 2 credits per 10 results; `limit` omitted keeps its default of 5.
    const limit = clampCount(options?.maxResults, 100);
    const res = await fetch('https://api.firecrawl.dev/v1/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        query: query,
        ...(limit !== undefined ? { limit } : {}),
        // v1 search takes a recency `tbs` but no region or language of its
        // own (those sit under `scrapeOptions`, which this search never uses).
        ...(options?.freshness ? { tbs: googleTbs(options.freshness) } : {}),
      }),
      signal,
    });
    assertOk(res, 'Firecrawl search');
    const data = await res.json();
    if (data.success && Array.isArray(data.data) && data.data.length > 0) {
      return {
        content: '', // Let sources speak for themselves
        sources: data.data.map((r: any) => ({
          url: r.url,
          title: r.title,
          // No `publishedAt`: Firecrawl's search results carry only
          // url/title/description. Its dates live in per-page `metadata`, which
          // would mean scraping every result — far too costly for a search.
          snippet: toSnippet(r.markdown || r.description)
        }))
      };
    }
    throw new ProviderError('Firecrawl search returned no results.');
  },
  
  async fetch(url: string, apiKey: string, signal?: AbortSignal): Promise<FetchResult> {
    const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        url: url,
        formats: ['markdown']
      }),
      signal,
    });
    assertOk(res, 'Firecrawl fetch');
    const data = await res.json();
    const markdown: unknown = data?.data?.markdown;
    if (data.success && typeof markdown === 'string' && markdown.trim() !== '') {
      // Firecrawl reports a truncated body through `warning`, absent on a clean
      // scrape. The documented response puts it beside `data`, not inside it;
      // both are read because the field has moved between API revisions and the
      // wrong one silently pins `truncated` to false.
      const raw = data.warning ?? data.data.warning;
      const warning = typeof raw === 'string' ? raw : '';
      return {
        content: markdown,
        truncated: warning.trim().length > 0,
      };
    }
    throw new ProviderError(`Firecrawl fetch returned no content${typeof data?.error === 'string' ? `: ${data.error}` : '.'}`);
  }
};
