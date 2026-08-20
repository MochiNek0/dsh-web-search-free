import { WebSearchProvider } from '../types';

export const firecrawlProvider: WebSearchProvider = {
  name: 'firecrawl',
  async search(query: string, apiKey: string): Promise<string> {
    const res = await fetch('https://api.firecrawl.dev/v1/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        query: query,
        pageOptions: { fetchPageContent: true }
      }),
    });
    if (!res.ok) throw new Error(`Firecrawl search failed: ${res.status} ${res.statusText}`);
    const data = await res.json();
    if (data.success && data.data) {
      return data.data.map((r: any) => `- ${r.title}: ${r.markdown || r.description} (${r.url})`).join('\n');
    }
    return 'No results found.';
  },
  
  async fetch(url: string, apiKey: string): Promise<string> {
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
    });
    if (!res.ok) throw new Error(`Firecrawl fetch failed: ${res.status} ${res.statusText}`);
    const data = await res.json();
    if (data.success && data.data) {
      return data.data.markdown || 'No markdown content available.';
    }
    return 'Failed to fetch content.';
  }
};
