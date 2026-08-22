/**
 * Trim a provider-supplied content blob down to a snippet suitable for the
 * `sources[]` list. The official `web_search` renderer appends every snippet
 * after its source URL verbatim, so a provider that hands back full page text
 * (Exa's `text`, Firecrawl's `markdown`, Jina's `content`) would put whole
 * pages into the model's context for a single search. A short excerpt is
 * enough for the model to pick a result and `web_fetch` it.
 */
export function toSnippet(content: unknown, max = 300): string | undefined {
  if (typeof content !== 'string' || content.length === 0) return undefined;
  const text = content.replace(/\s+/g, ' ').trim();
  if (text.length === 0) return undefined;
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

/**
 * Pick the first non-empty string from a provider's candidate date fields, for
 * `SearchSource.publishedAt`. Every backend names it differently and most omit
 * it for results whose date they could not determine, so a miss is normal and
 * returns `undefined` — the seam drops absent optional fields, and the official
 * renderer simply prints no `(date)` for that source.
 *
 * Non-string values are skipped rather than coerced: a raw epoch number would
 * render as `(1787372366790)`.
 */
export function toPublishedAt(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}
