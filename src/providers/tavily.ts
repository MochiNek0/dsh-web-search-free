import { WebSearchProvider, SearchResult, FetchResult, SearchOptions } from '../types.js';
import { ProviderError, assertOk, clampCount, isParamRejection, toSnippet, toPublishedAt } from './fields.js';

/**
 * Tavily's `country` takes a lower-case English country name, not an ISO code,
 * and only applies to `topic: general` — the topic this provider always uses.
 */
const TAVILY_COUNTRY: Record<string, string> = {
  CN: 'china',
  HK: 'hong kong',
  TW: 'taiwan',
  SG: 'singapore',
  JP: 'japan',
  KR: 'south korea',
  US: 'united states',
  GB: 'united kingdom',
};

export const tavilyProvider: WebSearchProvider = {
  name: 'tavily',
  supportsFetch: true,
  async search(query: string, apiKey: string, signal?: AbortSignal, options?: SearchOptions): Promise<SearchResult> {
    // Tavily's `max_results` accepts 0-20; omitted keeps its default.
    const maxResults = clampCount(options?.maxResults, 20);
    const country = options?.region ? TAVILY_COUNTRY[options.region] : undefined;
    const exclude = options?.excludeDomains?.slice(0, 150) ?? [];
    const post = (withCountry: boolean) =>
      fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: apiKey,
          query: query,
          search_depth: options?.searchDepth === 'advanced' ? 'advanced' : 'basic',
          include_answer: true,
          ...(maxResults !== undefined ? { max_results: maxResults } : {}),
          ...(options?.freshness ? { time_range: options.freshness } : {}),
          ...(exclude.length > 0 ? { exclude_domains: exclude } : {}),
          ...(withCountry && country ? { country } : {}),
        }),
        signal,
      });
    let res = await post(true);
    // The country enum is documented only in part; a name it does not know
    // must cost the region, not the whole search.
    if (country && isParamRejection(res)) res = await post(false);
    assertOk(res, 'Tavily search');
    const data = await res.json();
    const entries: any[] = Array.isArray(data?.results) ? data.results : [];
    if (entries.length === 0) throw new ProviderError('Tavily search returned no results.');

    return {
      content: data.answer || '',
      sources: entries.map((r: any) => ({
        url: r.url,
        title: r.title,
        // Tavily's `content` is already an excerpt, but its length varies a lot
        // between results; trimming keeps it in line with the other engines.
        snippet: toSnippet(r.content),
        // Tavily returns `published_date` only for `topic: 'news'`; this stays a
        // general web search, so expect it to be absent. Read anyway — it costs
        // nothing and lands automatically if the topic ever changes.
        publishedAt: toPublishedAt(r.published_date)
      }))
    };
  },

  async fetch(url: string, apiKey: string, signal?: AbortSignal): Promise<FetchResult> {
    const res = await fetch('https://api.tavily.com/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        urls: [url],
      }),
      signal,
    });
    assertOk(res, 'Tavily extract');
    const data = await res.json();
    const content = data?.results?.[0]?.raw_content;
    if (typeof content !== 'string' || content.trim() === '') {
      // A URL Tavily could not extract lands in `failed_results`, not as an
      // HTTP error — surface its reason so the next engine gets a turn.
      const reason = data?.failed_results?.[0]?.error;
      throw new ProviderError(`Tavily extract returned no content${typeof reason === 'string' ? `: ${reason}` : '.'}`);
    }
    // Tavily's /extract endpoint returns the full decoded `raw_content` with
    // no documented size cap, so there is no provider-side truncation to
    // report; the official seam still flags its own output-cap cut.
    return { content, truncated: false };
  }
};
