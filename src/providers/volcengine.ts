import { WebSearchProvider, SearchResult, FetchResult, SearchOptions } from '../types.js';
import { ProviderError, assertOk, clampCount, toSnippet, toPublishedAt } from './fields.js';

const VOLC_TIME_RANGE = { day: 'OneDay', week: 'OneWeek', month: 'OneMonth', year: 'OneYear' } as const;

/** Longer queries are truncated by the API anyway; cutting here keeps it deliberate. */
const MAX_QUERY_CHARS = 100;

/**
 * Error codes that arrive on a 200, mapped to the HTTP status that benches the
 * key for the right time (see `cooldownFor`): a bad key, a spent free tier, or
 * a rate limit. Anything else is left transient.
 */
const VOLC_ERROR_STATUS: Record<string, number> = {
  '10403': 401, // account or permission problem — usually an Ark key instead of a web-search one
  '700901': 401, // invalid api key
  '100013': 401, // sub-account lacks TorchlightApiFullAccess
  '10406': 402, // free quota exhausted
  '10407': 402, // no free-tier policy available
  '700429': 429, // free-tier rate limit
};

const stripTags = (value: unknown) => (typeof value === 'string' ? value.replace(/<[^>]+>/g, '') : value);

export const volcengineProvider: WebSearchProvider = {
  name: 'volcengine',
  // Volcengine web search is query-only; it has no URL fetch endpoint.
  supportsFetch: false,

  /**
   * Volcengine 联网搜索 / 豆包搜索 API, API-key flavour: Bearer auth with a key
   * from the web-search console (an Ark model key is NOT accepted). Results
   * are `Result.WebResults[]` with `Title` / `Url` / `Summary` / `Snippet` /
   * `PublishTime`; failures come back as `ResponseMetadata.Error` on a 200.
   *
   * Region and language are not sent: the index is Chinese web only.
   */
  async search(query: string, apiKey: string, signal?: AbortSignal, options?: SearchOptions): Promise<SearchResult> {
    const res = await fetch('https://open.feedcoopapi.com/search_api/web_search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'X-Traffic-Tag': 'dsh-web-search-free',
      },
      body: JSON.stringify({
        Query: query.trim().slice(0, MAX_QUERY_CHARS),
        SearchType: 'web',
        // `Count` accepts up to 50 for web results.
        Count: clampCount(options?.maxResults, 50) ?? 10,
        NeedSummary: true,
        ...(options?.freshness ? { TimeRange: VOLC_TIME_RANGE[options.freshness] } : {}),
      }),
      signal,
    });
    assertOk(res, 'Volcengine search');
    const data = await res.json();
    const error = data?.ResponseMetadata?.Error;
    if (error && (error.Code || error.CodeN || error.Message)) {
      const code = String(error.CodeN ?? error.Code ?? '');
      throw new ProviderError(
        `Volcengine search failed: ${code ? `${code} ` : ''}${error.Message ?? 'unknown error'}`,
        VOLC_ERROR_STATUS[code],
      );
    }
    const entries: any[] = Array.isArray(data?.Result?.WebResults) ? data.Result.WebResults : [];
    const sources = entries
      .filter((r: any) => typeof r?.Url === 'string' && r.Url.length > 0)
      .map((r: any) => ({
        url: r.Url,
        title: (stripTags(r.Title) as string) || r.Url,
        // `Summary` is the long LLM-ready excerpt NeedSummary asks for;
        // `Snippet` is the short SERP one, kept as the fallback.
        snippet: toSnippet(stripTags(r.Summary)) ?? toSnippet(stripTags(r.Snippet)),
        publishedAt: toPublishedAt(r.PublishTime),
      }));
    if (sources.length === 0) throw new ProviderError('Volcengine search returned no results.');
    return { content: '', sources };
  },

  async fetch(url: string, apiKey: string, signal?: AbortSignal): Promise<FetchResult> {
    // Unreachable in the fetch chain because supportsFetch is false.
    throw new Error('Volcengine search does not support direct URL fetching/scraping.');
  },
};
