import { WebSearchProvider, SearchResult, FetchResult, SearchOptions } from '../types.js';
import { ProviderError, assertOk, clampCount, toSnippet, toPublishedAt } from './fields.js';

/**
 * Baidu's `search_recency_filter` has no day window, so `day` asks for the
 * nearest one it does have rather than dropping the filter.
 */
const BAIDU_RECENCY = { day: 'week', week: 'week', month: 'month', year: 'year' } as const;

/**
 * The query limit is 72 units, a CJK or full-width character counting as two.
 * A longer query is cut to fit instead of being rejected outright.
 */
const MAX_QUERY_UNITS = 72;

function fitQuery(query: string): string {
  let units = 0;
  let out = '';
  for (const ch of query.trim()) {
    units += ch.charCodeAt(0) > 0xff ? 2 : 1;
    if (units > MAX_QUERY_UNITS) break;
    out += ch;
  }
  return out;
}

export const baiduProvider: WebSearchProvider = {
  name: 'baidu',
  // Baidu Qianfan's AI search is query-only; it has no URL fetch endpoint.
  supportsFetch: false,

  /**
   * Qianfan "百度搜索" (`/v2/ai_search/web_search`): a chat-shaped body whose
   * last user message is the query, Bearer auth with a key from the Qianfan V2
   * console. Results are `references[]` with `title` / `url` / `content` /
   * `date`. Errors can arrive on a 200 as `{ code, message }`.
   *
   * Region and language are not sent: the index is Chinese web only.
   */
  async search(query: string, apiKey: string, signal?: AbortSignal, options?: SearchOptions): Promise<SearchResult> {
    const res = await fetch('https://qianfan.baidubce.com/v2/ai_search/web_search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: fitQuery(query) }],
        search_source: 'baidu_search_v2',
        // `top_k` accepts up to 50.
        resource_type_filter: [{ type: 'web', top_k: clampCount(options?.maxResults, 50) ?? 10 }],
        ...(options?.freshness ? { search_recency_filter: BAIDU_RECENCY[options.freshness] } : {}),
      }),
      signal,
    });
    assertOk(res, 'Baidu search');
    const data = await res.json();
    if (data?.code !== undefined && data.code !== 0 && data.code !== '0') {
      const msg = typeof data?.message === 'string' && data.message.length > 0 ? data.message : `code=${data.code}`;
      throw new ProviderError(`Baidu search failed: ${msg}`);
    }
    const entries: any[] = Array.isArray(data?.references) ? data.references : [];
    const sources = entries
      .filter((r: any) => typeof r?.url === 'string' && r.url.length > 0)
      .map((r: any) => ({
        url: r.url,
        title: typeof r.title === 'string' && r.title.length > 0 ? r.title : r.url,
        snippet: toSnippet(r.content),
        // `date` is a display string ("2025-04-27 18:02:00"), passed through
        // verbatim like SerpApi's.
        publishedAt: toPublishedAt(r.date),
      }));
    if (sources.length === 0) throw new ProviderError('Baidu search returned no results.');
    return { content: '', sources };
  },

  async fetch(url: string, apiKey: string, signal?: AbortSignal): Promise<FetchResult> {
    // Unreachable in the fetch chain because supportsFetch is false.
    throw new Error('Baidu search does not support direct URL fetching/scraping.');
  },
};
