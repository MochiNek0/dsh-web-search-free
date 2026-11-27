import type { SearchResult, SearchSource } from './types.js'
import { urlIdentity } from './results.js'

/**
 * Post-processing shared by every search strategy. The host owns this pass so
 * fallback/race get the same URL validation, de-duplication and source cap as
 * merge, rather than only the strategy that happens to fuse results itself.
 */
export interface FinalizeOptions {
  query: string;
  freshness?: 'day' | 'week' | 'month' | 'year';
  blocked: readonly string[];
  preferred: readonly string[];
  snippetLength: number;
  maxResults?: number;
}

export const FRESHNESS_MS: Record<NonNullable<FinalizeOptions['freshness']>, number> = {
  day: 86_400_000,
  week: 7 * 86_400_000,
  month: 31 * 86_400_000,
  year: 365 * 86_400_000,
};

const STOP_WORDS = new Set<string>();
for (const word of 'a an and are as at be by for from how in is it of on or that the this to was what when where which who why with'.split(' ')) {
  STOP_WORDS.add(word);
}
for (const word of ['的', '了', '和', '是', '在', '与', '及', '或', '如何', '怎么', '什么']) {
  STOP_WORDS.add(word);
}

function queryTerms(query: string): string[] {
  return [...new Set(
    query.toLowerCase()
      .replace(/site:\S+|filetype:\S+/g, ' ')
      .split(/[^\p{L}\p{N}_+.#-]+/u)
      .filter((term) => term.length > 1 && !STOP_WORDS.has(term))
      .slice(0, 12),
  )]
}

/**
 * Cut a snippet to `max` characters, centred a little before the first query
 * term so the part that made the engine return this page survives the cut.
 */
export function excerptAroundQuery(content: unknown, query: string, max: number): string | undefined {
  if (typeof content !== 'string' || content.trim() === '') return undefined
  // dsh renders each source as one markdown list line (`- [title](url) —
  // snippet`), so a newline would split the entry or forge a fake one.
  const text = content.replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text

  const lower = text.toLowerCase()
  let at = -1
  for (const term of queryTerms(query)) {
    const found = lower.indexOf(term)
    if (found >= 0 && (at < 0 || found < at)) at = found
  }
  const start = Math.max(0, at < 0 ? 0 : at - Math.floor(max * 0.3))
  const end = Math.min(text.length, start + max)
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`
}

function hostOf(raw: string): string | undefined {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    return url.hostname.toLowerCase() || undefined
  } catch {
    return undefined
  }
}

const onDomain = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`)

/**
 * Validate, normalize, de-duplicate, filter and cap the sources returned by
 * any strategy. A dated result outside `freshness` is dropped; an undated
 * result is kept because absence of a date is not evidence that it is old.
 * Order is the engine's (or the merge's), except that preferred domains move
 * to the front: no host-side relevance scoring second-guesses the engines.
 */
export function finalizeSearch(
  result: SearchResult,
  options: FinalizeOptions,
  now = Date.now(),
): SearchResult {
  const max = Math.max(1, Math.floor(options.maxResults ?? 10))
  const cutoff = options.freshness ? now - FRESHNESS_MS[options.freshness] : undefined
  const blocked = options.blocked.map((domain) => domain.toLowerCase())
  const preferred = options.preferred.map((domain) => domain.toLowerCase())
  const seen = new Set<string>()
  const ahead: SearchSource[] = []
  const behind: SearchSource[] = []

  for (const original of result.sources ?? []) {
    const host = hostOf(original.url)
    if (!host) continue
    if (blocked.some((domain) => onDomain(host, domain))) continue
    const id = urlIdentity(original.url)
    if (seen.has(id)) continue
    seen.add(id)

    const publishedMs = original.publishedAt ? Date.parse(original.publishedAt) : NaN
    if (cutoff !== undefined && !Number.isNaN(publishedMs) && publishedMs < cutoff) continue

    const title = original.title?.trim()
    const source: SearchSource = {
      ...original,
      title: title ? title : original.url,
      publishedAt: Number.isNaN(publishedMs) ? undefined : new Date(publishedMs).toISOString(),
      snippet: excerptAroundQuery(original.snippet, options.query, options.snippetLength),
    }
    ;(preferred.some((domain) => onDomain(host, domain)) ? ahead : behind).push(source)
  }

  return {
    content: result.content || '',
    sources: [...ahead, ...behind].slice(0, max),
  }
}
