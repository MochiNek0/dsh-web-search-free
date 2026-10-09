# dsh-web-search-free

[中文](https://github.com/MochiNek0/dsh-web-search-free/blob/main/README.md) | English

A free web search / page fetching plugin for [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness). It replaces dsh's default `deepseek-official` channel with **multi-engine + automatic fallback**: engines with a key are tried in the order you set, and a failure or exhausted quota moves on to the next. One engine can hold several keys (one per line), rotated in order.

- **No model tokens**: calls each engine's retrieval endpoint directly, no LLM involved.
- **Takes over on install, falls back on removal**: installed as a dsh bundle layer, no manual profile edits.
- **Built-in configuration card**: reorder by dragging, add and test keys, view usage; follows dsh's language setting.
- **Requests leave from the host process only**: the browser side is just the card and contacts no outside service.

## Why "free"

Every search on the official `deepseek-official` channel is a **full model call** (with the server-side `web_search` tool), so both the search request and the sources injected back into the context cost tokens from your `DEEPSEEK_API_KEY` balance.

|                | Official `deepseek-official`                         | This plugin `web-search-free`                    |
| -------------- | ---------------------------------------------------- | ------------------------------------------------ |
| How it queries | LLM call + server-side search tool                   | Engine retrieval endpoints directly              |
| Model tokens   | Spent on every search                                | **0**                                            |
| Billed to      | DeepSeek API balance                                 | Each search API's own quota (most have free tiers) |
| Credentials    | **Requires** `DEEPSEEK_API_KEY`                      | Each engine's own key                            |
| Results        | Sources only; results the model did not quote have no snippet | Sources + snippets; Tavily adds a direct answer |

> If your chat model runs through a third party and `DEEPSEEK_API_KEY` is not set, dsh still selects the official channel and only fails with `WEB_PROVIDER_CREDENTIAL_MISSING` once the model actually calls `web_search`. This plugin needs no LLM credential.

## Supported engines

| Engine              | Search | Fetch | Result date | Free tier                                     | Get an API key                                           |
| ------------------- | :----: | :---: | :---------: | --------------------------------------------- | -------------------------------------------------------- |
| TinyFish            |   ✓    |   ✓   |   partial   | Free, rate-limited only                       | <https://www.tinyfish.ai/pricing>                        |
| SearXNG             |   ✓    |   ✗   |   partial   | Self-hosted, unlimited ("key" = instance URL) | <https://docs.searxng.org/admin/installation.html>       |
| AnySearch           |   ✓    |   ✓   |      ✗      | 1,000 calls/day                               | <https://anysearch.com/pricing>                          |
| Baidu Qianfan       |   ✓    |   ✗   |   partial   | Daily free quota (see the console)            | <https://console.bce.baidu.com/iam/#/iam/apikey/list>    |
| Tavily              |   ✓    |   ✓   |      ✗      | 1,000 credits/month                           | <https://app.tavily.com/>                                |
| Brave Search        |   ✓    |   ✗   |  **most**   | $5 credit/month (card required, not charged)  | <https://api-dashboard.search.brave.com/register>        |
| Exa (Metaphor)      |   ✓    |   ✓   |   partial   | $20 on signup + $10/month (rolls over)        | <https://dashboard.exa.ai/>                              |
| Firecrawl           |   ✓    |   ✓   |      ✗      | 1,000 credits/month (2 per 10 search results) | <https://www.firecrawl.dev/>                             |
| Volcengine (Doubao) |   ✓    |   ✗   |   partial   | 500 calls/month                               | <https://console.volcengine.com/search-infinity/api-key> |
| SerpApi             |   ✓    |   ✗   |    weak     | 250 calls/month                               | <https://serpapi.com/users/sign_up>                      |
| Jina AI             |   ✓    |   ✓   |   partial   | 10M tokens on a new key (one-time)            | <https://jina.ai/api-key>                                |
| Serping API         |   ✓    |   ✗   |   partial   | 1,000 per account (one-time, no card)         | <https://serpingapi.com/signup?ref=dsh-web-search-free>  |

The table order is the default call order: most sustainable free calls first (unlimited > daily reset > monthly reset > one-time), with lower signup friction breaking ties.

- **Fetching**: search-only engines (✗) never fetch. With no fetch-capable engine available, `web_fetch` falls back to keyless Jina Reader and dsh's local fetcher (see [Advanced settings](#advanced-settings)).
- **Result dates** let the model judge recency. Brave is the most complete (18/20 measured); Tavily returns no date for general search, and Firecrawl and AnySearch have no such field. Move Brave up if recency matters.

<details>
<summary>Per-engine notes</summary>

- **Jina**: `s.jina.ai` charges 10k tokens per search (≈1,000 searches); never resets.
- **Exa**: the balance never zeroes (≈1,400 basic searches).
- **TinyFish**: free tier is Search 30 req/min, Fetch 150 URLs/min.
- **SearXNG**: put instance URLs in the "key" box (e.g. `https://searx.example.com`), one per line. The instance must list `json` in `search.formats` in its `settings.yml`, or it answers 403.
- **Baidu Qianfan**: create the key on Baidu AI Cloud's API Key (V2) page; legacy AK/SK pairs do not work. Chinese web only.
- **Volcengine**: the key comes from "API Key management" in the web-search console; Ark keys do not work. Resets on the 1st; Chinese web only.

</details>

## Installation

Requires **dsh ≥ 0.1.2-rc.1** and `pnpm` on `PATH`. The card only appears in the Web UI, so install into the `web` profile:

```sh
dsh plugin --profile web add dsh-web-search-free
```

dsh then reconciles `dsh.profile.bundles` and the plugin takes over web search and fetch.

<details>
<summary>Installing from local source</summary>

```sh
pnpm install
pnpm build                          # produces dist/ (gitignored)
dsh plugin --profile web add .
```

Local directories are linked, so a later `pnpm build` applies right away; after changing client code, refresh the browser.

</details>

> dsh ≤ 0.1.2-alpha.5 does not mount the web tools: search works but `web_fetch` never appears. Use plugin 1.3.0 there.

## Configuration

Run `dsh web` and find the card:

| dsh version | Where the card is                                              |
| ----------- | -------------------------------------------------------------- |
| ≥ 0.1.6     | Sidebar **Plugins** → "Installed" → **web-search-free**        |
| ≤ 0.1.5     | **Settings → Plugins → Web Search Free**                       |

1. **Click an engine row** and paste keys (one per line); "Get an API key ↗" links to the signup page.
2. **Drag the `⋮⋮` handle** to set the call order: higher rows go first, failing through in order.
3. The **"Enable web_fetch"** switch at the top: when off, `web_fetch` calls return a clear error.
4. Click **Save**; it applies from the next search, no restart.

Configure at least one engine, or search fails with `No web search providers configured.`

The card also offers (needs a dsh with plugin route registration, verified on 0.2.0-rc.2; hidden on older versions):

- **Test keys**: one small search per key, showing success, result count, latency or the raw error. Uses one search of quota per key.
- **Usage**: calls, success rate, average latency, last error, cooldown state and cache hits per engine and key. In memory only; resets on restart.
- **Check for updates**: the host process asks the npm registry and shows the upgrade command if a newer version exists.

### Advanced settings

The "Advanced" section at the bottom is collapsed by default and works untouched. **Presets** at its top (Save quota / Fastest / Best quality / Chinese first / Reset to defaults) combine and apply on Save.

| Setting               | Field                 | Description                                                                                                                                   |
| --------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Search strategy       | `searchStrategy`      | `fallback` (default) one at a time, least quota; `race` queries the first N at once and takes the fastest; `merge` queries the first N and fuses results — best coverage, N× quota |
| Engines at once       | `parallelEngines`     | 2–4, default 2; `race` / `merge` only                                                                                                         |
| Region / language     | `region` / `language` | Default `auto`. Brave, SerpApi, Serping API, TinyFish and AnySearch take both; Tavily and Exa region only; SearXNG language only; the rest neither |
| Time range            | `freshness`           | `any` (default) / `day` / `week` / `month` / `year`. Not supported by AnySearch or Jina; Baidu Qianfan treats `day` as a week                  |
| Blocked domains       | `blockedDomains`      | One per line, subdomains included                                                                                                             |
| Preferred domains     | `preferredDomains`    | One per line; results from them move to the top                                                                                               |
| Snippet length        | `snippetLength`       | 100–1000, default 300                                                                                                                         |
| Tavily search depth   | `tavilySearchDepth`   | `basic` (default, 1 credit) / `advanced` (2 credits)                                                                                          |
| Fetch source          | `fetchSource`         | `providers` (default): keyed engines → keyless Jina → dsh's local fetcher; `dsh`: dsh's local fetcher only (free, no third party, no JS rendering) |
| Keyless fetch fallback | `keylessJinaFetch`   | On by default: when every keyed fetch fails, use Jina Reader without a key (20 req/min; the URL is sent to Jina)                              |
| Cache                 | `cacheMinutes`        | 0–60 minutes, default 10; identical requests are served from cache without using quota. 0 turns it off                                        |

Each (engine, key) attempt has its own time limit (10 s search, 20 s fetch). A key that returns 401/402/403/429 or reports exhausted quota moves to the back of the chain for a while (2 minutes for 429, 30 minutes otherwise). When everything fails, the error lists each attempt's reason with keys masked.

### Manual configuration

If the card does not show up (the browser console prints `[web-search-free] no settings card mounted: …` — please paste it into an issue), edit `~/.dsh/profiles/web/cordis.patch.yml` directly. The install already inserted the `web-search-free` row, so **override its config by id** — do not add another `insert`:

```yaml
- id: web-search-free
  config:
    tavilyApiKey: tvly-xxxxxxxx
    exaApiKey: |-
      key-1
      key-2
    providerOrder: [tavily, exa, tinyfish]
    searchStrategy: merge
```

Field names follow `Config` in `src/index.ts`: `<engine>ApiKey` (multi-line string for several keys), `enableFetch`, `providerOrder`, plus the fields above. Restart dsh to apply. On dsh ≥ 0.1.7 the card writes this same file, so saving from the card overwrites matching fields.

### Keys gone after upgrading to dsh 0.1.7

dsh 0.1.7 migrates settings from `~/.dsh/settings.yaml` into the profile's `cordis.patch.yml`, once. If the plugin could not start at that moment (1.5.x stops the Web UI at "Failed to load plugins" on 0.1.7), the keys stay in `~/.dsh/settings.yaml.imported`. When the plugin detects this, it says so in the log and on the card. Re-enter the keys in the card, or hand this to dsh:

> Move every field of the web-search-free section in settings.yaml.imported (under the dsh home, ~/.dsh by default) into the current profile's cordis.patch.yml, as the config of the entry with id web-search-free; add that entry if it is missing. Preserve the file's existing comments and formatting, and back it up first.

## Updating and uninstalling

```sh
dsh plugin --profile web update dsh-web-search-free
dsh plugin --profile web remove dsh-web-search-free
```

After removal, web search/fetch falls back to `deepseek-official`. Note:

- **Click "Clear all settings" on the card before uninstalling**, or your keys stay in dsh's config files.
- **Restart dsh after uninstalling**, or search fails with `WEB_PROVIDER_CONFIGURED_MISSING`.

## How it works

The plugin is a dsh bundle layer: `cordis.patch.yml` inserts a `web-search-free` row and points the `web` row's `searchProvider` / `fetchProvider` at it. The host half (`src/index.ts`) registers the search and fetch providers and walks `providerOrder`; the client half (`src/client.tsx`) provides the card. See source comments for details.

Development note: no `@deepseek-ai/*` package may go into `dependencies` or a non-optional `peerDependencies`, or a private copy lands in the user's profile and shadows the host's instance. Run `pnpm run check` after touching `package.json` (it also runs before publishing).

## Feedback

dsh is still moving fast and this plugin may lag behind at times. Please [open an issue](https://github.com/MochiNek0/dsh-web-search-free/issues) with your dsh version and the error.

## License

[MIT](https://github.com/MochiNek0/dsh-web-search-free/blob/main/LICENSE)
