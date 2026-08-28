import { WebSearchProvider, SearchResult, FetchResult } from '../types.js';
import { toPublishedAt } from './fields.js';

/**
 * Search and Fetch live on *different subdomains* (`api.search.tinyfish.ai` vs
 * `api.fetch.tinyfish.ai`), so each method holds its own base. Their field
 * names also diverge: Search returns `snippet` + `date`, Fetch returns
 * `description` + `published_date`. The mappings below keep each to its own
 * shape rather than forcing one onto the other.
 */
export const tinyfishProvider: WebSearchProvider = {
  name: 'tinyfish',
  supportsFetch: true,

  /**
   * TinyFish's search endpoint is a bare GET on the root path with all params
   * on the query string. There is no `num`/`count` parameter — the API returns
   * a fixed page size and paging is the only way to get more. We take page 0,
   * which is enough for a search; the model can `web_fetch` anything deeper.
   *
   * `date` is documented as "present for news results and some web results" and
   * is absent from the OpenAPI required list, so a miss is normal and yields
   * `undefined` — the seam drops absent optional fields.
   */
  async search(query: string, apiKey: string, signal?: AbortSignal): Promise<SearchResult> {
    const url = new URL('https://api.search.tinyfish.ai');
    url.searchParams.set('query', query);
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'X-API-Key': apiKey },
      signal,
    });
    if (!res.ok) throw new Error(`TinyFish search failed: ${res.status} ${res.statusText}`);
    const data = await res.json();
    const entries: any[] = Array.isArray(data?.results) ? data.results : [];
    if (entries.length === 0) throw new Error('TinyFish search returned no results.');

    const sources = entries
      .map((r: any) => {
        const link = typeof r?.url === 'string' ? r.url : '';
        if (!link) return undefined;
        return {
          url: link,
          title: typeof r?.title === 'string' && r.title.length > 0 ? r.title : link,
          // Search uses `snippet`; the field is in OpenAPI's required list, so
          // it is present whenever the result itself is.
          snippet: typeof r?.snippet === 'string' && r.snippet.length > 0 ? r.snippet : undefined,
          publishedAt: toPublishedAt(r?.date),
        };
      })
      .filter((s): s is NonNullable<typeof s> => s !== undefined);

    if (sources.length === 0) throw new Error('TinyFish search returned no parsable results.');
    return { content: '', sources };
  },

  /**
   * Fetch takes a single-URL array (the API accepts up to 10; this seam only
   * ever fetches one at a time) and returns markdown under `results[].text`.
   * `published_date` is `null` when the extractor could not date the page, so
   * it is read but expected to miss often.
   */
  async fetch(url: string, apiKey: string, signal?: AbortSignal): Promise<FetchResult> {
    const res = await fetch('https://api.fetch.tinyfish.ai', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify({ urls: [url], format: 'markdown' }),
      signal,
    });
    if (!res.ok) throw new Error(`TinyFish fetch failed: ${res.status} ${res.statusText}`);
    const data = await res.json();
    const first = Array.isArray(data?.results) && data.results.length > 0 ? data.results[0] : null;
    if (first && typeof first.text === 'string' && first.text.length > 0) {
      // The API reports no truncation flag of its own; the official seam still
      // flags its own `fetchMaxOutputChars` cut if it bites.
      return { content: first.text, truncated: false };
    }
    // A per-URL failure lands in `errors[]` alongside an empty `results[]`;
    // surface the API's own reason if it gave one, otherwise a generic message.
    const errEntry = Array.isArray(data?.errors) ? data.errors.find((e: any) => e?.url === url) : null;
    const reason = typeof errEntry?.error === 'string' ? errEntry.error : 'No content found.';
    return { content: reason, truncated: false };
  },
};
