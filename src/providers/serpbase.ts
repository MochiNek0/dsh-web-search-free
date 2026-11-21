import { WebSearchProvider, SearchResult, FetchResult, SearchOptions } from '../types.js';
import { ProviderError, googleCountry, googleLanguage, googleTbs, optional, toPublishedAt } from './fields.js';

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

/** Business status for "you sent something I do not accept" — the cue to retry once without locale. */
const INVALID_REQUEST = 1000;

/**
 * Whether a result URL is one of Google's own redirect wrappers
 * (`google.com/goto?url=…`, `www.google.com/url?q=…`) rather than the page.
 * SerpBase unwraps these when it can, but Google rate-limits the unwrapping, so
 * a search that outruns that budget comes back with the wrapper in place.
 *
 * The `www.` is optional: SerpBase returns both `https://www.google.com/goto?…`
 * and `https://google.com/goto?…` for the same thing.
 */
const isGoogleWrapper = (link: string): boolean => /^https?:\/\/(?:www\.)?google\.[^/]+\/(?:goto|url)\?/i.test(link);

/**
 * The real page behind a Google wrapper, or `undefined` when the wrapper holds
 * no usable target.
 *
 * This is done locally rather than through SerpBase's `/google/resolve`: the
 * wrapper carries the target in its own query string (`?url=` on `/goto`,
 * `?q=` on `/url`), so unwrapping costs nothing and adds no request — and it
 * has to happen here, because the Host half filters and de-duplicates on the
 * URL as given: a result still wrapped as `www.google.com/goto?…` looks like a
 * google.com hit, so `blockedDomains` would miss it, `preferredDomains` would
 * not rank it, and merge mode could not collapse it against the same page from
 * another engine.
 */
const unwrapGoogle = (link: string): string | undefined => {
  if (!isGoogleWrapper(link)) return undefined;
  let wrapper: URL;
  try {
    wrapper = new URL(link);
  } catch {
    return undefined;
  }
  const target = wrapper.searchParams.get('url') ?? wrapper.searchParams.get('q') ?? '';
  if (target.length === 0) return undefined;
  try {
    const url = new URL(target);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
};

/**
 * The page's own URL when either field carries one, otherwise the wrapper
 * unwrapped in place, otherwise whichever candidate exists (a wrapper is still
 * better than dropping the result — it 302s to the real page).
 */
const pickLink = (primary: unknown, fallback: unknown): string => {
  const candidates = [primary, fallback].filter((v): v is string => typeof v === 'string' && v.length > 0);
  const direct = candidates.find((v) => !isGoogleWrapper(v));
  if (direct) return direct;
  for (const candidate of candidates) {
    const unwrapped = unwrapGoogle(candidate);
    if (unwrapped) return unwrapped;
  }
  return candidates[0] ?? '';
};

/** Body of a failed request, for the log line — best effort, never throws. */
const failureDetail = async (res: Response): Promise<string> => {
  try {
    const body = await res.json();
    const message =
      typeof body?.error === 'string' ? body.error
      : typeof body?.message === 'string' ? body.message
      : '';
    const code = typeof body?.status === 'number' ? `status ${body.status}` : '';
    const parts = [code, message].filter((part) => part.length > 0);
    return parts.length > 0 ? `: ${parts.join(' — ')}` : '';
  } catch {
    // non-JSON error body (a gateway HTML page); the status line is enough
    return '';
  }
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
   * Three measured limits shape the request:
   * - `num` / `limit` are not parameters of this product (measured: `num: 5`
   *   still returned 8 organic results, `num: 20` returned 5), so the seam's
   *   `maxResults` is applied to the parsed list instead of at the source.
   * - `tbs` is a documented parameter of this product: `qdr:h` / `qdr:d` /
   *   `qdr:w` / `qdr:m` / `qdr:y` (optionally with a count, e.g. `qdr:m6`),
   *   `cdr:1,cd_min:1/1/2026,cd_max:3/31/2026` for a date range, `sbd:1` for
   *   date sort, `li:1` for verbatim. It is sent to Google unchanged and
   *   billed as the same credit, so `freshness` is forwarded as `tbs`
   *   (<https://serpbase.dev/docs/google_web_search>). A value that is not
   *   `name:value` pairs is refused with `status: 1000`. Nothing downstream
   *   re-filters (`finalizeSources` only trims snippets and applies
   *   `preferredDomains`), so the window is Google's to apply.
   * - `gl` / `hl` are checked against a closed list upstream: an unknown value
   *   (`hl: zh-cn`, `gl: uk`) is answered with `status: 1000`, not with
   *   results. Since the mapping here comes from the user's locale settings,
   *   a rejection retries once without either rather than failing every search
   *   for that user.
   */
  async search(query: string, apiKey: string, signal?: AbortSignal, options?: SearchOptions): Promise<SearchResult> {
    const country = googleCountry(options?.region);
    const language = googleLanguage(options?.language);
    const post = (withLocale: boolean) =>
      fetch('https://api.serpbase.dev/google/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
        },
        body: JSON.stringify({
          q: query,
          ...(withLocale ? optional('gl', country) : {}),
          ...(withLocale ? optional('hl', language) : {}),
          // Carries the freshness window (`qdr:h` / `qdr:d` / `qdr:w` / …), a
          // documented parameter sent to Google unchanged, same credits.
          ...optional('tbs', googleTbs(options?.freshness)),
          // The product's own budget: with it, SerpBase returns `status: 1504`
          // (not charged) instead of letting our abort cut the request off, so a
          // slow query still hands the turn to the next engine with a clean,
          // unbilled failure.
          timeout: 8,
        }),
        signal,
      });

    let res = await post(true);
    if (!res.ok) {
      // A non-2xx here is transport-level (Cloudflare, gateway) — but the body
      // still carries the product's own `status` / `error` when the gateway
      // forwards it, and that is where the difference between "quota spent" and
      // "slow down" lives: without the body text a 429 benches the key for two
      // minutes instead of for a spent balance.
      throw new ProviderError(
        `SerpBase search failed: ${res.status} ${res.statusText}${await failureDetail(res)}`,
        res.status,
      );
    }

    let data = await res.json();
    let code = typeof data?.status === 'number' ? data.status : undefined;
    // An unknown `gl` / `hl` is a `status: 1000` on a 200. Retry once without the
    // locale rather than fail every search for a user whose settings map to a
    // value this product does not accept.
    if (code === INVALID_REQUEST && (country || language)) {
      res = await post(false);
      if (!res.ok) {
        throw new ProviderError(
          `SerpBase search failed: ${res.status} ${res.statusText}${await failureDetail(res)}`,
          res.status,
        );
      }
      data = await res.json();
      code = typeof data?.status === 'number' ? data.status : undefined;
    }
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
      //
      // The trade-off, deliberately kept: a search that genuinely has no hits
      // costs one credit here and hands over, instead of returning an empty
      // answer while the other engines might still have something. SerpBase is
      // last in the default order, so the extra hop only happens for queries
      // nothing else answered either; a user who moves it to the front pays one
      // credit per empty query. Throwing without a status means no cooldown —
      // an empty result is not the key's fault.
      throw new ProviderError('SerpBase search returned no results.');
    }

    const parsed = entries
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

    if (parsed.length === 0) throw new ProviderError('SerpBase search returned no parsable results.');

    // `maxResults` is applied here because the product has no count parameter
    // (see the doc comment): without it a caller asking for 3 sources gets the
    // full page and hands the model 9–10 of them.
    const cap = options?.maxResults;
    const sources =
      typeof cap === 'number' && Number.isFinite(cap) && cap > 0 ? parsed.slice(0, Math.floor(cap)) : parsed;

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
