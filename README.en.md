# dsh-web-search-free

English | [中文](https://github.com/MochiNek0/dsh-web-search-free/blob/main/README.md)

A free Web Search / web fetch plugin for [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness).

It replaces dsh's default `deepseek-official` search/fetch channel with a **multi-engine + automatic fallback** channel: you provide API keys for whichever engines you choose, and it tries them in the order you arrange; if one fails (or runs out of quota) it automatically falls through to the next. A single engine may also carry multiple keys (one per line), rotated in order within that engine. All retrieval requests are issued by dsh's **host process (Node)** straight to each engine — never through the official search backend, and never through an LLM. The browser side holds only the settings card and issues no network requests.

- Registers as a dsh `web` capability channel (providing both `searchProvider` and `fetchProvider`, both with id `web-search-free`).
- Ships a Web settings card (Settings → Plugins → **Web Search Free**) with drag-to-reorder and per-engine key entry.
- Installs as a dsh bundle layer: installing takes over web search/fetch; uninstalling (plus a dsh restart) reverts to the default channel — no manual profile edits.
- The model-facing `web_fetch` tool can be switched on and off from the card — the switch mounts and unmounts the tool, rather than leaving it in place to fail.

## Why "free": the billing difference vs. the official channel

dsh's default official channel `deepseek-official` (provided by `@deepseek-ai/dsh-web-search-deepseek`) is **not a dedicated search endpoint**: every search issues a **full Messages model call** (`POST …/anthropic/v1/messages` with the native `web_search` server tool), DeepSeek runs the search server-side and returns structured result blocks. So each search burns two sets of tokens:

1. **The auxiliary search request itself** — an independent model receives `Perform a web search for the query: <query>` plus a tool definition and incurs input + output tokens (`maxTokens` defaults to 4096, `maxUses` to 5); it's a complete model turn, billed for latency and generation like any model call.
2. **The results re-entering the conversation** — the parsed sources (URL/title/snippet) are injected back into the conversation model's context and resent as conversation tokens until compaction.

Both are charged against your `DEEPSEEK_API_KEY` balance.

This plugin instead calls each engine's **dedicated retrieval endpoint** (e.g. Tavily `/search`, Exa `/search`, Jina `s.jina.ai`) — pure retrieval, never touching any LLM:

|                  | Official `deepseek-official`                                                                        | This plugin `web-search-free`                              |
| ---------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Retrieval method | One full LLM model call + server-side search tool                                                   | Direct calls to each engine's dedicated retrieval endpoint |
| Model tokens     | Burned every search (input + output)                                                                | **0** (pure retrieval, no LLM involved)                    |
| Billed against   | DeepSeek API balance                                                                                | Each search API's own quota (most have a free tier)        |
| Credentials      | **Requires** `DEEPSEEK_API_KEY`                                                                     | Per-engine API keys                                        |
| Result content   | Sources only; snippets come from the model's citations, so an uncited result carries **no snippet** | Sources + snippets; Tavily also returns a direct answer    |

That's the core reason the plugin is named "free" — the official channel burns a whole model turn per search, while this one does pure retrieval and burns zero tokens.

> One more trap worth knowing: the official channel **hard-requires `DEEPSEEK_API_KEY`**. If your conversation model runs through a third-party route (a self-hosted provider, a relay, …) you likely never configured that key — and the official provider's `available()` only checks whether _a key resolver exists_ (one always does), so dsh selects it as usual and **only throws `WEB_PROVIDER_CREDENTIAL_MISSING` once the model actually calls `web_search`**. Nothing in the UI hints at it. This plugin needs no LLM credential at all.

## Supported engines

| Engine         | Search | Fetch | Result dates | Free tier                          | Get an API key                                    |
| -------------- | :----: | :---: | :----------: | ---------------------------------- | ------------------------------------------------- |
| TinyFish       |   ✓    |   ✓   |     some     | Search/fetch free (rate-limited only) | <https://www.tinyfish.ai/pricing>              |
| AnySearch      |   ✓    |   ✓   |      ✗       | 1,000/day (resets daily)           | <https://anysearch.com/pricing>                   |
| Exa (Metaphor) |   ✓    |   ✓   |     some     | $20 on signup + $10/month credit (cumulative, no monthly reset) | <https://dashboard.exa.ai/> |
| Tavily         |   ✓    |   ✓   |      ✗       | 1,000 credits/month (monthly reset) | <https://app.tavily.com/>                        |
| Firecrawl      |   ✓    |   ✓   |      ✗       | 1,000 credits/month (search costs 2 credits/10 results) | <https://www.firecrawl.dev/>          |
| Brave Search   |   ✓    |   ✗   |   **most**   | $5 credit/month (card required, not charged) | <https://api-dashboard.search.brave.com/register> |
| SerpApi        |   ✓    |   ✗   |     weak     | 250/month (monthly reset)           | <https://serpapi.com/users/sign_up>              |
| Jina AI        |   ✓    |   ✓   |     some     | New key gets 10M tokens (one-time, until exhausted) | <https://jina.ai/api-key>                |

> The table order is the default call order (sorted by sustainable free volume, largest first). Jina is a one-time grant but still enters the fetch chain — any engine with a key and `supportsFetch: true` is picked by `getActiveProviders('fetch')` regardless of its position in the search chain.

> **On how each free tier works**: Jina is a **one-time token grant** (new keys get 10M tokens; `s.jina.ai` search costs a fixed 10,000 tokens per request, so that's roughly 1,000 searches before it's gone — no reset, top up or rotate keys); Exa is a **cumulative credit balance** ($20 on signup + $10/month added, balance doesn't reset, ~1,400 basic searches); AnySearch is **daily reset** (1,000/day, ~30k/month); Tavily / Firecrawl / SerpApi are **monthly reset**; Brave is also a monthly $5 credit reset; TinyFish's search and fetch are completely free, rate-limited only (free tier: Search 30 req/min, Fetch 150 url/min).

**On fetch**: Brave Search and SerpApi are pure SERP scrapers with no URL-fetch endpoint, so they **never enter the fetch chain** (search only). If only those are configured with keys, the fetch chain is empty and fails with `No web fetch providers configured.` — configure a key for an engine that supports fetch as well.

**On result dates**: `publishedAt` is what lets the model judge how current a result is, and engines differ sharply (measured coverage from a single query, indicative only): Brave `page_age` 18/20, Exa `publishedDate` 4/10, Jina `publishedTime` 1–3/10, TinyFish `date` (reliable for news, partial for web), SerpApi `date` (weak, display string). Tavily's `published_date` is returned **only under `topic: 'news'`**, and this plugin runs general web search, so it is empty in practice. Firecrawl and AnySearch carry no date field at all.

> If recency matters to you, move Brave up the call order — at the cost of Tavily's direct answer and its longer excerpts.

## Prerequisites

- dsh installed, with the `dsh` command available (when developing inside a dsh source checkout, use `pnpm dsh ...` instead).
- `pnpm` on your `PATH` (`dsh plugin` manages dependencies via pnpm inside the profile directory).
- The target profile is usually `web` (this plugin's client half declares `platform: web`; the settings card only appears in the Web UI). The `web` profile auto-initializes from a template on first use.

## Installation

`dsh plugin --profile <name> <pnpm args>` forwards the pnpm arguments into the profile directory and, **after a successful run, automatically reconciles `dsh.profile.bundles`**: any dependency that resolves to a package declaring `dsh.bundle` is appended to the bundle layer stack — this plugin declares exactly `dsh.bundle.patch`, so installing it takes over web search/fetch with no manual profile edit.

### From npm (recommended)

```sh
dsh plugin --profile web add dsh-web-search-free
```

### From local source (for development / further hacking)

This repo gitignores `dist/`, so build the artifacts before installing.

```sh
# 1) Build in the plugin repo
cd /path/to/dsh-web-search-free
pnpm install
pnpm build            # produces dist/index.js and dist/client.js

# 2) Add it to the web profile (run inside the plugin dir; "." is anchored to the cwd)
dsh plugin --profile web add .
```

> You can also use an absolute path and run from anywhere:
> `dsh plugin --profile web add /absolute/path/to/dsh-web-search-free`
>
> pnpm installs local directories as a link by default, so **rebuilding with `pnpm build` from source is picked up by the profile immediately** — handy for iteration. After changing the client half, refresh the browser (client-plugin hot-reload requires a rebuild watcher like `pnpm run dev:web` to be running).

## Configuration

After installing, start the dsh Web UI:

```sh
dsh web          # equivalent to dsh --profile web
```

Open the **Settings → Plugins → Web Search Free** card:

1. Expand the card. Engines come in two groups: **"调用顺序" (call order)** holds the engines with a saved key — the ones actually in the chain, numbered `#1`, `#2`, …; **"其他可用引擎 (n)" (other available engines)** holds the ones with no key yet, collapsed by default — click the heading to expand. Each row shows the engine name, a capability chip (`Search · Fetch` or `Search only`), the free tier, and the count of configured keys.
2. **Click a row** to expand it; an input appears. Paste the API key into it; the in-row "Get API key ↗" link goes straight to each engine's signup page. An engine may carry multiple keys: **one per line**, rotated in order within the engine. Click the row again to collapse it. On save, the row moves up into the call-order group.
3. **Drag the `⋮⋮` handle on the left of a row** to set the call order: engines higher up are tried first, failing through to the next in order; multiple keys for the same engine are also tried in turn — the first successful (engine, key) pair returns, and only an all-fail raises an error. Engines with no key never enter the call chain and have nothing to order, so only rows in the call-order group are draggable. Note that clicking the row body toggles expand/collapse; to drag, grab the `⋮⋮` handle.
4. Above the engine list is the **"Enable web_fetch (URL retrieval)"** switch. On, the model gets a `web_fetch` tool that pulls the full text of a given URL; off, that tool is **removed** from the model's catalog (not left in place to fail), leaving search only. Toggling takes effect immediately, with no restart.
5. Click "Save". Settings persist through the dsh settings namespace (`web-search-free`) and take effect on the next search, with no restart. The card header shows a badge with the count of configured engines, so you can tell at a glance whether the plugin is ready without expanding.

**Configure at least one engine's key**, otherwise search/fetch fails with `No web search providers configured.`

> On `web_fetch`: dsh's stock compositions ship it disabled (the model picks the request target and fetch providers defer SSRF protection). This plugin hands you the choice, enabled by default. Turn it off if the outbound surface concerns you — the cost is that the model can no longer read a URL you paste, nor read a long document in depth; it only sees search snippets.

## Verification

1. Start the Web UI with `dsh web`.
2. Ask the model to use web search/fetch in a conversation (e.g. "search for today's news" or "fetch the content of https://example.com"). Fetching requires **"Enable web_fetch"** to be on in the card; otherwise the tool is not in the model's catalog at all.
3. The request flows through the `web-search-free` channel in your arranged engine order; on a failure you'll see `Provider <name> ... failed. Trying next provider ...` in the logs, then the next engine is tried automatically.

## Updating

```sh
# Local source: just rebuild (linked install, no reinstall needed)
cd /path/to/dsh-web-search-free && pnpm build

# npm: upgrade to a new version
dsh plugin --profile web update dsh-web-search-free
```

`update` also triggers reconciliation: if the new version adds or drops a `dsh.bundle` declaration, the bundle layer stack follows automatically.

## Uninstalling

```sh
dsh plugin --profile web remove dsh-web-search-free
```

Reconciliation removes this plugin from `dsh.profile.bundles`, and web search/fetch **reverts to dsh-base's `deepseek-official` default channel** — no manual profile or patch edit.

Two caveats:

- **Click "Clear all settings" at the bottom of the card before uninstalling.** dsh's uninstall flow does not delete a settings namespace's stored section, so your API keys would stay in `$DSH_HOME/settings.yaml`. That button erases every value this plugin wrote (click twice to confirm). An empty `web-search-free:` key remains in the file afterwards — it holds no values, and no client-side API can delete the key itself.
- **Restart dsh after uninstalling** for the fallback to actually take effect. The `web` row's provider selection is composed at boot; uninstalling only deactivates this plugin's entry in the running process, and until a restart search fails with `WEB_PROVIDER_CONFIGURED_MISSING`.

## How it works

This plugin is a dsh **bundle layer** (`package.json` declares `dsh.bundle.patch: ./cordis.patch.yml`). `cordis.patch.yml` does two things:

- `insert`s a `web-search-free` row to bring this plugin's host half into the composition;
- uses a same-id `web` override layer to repoint both `searchProvider` and `fetchProvider` to `web-search-free`, overriding the `deepseek-official` that dsh-base pins.

The host half (`src/index.ts`, `inject: ['web']`) registers search and fetch providers into `ctx.web`, iterating configured-key engines in `providerOrder` order with fallback; each engine's key field may hold multiple values (one per line), rotated in order within the engine. The client half (`src/client.tsx`) registers a React card on the Plugins settings page, reading and writing the same `web-search-free` settings namespace. The two halves are aligned by that namespace string.

Mounting `web_fetch` is the plugin's own job rather than something the bundle patch does. The reason is that tool-web decides **tool visibility at mount time** — its docs state "Enablement controls tool registration; an enabled tool remains visible when its provider is unavailable" — so a switch that only the capability channel reads could make `web_fetch` fail but never disappear. And bundle patch layers are read once at boot and are not hot-watched. So the host half resolves the **running dsh's own** `@deepseek-ai/dsh-tool-web` via `createRequire(ctx.baseUrl)` against the profile directory and mounts it as a child fiber with `{ search: false, fetch: true }`: `ctx.plugin` registers into the global tool layer every agent scope inherits, and on dispose tool-web's own effects withdraw `web_fetch` along with its prompt section. `search: false` keeps this out of the `web_search` business entirely — whatever the composition already mounts (a preset's scoped row on the Web surface) stays that name's sole owner.

A resolution or mount failure degrades to a single warn: it never throws and never produces an unhandled rejection, and the search path is unaffected.

The build has two steps (the package declares `"type": "module"`): `tsconfig.json` (`module: NodeNext`) compiles the host half to ESM (`dist/index.js` etc., matching dsh's ESM runtime and avoiding the load race triggered when CJS `require()`s an ESM dependency); `tsconfig.client.json` (`module: CommonJS`) compiles `dist/client.js` separately, which `wrap-client.cjs` then wraps as `window.__ModuleLoader__.load(...)` so it can be loaded by dsh's browser-side module loader. The host half imports `Schema` from `@deepseek-ai/schemastery` (not the legacy `cordis`), and `Context` is imported as a type only from `@deepseek-ai/cordis`.

The plugin is installed *beside* a profile, so every host service must resolve to the ONE instance the running dsh already loaded. Any `@deepseek-ai/*` entry in `dependencies` — or in `peerDependencies` without `optional: true`, which pnpm auto-installs — becomes a private second copy inside the user's profile; under a hoisted node_modules it lands at the profile root and shadows the harness's own, so Cordis Service identities stop matching. That failure only appears on someone else's machine and a local `pnpm build` can never surface it, so `prepublishOnly` runs `scripts/check-package.cjs` as a gate: no host package in `dependencies`, host peers must be optional, dist's actual imports and the declared dependencies must agree both ways, and `exports` condition order plus the wrapped client bundle are verified. Run `pnpm run check` after touching `package.json`.

## License

MIT, see [LICENSE](https://github.com/MochiNek0/dsh-web-search-free/blob/main/LICENSE).
