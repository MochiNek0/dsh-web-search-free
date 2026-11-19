import { WebSearchProvider, SearchResult, FetchResult, SearchOptions } from '../types.js';
import { ProviderError, googleCountry, googleLanguage, googleTbs, toPublishedAt } from './fields.js';

/**
 * SerpBase answers with a business `status` code inside the HTTP response and
 * uses HTTP 200 for most failures, so `res.ok` alone says nothing. The codes
 * below are the ones the docs define; mapping them onto HTTP semantics lets the
 * fallback loop bench the key for the right length of time — `cooldownFor` only
 * understands HTTP statuses, and the difference between "key is dead" (401),
 * "credits are spent" (402) and "slow down" (429) is exactly what it needs.
 */
const STATUS_HTTP: Record<number, number> = {
  1000: 400, // INVALID_REQUEST
  1001: 401, // UNAUTHORIZED
  1003: 403, // FORBIDDEN — e.g. a paused product
  1004: 404, // NOT_FOUND — unknown route or catalog miss
  1020: 402, // INSUFFICIENT_CREDITS
  1029: 429, // RATE_LIMITED
  1500: 500, // INTERNAL_ERROR
  1502: 502, // UPSTREAM_FAILED
  1503: 503, // SERVICE_UNAVAILABLE
  1504: 504, // UPSTREAM_TIMEOUT
};

/** `{ [name]: value }` when the value is set, `{}` otherwise — for spreading into a request body. */
const optional = (name: string, value: unknown) => (value === undefined ? {} : { [name]: value });

/**
 * Whether a result URL is one of Google's own redirect wrappers
 * (`google.com/goto?url=…` or `/url?q=…`) rather than the page itself.
 * SerpBase unwraps these when it can, but Google rate-limits the unwrapping, so
 * a search that outruns that budget comes back with the wrapper in place. The
 * wrapper still 302s to the real page, so it is passed through rather than
 * dropped — the free `/google/resolve` endpoint converts a batch of them later
 * if a caller cares.
 */
const isGoogleWrapper = (link: string): boolean => /^https?:\/\/www\.google\.[^/]+\/(?:goto|url)\?/.test(link);

/**
 * The page's own URL when either field carries one, otherwise whichever
 * candidate exists (a wrapper is still better than dropping the result).
 */
const pickLink = (primary: unknown, fallback: unknown): string => {
  const candidates = [primary, fallback].filter((v): v is string => typeof v === 'string' && v.length > 0);
  return candidates.find((v) => !isGoogleWrapper(v)) ?? candidates[0] ?? '';
};

export const serpbaseProvider: WebSearchProvider = {
  name: 'serpbase',
  // SerpBase's scrape/crawl products are not callable yet (both are marked
  // "In development · Paused" on its product pages), so this provider is
  // search-only and must stay out of the fetch fallback chain. `fetch` is kept
  // for interface completeness and throws if ever reached directly.
  supportsFetch: false,

  /**
   * SerpBase is a universal search/data API; `POST /google/search` is its
   * Google SERP product. It authenticates with an `X-API-Key` header (a key in
   * the query string is rejected) and takes the query in a JSON body.
   *
   * Results live under `organic[]` with `title` / `url` / `link` / `snippet`.
   * `url` and `link` normally agree; both are Google's `google.com/goto?url=…`
   * wrapper when SerpBase could not unwrap in time (see isGoogleWrapper).
   * `published_at` is a display date ("Apr 14, 2025"), not ISO-8601; like
   * SerpApi's `date` it is passed through verbatim rather than parsed.
   *
   * Two measured limits shape the request:
   * - `num` / `limit` are not parameters of this product (measured: `num: 5`
   *   still returned 8 organic results, `num: 20` returned 5), so the seam's
   *   cap is applied after the fact instead of at the source.
   * - `tbs` is accepted as a plain string (`qdr:d` / `qdr:w` / `qdr:m` /
   *   `qdr:y`): HTTP 200, `status: 0`, still one credit, no rejection — so
   *   `freshness` is forwarded as `tbs`. Whether the product then applies the
   *   window is *unverified*: a measured `qdr:h` search for a topic that only
   *   has old pages still came back with 1995 pages, and the `search_url` the
   *   response echoes contains no `tbs`. Sending it costs nothing and starts
   *   working the day the upstream honours it; the READMEs call it unverified
   *   rather than unsupported.
   */
  async search(query: string, apiKey: string, signal?: AbortSignal, options?: SearchOptions): Promise<SearchResult> {
    const res = await fetch('https://api.serpbase.dev/google/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify({
        q: query,
        ...optional('gl', googleCountry(options?.region)),
        ...optional('hl', googleLanguage(options?.language)),
        // Accepted as a plain `qdr:*` string; whether the upstream honours it
        // is unverified (see the doc comment above), but it is harmless to send.
        ...optional('tbs', googleTbs(options?.freshness)),
        // The product's own budget: with it, SerpBase returns `status: 1504`
        // (not charged) instead of letting our abort cut the request off, so a
        // slow query still hands the turn to the next engine with a clean,
        // unbilled failure.
        timeout: 8,
      }),
      signal,
    });
    if (!res.ok) {
      // A non-2xx here is transport-level (Cloudflare, gateway); the product's
      // own failures come back as 200 + `status`.
      throw new ProviderError(`SerpBase search failed: ${res.status} ${res.statusText}`, res.status);
    }

    const data = await res.json();
    const code = typeof data?.status === 'number' ? data.status : undefined;
    if (code !== 0) {
      // `error` names the cause; `request_id` is the support handle. Keep both
      // in the log line, and keep the business code so a 200-with-error is
      // still visible as such.
      const detail = typeof data?.error === 'string' && data.error.length > 0 ? `: ${data.error}` : '';
      const requestId = typeof data?.request_id === 'string' && data.request_id.length > 0 ? ` (${data.request_id})` : '';
      const httpStatus = code === undefined ? undefined : STATUS_HTTP[code];
      throw new ProviderError(
        `SerpBase search failed: status ${code ?? 'missing'}${detail}${requestId}`,
        httpStatus,
      );
    }

    const entries: any[] = Array.isArray(data?.organic) ? data.organic : [];
    if (entries.length === 0) {
      // `no_results: true` with an empty `organic[]` is a real (charged) answer,
      // not an error — but the chain treats a resolved value as success, so it
      // has to throw for the next engine to get a turn.
      throw new ProviderError('SerpBase search returned no results.');
    }

    const sources = entries
      .map((r: any) => {
        // `url` and `link` normally carry the same string; take whichever one
        // is the real page when only one of them is.
        const url = pickLink(r?.url, r?.link);
        if (!url) return undefined;
        return {
          url,
          title: typeof r?.title === 'string' && r.title.length > 0 ? r.title : url,
          snippet: typeof r?.snippet === 'string' && r.snippet.length > 0 ? r.snippet : undefined,
          // A display string, not ISO; passed through verbatim. Present on some
          // results only — a miss is normal.
          publishedAt: toPublishedAt(r?.published_at, r?.date),
        };
      })
      .filter((s): s is NonNullable<typeof s> => s !== undefined);

    if (sources.length === 0) throw new ProviderError('SerpBase search returned no parsable results.');

    // No `content`: SerpBase also returns an AI overview for some queries, and
    // a synthesized answer must not be handed to the model as a source (the
    // envelope's `content` slot is for the engine's own direct answer, as with
    // Tavily — a Google AI summary is not that).
    return { content: '', sources };
  },

  async fetch(url: string, apiKey: string, signal?: AbortSignal): Promise<FetchResult> {
    // Unreachable in the fetch chain because supportsFetch is false; kept for
    // interface completeness and direct callers.
    throw new Error('SerpBase does not support direct URL fetching/extracting.');
  },
};
