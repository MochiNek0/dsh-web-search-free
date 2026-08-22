import { WebSearchProvider, SearchResult, FetchResult } from '../types.js';
import { toSnippet } from './fields.js';

export const firecrawlProvider: WebSearchProvider = {
  name: 'firecrawl',
  supportsFetch: true,
  async search(query: string, apiKey: string, signal?: AbortSignal): Promise<SearchResult | string> {
    const res = await fetch('https://api.firecrawl.dev/v1/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        query: query
      }),
      signal,
    });
    if (!res.ok) throw new Error(`Firecrawl search failed: ${res.status} ${res.statusText}`);
    const data = await res.json();
    if (data.success && data.data) {
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
    return 'No results found.';
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
    if (!res.ok) throw new Error(`Firecrawl fetch failed: ${res.status} ${res.statusText}`);
    const data = await res.json();
    if (data.success && data.data) {
      // Firecrawl reports a truncated body through `warning`, absent on a clean
      // scrape. The documented response puts it beside `data`, not inside it;
      // both are read because the field has moved between API revisions and the
      // wrong one silently pins `truncated` to false.
      const raw = data.warning ?? data.data.warning;
      const warning = typeof raw === 'string' ? raw : '';
      return {
        content: data.data.markdown || 'No markdown content available.',
        truncated: warning.trim().length > 0,
      };
    }
    return { content: 'Failed to fetch content.', truncated: false };
  }
};
