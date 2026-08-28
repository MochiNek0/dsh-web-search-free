import { WebSearchProvider, SearchResult, FetchResult } from '../types.js';
import { toSnippet } from './fields.js';

/** AnySearch caps extracted text at this length; a body of exactly this length reads as truncated. */
const EXTRACT_MAX_CHARACTERS = 50000;

export const anysearchProvider: WebSearchProvider = {
  name: 'anysearch',
  supportsFetch: true,

  /**
   * AnySearch envelopes every response as `{code, message, request_id, data}`
   * and — critically — a 200 can still be an error: success is `code === 0`.
   * Reading only `res.ok` would treat a server-side failure as success and
   * return an empty result, ending the fallback chain. So check the envelope
   * code first, then look for `data.results`.
   *
   * The official formatter prefers `result.content` over `result.snippet`, but
   * `content` can be a full body excerpt — `toSnippet` trims it to a length the
   * official `web_search` renderer handles without flooding the model context.
   *
   * No date field exists in AnySearch's API, so `publishedAt` is never set.
   */
  async search(query: string, apiKey: string, signal?: AbortSignal): Promise<SearchResult> {
    const res = await fetch('https://api.anysearch.com/v1/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ query, max_results: 10 }),
      signal,
    });
    if (!res.ok) throw new Error(`AnySearch search failed: ${res.status} ${res.statusText}`);
    const data = await res.json();
    if (typeof data?.code !== 'number' || data.code !== 0) {
      const msg = typeof data?.message === 'string' && data.message.length > 0 ? data.message : `code=${data?.code}`;
      throw new Error(`AnySearch search failed: ${msg}`);
    }
    const entries: any[] = Array.isArray(data?.data?.results) ? data.data.results : [];
    if (entries.length === 0) throw new Error('AnySearch search returned no results.');

    const sources = entries
      .map((r: any) => {
        const url = typeof r?.url === 'string' ? r.url : '';
        if (!url) return undefined;
        // Prefer `content` (richer) then fall back to `snippet`, matching the
        // official CLI's own `result.content || result.snippet` ordering.
        const snippet = toSnippet(r?.content) ?? toSnippet(r?.snippet);
        return {
          url,
          title: typeof r?.title === 'string' && r.title.length > 0 ? r.title : url,
          snippet,
        };
      })
      .filter((s): s is NonNullable<typeof s> => s !== undefined);

    if (sources.length === 0) throw new Error('AnySearch search returned no parsable results.');
    return { content: '', sources };
  },

  /**
   * `/v1/extract` returns markdown under `data.content`. It caps at
   * `EXTRACT_MAX_CHARACTERS`, so a body of exactly that length is treated as
   * truncated — the API reports no flag of its own.
   */
  async fetch(url: string, apiKey: string, signal?: AbortSignal): Promise<FetchResult> {
    const res = await fetch('https://api.anysearch.com/v1/extract', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ url }),
      signal,
    });
    if (!res.ok) throw new Error(`AnySearch extract failed: ${res.status} ${res.statusText}`);
    const data = await res.json();
    if (typeof data?.code !== 'number' || data.code !== 0) {
      const msg = typeof data?.message === 'string' && data.message.length > 0 ? data.message : `code=${data?.code}`;
      throw new Error(`AnySearch extract failed: ${msg}`);
    }
    const text: string = typeof data?.data?.content === 'string' ? data.data.content : '';
    return {
      content: text || 'No content found.',
      truncated: text.length >= EXTRACT_MAX_CHARACTERS,
    };
  },
};
