import { WebSearchProvider, SearchResult } from '../types';

export const braveProvider: WebSearchProvider = {
  name: 'brave',
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
          snippet: r.description
        }))
      };
    }
    return 'No results found.';
  },
  
  async fetch(url: string, apiKey: string, signal?: AbortSignal): Promise<string> {
    // Brave Search API is only for search queries, not content fetching/scraping.
    throw new Error('Brave Search does not support direct URL fetching/scraping.');
  }
};
