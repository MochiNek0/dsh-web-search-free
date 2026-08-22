export interface SearchSource {
  url: string;
  title: string;
  snippet?: string;
  /** Publication/crawl timestamp as a provider-supplied ISO-8601 string. */
  publishedAt?: string;
}

export interface SearchResult {
  content?: string;
  sources?: SearchSource[];
}

/**
 * Normalized fetch outcome from a single provider. `truncated` is the
 * provider-side truth of whether *it* capped the decoded body — the official
 * `dsh-tool-web` seam ORs this with its own `fetchMaxOutputChars` cap and any
 * source-character cut, so a hard `false` here would mask real provider
 * truncation. Each provider reports what it can determine from its API.
 */
export interface FetchResult {
  content: string;
  truncated: boolean;
}

export interface WebSearchProvider {
  name: string;
  /**
   * Whether this provider can fetch an arbitrary URL. Brave is search-only, so
   * its `fetch` always throws; marking `supportsFetch: false` keeps it in the
   * search fallback chain while excluding it from the fetch chain so the fetch
   * path never wastes a round on a known-dead node.
   */
  supportsFetch: boolean;
  search(query: string, apiKey: string, signal?: AbortSignal): Promise<SearchResult | string>;
  fetch(url: string, apiKey: string, signal?: AbortSignal): Promise<FetchResult>;
}
