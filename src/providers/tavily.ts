import { WebSearchProvider, SearchResult } from '../types';

export const tavilyProvider: WebSearchProvider = {
  name: 'tavily',
  async search(query: string, apiKey: string, signal?: AbortSignal): Promise<SearchResult> {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query: query,
        search_depth: 'basic',
        include_answer: true,
      }),
      signal,
    });
    if (!res.ok) throw new Error(`Tavily search failed: ${res.status} ${res.statusText}`);
    const data = await res.json();
    
    return {
      content: data.answer || '',
      sources: data.results?.map((r: any) => ({
        url: r.url,
        title: r.title,
        snippet: r.content
      })) || []
    };
  },
  
  async fetch(url: string, apiKey: string, signal?: AbortSignal): Promise<string> {
    const res = await fetch('https://api.tavily.com/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        urls: [url],
      }),
      signal,
    });
    if (!res.ok) throw new Error(`Tavily extract failed: ${res.status} ${res.statusText}`);
    const data = await res.json();
    if (data.results && data.results.length > 0) {
      return data.results[0].raw_content || 'No content found.';
    }
    return 'No results found.';
  }
};
