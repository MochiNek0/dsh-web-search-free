import { WebSearchProvider, SearchResult, FetchResult } from '../types.js';
import { toPublishedAt } from './fields.js';

export const tavilyProvider: WebSearchProvider = {
  name: 'tavily',
  supportsFetch: true,
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
        snippet: r.content,
        // Tavily returns `published_date` only for `topic: 'news'`; this stays a
        // general web search, so expect it to be absent. Read anyway — it costs
        // nothing and lands automatically if the topic ever changes.
        publishedAt: toPublishedAt(r.published_date)
      })) || []
    };
  },
  
  async fetch(url: string, apiKey: string, signal?: AbortSignal): Promise<FetchResult> {
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
      // Tavily's /extract endpoint returns the full decoded `raw_content` with
      // no documented size cap, so there is no provider-side truncation to
      // report; the official seam still flags its own output-cap cut.
      return { content: data.results[0].raw_content || 'No content found.', truncated: false };
    }
    return { content: 'No results found.', truncated: false };
  }
};
