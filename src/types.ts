export interface WebSearchProvider {
  name: string;
  search(query: string, apiKey: string): Promise<string>;
  fetch(url: string, apiKey: string): Promise<string>;
}
