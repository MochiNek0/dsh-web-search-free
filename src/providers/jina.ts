import { WebSearchProvider, SearchResult, FetchResult } from '../types.js';
import { toSnippet, toPublishedAt } from './fields.js';

export const jinaProvider: WebSearchProvider = {
  name: 'jina',
  supportsFetch: true,

  /**
   * s.jina.ai returns ready-to-use markdown by default, which gave the model a
   * wall of text with no structured `Sources:` list. Requesting JSON
   * (`Accept: application/json`) instead returns one entry per result with
   * `url`/`title`/`description`/`content`/`publishedTime`, which we project
   * into structured sources so Jina behaves like the other providers.
   */
  async search(query: string, apiKey: string, signal?: AbortSignal): Promise<SearchResult> {
    const res = await fetch(`https://s.jina.ai/${encodeURIComponent(query)}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
      },
      signal,
    });
    if (!res.ok) throw new Error(`Jina search failed: ${res.status} ${res.statusText}`);

    // s.jina.ai JSON mode has shipped both as a bare array and wrapped as
    // { code, status, data: [...] }; accept either so a future API revision
    // does not silently empty the source list.
    const data = await res.json();
    const entries: any[] = Array.isArray(data)
      ? data
      : Array.isArray(data?.data)
        ? data.data
        : Array.isArray(data?.results)
          ? data.results
          : [];

    const sources = entries
      .map((entry: any) => {
        const url = typeof entry?.url === 'string' ? entry.url : '';
        if (!url) return undefined;
        // `description` is the search engine's own excerpt; `content` is the
        // whole crawled page, kept only as a fallback for entries without one.
        const snippet = toSnippet(entry?.description) ?? toSnippet(entry?.content);
        // `publishedTime` is what s.jina.ai returns today; the others are
        // earlier API revisions' names for the same thing.
        return {
          url,
          title: typeof entry?.title === 'string' && entry.title.length > 0 ? entry.title : url,
          snippet,
          publishedAt: toPublishedAt(entry?.publishedTime, entry?.publishDate, entry?.publishedAt, entry?.timestamp),
        };
      })
      .filter((source): source is NonNullable<typeof source> => source !== undefined);

    // Throw rather than return an empty result: an empty-but-successful return
    // ends the fallback chain in `apply`, so an API revision that breaks the
    // shape above would silently degrade every search to "No results found."
    // instead of moving on to the next configured provider.
    if (sources.length === 0) throw new Error('Jina search returned no parsable results.');

    return { content: '', sources };
  },

  async fetch(url: string, apiKey: string, signal?: AbortSignal): Promise<FetchResult> {
    const res = await fetch(`https://r.jina.ai/${encodeURIComponent(url)}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'text/plain',
      },
      signal,
    });
    if (!res.ok) throw new Error(`Jina fetch failed: ${res.status} ${res.statusText}`);
    const text = await res.text();
    // Jina Reader returns the full decoded page unless an `x-max-tokens` budget
    // is requested, which we never set, so there is no provider-side cap to
    // report. The official seam still flags truncation if its own
    // `fetchMaxOutputChars` cap bites.
    return { content: text, truncated: false };
  },
};
