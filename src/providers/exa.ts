import { WebSearchProvider, SearchResult, FetchResult } from '../types.js';
import { toSnippet, toPublishedAt } from './fields.js';

/**
 * Cap requested from Exa's `/contents` endpoint, mirroring `dsh-tool-web`'s
 * `DEFAULT_FETCH_MAX_OUTPUT_CHARS`. A returned body of exactly this length is
 * read as truncated — the API reports no flag of its own.
 */
const FETCH_MAX_CHARACTERS = 200000;

/** Per-result text requested for search, sized to survive `toSnippet`'s 300-char cut. */
const SEARCH_SNIPPET_CHARACTERS = 1000;

export const exaProvider: WebSearchProvider = {
  name: 'exa',
  supportsFetch: true,
  async search(query: string, apiKey: string, signal?: AbortSignal): Promise<SearchResult | string> {
    const res = await fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey
      },
      body: JSON.stringify({
        query: query,
        contents: {
          // Only a snippet survives `toSnippet` below, so asking for the full
          // body per result would download (and bill) ~100x what is used.
          text: { maxCharacters: SEARCH_SNIPPET_CHARACTERS }
        }
      }),
      signal,
    });
    if (!res.ok) throw new Error(`Exa search failed: ${res.status} ${res.statusText}`);
    const data = await res.json();
    if (data.results && data.results.length > 0) {
      return {
        content: '',
        sources: data.results.map((r: any) => ({
          url: r.url,
          title: r.title,
          snippet: toSnippet(r.text),
          // Present on the results Exa could date (roughly half in practice),
          // absent on the rest. ISO-8601.
          publishedAt: toPublishedAt(r.publishedDate)
        }))
      };
    }
    return 'No results found.';
  },
  
  async fetch(url: string, apiKey: string, signal?: AbortSignal): Promise<FetchResult> {
    const res = await fetch('https://api.exa.ai/contents', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey
      },
      body: JSON.stringify({
        urls: [url],
        // `text: true` returns the whole extracted body, with no flag saying
        // whether Exa itself cut it. Pinning `maxCharacters` makes the cap
        // deterministic so truncation is inferable from the returned length.
        // The value matches `dsh-tool-web`'s own `fetchMaxOutputChars` default,
        // so this cap never bites before the seam's would.
        text: { maxCharacters: FETCH_MAX_CHARACTERS }
      }),
      signal,
    });
    if (!res.ok) throw new Error(`Exa fetch failed: ${res.status} ${res.statusText}`);
    const data = await res.json();
    if (data.results && data.results.length > 0) {
      const text: string = data.results[0].text || '';
      return {
        content: text || 'No content found.',
        truncated: text.length >= FETCH_MAX_CHARACTERS,
      };
    }
    return { content: 'No results found.', truncated: false };
  }
};
