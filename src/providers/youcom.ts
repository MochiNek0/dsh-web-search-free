import { WebSearchProvider, SearchResult, FetchResult, SearchOptions } from '../types.js';
import { ProviderError, clampCount, toPublishedAt } from './fields.js';

/**
 * You.com — Agents API, keyless by default.
 *
 * The default tier is the free one: `GET /v1/agents/search` with `query` +
 * `max_results` query params and no auth, rate-limited to 100 searches/day per
 * IP — no signup, no key. A configured key (the `youcomApiKey` setting, or a
 * `YDC_API_KEY` in the environment) switches the call to the keyed variant —
 * `POST` with `X-API-Key` — for higher limits. The two tiers answer in
 * different shapes (keyless nests under `results.web[]`, keyed is a flat
 * `results[]`), both handled below, so they stay swappable.
 *
 * The free tier takes no region/language/freshness parameters, so those
 * `SearchOptions` are ignored rather than failed on.
 */
const AGENTS_SEARCH_URL = 'https://api.you.com/v1/agents/search';

/** Integration slug — You.com attributes free-tier traffic by User-Agent. */
const USER_AGENT = 'youdotcom-integration/mochinek0-dsh-web-search-free';

/** Requested page, and a defensive cap on whatever comes back. */
const MAX_RESULTS = 20;

/** `{ [name]: value }` when the value is set, `{}` otherwise — for spreading into a request body. */
const optional = (name: string, value: unknown) => (value === undefined ? {} : { [name]: value });

/**
 * Map one raw You.com result to a source, or `undefined` when it carries no
 * usable URL — the API is a network edge, so entries are validated, not
 * trusted. Keyless answers `snippets` (array); keyed answers `snippet`
 * (string); both carry `description` as a fallback.
 */
function toSource(r: any) {
  const url = typeof r?.url === 'string' ? r.url : '';
  if (!url) return undefined;
  const snippet =
    Array.isArray(r?.snippets) && typeof r.snippets[0] === 'string' ? r.snippets[0]
    : typeof r?.snippet === 'string' && r.snippet.length > 0 ? r.snippet
    : typeof r?.description === 'string' && r.description.length > 0 ? r.description
    : undefined;
  return {
    url,
    title: typeof r?.title === 'string' && r.title.length > 0 ? r.title : url,
    snippet,
    // A display-ish timestamp present on some results only; verbatim, a miss is normal.
    publishedAt: toPublishedAt(r?.page_age),
  };
}

export const youcomProvider: WebSearchProvider = {
  name: 'youcom',
  // You.com's Agents API is search-only, so `supportsFetch: false` keeps it in
  // the search chain while excluding it from the fetch chain. `fetch` is kept
  // for interface completeness and throws if ever reached directly.
  supportsFetch: false,

  async search(query: string, apiKey: string, signal?: AbortSignal, options?: SearchOptions): Promise<SearchResult> {
    const max = clampCount(options?.maxResults, MAX_RESULTS);
    // The keyed tier also answers a plain `YDC_API_KEY` in the environment.
    const key = apiKey.trim() || (process.env.YDC_API_KEY ?? '').trim();
    const res = key
      ? await fetch(AGENTS_SEARCH_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': key,
            'User-Agent': USER_AGENT,
          },
          body: JSON.stringify({ query, ...optional('max_results', max) }),
          signal,
        })
      : await fetch(
          `${AGENTS_SEARCH_URL}?${new URLSearchParams({
            query,
            ...(max !== undefined ? { max_results: String(max) } : {}),
          })}`,
          { headers: { 'User-Agent': USER_AGENT }, signal },
        );
    if (!res.ok) {
      // 401/429 (or 402) hand off to the next engine and bench the key via the
      // status carried on the error.
      throw new ProviderError(`You.com search failed: ${res.status} ${res.statusText}`, res.status);
    }
    const data: any = await res.json();
    const results = data?.results;
    // Keyless nests under `web` (plus `news` on some answers); keyed is flat.
    const entries: any[] = Array.isArray(results)
      ? results
      : [...(Array.isArray(results?.web) ? results.web : []), ...(Array.isArray(results?.news) ? results.news : [])];
    if (entries.length === 0) {
      throw new ProviderError(
        results === undefined
          ? 'You.com search response had no results field.'
          : 'You.com search returned no results.',
      );
    }
    const sources = entries
      .slice(0, MAX_RESULTS)
      .map(toSource)
      .filter((s): s is NonNullable<typeof s> => s !== undefined);
    if (sources.length === 0) throw new ProviderError('You.com search returned no parsable results.');
    return { content: '', sources };
  },

  async fetch(url: string, apiKey: string, signal?: AbortSignal): Promise<FetchResult> {
    // Unreachable in the fetch chain because supportsFetch is false; kept for
    // interface completeness and direct callers.
    throw new Error('You.com does not support direct URL fetching/extracting.');
  },
};