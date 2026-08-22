# dsh-web-search-free

English | [中文](README.md)

A free Web Search / web fetch plugin for [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/dsh).

It replaces dsh's default `deepseek-official` search/fetch channel with a **multi-engine + automatic fallback** channel: you provide API keys for whichever engines you choose, and it tries them in the order you arrange; if one fails (or runs out of quota) it automatically falls through to the next. A single engine may also carry multiple keys (one per line), rotated in order within that engine. All requests are issued from your browser side, never through the official search backend.

- Registers as a dsh `web` capability channel (providing both `searchProvider` and `fetchProvider`, both with id `web-search-free`).
- Ships a Web settings card (Settings → Plugins → **Web Search Free**) with drag-to-reorder and per-engine key entry.
- Installs as a dsh bundle layer: installing takes over web search/fetch, uninstalling auto-reverts to the default channel — no manual profile edits.

## Why "free": the billing difference vs. the official channel

dsh's default official channel `deepseek-official` (provided by `@deepseek-ai/dsh-web-search-deepseek`) is **not a dedicated search endpoint**: every search issues a **full Messages model call** (`POST …/anthropic/v1/messages` with the native `web_search` server tool), DeepSeek runs the search server-side and returns structured result blocks. So each search burns two sets of tokens:

1. **The auxiliary search request itself** — an independent model receives `Perform a web search for the query: <query>` plus a tool definition and incurs input + output tokens (`maxTokens` defaults to 4096, `maxUses` to 5); it's a complete model turn, billed for latency and generation like any model call.
2. **The results re-entering the conversation** — the parsed sources (URL/title/snippet) are injected back into the conversation model's context and resent as conversation tokens until compaction.

Both are charged against your `DEEPSEEK_API_KEY` balance.

This plugin instead calls each engine's **dedicated retrieval endpoint** (e.g. Tavily `/search`, Exa `/search`, Jina `s.jina.ai`) — pure retrieval, never touching any LLM:

| | Official `deepseek-official` | This plugin `web-search-free` |
|---|---|---|
| Retrieval method | One full LLM model call + server-side search tool | Direct calls to each engine's dedicated retrieval endpoint |
| Model tokens | Burned every search (input + output) | **0** (pure retrieval, no LLM involved) |
| Billed against | DeepSeek API balance | Each search API's own quota (most have a free tier) |
| Credentials | `DEEPSEEK_API_KEY` | Per-engine API keys |

That's the core reason the plugin is named "free" — the official channel burns a whole model turn per search, while this one does pure retrieval and burns zero tokens.

## Supported engines

| Engine | Search | Fetch | Get an API key |
|---|:---:|:---:|---|
| Jina AI | ✓ | ✓ | <https://jina.ai/api-key> |
| Exa (Metaphor) | ✓ | ✓ | <https://dashboard.exa.ai/> |
| Tavily | ✓ | ✓ | <https://app.tavily.com/> |
| Firecrawl | ✓ | ✓ | <https://www.firecrawl.dev/> |
| Brave Search | ✓ | ✗ | <https://api-dashboard.search.brave.com/register> |

> Brave supports search only, not URL fetch. If your fetch chain only has a Brave key configured, fetch will fail — please also configure a key for an engine that supports fetch.

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

1. Expand the card; each row maps to one engine.
2. Paste the API key into the matching engine's input; the in-row "Get API key ↗" link goes straight to each engine's signup page. An engine may carry multiple keys: **one per line**, rotated in order within the engine.
3. **Drag each row** to set the call order: engines higher up are tried first, failing through to the next in order; multiple keys for the same engine are also tried in turn — the first successful (engine, key) pair returns, and only an all-fail raises an error. Engines with no key never enter the call chain.
4. Above the engine list is the **"Enable web_fetch (URL retrieval)"** switch. On, the model gets a `web_fetch` tool that pulls the full text of a given URL; off, that tool is **removed** from the model's catalog (not left in place to fail), leaving search only. Toggling takes effect immediately, with no restart.
5. Click "Save". Settings persist through the dsh settings namespace (`web-search-free`) and take effect on the next search, with no restart.

**Configure at least one engine's key**, otherwise search/fetch fails with `No web search providers configured.`

> On `web_fetch`: dsh's stock compositions ship it disabled (the model picks the request target and fetch providers defer SSRF protection). This plugin hands you the choice, enabled by default. Turn it off if the outbound surface concerns you — the cost is that the model can no longer read a URL you paste, nor read a long document in depth; it only sees search snippets.

## Verification

1. Start the Web UI with `dsh web`.
2. Ask the model to use web search/fetch in a conversation (e.g. "search for today's news" or "fetch the content of https://example.com").
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

The build has two steps (the package declares `"type": "module"`): `tsconfig.json` (`module: NodeNext`) compiles the host half to ESM (`dist/index.js` etc., matching dsh's ESM runtime and avoiding the load race triggered when CJS `require()`s an ESM dependency); `tsconfig.client.json` (`module: CommonJS`) compiles `dist/client.js` separately, which `wrap-client.cjs` then wraps as `window.__ModuleLoader__.load(...)` so it can be loaded by dsh's browser-side module loader. The host half imports `Schema` from `@deepseek-ai/schemastery` (not the legacy `cordis`), and `Context` is imported as a type only from `@deepseek-ai/cordis`.

## License

MIT, see [LICENSE](LICENSE).
