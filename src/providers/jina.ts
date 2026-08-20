import { WebSearchProvider } from '../types';

export const jinaProvider: WebSearchProvider = {
  name: 'jina',
  async search(query: string, apiKey: string): Promise<string> {
    const res = await fetch(`https://s.jina.ai/${encodeURIComponent(query)}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        // Jina API returns ready-to-use markdown by default
        'Accept': 'text/plain' 
      },
    });
    if (!res.ok) throw new Error(`Jina search failed: ${res.status} ${res.statusText}`);
    return await res.text();
  },
  
  async fetch(url: string, apiKey: string): Promise<string> {
    const res = await fetch(`https://r.jina.ai/${encodeURIComponent(url)}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'text/plain'
      },
    });
    if (!res.ok) throw new Error(`Jina fetch failed: ${res.status} ${res.statusText}`);
    return await res.text();
  }
};
