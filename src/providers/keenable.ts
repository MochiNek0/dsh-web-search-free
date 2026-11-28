import { WebSearchProvider, SearchResult, FetchResult, SearchOptions } from '../types.js';
import { ProviderError, SNIPPET_MAX_CHARS, clampCount, freshnessSince, toSnippet, toPublishedAt } from './fields.js';

/** Sent with every request so Keenable can tell this plugin's traffic apart. */
const APP_TITLE = 'dsh-web-search-free';

/**
 * Cap requested per page from `/v1/fetch`, the same value the Exa provider
 * uses (`dsh-tool-web`'s `DEFAULT_FETCH_MAX_OUTPUT_CHARS`). Keenable reports
 * its own `truncated` flag when a page ran over it.
 */
const FETCH_MAX_CHARACTERS = 200000;

/** `{ [name]: value }` when the value is set, `{}` otherwise — for spreading into a request body. */
const optional = (name: string, value: unknown) => (value === undefined ? {} : { [name]: value });

/**
 * Keenable errors are `{ error, message, code, retryable }` with a matching
 * HTTP status (401 invalid key, 402 out of funds, 429 rate limited). Put the
 * message in the log line when the body is parsable.
 */
async function failure(res: Response, label: string): Promise<ProviderError> {
  let detail = '';
  try {
    const body = await res.json();
    if (typeof body?.message === 'string' && body.message.length > 0) detail = `: ${body.message}`;
  } catch {
    // non-JSON error body; the status line is enough
  }
  return new ProviderError(`${label} failed: ${res.status} ${res.statusText}${detail}`, res.status);
}

export const keenableProvider: WebSearchProvider = {
  name: 'keenable',
  supportsFetch: true,

  /**
   * `POST /v1/search` with an `X-API-Key` header. Results are
   * `{ title, url, snippet, published_at?, acquired_at? }`; `description` is
   * still in the response but always empty, so it is not read. Region and
   * language have no equivalent and are ignored. `searchDepth` is the Tavily
   * setting, so Keenable keeps its own default mode (`pro`).
   */
  async search(query: string, apiKey: string, signal?: AbortSignal, options?: SearchOptions): Promise<SearchResult> {
    const res = await fetch('https://api.keenable.ai/v1/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
        'X-Keenable-Title': APP_TITLE,
      },
      body: JSON.stringify({
        query,
        ...optional('max_results', clampCount(options?.maxResults, 50)),
        // Snippets otherwise run to several thousand characters; the host trims to
        // the user's snippet length anyway, so ask for no more than its upper bound.
        snippet_max_length: SNIPPET_MAX_CHARS,
        ...optional('published_after', freshnessSince(options?.freshness)),
        ...optional('exclude_domains', options?.excludeDomains?.length ? options.excludeDomains.slice(0, 1000) : undefined),
      }),
      signal,
    });
    if (!res.ok) throw await failure(res, 'Keenable search');
    const data = await res.json();
    const entries: any[] = Array.isArray(data?.results) ? data.results : [];

    const sources = entries
      .map((r: any) => {
        const url = typeof r?.url === 'string' ? r.url : '';
        if (!url) return undefined;
        return {
          url,
          title: typeof r?.title === 'string' && r.title.length > 0 ? r.title : url,
          snippet: toSnippet(r?.snippet),
          publishedAt: toPublishedAt(r?.published_at),
        };
      })
      .filter((s): s is NonNullable<typeof s> => s !== undefined);

    if (sources.length === 0) throw new ProviderError('Keenable search returned no results.');
    return { content: '', sources };
  },

  /**
   * `POST /v1/fetch` returns one entry per URL. A page Keenable could not read
   * still comes back in a 200, as `{ url, error }`, so that case is a failure
   * here too and hands off to the next engine.
   */
  async fetch(url: string, apiKey: string, signal?: AbortSignal): Promise<FetchResult> {
    const res = await fetch('https://api.keenable.ai/v1/fetch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
        'X-Keenable-Title': APP_TITLE,
      },
      body: JSON.stringify({ urls: [url], content: { max_chars: FETCH_MAX_CHARACTERS } }),
      signal,
    });
    if (!res.ok) throw await failure(res, 'Keenable fetch');
    const data = await res.json();
    const page = data?.results?.[0];
    if (page?.error) {
      const message = typeof page.error.message === 'string' ? page.error.message : 'page could not be read';
      const status = typeof page.error.status === 'number' ? page.error.status : undefined;
      throw new ProviderError(`Keenable fetch failed for this URL: ${message}`, status);
    }
    const content: unknown = page?.content;
    if (typeof content !== 'string' || content.trim() === '') {
      throw new ProviderError('Keenable fetch returned no content.');
    }
    return { content, truncated: page?.truncated === true };
  },
};
