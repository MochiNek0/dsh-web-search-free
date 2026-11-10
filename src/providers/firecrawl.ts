import { WebSearchProvider, SearchResult, FetchResult, SearchOptions } from '../types.js';
import { ProviderError, assertOk, clampCount, googleTbs, toSnippet } from './fields.js';

export const firecrawlProvider: WebSearchProvider = {
  name: 'firecrawl',
  supportsFetch: true,
  async search(query: string, apiKey: string, signal?: AbortSignal, options?: SearchOptions): Promise<SearchResult> {
    // Firecrawl bills 2 credits per 10 results; `limit` omitted keeps its default of 10.
    const limit = clampCount(options?.maxResults, 100);
    const res = await fetch('https://api.firecrawl.dev/v2/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        query: query,
        // Web results only; without `scrapeOptions` each result stays a cheap
        // url/title/description triple rather than a full-page scrape.
        sources: [{ type: 'web' }],
        ...(limit !== undefined ? { limit } : {}),
        // v2 search takes a top-level recency `tbs` but no region or language
        // of its own (those sit under `scrapeOptions`, which this search never uses).
        ...(options?.freshness ? { tbs: googleTbs(options.freshness) } : {}),
      }),
      signal,
    });
    assertOk(res, 'Firecrawl search');
    const data = await res.json();
    // v2 groups results by source type (`data.web`, `data.news`, ...). This
    // search requests only `web`, so that is the array to flatten.
    const web = data.success ? data.data?.web : undefined;
    if (Array.isArray(web) && web.length > 0) {
      return {
        content: '', // Let sources speak for themselves
        sources: web.map((r: any) => ({
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
    const res = await fetch('https://api.firecrawl.dev/v2/scrape', {
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
