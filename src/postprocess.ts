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

function relevance(source: SearchSource, terms: readonly string[]): number {
  if (terms.length === 0) return 0
  const title = source.title.toLowerCase()
  const snippet = (source.snippet ?? '').toLowerCase()
  let score = 0
  for (const term of terms) {
    if (title.includes(term)) score += 2
    if (snippet.includes(term)) score += 1
  }
  return score / (terms.length * 3)
}

function excerptAroundQuery(content: unknown, query: string, max: number): string | undefined {
  if (typeof content !== 'string' || content.trim() === '') return undefined
  // Preserve newlines for code/tables/lists; only collapse runs of spaces/tabs.
  const text = content.replace(/[ \t]+/g, ' ').trim()
  if (text.length <= max) return text

  const terms = queryTerms(query)
  const lower = text.toLowerCase()
  let at = -1
  for (const term of terms) {
    const found = lower.indexOf(term)
    if (found >= 0 && (at < 0 || found < at)) at = found
  }
  const start = Math.max(0, at < 0 ? 0 : at - Math.floor(max * 0.3))
  const end = Math.min(text.length, start + max)
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`
}

function validHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname)
  } catch {
    return false
  }
}

function hostOf(raw: string): string | undefined {
  try {
    return new URL(raw).hostname.toLowerCase()
  } catch {
    return undefined
  }
}

function domainRank(url: string, preferred: readonly string[]): number {
  const host = hostOf(url)
  if (!host) return preferred.length + 1
  const index = preferred.findIndex((domain) => host === domain || host.endsWith(`.${domain}`))
  return index < 0 ? preferred.length : index
}

/**
 * Validate, normalize, de-duplicate, filter and rank the sources returned by
 * any strategy. A dated result outside `freshness` is dropped; an undated
 * result is kept because absence of a date is not evidence that it is old.
 */
export function finalizeSearch(
  result: SearchResult,
  options: FinalizeOptions,
  now = Date.now(),
): SearchResult {
  const max = Math.max(1, Math.floor(options.maxResults ?? 10))
  const cutoff = options.freshness ? now - FRESHNESS_MS[options.freshness] : undefined
  const terms = queryTerms(options.query)
  const blocked = options.blocked.map((domain) => domain.toLowerCase())
  const preferred = options.preferred.map((domain) => domain.toLowerCase())
  const seen = new Set<string>()
  const hostCounts = new Map<string, number>()
  const candidates: { source: SearchSource; order: number; score: number }[] = []

  ;(result.sources ?? []).forEach((original, order) => {
    if (!validHttpUrl(original.url)) return
    const host = hostOf(original.url)!
    if (blocked.some((domain) => host === domain || host.endsWith(`.${domain}`))) return
    const id = urlIdentity(original.url)
    if (seen.has(id)) return
    seen.add(id)

    let publishedAt: string | undefined
    try {
      publishedAt = original.publishedAt ? new Date(original.publishedAt).toISOString() : undefined
    } catch {
      publishedAt = undefined
    }
    const publishedMs = publishedAt ? Date.parse(publishedAt) : NaN
    if (cutoff !== undefined && !Number.isNaN(publishedMs) && publishedMs < cutoff) return

    // Empty strings, HTML-only titles and obvious placeholders are not useful
    // titles. Fall back to the URL rather than presenting a blank source.
    const title = original.title?.trim()
    const source: SearchSource = {
      ...original,
      title: title ? title : original.url,
      publishedAt,
      snippet: excerptAroundQuery(original.snippet, options.query, options.snippetLength),
    }
    // Soft quality signals: a usable excerpt and a language consistent with
    // the query help break ties without hiding otherwise relevant results.
    const hasSnippet = Boolean(source.snippet && source.snippet.trim().length > 0)
    const langPenalty = options.query.length > 3 && /[\u4e00-\u9fff]/.test(options.query) && !/[\u4e00-\u9fff]/.test(`${source.title} ${source.snippet ?? ''}`)
      ? 0.15
      : 0
    const relevanceScore = relevance(source, terms)
    const text = `${source.title} ${source.snippet ?? ''}`.toLowerCase()
    const coverage = terms.length > 0 ? terms.filter((term) => text.includes(term)).length / terms.length : 0
    const titleCoverage = terms.length > 0 ? terms.filter((term) => source.title.toLowerCase().includes(term)).length / terms.length : 0
    const bonus = coverage === 1 ? 0.1 : 0
    // Recency is a soft ranking signal once the hard date cutoff above has
    // removed stale pages. A dated recent source should outrank an undated
    // partial match, without hiding useful undated documentation.
    const ageDays = Number.isNaN(publishedMs) ? undefined : Math.max(0, now - publishedMs) / 86_400_000
    const recencyBonus = ageDays === undefined ? 0 : Math.max(0, 0.35 - ageDays * 0.01)
    const seenOnHost = hostCounts.get(host) ?? 0
    const score = relevanceScore + coverage * 0.2 + titleCoverage * 0.2 + bonus + recencyBonus + (hasSnippet ? 0.1 : 0) - langPenalty - seenOnHost * 0.025
    hostCounts.set(host, seenOnHost + 1)
    candidates.push({ source, order, score })
  })

  candidates.sort((a, b) =>
    domainRank(a.source.url, preferred) - domainRank(b.source.url, preferred) ||
    b.score - a.score ||
    a.order - b.order,
  )

  return {
    content: result.content || '',
    sources: candidates.slice(0, max).map((entry) => entry.source),
  }
}
