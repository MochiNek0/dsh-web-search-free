import { WebSearchProvider } from '../types';

export const tavilyProvider: WebSearchProvider = {
  name: 'tavily',
  async search(query: string, apiKey: string): Promise<string> {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query: query,
        search_depth: 'basic',
        include_answer: true,
      }),
    });
    if (!res.ok) throw new Error(`Tavily search failed: ${res.status} ${res.statusText}`);
    const data = await res.json();
    return `Answer: ${data.answer || ''}\n\nResults:\n${data.results?.map((r: any) => `- ${r.title}: ${r.content} (${r.url})`).join('\n')}`;
  },
  
  async fetch(url: string, apiKey: string): Promise<string> {
    const res = await fetch('https://api.tavily.com/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        urls: [url],
      }),
    });
    if (!res.ok) throw new Error(`Tavily extract failed: ${res.status} ${res.statusText}`);
    const data = await res.json();
    if (data.results && data.results.length > 0) {
      return data.results[0].raw_content || 'No content found.';
    }
    return 'No results found.';
  }
};
