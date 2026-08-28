import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { availableProviders } from './providers/index.js'
import { WebSearchProvider as MyProvider } from './types.js'

export const name = 'web-search-free'
export const inject = ['web']

/**
 * Settings namespace this plugin owns. The browser card in `./client` is keyed
 * on this string: the Plugins settings tab dispatches `settings.plugin.item`
 * per namespace the Host serves, so the two halves must spell it identically.
 */
export const SETTINGS_NAMESPACE = 'web-search-free'

export interface Config {
  jinaApiKey?: string
  exaApiKey?: string
  tavilyApiKey?: string
  firecrawlApiKey?: string
  braveApiKey?: string
  anysearchApiKey?: string
  tinyfishApiKey?: string
  serpapiApiKey?: string
  /**
   * Whether the model gets a `web_fetch` tool at all. Search is always on.
   * Owned by {@link createFetchToolMount}, which mounts and unmounts tool-web
   * to match; this is a tool switch, not just a backend one.
   */
  enableFetch?: boolean
  providerOrder: string[]
}

export const Config = Schema.object({
  jinaApiKey: Schema.string().description('API key(s) for Jina AI. One key per line for multi-key rotation.'),
  exaApiKey: Schema.string().description('API key(s) for Exa (Metaphor). One key per line for multi-key rotation.'),
  tavilyApiKey: Schema.string().description('API key(s) for Tavily. One key per line for multi-key rotation.'),
  firecrawlApiKey: Schema.string().description('API key(s) for Firecrawl. One key per line for multi-key rotation.'),
  braveApiKey: Schema.string().description('API key(s) for Brave Search. One key per line for multi-key rotation.'),
  anysearchApiKey: Schema.string().description('API key(s) for AnySearch. One key per line for multi-key rotation.'),
  tinyfishApiKey: Schema.string().description('API key(s) for TinyFish. One key per line for multi-key rotation.'),
  serpapiApiKey: Schema.string().description('API key(s) for SerpApi. One key per line for multi-key rotation.'),
  enableFetch: Schema.boolean().default(true).description('是否为模型挂载 web_fetch（URL 内容抓取）。关闭后该工具会从模型的工具表里移除，只保留搜索；切换即时生效，无需重启。'),
  providerOrder: Schema.array(Schema.union(['jina', 'exa', 'tavily', 'firecrawl', 'brave', 'anysearch', 'tinyfish', 'serpapi']))
    .default(['tinyfish', 'anysearch', 'exa', 'tavily', 'firecrawl', 'brave', 'serpapi', 'jina'])
    .description('定义 Provider 的调用顺序。排在前面的服务会优先执行，如果请求失败（或额度用尽），会自动按照该顺序 fallback 到下一个可用服务。')
})

/** Short, non-leaking token for log lines so a failing key is identifiable without printing it. */
function maskKey(key: string): string {
  if (!key) return '***'
  if (key.length <= 8) return '***'
  return `${key.slice(0, 4)}…${key.slice(-3)}`
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    web: any
    settings: any
  }
}

/**
 * Load the HOST's own `@deepseek-ai/dsh-tool-web` — not a copy of our own.
 *
 * A bare `import` from this package would fail: the plugin is installed beside
 * the profile (or linked from a checkout), and `@deepseek-ai/dsh-tool-web` is
 * not on its Node resolution chain. It IS resolvable from the profile
 * directory, which is what `ctx.baseUrl` points at, so resolution is anchored
 * there. That also guarantees we mount the very instance the running dsh uses,
 * rather than pulling a second copy with its own `dsh-tools` / `dsh-web`.
 *
 * Returns a plain object rather than the module namespace: the namespace is
 * frozen, and cordis only needs `apply` plus the metadata.
 */
async function loadToolWeb(ctx: Context) {
  const baseUrl = (ctx as any).baseUrl
  if (!baseUrl) throw new Error('ctx.baseUrl is unset; cannot anchor tool-web resolution')
  const entry = createRequire(baseUrl).resolve('@deepseek-ai/dsh-tool-web')
  const mod: any = await import(pathToFileURL(entry).href)
  return { name: mod.name, inject: mod.inject, Config: mod.Config, apply: mod.apply }
}

/**
 * Own the model-facing `web_fetch` tool's lifetime, so the `enableFetch`
 * setting is a real tool switch rather than a backend one.
 *
 * Whether the model SEES `web_fetch` is decided by tool-web's `fetch` config at
 * mount time — "Enablement controls tool registration; an enabled tool remains
 * visible when its provider is unavailable and fails with a structured error at
 * execution time" (dsh-tool-web). A settings flag the seam reads can therefore
 * only make the tool fail, never disappear. Mounting tool-web ourselves as a
 * child fiber does: `ctx.plugin` registers into the global tool layer that every
 * agent scope inherits, and disposing the fiber runs tool-web's own effect-scoped
 * disposers, taking `web_fetch` and its prompt section back out.
 *
 * `search: false` keeps us out of the `web_search` business entirely — whatever
 * the composition already mounts (a preset's scoped row on the Web surface, the
 * host row on TUI/headless) stays the sole owner of that name.
 *
 * Deliberately NOT gated on API keys: a key-less fetch chain still yields a
 * clear WEB_PROVIDER_CONFIGURED_UNAVAILABLE from the seam, and a tool that
 * blinks in and out as keys are edited is worse than one that reports why it
 * cannot run.
 */
function createFetchToolMount(ctx: Context, logger: any, wanted: () => boolean) {
  let fiber: { dispose(): Promise<void> | void } | null = null
  let plugin: Awaited<ReturnType<typeof loadToolWeb>> | null = null
  // Toggles are serialized: `watch` callbacks and the initial sync can overlap,
  // and a mount racing an unmount would strand a fiber holding `web_fetch`.
  let chain: Promise<void> = Promise.resolve()

  const sync = () => {
    chain = chain.then(async () => {
      const want = wanted()
      if (want === (fiber !== null)) return

      if (!want) {
        const current = fiber
        fiber = null
        await current!.dispose()
        return
      }

      // No guard against a composition that ALSO mounts tool-web with
      // `fetch: true` (a user patch, or a profile that never disabled the host
      // row). A pre-check reads the registry at whatever moment this runs, and
      // measurement says we usually get there first — the other row then throws
      // its own duplicate-registration error, which the pre-check cannot
      // prevent, so it would only buy false confidence. That throw is contained
      // by cordis (logged against `tool-web`; the tree keeps running and its
      // `web_search` survives), and `web_fetch` still works — served by us. The
      // fix for anyone hitting it is to pick one owner, not to make this
      // defensive.
      plugin = plugin ?? await loadToolWeb(ctx)
      fiber = ctx.plugin(plugin as any, { search: false, fetch: true })
    }).catch((err: any) => {
      logger.warn?.(`Failed to ${wanted() ? 'mount' : 'unmount'} web_fetch: ${err?.message}. Web search is unaffected.`)
    })
  }

  // Our own disposal tears the child down with us; this only covers the
  // toggled-off path so a dispose mid-flight cannot outrun the chain.
  ctx.effect(() => () => {
    chain = chain.then(async () => {
      const current = fiber
      fiber = null
      await current?.dispose()
    })
  })

  return sync
}

export function apply(ctx: Context, config: Config) {
  const logger = ctx.logger?.('web-search-free') || console

  // Register the settings namespace so the user layer (written by the Plugins
  // settings card) exists at all: a namespace the Host does not serve is never
  // dispatched to a card. Each call projects the section fresh, so a key saved
  // in the UI reaches the next search without a restart.
  let resolved: () => Config = () => config

  // Owns `web_fetch`'s registration; re-read after every settings commit so the
  // toggle takes effect without a restart.
  const syncFetchTool = createFetchToolMount(ctx, logger, () => resolved().enableFetch !== false)

  ctx.inject(['settings'], (sctx) => {
    const scope = sctx.settings.register(SETTINGS_NAMESPACE, Config, { base: config })
    resolved = () => scope.get()
    syncFetchTool()
    sctx.effect(() => scope.watch(() => syncFetchTool()))
    sctx.effect(() => () => {
      resolved = () => config
      syncFetchTool()
    })
  })

  // Composition-only value until (and unless) a settings service shows up.
  syncFetchTool()

  const getActiveProviders = (capability?: 'search' | 'fetch') => {
    const current = resolved()
    const activeProviders: { provider: MyProvider; keys: string[] }[] = []

    const orderedNames = Array.from(new Set([
      ...(current.providerOrder || []),
      ...Object.keys(availableProviders)
    ]))

    for (const name of orderedNames) {
      const provider = availableProviders[name]
      if (!provider) continue
      // Brave (and any future search-only provider) declares
      // `supportsFetch: false`; keep it in the search chain but skip it for
      // fetch so the fetch fallback chain never wastes a round on a node that
      // can only throw.
      if (capability === 'fetch' && provider.supportsFetch === false) continue

      const configKey = `${name}ApiKey` as keyof Config
      const raw = current[configKey]
      if (typeof raw === 'string' && raw.trim() !== '') {
        // A key field may hold several keys, one per line. Empty lines and
        // surrounding whitespace are stripped; rotation tries them in order.
        const keys = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
        if (keys.length > 0) activeProviders.push({ provider, keys })
      }
    }
    return activeProviders
  }

  ctx.web?.registerSearchProvider({
    id: 'web-search-free',
    available: () => getActiveProviders('search').length > 0,
    async search(request: any, signal: any) {
      const activeProviders = getActiveProviders('search')
      if (activeProviders.length === 0) {
        throw new Error('No web search providers configured. Please set at least one API key in config.')
      }

      let lastError: Error | null = null

      for (const { provider, keys } of activeProviders) {
        for (const key of keys) {
          try {
            const result = await provider.search(request.query, key, signal)
            if (typeof result === 'string') {
              return { content: result, sources: [], truncated: false }
            }
            return { content: result.content || '', sources: result.sources || [], truncated: false }
          } catch (err: any) {
            lastError = err
            if (logger && logger.warn) {
              logger.warn(`Provider ${provider.name} (key ${maskKey(key)}) search failed: ${err.message}. Trying next key/provider...`)
            }
            continue
          }
        }
      }
      throw new Error(`All configured search providers failed. Last error: ${lastError?.message}`)
    }
  })

  ctx.web?.registerFetchProvider({
    id: 'web-search-free',
    // `enableFetch` is checked here too, not just at the mount: the tool and the
    // provider are separate registrations, and a composition that mounts
    // `web_fetch` some other way must not reach a backend the user switched off.
    available: () => resolved().enableFetch !== false && getActiveProviders('fetch').length > 0,
    async fetch(request: any, signal: any) {
      const activeProviders = getActiveProviders('fetch')
      if (activeProviders.length === 0) {
        throw new Error('No web fetch providers configured. Please set at least one API key in config.')
      }

      let lastError: Error | null = null

      for (const { provider, keys } of activeProviders) {
        for (const key of keys) {
          try {
            const result = await provider.fetch(request.url, key, signal)
            // Propagate the provider-reported truncation instead of a hardcoded
            // false: the official `dsh-tool-web` seam ORs this with its own
            // `fetchMaxOutputChars` cap and any source-character cut, so the
            // provider's own cap (e.g. Exa's 10000-char text limit, Firecrawl's
            // truncation warning) must be reflected here to be honest.
            return {
              url: request.url,
              statusCode: 200,
              body: { kind: 'text', content: result.content },
              truncated: result.truncated,
            }
          } catch (err: any) {
            lastError = err
            if (logger && logger.warn) {
              logger.warn(`Provider ${provider.name} (key ${maskKey(key)}) fetch failed: ${err.message}. Trying next key/provider...`)
            }
            continue
          }
        }
      }
      throw new Error(`All configured fetch providers failed. Last error: ${lastError?.message}`)
    }
  })
}
