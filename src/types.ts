export interface SearchSource {
  url: string;
  title: string;
  snippet?: string;
}

export interface SearchResult {
  content?: string;
  sources?: SearchSource[];
}

export interface WebSearchProvider {
  name: string;
  search(query: string, apiKey: string, signal?: AbortSignal): Promise<SearchResult | string>;
  fetch(url: string, apiKey: string, signal?: AbortSignal): Promise<string>;
}
