import { WebSearchProvider, SearchResult, FetchResult, SearchOptions } from '../types.js';
import { ProviderError, assertOk, clampCount, toPublishedAt } from './fields.js';

/**
 * Brave validates `country` and `search_lang` against fixed enums and answers
 * an unknown value with 422, so only values from those enums are ever sent:
 * Singapore has no Brave country and simply falls back to Brave's default.
 */
const BRAVE_COUNTRIES = new Set(['CN', 'HK', 'TW', 'JP', 'KR', 'US', 'GB']);
const BRAVE_SEARCH_LANG: Record<string, string> = {
  'zh-CN': 'zh-hans',
  'zh-TW': 'zh-hant',
  en: 'en',
  ja: 'ja',
  ko: 'ko',
};
const BRAVE_FRESHNESS = { day: 'pd', week: 'pw', month: 'pm', year: 'py' } as const;

export const braveProvider: WebSearchProvider = {
  name: 'brave',
  // Brave Search API is query-only; it has no URL fetch/scrape endpoint, so it
  // must stay out of the fetch fallback chain. `fetch` is kept for interface
  // completeness and throws if ever reached directly.
  supportsFetch: false,
  async search(query: string, apiKey: string, signal?: AbortSignal, options?: SearchOptions): Promise<SearchResult> {
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', query);
    // Brave's `count` accepts 1-20; omitted keeps its default of 20.
    const count = clampCount(options?.maxResults, 20);
    if (count !== undefined) url.searchParams.set('count', String(count));
    if (options?.region && BRAVE_COUNTRIES.has(options.region)) url.searchParams.set('country', options.region);
    const searchLang = options?.language ? BRAVE_SEARCH_LANG[options.language] : undefined;
    if (searchLang) url.searchParams.set('search_lang', searchLang);
    if (options?.freshness) url.searchParams.set('freshness', BRAVE_FRESHNESS[options.freshness]);
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'X-Subscription-Token': apiKey
      },
      signal,
    });
    assertOk(res, 'Brave search');
    const data = await res.json();
    if (data.web && data.web.results && data.web.results.length > 0) {
      return {
        content: '',
        sources: data.web.results.map((r: any) => ({
          url: r.url,
          title: r.title,
          snippet: r.description,
          // `page_age` is Brave's ISO-8601 timestamp. It also returns `age`
          // ("1 week ago"), deliberately unused: `publishedAt` is contracted as
          // a date, and the renderer prints it verbatim.
          publishedAt: toPublishedAt(r.page_age)
        }))
      };
    }
    throw new ProviderError('Brave search returned no results.');
  },
  
  async fetch(url: string, apiKey: string, signal?: AbortSignal): Promise<FetchResult> {
    // Unreachable in the fetch chain because supportsFetch is false; kept for
    // interface completeness and direct callers.
    throw new Error('Brave Search does not support direct URL fetching/scraping.');
  }
};
