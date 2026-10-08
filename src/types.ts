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

/** Per-call search options forwarded from the seam's `WebSearchRequest`. */
export interface SearchOptions {
  /**
   * The seam's source cap. Providers whose API has a result-count control
   * apply it at the request layer to save quota and latency; the seam
   * truncates to it regardless, so ignoring it is never wrong.
   */
  maxResults?: number;
  /**
   * The options below come from the user's settings, already resolved: an
   * absent value means "engine default". Each provider maps what its API
   * supports and ignores the rest — none of them may fail a search because an
   * option has no equivalent on their side.
   */
  /** ISO 3166 alpha-2 country code, upper case (`CN`, `US`). */
  region?: string;
  /** BCP 47 language tag from the settings list (`zh-CN`, `zh-TW`, `en`, `ja`, `ko`). */
  language?: string;
  /** Recency window. */
  freshness?: 'day' | 'week' | 'month' | 'year';
  /**
   * Domains the user blocked. The Host half filters them out of every result
   * regardless; a provider that can exclude them at the source should, so
   * they do not use up result slots.
   */
  excludeDomains?: string[];
  /** Search depth for engines that offer one (Tavily). */
  searchDepth?: 'basic' | 'advanced';
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
  /**
   * Run one search. An empty result set must THROW rather than resolve: the
   * fallback chain treats any resolved value as success and stops there, so
   * an engine that found nothing would otherwise hide every engine after it.
   */
  search(query: string, apiKey: string, signal?: AbortSignal, options?: SearchOptions): Promise<SearchResult>;
  /**
   * Fetch one URL. Likewise, a fetch that produced no content must throw so
   * the next engine gets a turn, instead of handing the model a placeholder.
   */
  fetch(url: string, apiKey: string, signal?: AbortSignal): Promise<FetchResult>;
}
