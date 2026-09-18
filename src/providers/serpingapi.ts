import { WebSearchProvider, SearchResult, FetchResult } from '../types.js';
import { toPublishedAt } from './fields.js';

export const serpingapiProvider: WebSearchProvider = {
  name: 'serpingapi',
  // Serping API is a Google SERP API only; it has no URL extract/reader
  // endpoint, so it must stay out of the fetch fallback chain. `fetch` is kept
  // for interface completeness and throws if ever reached directly.
  supportsFetch: false,

  /**
   * Serping API authenticates with an `X-API-Key` header and takes the query
   * as a JSON body (`POST /v1/search`, `{ q }`). GET with a query string is
   * accepted too, but POST keeps the key and query out of URLs.
   *
   * The response is Serper-shaped: results live under `organic[]` with
   * `title` / `link` / `snippet` / `position`, and `answerBox`,
   * `knowledgeGraph`, `peopleAlsoAsk`, `relatedSearches` appear when Google
   * returns them. `date` is present on some organic results as a display
   * string rather than ISO-8601; like SerpApi's it is passed through verbatim.
   *
   * Errors are `{ error: { code, message } }` with a matching HTTP status
   * (401 invalid key, 429 `quota_exceeded` once the monthly quota is spent),
   * so a non-2xx here is what hands off to the next engine in the chain.
   */
  async search(query: string, apiKey: string, signal?: AbortSignal): Promise<SearchResult> {
    const res = await fetch('https://api.serpingapi.com/v1/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify({ q: query }),
      signal,
    });
    if (!res.ok) {
      // The JSON error body names the cause (`quota_exceeded`, `invalid_api_key`);
      // include it in the log line when the body is parsable.
      let detail = '';
      try {
        const body = await res.json();
        if (typeof body?.error?.message === 'string' && body.error.message.length > 0) {
          detail = `: ${body.error.message}`;
        }
      } catch {
        // non-JSON error body; the status line is enough
      }
      throw new Error(`Serping API search failed: ${res.status} ${res.statusText}${detail}`);
    }
    const data = await res.json();
    const entries: any[] = Array.isArray(data?.organic) ? data.organic : [];
    if (entries.length === 0) throw new Error('Serping API search returned no results.');

    const sources = entries
      .map((r: any) => {
        const link = typeof r?.link === 'string' ? r.link : '';
        if (!link) return undefined;
        return {
          url: link,
          title: typeof r?.title === 'string' && r.title.length > 0 ? r.title : link,
          snippet: typeof r?.snippet === 'string' && r.snippet.length > 0 ? r.snippet : undefined,
          // A display string, not ISO; passed through verbatim. Present on
          // some results only — a miss is normal.
          publishedAt: toPublishedAt(r?.date),
        };
      })
      .filter((s): s is NonNullable<typeof s> => s !== undefined);

    if (sources.length === 0) throw new Error('Serping API search returned no parsable results.');

    // `answerBox` is Google's featured snippet / direct answer when there is
    // one. Its short `answer` or `snippet` text goes into `content`, the same
    // slot Tavily's direct answer uses; absent for most queries.
    const answerBox = data?.answerBox;
    const content =
      typeof answerBox?.answer === 'string' ? answerBox.answer
      : typeof answerBox?.snippet === 'string' ? answerBox.snippet
      : '';
    return { content, sources };
  },

  async fetch(url: string, apiKey: string, signal?: AbortSignal): Promise<FetchResult> {
    // Unreachable in the fetch chain because supportsFetch is false; kept for
    // interface completeness and direct callers.
    throw new Error('Serping API does not support direct URL fetching/extracting.');
  },
};
