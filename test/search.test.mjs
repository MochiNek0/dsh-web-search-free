// Unit tests for the pure search helpers. They run against the compiled
// `dist/` output: `pnpm test` builds the server side first.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parsePublishedAt, toPublishedAt, toSnippet } from '../dist/providers/fields.js'
import { urlIdentity, mergeResults } from '../dist/results.js'
import { finalizeSearch, excerptAroundQuery } from '../dist/postprocess.js'
import { baiduProvider } from '../dist/providers/baidu.js'
import { keenableProvider } from '../dist/providers/keenable.js'

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

/** Swap in a fetch stub for one test; returns the recorded calls. */
function stubFetch(t, respond) {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    return respond(url, init)
  }
  return calls
}

test('keenable search: keyed POST, options mapped, snippet read instead of the empty description', async (t) => {
  const calls = stubFetch(t, () => new Response(JSON.stringify({
    query: 'q',
    mode: 'realtime',
    results: [
      { title: 'A', url: 'https://a.example', snippet: 'alpha  text', description: '', published_at: '2026-11-01T00:00:00Z' },
      { title: '', url: 'https://b.example', snippet: 'beta' },
      { title: 'no url', snippet: 'dropped' },
    ],
  }), { status: 200 }))

  const result = await keenableProvider.search('q', 'kn-key', undefined, {
    maxResults: 80, searchDepth: 'basic', freshness: 'week', excludeDomains: ['pinterest.com'], region: 'US',
  })

  assert.equal(calls[0].url, 'https://api.keenable.ai/v1/search')
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(calls[0].init.headers['X-API-Key'], 'kn-key')
  const body = JSON.parse(calls[0].init.body)
  assert.equal(body.query, 'q')
  assert.equal(body.max_results, 50)
  assert.equal(body.mode, undefined)
  assert.deepEqual(body.exclude_domains, ['pinterest.com'])
  assert.ok(Date.parse(body.published_after) < Date.now())
  assert.equal(body.region, undefined)
  assert.deepEqual(result.sources, [
    { url: 'https://a.example', title: 'A', snippet: 'alpha text', publishedAt: '2026-11-01T00:00:00.000Z' },
    { url: 'https://b.example', title: 'https://b.example', snippet: 'beta', publishedAt: undefined },
  ])
})

test('keenable search: no options keeps Keenable defaults', async (t) => {
  const calls = stubFetch(t, () => new Response(JSON.stringify({ results: [{ title: 'A', url: 'https://a.example', snippet: 's' }] }), { status: 200 }))
  await keenableProvider.search('q', 'kn-key')
  assert.deepEqual(JSON.parse(calls[0].init.body), { query: 'q', snippet_max_length: 1000 })
})

test('keenable search: an error status hands off with the status and API message', async (t) => {
  stubFetch(t, () => new Response(JSON.stringify({ error: 'Payment required', message: 'Out of funds' }), { status: 402 }))
  await assert.rejects(keenableProvider.search('q', 'kn-key'), (err) => {
    assert.equal(err.status, 402)
    assert.match(err.message, /Out of funds/)
    return true
  })
})

test('keenable search: an empty result list is a failure so the chain moves on', async (t) => {
  stubFetch(t, () => new Response(JSON.stringify({ results: [] }), { status: 200 }))
  await assert.rejects(keenableProvider.search('q', 'kn-key'), /no results/)
})

test('keenable fetch: one URL, provider truncation flag kept', async (t) => {
  const calls = stubFetch(t, () => new Response(JSON.stringify({
    results: [{ url: 'https://a.example', content: '# Page', truncated: true }],
  }), { status: 200 }))
  const result = await keenableProvider.fetch('https://a.example', 'kn-key')
  assert.equal(calls[0].url, 'https://api.keenable.ai/v1/fetch')
  assert.deepEqual(JSON.parse(calls[0].init.body), { urls: ['https://a.example'], content: { max_chars: 200000 } })
  assert.deepEqual(result, { content: '# Page', truncated: true })
})

test('keenable fetch: a per-URL error inside a 200 is a failure', async (t) => {
  stubFetch(t, () => new Response(JSON.stringify({
    results: [{ url: 'https://a.example', error: { status: 403, message: 'blocked by site' } }],
  }), { status: 200 }))
  await assert.rejects(keenableProvider.fetch('https://a.example', 'kn-key'), (err) => {
    assert.equal(err.status, 403)
    assert.match(err.message, /blocked by site/)
    return true
  })
})
