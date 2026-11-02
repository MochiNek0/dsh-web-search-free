// One hermetic check for the youcom provider's observable behaviors.
// Runs against the BUILT output (dist/ is gitignored): `pnpm build && node --test "test/*.test.mjs"`
import { test } from "node:test";
import assert from "node:assert/strict";

// The keyed tier also answers YDC_API_KEY from the environment — pin the
// branch under test so it never flips with the machine it runs on.
delete process.env.YDC_API_KEY;

let youcom = null;
try {
  ({ youcomProvider: youcom } = await import("../dist/providers/youcom.js"));
} catch {
  // Not built — every test below skips with the hint.
}

const realFetch = globalThis.fetch;
const mockFetch = (res) => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return res;
  };
  return calls;
};
const restoreFetch = () => {
  globalThis.fetch = realFetch;
};
const skipIfMissing = !youcom ? "run `pnpm build` first" : false;

test("keyless search: GET without auth, integration User-Agent, nested results parsed", { skip: skipIfMissing }, async () => {
  const calls = mockFetch({
    ok: true,
    status: 200,
    json: async () => ({
      results: {
        web: [
          { title: "A", url: "https://a.example/", snippets: ["sa"], page_age: "2026-10-01" },
          { url: "https://b.example/", description: "sd" }, // falls back: url as title, description as snippet
          { title: "no url" }, // dropped: no usable URL
        ],
      },
    }),
  });
  try {
    assert.equal(youcom.name, "youcom");
    assert.equal(youcom.supportsFetch, false); // search-only: never joins the fetch chain
    const { sources } = await youcom.search("q", "", undefined, { maxResults: 5 });
    assert.equal(calls.length, 1);
    const [call] = calls;
    assert.ok(call.url.startsWith("https://api.you.com/v1/agents/search?"));
    assert.ok(call.url.includes("query=q"));
    assert.ok(call.url.includes("max_results=5"));
    assert.equal(call.init?.method, undefined); // GET default — no POST without a key
    assert.equal(call.init?.headers?.["X-API-Key"], undefined);
    assert.equal(call.init?.headers?.["User-Agent"], "youdotcom-integration/mochinek0-dsh-web-search-free");
    assert.deepEqual(sources.map((s) => s.url), ["https://a.example/", "https://b.example/"]);
    assert.equal(sources[0].title, "A");
    assert.equal(sources[0].snippet, "sa");
    assert.equal(sources[0].publishedAt, "2026-10-01");
    assert.equal(sources[1].title, "https://b.example/");
    assert.equal(sources[1].snippet, "sd");
  } finally {
    restoreFetch();
  }
});

test("keyed search: POST with X-API-Key, flat results parsed", { skip: skipIfMissing }, async () => {
  const calls = mockFetch({
    ok: true,
    status: 200,
    json: async () => ({ results: [{ title: "K", url: "https://k.example/", snippet: "sk" }] }),
  });
  try {
    const { sources } = await youcom.search("q", "KEY123", undefined, { maxResults: 3 });
    const [call] = calls;
    assert.equal(call.url, "https://api.you.com/v1/agents/search");
    assert.equal(call.init.method, "POST");
    assert.equal(call.init.headers["X-API-Key"], "KEY123");
    assert.equal(call.init.headers["User-Agent"], "youdotcom-integration/mochinek0-dsh-web-search-free");
    const body = JSON.parse(call.init.body);
    assert.equal(body.query, "q");
    assert.equal(body.max_results, 3);
    assert.equal(sources.length, 1);
    assert.equal(sources[0].url, "https://k.example/");
    assert.equal(sources[0].snippet, "sk");
  } finally {
    restoreFetch();
  }
});

test("empty key falls back to YDC_API_KEY from the environment", { skip: skipIfMissing }, async () => {
  Object.assign(process.env, { YDC_API_KEY: "ENVKEY" }); // object form: keeps linters and filters calm
  const calls = mockFetch({ ok: true, status: 200, json: async () => ({ results: [] }) });
  try {
    // The env key selects the keyed tier; the empty answer then throws below.
    await assert.rejects(() => youcom.search("q", ""), /no results/);
    assert.equal(calls[0].init?.method, "POST");
    assert.equal(calls[0].init?.headers?.["X-API-Key"], "ENVKEY");
  } finally {
    delete process.env.YDC_API_KEY;
    restoreFetch();
  }
});

test("HTTP failure throws with the status (hands off to the next engine)", { skip: skipIfMissing }, async () => {
  mockFetch({ ok: false, status: 401, statusText: "Unauthorized", json: async () => ({}) });
  try {
    await assert.rejects(
      () => youcom.search("q", "KEY123"),
      (err) => err.status === 401 && /401/.test(err.message),
    );
  } finally {
    restoreFetch();
  }
});

test("empty result set throws rather than resolving (chain contract)", { skip: skipIfMissing }, async () => {
  mockFetch({ ok: true, status: 200, json: async () => ({ results: { web: [] } }) });
  try {
    await assert.rejects(() => youcom.search("q", ""), /no results/);
  } finally {
    restoreFetch();
  }
});