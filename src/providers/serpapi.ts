import { WebSearchProvider, SearchResult, FetchResult } from '../types.js';
import { toPublishedAt } from './fields.js';

export const serpapiProvider: WebSearchProvider = {
  name: 'serpapi',
  // SerpApi is a SERP scraper only; it has no URL extract/reader endpoint, so
  // it must stay out of the fetch fallback chain. `fetch` is kept for
  // interface completeness and throws if ever reached directly.
  supportsFetch: false,

  /**
   * SerpApi authenticates with `?api_key=` — their docs are explicit that the
   * key "should not be in HTTP headers, form data, or anywhere else." So no
   * `Authorization` header here.
   *
   * Results live under `organic_results[]`, and the URL field is `link` — not
   * `url` as every other provider uses. `snippet` is genuinely optional, and
   * `date` (when present) is a display string like "5 days ago" rather than
   * ISO-8601; `toPublishedAt` passes it through verbatim, which the renderer
   * prints as-is. That is coarser than a parsed date but still signals
   * recency, so it is read rather than dropped.
   */
  async search(query: string, apiKey: string, signal?: AbortSignal): Promise<SearchResult> {
    const url = new URL('https://serpapi.com/search');
    url.searchParams.set('engine', 'google');
    url.searchParams.set('q', query);
    url.searchParams.set('api_key', apiKey);
    // `num` is unreliable now (Google removed &num=100 support and SerpApi's
    // own Light Fast workaround was capped), so it is not set. The default page
    // size is what Google returns, which is enough for a search.
    const res = await fetch(url, { method: 'GET', signal });
    if (!res.ok) throw new Error(`SerpApi search failed: ${res.status} ${res.statusText}`);
    const data = await res.json();
    // A top-level `error` string can appear even on 200; SerpApi's async path
    // also reports status through `search_metadata.status`.
    if (typeof data?.error === 'string' && data.error.length > 0) {
      throw new Error(`SerpApi search failed: ${data.error}`);
    }
    const entries: any[] = Array.isArray(data?.organic_results) ? data.organic_results : [];
    if (entries.length === 0) throw new Error('SerpApi search returned no results.');

    const sources = entries
      .map((r: any) => {
        const link = typeof r?.link === 'string' ? r.link : '';
        if (!link) return undefined;
        return {
          url: link,
          title: typeof r?.title === 'string' && r.title.length > 0 ? r.title : link,
          snippet: typeof r?.snippet === 'string' && r.snippet.length > 0 ? r.snippet : undefined,
          // A display string ("May 2, 2022", "5 days ago"), not ISO; passed
          // through verbatim. Often absent — a miss is normal.
          publishedAt: toPublishedAt(r?.date),
        };
      })
      .filter((s): s is NonNullable<typeof s> => s !== undefined);

    if (sources.length === 0) throw new Error('SerpApi search returned no parsable results.');
    return { content: '', sources };
  },

  async fetch(url: string, apiKey: string, signal?: AbortSignal): Promise<FetchResult> {
    // Unreachable in the fetch chain because supportsFetch is false; kept for
    // interface completeness and direct callers.
    throw new Error('SerpApi does not support direct URL fetching/extracting.');
  },
};
