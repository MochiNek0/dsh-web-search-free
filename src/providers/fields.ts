/**
 * A provider failure carrying the HTTP status when there was one. The fallback
 * loop reads `status` to decide how long to bench the key: an auth or quota
 * failure will keep failing for a while, a network blip or 5xx will not.
 */
export class ProviderError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'ProviderError';
  }
}

/** Throw a {@link ProviderError} for a non-2xx response, labelled with the operation. */
export function assertOk(res: Response, label: string): void {
  if (!res.ok) throw new ProviderError(`${label} failed: ${res.status} ${res.statusText}`, res.status);
}

/**
 * Clamp the seam's `maxResults` to what a provider's count parameter accepts.
 * Returns `undefined` when the seam set no bound, so the caller can omit the
 * parameter and keep the provider's own default.
 */
export function clampCount(maxResults: number | undefined, max: number): number | undefined {
  if (typeof maxResults !== 'number' || !Number.isFinite(maxResults) || maxResults <= 0) return undefined;
  return Math.min(Math.floor(maxResults), max);
}

type Freshness = 'day' | 'week' | 'month' | 'year';

/** Window length per freshness setting, for engines that take a start date or minutes. */
const FRESHNESS_DAYS: Record<Freshness, number> = { day: 1, week: 7, month: 31, year: 365 };

/** ISO-8601 instant `freshness` reaches back to, or `undefined` for no limit. */
export function freshnessSince(freshness: Freshness | undefined, now = Date.now()): string | undefined {
  return freshness ? new Date(now - FRESHNESS_DAYS[freshness] * 86_400_000).toISOString() : undefined;
}

/** The same window in minutes (TinyFish's `recency_minutes`). */
export function freshnessMinutes(freshness: Freshness | undefined): number | undefined {
  return freshness ? FRESHNESS_DAYS[freshness] * 24 * 60 : undefined;
}

/** Google's `tbs` recency filter, as SerpApi, Serping API and Firecrawl pass it through. */
export function googleTbs(freshness: Freshness | undefined): string | undefined {
  return freshness ? `qdr:${freshness[0]}` : undefined;
}

/**
 * Google's `gl`: lower-case ISO 3166 alpha-2, except the United Kingdom,
 * which Google spells `uk`.
 */
export function googleCountry(region: string | undefined): string | undefined {
  if (!region) return undefined;
  return region === 'GB' ? 'uk' : region.toLowerCase();
}

/** Google's `hl`: Chinese keeps its script region (`zh-cn` / `zh-tw`), the rest are bare codes. */
export function googleLanguage(language: string | undefined): string | undefined {
  return language?.toLowerCase();
}

/**
 * Whether a response is the API rejecting a parameter value — the cue for an
 * engine whose locale mapping is not fully documented to retry once without
 * it, rather than fail every search for users who set a region or language.
 */
export function isParamRejection(res: Response): boolean {
  return res.status === 400 || res.status === 422;
}

/**
 * Upper bound for a provider-side snippet: the top of the user's
 * `snippetLength` range. The Host half trims every source again to the
 * configured length, so providers only need to keep within this.
 */
export const SNIPPET_MAX_CHARS = 1000;

/**
 * Trim a provider-supplied content blob down to a snippet suitable for the
 * `sources[]` list. The official `web_search` renderer appends every snippet
 * after its source URL verbatim, so a provider that hands back full page text
 * (Exa's `text`, Firecrawl's `markdown`, Jina's `content`) would put whole
 * pages into the model's context for a single search. A short excerpt is
 * enough for the model to pick a result and `web_fetch` it.
 */
export function toSnippet(content: unknown, max = SNIPPET_MAX_CHARS): string | undefined {
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
