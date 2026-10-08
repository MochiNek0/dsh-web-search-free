import { SearchResult, SearchSource } from './types.js'
import { toSnippet } from './providers/fields.js'

/**
 * Tracking parameters stripped before two URLs are compared. Engines append
 * their own (`utm_*` from SERP redirects, `spm` on Alibaba-family sites), so
 * the same page found by two engines would otherwise count as two results.
 */
const TRACKING_PARAM = /^(utm_\w+|gclid|fbclid|msclkid|spm|ref|ref_src|from)$/i

/**
 * Identity of a result page for de-duplication: scheme, `www.`, fragment,
 * tracking parameters and a trailing slash do not make a different page.
 * Unparseable URLs compare by their trimmed text.
 */
export function urlIdentity(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return raw.trim()
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  for (const name of [...url.searchParams.keys()]) {
    if (TRACKING_PARAM.test(name)) url.searchParams.delete(name)
  }
  url.searchParams.sort()
  const query = url.searchParams.toString()
  const path = url.pathname.replace(/\/+$/, '')
  return `${host}${url.port ? `:${url.port}` : ''}${path}${query ? `?${query}` : ''}`
}

/**
 * Parse a user-entered domain list: one per line (commas and spaces also
 * split), tolerant of pasted URLs and `*.` wildcards — `https://www.Foo.com/x`
 * and `*.foo.com` both become `foo.com`.
 */
export function parseDomains(raw: unknown): string[] {
  if (typeof raw !== 'string') return []
  const out = new Set<string>()
  for (const item of raw.split(/[\s,，]+/)) {
    const domain = item
      .trim()
      .toLowerCase()
      .replace(/^[a-z]+:\/\//, '')
      .replace(/^\*\./, '')
      .replace(/^www\./, '')
      .replace(/[/?#:].*$/, '')
    if (domain.includes('.')) out.add(domain)
  }
  return [...out]
}

/** Whether `url`'s host is one of `domains` or a subdomain of one. */
export function matchesDomain(url: string, domains: readonly string[]): boolean {
  if (domains.length === 0) return false
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return false
  }
  return domains.some((d) => host === d || host.endsWith(`.${d}`))
}

/**
 * Reciprocal-rank-fusion constant. 60 is the value from the original RRF
 * paper and the de-facto default: large enough that one engine's #1 does not
 * drown out a page several engines agree on.
 */
const RRF_K = 60

/**
 * Fuse several engines' result lists into one, best first.
 *
 * Each page scores Σ 1/(k + rank) over the lists it appears in, so a page
 * several engines rank well beats one engine's top hit. Duplicates collapse
 * by {@link urlIdentity}, keeping the first title, the longest snippet and the
 * first date any engine supplied. Ties keep the order of first appearance, so
 * the configured engine order still breaks them.
 *
 * @param results - per-engine results, in configured engine order.
 * @returns one result: the first non-empty provider answer, fused sources.
 */
export function mergeResults(results: readonly SearchResult[]): SearchResult {
  const merged = new Map<string, { source: SearchSource; score: number; seq: number }>()
  let seq = 0
  for (const result of results) {
    ;(result.sources ?? []).forEach((source, rank) => {
      const id = urlIdentity(source.url)
      const score = 1 / (RRF_K + rank + 1)
      const hit = merged.get(id)
      if (!hit) {
        merged.set(id, { source: { ...source }, score, seq: seq++ })
        return
      }
      hit.score += score
      if ((source.snippet?.length ?? 0) > (hit.source.snippet?.length ?? 0)) hit.source.snippet = source.snippet
      hit.source.publishedAt ??= source.publishedAt
      if (!hit.source.title && source.title) hit.source.title = source.title
    })
  }
  const sources = [...merged.values()]
    .sort((a, b) => b.score - a.score || a.seq - b.seq)
    .map((m) => m.source)
  const content = results.map((r) => r.content).find((c) => typeof c === 'string' && c.trim() !== '') ?? ''
  return { content, sources }
}

/**
 * Last pass over the sources handed to the seam: preferred domains move to the
 * front (otherwise keeping their order), and every snippet is cut to the
 * configured length so all engines cost the model the same context.
 */
export function finalizeSources(
  sources: readonly SearchSource[],
  preferred: readonly string[],
  snippetLength: number,
): SearchSource[] {
  const trimmed = sources.map((s) => ({ ...s, snippet: toSnippet(s.snippet, snippetLength) }))
  if (preferred.length === 0) return trimmed
  const ahead = trimmed.filter((s) => matchesDomain(s.url, preferred))
  return [...ahead, ...trimmed.filter((s) => !matchesDomain(s.url, preferred))]
}
