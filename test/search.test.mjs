// Unit tests for the pure search helpers. They run against the compiled
// `dist/` output: `pnpm test` builds the server side first.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parsePublishedAt, toPublishedAt, toSnippet } from '../dist/providers/fields.js'
import { urlIdentity, mergeResults } from '../dist/results.js'
import { finalizeSearch, excerptAroundQuery } from '../dist/postprocess.js'
import { baiduProvider } from '../dist/providers/baidu.js'

const NOW = Date.parse('2026-11-27T12:00:00.000Z')
const DAY = 86_400_000
const iso = (ms) => new Date(ms).toISOString()

test('parsePublishedAt: epoch seconds and milliseconds', () => {
  assert.equal(parsePublishedAt(1_700_000_000), '2023-11-14T22:13:20.000Z')
  assert.equal(parsePublishedAt(1_700_000_000_000), '2023-11-14T22:13:20.000Z')
})

test('parsePublishedAt: ISO, bare date and space-separated timestamps', () => {
  assert.equal(parsePublishedAt('2025-04-27T18:02:00+08:00'), '2025-04-27T10:02:00.000Z')
  assert.equal(parsePublishedAt('2025-04-27'), '2025-04-27T00:00:00.000Z')
  assert.equal(parsePublishedAt('2025-04-27 18:02:00'), '2025-04-27T18:02:00.000Z')
})

test('parsePublishedAt: English relative dates', () => {
  assert.equal(parsePublishedAt('5 days ago', NOW), iso(NOW - 5 * DAY))
  assert.equal(parsePublishedAt('a day ago', NOW), iso(NOW - DAY))
  assert.equal(parsePublishedAt('2 Hours ago', NOW), iso(NOW - 2 * 3_600_000))
  assert.equal(parsePublishedAt('Yesterday', NOW), iso(NOW - DAY))
})

test('parsePublishedAt: Chinese relative dates', () => {
  assert.equal(parsePublishedAt('3天前', NOW), iso(NOW - 3 * DAY))
  assert.equal(parsePublishedAt('5 小时前', NOW), iso(NOW - 5 * 3_600_000))
  assert.equal(parsePublishedAt('2个月前', NOW), iso(NOW - 62 * DAY))
  assert.equal(parsePublishedAt('昨天', NOW), iso(NOW - DAY))
  assert.equal(parsePublishedAt('前天', NOW), iso(NOW - 2 * DAY))
  assert.equal(parsePublishedAt('刚刚', NOW), iso(NOW))
})

test('parsePublishedAt: unparseable and non-string values are omitted', () => {
  assert.equal(parsePublishedAt('sometime'), undefined)
  assert.equal(parsePublishedAt(''), undefined)
  assert.equal(parsePublishedAt(null), undefined)
  assert.equal(parsePublishedAt(Number.NaN), undefined)
})

test('toPublishedAt picks the first parseable candidate', () => {
  assert.equal(toPublishedAt(undefined, 'garbage', '2025-01-02'), '2025-01-02T00:00:00.000Z')
  assert.equal(toPublishedAt(undefined, ''), undefined)
})

test('toSnippet folds all whitespace and truncates', () => {
  assert.equal(toSnippet('a\n\n- b\t c'), 'a - b c')
  assert.equal(toSnippet('abcdef', 3), 'abc…')
  assert.equal(toSnippet('   '), undefined)
  assert.equal(toSnippet(42), undefined)
})

test('urlIdentity ignores scheme, www, trailing slash, fragment, tracking params and param order', () => {
  const base = urlIdentity('https://example.com/a?x=1&y=2')
  assert.equal(urlIdentity('http://www.Example.com/a/?y=2&x=1&utm_source=z#top'), base)
  assert.notEqual(urlIdentity('https://example.com/b?x=1&y=2'), base)
  assert.notEqual(urlIdentity('https://example.com/a?x=2&y=2'), base)
  assert.equal(urlIdentity('  not a url '), 'not a url')
})

test('mergeResults: fused order, earliest date, better snippet, first answer', () => {
  const merged = mergeResults([
    { content: '', sources: [
      { url: 'https://a.com/1', title: 'A', snippet: 'short', publishedAt: '2025-02-01T00:00:00.000Z' },
      { url: 'https://b.com/1', title: 'B' },
    ] },
    { content: 'answer', sources: [
      { url: 'https://b.com/1/', title: 'B2', snippet: 'from second engine' },
      { url: 'http://www.a.com/1', title: 'A2', snippet: 'a much longer short snippet', publishedAt: '2025-01-01T00:00:00.000Z' },
    ] },
  ])
  assert.equal(merged.content, 'answer')
  assert.deepEqual(merged.sources.map((s) => s.title), ['A', 'B'])
  assert.equal(merged.sources[0].publishedAt, '2025-01-01T00:00:00.000Z')
  assert.equal(merged.sources[0].snippet, 'a much longer short snippet')
  assert.equal(merged.sources[1].snippet, 'from second engine')
})

test('excerptAroundQuery keeps text near the first query term on one line', () => {
  const text = `${'x'.repeat(500)} the rust\nasync runtime ${'y'.repeat(500)}`
  const out = excerptAroundQuery(text, 'rust async', 100)
  assert.ok(out.startsWith('…') && out.endsWith('…'))
  assert.ok(out.includes('rust async runtime'))
  assert.ok(!out.includes('\n'))
  assert.equal(excerptAroundQuery('short\ntext', 'q', 100), 'short text')
  assert.equal(excerptAroundQuery('  ', 'q', 100), undefined)
})

test('finalizeSearch: validates, de-duplicates, blocks, filters by date, keeps engine order, caps', () => {
  const sources = [
    { url: 'ftp://x.com/file', title: 'ftp' },
    { url: 'https://z.com/1', title: 'unrelated first', snippet: 'nothing' },
    { url: 'https://ads.blocked.com/1', title: 'blocked' },
    { url: 'https://docs.pref.org/a', title: 'preferred', snippet: 'p' },
    { url: 'https://y.com/old', title: 'old', publishedAt: iso(NOW - 30 * DAY) },
    { url: 'https://y.com/new', title: '  ', publishedAt: iso(NOW - DAY) },
    { url: 'http://www.z.com/1/', title: 'duplicate' },
    { url: 'https://w.com/undated', title: 'undated rust async match', snippet: 'rust async' },
  ]
  const out = finalizeSearch({ content: '', sources }, {
    query: 'rust async', freshness: 'week', blocked: ['blocked.com'], preferred: ['pref.org'],
    snippetLength: 300, maxResults: 3,
  }, NOW)
  // Preferred first, then the engine's order: no relevance reranking moves
  // the query-matching result ahead of the first one.
  assert.deepEqual(out.sources.map((s) => s.url), ['https://docs.pref.org/a', 'https://z.com/1', 'https://y.com/new'])
  assert.equal(out.sources[2].title, 'https://y.com/new')
  assert.equal(out.sources[2].publishedAt, iso(NOW - DAY))
})

test('finalizeSearch keeps undated results under a freshness filter and passes content through', () => {
  const out = finalizeSearch(
    { content: 'answer', sources: [{ url: 'https://a.com', title: 'a', snippet: 'one\ntwo' }] },
    { query: 'q', freshness: 'day', blocked: [], preferred: [], snippetLength: 300 },
    NOW,
  )
  assert.equal(out.content, 'answer')
  assert.equal(out.sources.length, 1)
  assert.equal(out.sources[0].snippet, 'one two')
})

test('baidu: zone-less timestamps are read as Beijing time', async (t) => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  globalThis.fetch = async () => new Response(JSON.stringify({
    references: [{ url: 'https://a.cn', title: 'a', content: 'c', date: '2025-04-27 18:02:00' }],
  }), { status: 200 })
  const result = await baiduProvider.search('q', 'key')
  assert.equal(result.sources[0].publishedAt, '2025-04-27T10:02:00.000Z')
})
