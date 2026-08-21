import { WebSearchProvider, SearchResult } from '../types.js';

export const exaProvider: WebSearchProvider = {
  name: 'exa',
  async search(query: string, apiKey: string, signal?: AbortSignal): Promise<SearchResult | string> {
    const res = await fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey
      },
      body: JSON.stringify({
        query: query,
        contents: {
          text: true
        }
      }),
      signal,
    });
    if (!res.ok) throw new Error(`Exa search failed: ${res.status} ${res.statusText}`);
    const data = await res.json();
    if (data.results && data.results.length > 0) {
      return {
        content: '',
        sources: data.results.map((r: any) => ({
          url: r.url,
          title: r.title,
          snippet: r.text || r.url
        }))
      };
    }
    return 'No results found.';
  },
  
  async fetch(url: string, apiKey: string, signal?: AbortSignal): Promise<string> {
    const res = await fetch('https://api.exa.ai/contents', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey
      },
      body: JSON.stringify({
        urls: [url],
        text: true
      }),
      signal,
    });
    if (!res.ok) throw new Error(`Exa fetch failed: ${res.status} ${res.statusText}`);
    const data = await res.json();
    if (data.results && data.results.length > 0) {
      return data.results[0].text || 'No content found.';
    }
    return 'No results found.';
  }
};
