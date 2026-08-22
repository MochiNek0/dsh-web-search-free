import { WebSearchProvider, SearchResult, FetchResult } from '../types.js';
import { toPublishedAt } from './fields.js';

export const braveProvider: WebSearchProvider = {
  name: 'brave',
  // Brave Search API is query-only; it has no URL fetch/scrape endpoint, so it
  // must stay out of the fetch fallback chain. `fetch` is kept for interface
  // completeness and throws if ever reached directly.
  supportsFetch: false,
  async search(query: string, apiKey: string, signal?: AbortSignal): Promise<SearchResult | string> {
    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'X-Subscription-Token': apiKey
      },
      signal,
    });
    if (!res.ok) throw new Error(`Brave search failed: ${res.status} ${res.statusText}`);
    const data = await res.json();
    if (data.web && data.web.results && data.web.results.length > 0) {
      return {
        content: '',
        sources: data.web.results.map((r: any) => ({
          url: r.url,
          title: r.title,
          snippet: r.description,
          // `page_age` is Brave's ISO-8601 timestamp. It also returns `age`
          // ("1 week ago"), deliberately unused: `publishedAt` is contracted as
          // a date, and the renderer prints it verbatim.
          publishedAt: toPublishedAt(r.page_age)
        }))
      };
    }
    return 'No results found.';
  },
  
  async fetch(url: string, apiKey: string, signal?: AbortSignal): Promise<FetchResult> {
    // Unreachable in the fetch chain because supportsFetch is false; kept for
    // interface completeness and direct callers.
    throw new Error('Brave Search does not support direct URL fetching/scraping.');
  }
};
