import { WebSearchProvider, SearchResult, FetchResult, SearchOptions } from '../types.js';
import { ProviderError, toSnippet, toPublishedAt } from './fields.js';

/**
 * The search URL for one instance. The "key" field holds instance base URLs,
 * one per line; a pasted `/search` path or trailing slash is tolerated.
 */
function searchUrl(instance: string): URL {
  let base: URL;
  try {
    base = new URL(instance.trim());
  } catch {
    throw new ProviderError(`SearXNG instance "${instance}" is not a valid URL.`);
  }
  if (base.protocol !== 'https:' && base.protocol !== 'http:') {
    throw new ProviderError(`SearXNG instance "${instance}" must be an http(s) URL.`);
  }
  base.pathname = `${base.pathname.replace(/\/+$/, '').replace(/\/search$/, '')}/search`;
  base.search = '';
  base.hash = '';
  return base;
}

export const searxngProvider: WebSearchProvider = {
  name: 'searxng',
  // A metasearch engine: it returns other engines' results, never page bodies.
  supportsFetch: false,

  /**
   * A self-hosted (or trusted) SearXNG instance through its JSON API:
   * `GET /search?q=…&format=json`. Free and keyless — the "key" is the
   * instance URL, so rotation walks several instances in order.
   *
   * The JSON format is off by default: the instance must list `json` under
   * `search.formats` in its settings.yml, or it answers 403. No result-count
   * parameter exists (one page is ~10 results); the seam truncates anyway.
   */
  async search(query: string, instance: string, signal?: AbortSignal, options?: SearchOptions): Promise<SearchResult> {
    const url = searchUrl(instance);
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'json');
    // SearXNG takes BCP 47 tags as-is (`zh-CN`, `en`) and the same four windows.
    if (options?.language) url.searchParams.set('language', options.language);
    if (options?.freshness) url.searchParams.set('time_range', options.freshness);
    const res = await fetch(url, { headers: { 'Accept': 'application/json' }, signal });
    if (res.status === 403) {
      throw new ProviderError(
        'SearXNG search failed: 403 Forbidden — the instance does not serve JSON; add "json" to search.formats in its settings.yml.',
        403,
      );
    }
    if (!res.ok) throw new ProviderError(`SearXNG search failed: ${res.status} ${res.statusText}`, res.status);
    const data = await res.json();
    const entries: any[] = Array.isArray(data?.results) ? data.results : [];
    const sources = entries
      .filter((r: any) => typeof r?.url === 'string' && r.url.length > 0)
      .map((r: any) => ({
        url: r.url,
        title: typeof r.title === 'string' && r.title.length > 0 ? r.title : r.url,
        snippet: toSnippet(r.content),
        // ISO-8601 when the underlying engine supplied a date, else null.
        publishedAt: toPublishedAt(r.publishedDate),
      }));
    if (sources.length === 0) throw new ProviderError('SearXNG search returned no results.');
    return { content: '', sources };
  },

  async fetch(url: string, instance: string, signal?: AbortSignal): Promise<FetchResult> {
    // Unreachable in the fetch chain because supportsFetch is false.
    throw new Error('SearXNG does not support direct URL fetching/scraping.');
  },
};
