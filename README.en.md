# dsh-web-search-free

[中文](https://github.com/MochiNek0/dsh-web-search-free/blob/main/README.md) | English

A free web search / page fetching plugin for [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness). It replaces dsh's default `deepseek-official` channel with **multi-engine + automatic fallback**: you provide keys for whichever engines you like, and it tries them in the order you arrange, falling through on failure or exhausted quota. A single engine may carry multiple keys (one per line), rotated in order too.

- **Burns no model tokens** — it hits each engine's dedicated retrieval endpoint, never an LLM.
- **Takes over on install, falls back on removal** — installed as a dsh bundle layer, no manual profile edits.
- **Ships a configuration card** — drag to reorder, add keys one by one; its copy follows the dsh Language preference.
- **`web_fetch` can be switched off** — every call then returns a clear "backend disabled" error.

All retrieval requests are issued by dsh's **host process (Node)** straight to each engine, never through the official search backend. The browser side holds only the configuration card and issues no network requests.

## Why "free"

The official channel `deepseek-official` (from `@deepseek-ai/dsh-web-search-deepseek`) is **not a dedicated search endpoint**: every search makes a **full Messages model call** carrying the native server-side `web_search` tool, with DeepSeek running the search server-side. So each search burns tokens twice — the auxiliary search request itself (input + output; `maxTokens` defaults to 4096, `maxUses` to 5), and the resulting sources injected back into the conversation context, resent on every turn until compaction. Both come out of your `DEEPSEEK_API_KEY` balance.

This plugin calls each engine's retrieval endpoint directly (Tavily `/search`, Exa `/search`, Jina `s.jina.ai`, …) — pure retrieval:

|                | Official `deepseek-official`                                               | This plugin `web-search-free`                        |
| -------------- | -------------------------------------------------------------------------- | ---------------------------------------------------- |
| How it queries | A full LLM model call + server-side search tool                            | Direct calls to each engine's retrieval endpoint      |
| Model tokens   | Burned on every search (input + output)                                    | **0** (pure retrieval, no LLM involved)               |
| Billed to      | Your DeepSeek API balance                                                  | Each search API's own quota (most have a free tier)   |
| Credentials    | **Requires** `DEEPSEEK_API_KEY`                                            | Each engine's own API key                             |
| Result payload | Sources only; snippets come from what the model quoted, so unquoted results have **no snippet** | Sources + snippets; Tavily adds a direct answer |

> **An easy trap**: the official channel hard-depends on `DEEPSEEK_API_KEY`. If your conversation model runs through a third party (self-hosted provider, a relay, …) you probably never set it — and the official provider's `available()` only checks whether a key *resolver* exists (always true), so dsh selects it anyway and **only raises `WEB_PROVIDER_CREDENTIAL_MISSING` once the model actually calls `web_search`**, with nothing visible in the UI beforehand. This plugin depends on no LLM credential.

## Supported engines

| Engine         | Search | Fetch | Result date | Free tier                                                  | Get an API key                                    |
| -------------- | :----: | :---: | :---------: | ---------------------------------------------------------- | ------------------------------------------------- |
| TinyFish       |   ✓    |   ✓   |   partial   | Search & fetch free (rate-limited only)                    | <https://www.tinyfish.ai/pricing>                 |
| AnySearch      |   ✓    |   ✓   |      ✗      | 1,000 calls/day (resets daily)                             | <https://anysearch.com/pricing>                   |
| Exa (Metaphor) |   ✓    |   ✓   |   partial   | $20 on signup + $10 credit/month (rolls over, never reset) | <https://dashboard.exa.ai/>                       |
| Tavily         |   ✓    |   ✓   |      ✗      | 1,000 credits/month (resets monthly)                       | <https://app.tavily.com/>                         |
| Firecrawl      |   ✓    |   ✓   |      ✗      | 1,000 credits/month (search costs 2 per 10 results)        | <https://www.firecrawl.dev/>                      |
| Serping API    |   ✓    |   ✗   |   partial   | 1,000 calls/month (resets monthly, no card)                | <https://serpingapi.com/signup>                   |
| Brave Search   |   ✓    |   ✗   |  **most**   | $5 credit/month (card required, not charged)               | <https://api-dashboard.search.brave.com/register> |
| SerpApi        |   ✓    |   ✗   |    weak     | 250 calls/month (resets monthly)                           | <https://serpapi.com/users/sign_up>               |
| Jina AI        |   ✓    |   ✓   |   partial   | 10M tokens on a new key (one-time, no reset)               | <https://jina.ai/api-key>                         |

The table order is the default call order (largest sustainable free tier first). Two things to note:

- **Fetching**: Brave, Serping API and SerpApi are pure SERP APIs with no URL fetch endpoint, so they only join the search chain. If those three are all you configured, the fetch chain is empty and fails with `No web fetch providers configured.` — add a key for an engine that supports fetching.
- **Result dates**: `publishedAt` is what lets the model judge how current a result is, and coverage varies a lot. Brave is the most complete (18/20 measured); Exa, Jina, TinyFish, Serping API and SerpApi carry it on some results; Tavily's `published_date` is only returned under `topic: 'news'`, so it is empty here; Firecrawl and AnySearch have no such field. If recency matters, move Brave up the call order — at the cost of Tavily's direct answer and longer excerpts.

<details>
<summary>How each free tier resets (click to expand)</summary>

- **Jina**: one-time tokens — 10M on a new key, `s.jina.ai` charging a flat 10k per search (≈1,000 searches). Once spent you top up or rotate the key; it never resets.
- **Exa**: rolling credit — $20 on signup plus $10/month, never zeroed (≈1,400 basic searches).
- **AnySearch**: resets daily, 1,000 calls/day (≈30k/month).
- **Tavily / Firecrawl / Serping API / SerpApi / Brave**: reset monthly.
- **TinyFish**: search and fetch are free outright, limited only by rate (free tier: Search 30 req/min, Fetch 150 url/min).

</details>

## Installation

Prerequisites: **dsh ≥ 0.1.2-rc.1**, `pnpm` on `PATH`, and a target profile — usually `web` (this plugin's client half declares `platform: web`, so the card only appears in the Web UI; the `web` profile auto-initializes from a template on first use).

```sh
dsh plugin --profile web add dsh-web-search-free
```

`dsh plugin` forwards its pnpm arguments into the profile directory and, on success, **reconciles `dsh.profile.bundles`** — this plugin declares `dsh.bundle.patch`, so installing it takes over web search/fetch with no manual profile edit.

<details>
<summary>Installing from local source (for hacking on it)</summary>

`dist/` is gitignored, so build before installing:

```sh
cd /path/to/dsh-web-search-free
pnpm install
pnpm build                          # produces dist/index.js and dist/client.js
dsh plugin --profile web add .      # "." anchors to the current directory; an absolute path works too
```

pnpm links local directories by default, so a later `pnpm build` reaches the profile immediately. After changing the client half, just refresh the browser.

</details>

<details>
<summary>Older dsh (≤ 0.1.2-alpha.5)</summary>

Those compositions do not mount the web tools, so with this plugin installed **search works but `web_fetch` never appears** — use 1.3.0 instead, which mounts `tool-web` itself.

</details>

## Configuration

Start the Web UI (`dsh web`) and find the configuration card. Where it lives depends on your dsh version, and the plugin places itself into whichever seat that version actually has:

| dsh version | Where the card is |
| --- | --- |
| ≥ 0.1.6 | Sidebar **插件 (Plugins)** → **web-search-free** under "已安装 (Installed)"; the form sits between the package description and its components |
| ≤ 0.1.5 | **Settings → Plugins → Web Search Free** |

Engines come in two groups: **call order** holds the ones with a saved key — those actually in the chain, numbered `#1`, `#2`, … — and **other available engines** holds the rest.

1. **Click a row** to expand it and paste an API key; the in-row "Get an API key ↗" link goes to the signup page. An engine takes multiple keys, **one per line**, rotated in order. On save the row moves up into the call order.
2. **Drag the `⋮⋮` handle** to reorder: higher rows are tried first, failing through in order, and the first successful (engine, key) pair returns. Only rows in the call order are draggable; clicking the row body toggles expand/collapse, so grab `⋮⋮` to drag.
3. The **"Enable web_fetch (URL fetching)"** switch at the top controls whether the model can fetch full page text. Off, calls return a clear error rather than the tool disappearing from the catalog.
4. Click **Save**. Settings persist in the dsh settings namespace `web-search-free` and take effect on the next search, with no restart.

**Configure at least one engine's key**, otherwise search fails with `No web search providers configured.`

### When the card is nowhere to be found

dsh's plugin configuration surface is still moving fast, and the slot the card occupies has been renamed more than once. The plugin knows every slot name that has existed so far, but if your dsh is newer than the plugin and the slot changed again, the card will not appear — the browser console then carries one line, `[web-search-free] no settings card mounted: …`, listing the plugin-related slots your dsh does declare. **Please paste that line into an issue.**

You do not have to wait for a release: **every setting can be written straight into the profile's `~/.dsh/profiles/web/cordis.patch.yml`**, a path that depends on no UI. Installing already inserted the `web-search-free` row through the plugin's own bundle layer, so what you write here is an **id-targeted override of that row's config** (do not write another `insert` — that adds a duplicate row):

```yaml
- id: web-search-free
  config:
    tavilyApiKey: tvly-xxxxxxxx
    exaApiKey: |-
      key-1
      key-2
    enableFetch: true
    providerOrder: [tavily, exa, tinyfish]
```

The field names match the card one for one (see `Config` in `src/index.ts`): `<engine>ApiKey` (a multi-line string for multiple keys), `enableFetch`, `providerOrder`. Restart dsh to apply.

How this relates to the card depends on the dsh version: on dsh >= 0.1.7 the card writes to *this very file* — same layer, so saving from the card overwrites the fields you hand-wrote here. On dsh <= 0.1.6 the card writes a separate settings document (`~/.dsh/settings.yaml`) whose values form the user layer and override the base values set here.

### Keys gone after upgrading to dsh 0.1.7

Where configuration lives changed in dsh 0.1.7: <= 0.1.6 kept it in `~/.dsh/settings.yaml`, >= 0.1.7 keeps it in the profile's `cordis.patch.yml`. dsh migrates once on its own — renaming `settings.yaml` to `settings.yaml.imported` and writing each section into the entry of the same id — but it runs **only that once**, and only for sections the running composition accepts at that moment.

If this plugin could not start during the upgrade (1.5.x stops the whole web UI at "Failed to load plugins" on 0.1.7), it misses its turn and the keys stay in the renamed file with nothing pointing at them.

**Nothing is lost**: they are in `settings.yaml.imported` under the dsh home (`~/.dsh` by default). The plugin says so in its startup log when it detects this, and the card shows the same hint. The quickest fix is to hand this to dsh:

> Move every field of the web-search-free section in settings.yaml.imported (under the dsh home, ~/.dsh by default) into the current profile's cordis.patch.yml, as the config of the entry with id web-search-free; add that entry if it is missing. Preserve the file's existing comments and formatting, and back it up first.

You can also copy it across by hand in the YAML shape shown above, or simply retype the keys in the card.

## Verifying it works

Start `dsh web` and ask the model to search or fetch ("search for today's news", "fetch the contents of https://example.com"). When an engine fails you will see `Provider <name> ... failed. Trying next provider ...` in the log, followed by the next attempt.

## Updating and uninstalling

```sh
dsh plugin --profile web update dsh-web-search-free    # upgrade
dsh plugin --profile web remove dsh-web-search-free    # uninstall
```

Both reconcile the bundle stack: after removal, web search/fetch **falls back to dsh-base's `deepseek-official` channel** with no manual profile edit.

Two things to keep in mind:

- **Click "Clear all settings" at the bottom of the card first.** dsh's uninstall flow does not delete anything in the settings namespace, so your API keys would stay in `$DSH_HOME/settings.yaml`. That button clears every value this plugin wrote (two clicks to confirm).
- **Restart dsh after uninstalling.** The `web` row's provider selection is composed at startup; until you restart, search fails with `WEB_PROVIDER_CONFIGURED_MISSING`.

## How it works

This plugin is a dsh **bundle layer** (`package.json` declares `dsh.bundle.patch: ./cordis.patch.yml`). The patch does two things: it `insert`s a `web-search-free` row to bring the host half into the composition, then uses a same-id `web` override to repoint both `searchProvider` and `fetchProvider` at `web-search-free`, beating the `deepseek-official` that `dsh-base` pins.

The host half (`src/index.ts`) registers the search and fetch providers on `ctx.web` and walks the keyed engines in `providerOrder` for fallback. The client half (`src/client.tsx`) registers the React configuration card, reading and writing the same `web-search-free` namespace. That namespace string is what aligns the two halves.

<details>
<summary>Deeper implementation notes (click to expand)</summary>

**Why it does not mount `tool-web` itself**: mounting the `web_fetch` tool belongs to the composition (dsh ≥ 0.1.5) — `dsh-base`'s `tool-web` row mounts it on TUI/headless, and on the Web surface each agent preset mounts its own row. Preset files are loaded by dsh-agent-presets from its own roots and are not part of the profile patch stack, so a bundle patch cannot reach them — and none needs to: every one of those rows draws from the same capability seam, which the `web` override above already points here. Self-mounting would only duplicate-register `web_fetch` against the preset rows, and since a per-agent scope shadows a global registration, unloading this plugin's fiber could never remove the preset's copy.

**Why `enableFetch` is a provider gate**: it is implemented as the fetch provider's **availability** — the seam reads `available()` on each execution, so with the switch off `web_fetch` stays in the catalog but every call returns a structured `WEB_PROVIDER_CONFIGURED_UNAVAILABLE` error (dsh's own semantics). Toggling takes effect immediately, with no watch or remount wiring. Both provider registrations hang off `ctx.effect`, so a disabled plugin or a hot reload withdraws them from the seam instead of hitting `WEB_DUPLICATE_PROVIDER` on the next apply.

**How the card keeps up with dsh's slot renames**: the client half holds a table of candidate slots (`SLOT_CANDIDATES`) and calls `ctx.slots.inject` once per candidate — that call *waits* for a slot the host has never declared rather than throwing, so one build serves several dsh versions. An arbiter keeps exactly one card mounted even if some transitional release declares both. When none of them turns up, it prints the diagnostic line above.

**How the settings face keeps up across generations**: the service carrying the settings section changed too — dsh >= 0.1.7 provides `configForms` (forms keyed by profile entry id), <= 0.1.6 provides `settingsScope` (bound to a registered namespace). Their `getSnapshot` / `subscribe` / `set` / `unset` are identical, so the card itself never learns which it got. The crucial part is that **neither may be named in the top-level `inject`**: a service the host does not provide leaves the whole entry pending forever, and web boot treats an entry that did not activate as fatal (`web boot: 1 entry did not activate`), stopping the entire UI at "Failed to load plugins". Each is therefore awaited in its own child `ctx.inject()` fiber — a child fiber is not a loader entry, so a wait that never resolves costs nothing, and whichever arrives first mounts the card.

**Why every Config field is `.volatile()`**: dsh >= 0.1.7 deleted the settings-namespace registry. A plugin entry's own Config *is* its settings section, and the form is projected from the fields marked `.volatile()` — mark none and `volatileForm()` returns undefined, the entry never reaches the browser's describe mirror, and the card reads "unavailable" forever. The wrapping, however, is done by schemastery at parse time and is independent of the host version, so <= 0.1.6's `settings.register` must be handed the **unmarked** schema (otherwise every field surfaces as `{}`). Both schemas are therefore derived from one field table, and every read goes through `liveConfig()` to unwrap.

**Why the build has two steps** (the package declares `"type": "module"`): `tsconfig.json` (`module: NodeNext`) compiles the host half to ESM, matching the dsh runtime and avoiding the load race a CJS `require()` of an ESM dependency triggers; `tsconfig.client.json` (`module: CommonJS`) emits `dist/client.js` separately, which `wrap-client.cjs` then wraps as `window.__ModuleLoader__.load(...)` for dsh's browser-side module loader.

**The publish gate**: the plugin installs *beside* the profile, so every host service must resolve to the one instance of the running dsh. Any `@deepseek-ai/*` that lands in `dependencies` (or in a non-optional `peerDependencies` — pnpm installs those automatically) creates a private copy inside the user's profile that shadows the host's, and Cordis Service identity stops matching. That kind of breakage only shows up on other people's machines, so `prepublishOnly` runs `scripts/check-package.cjs` to block it before release. Run `pnpm run check` after touching `package.json`.

</details>

## Feedback and updates

Upstream dsh is still iterating quickly — slot positions, interface semantics and composition can all shift between releases, and this plugin will occasionally lag behind. If anything goes wrong — the card does not show up, an engine errors out, behavior is off on a new dsh — please [open an issue](https://github.com/MochiNek0/dsh-web-search-free/issues) with your dsh version and the error. The plugin will keep being updated to follow along.

Thanks to everyone for the support 🙏

## License

MIT — see [LICENSE](https://github.com/MochiNek0/dsh-web-search-free/blob/main/LICENSE).
