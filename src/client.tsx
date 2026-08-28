import * as React from "react";

/**
 * Must equal the namespace the Host half registers: the Plugins settings tab
 * dispatches `settings.plugin.item` once per served namespace, using it as the
 * keyed slot's entry key.
 */
const NAMESPACE = "web-search-free";

/**
 * All backends the host half knows about; the order here is the default fallback.
 *
 * The free-tier hint shown under each engine is NOT stored here: it is copy, so
 * it lives in the dictionaries below under `free.<key>`, keyed by `key`. Keep it
 * terse — it's a one-line badge, not a pricing table.
 *
 * `caps.search` / `caps.fetch` drive the small capability chips on each row:
 * a search-only engine (Brave, SerpApi) shows just "搜索", one that also
 * fetches shows "搜索 · 抓取". This mirrors `supportsFetch` on the host side.
 */
type ProviderMeta = {
  key: string;
  field: string;
  label: string;
  signup: string;
  caps: { search: true; fetch?: true };
};

const PROVIDERS: ProviderMeta[] = [
  {
    key: "tinyfish",
    field: "tinyfishApiKey",
    label: "TinyFish",
    signup: "https://www.tinyfish.ai/pricing",
    caps: { search: true, fetch: true },
  },
  {
    key: "anysearch",
    field: "anysearchApiKey",
    label: "AnySearch",
    signup: "https://anysearch.com/pricing",
    caps: { search: true, fetch: true },
  },
  {
    key: "exa",
    field: "exaApiKey",
    label: "Exa (Metaphor)",
    signup: "https://dashboard.exa.ai/",
    caps: { search: true, fetch: true },
  },
  {
    key: "tavily",
    field: "tavilyApiKey",
    label: "Tavily",
    signup: "https://app.tavily.com/",
    caps: { search: true, fetch: true },
  },
  {
    key: "firecrawl",
    field: "firecrawlApiKey",
    label: "Firecrawl",
    signup: "https://www.firecrawl.dev/",
    caps: { search: true, fetch: true },
  },
  {
    key: "brave",
    field: "braveApiKey",
    label: "Brave Search",
    signup: "https://api-dashboard.search.brave.com/register",
    caps: { search: true },
  },
  {
    key: "serpapi",
    field: "serpapiApiKey",
    label: "SerpApi",
    signup: "https://serpapi.com/users/sign_up",
    caps: { search: true },
  },
  {
    key: "jina",
    field: "jinaApiKey",
    label: "Jina AI",
    signup: "https://jina.ai/api-key",
    caps: { search: true, fetch: true },
  },
];
const DEFAULT_ORDER = PROVIDERS.map((p) => p.key);
const byKey = (key: string) => PROVIDERS.find((p) => p.key === key)!;

/** Split a multi-key field into trimmed, non-empty lines. */
const parseKeys = (raw: string): string[] =>
  (raw || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

/** Canonical storage form: one key per line, no blanks, trimmed. */
const normalizeKeys = (raw: string): string => parseKeys(raw).join("\n");

/** The two languages dsh ships; `LocaleSnapshot.active` is one of these. */
type Lang = "zh" | "en";

/**
 * Every user-visible string in this card, flat keys with `{name}` placeholders.
 *
 * zh is the key-set source of truth (the repo convention `dsh-client-locale`
 * follows); `en` is typed against it, so a missing or extra English key is a
 * compile error rather than a string that silently falls back at runtime.
 */
const zh = {
  "body.loading": "正在读取设置…",
  "body.unavailable": "该连接不同步设置，无法在此配置。",
  intro:
    "填了 Key 的引擎进入「调用顺序」：排在前面的优先调用，失败则 fallback 到下一个，拖 ⋮⋮ 可改顺序。每个引擎可填多个 Key（每行一个），同一引擎内也按顺序轮换。",
  "fetch.label": "启用 web_fetch（URL 抓取）",
  "fetch.on":
    "已开启：模型可调用 web_fetch，由上面填了 Key 的引擎按顺序抓取 URL 全文。",
  "fetch.off":
    "已关闭：web_fetch 工具会从模型的工具表里移除，只保留搜索。切换即时生效，无需重启。",
  "caps.searchFetch": "搜索 · 抓取",
  "caps.searchOnly": "仅搜索",
  "row.rotating": "{count} 个 Key · 按顺序轮换",
  "row.cleared": "已清空 · 保存后移出调用链",
  "row.joining": "{count} 个 Key · 保存后加入调用链",
  "row.unconfigured": "未配置",
  "row.hint": "点击填入 Key 启用",
  "row.dragTitle": "拖动调整调用顺序",
  "row.placeholder": "每行一个 API Key，支持多 Key 轮换",
  "row.signup": "获取 API Key ↗",
  "chain.label": "调用顺序",
  "chain.labelCount": "调用顺序 · {count} 个引擎（拖 ⋮⋮ 排序）",
  "chain.empty":
    "还没有引擎进入调用链。在下面挑一个填入 API Key，保存后它就会出现在这里。",
  "rest.label": "其他可用引擎 ({count})",
  "clear.title":
    "删除本插件在 dsh 设置文件中的全部配置，卸载前用它可以不留残留",
  "clear.idle": "清空全部配置",
  "clear.armed": "确认清空？不可撤销",
  "clear.busy": "清空中…",
  "action.discard": "放弃",
  "action.save": "保存",
  "action.saving": "保存中…",
  "error.save": "部分字段未保存成功，请重试。",
  "error.clear": "未能清空：{names}，请重试。",
  /** Joins the engine names in `error.clear`; zh uses the enumeration comma. */
  "list.separator": "、",
  "summary.configured": "{count} 个引擎已配置",
  "summary.none": "尚未配置任何引擎",
  /** The card's own name, as it appears in the Plugins list. */
  "header.title": "免费网页搜索",
  // Deliberately does NOT repeat the title: the two lines sit one above the
  // other, so the subtitle carries what the name does not — how it works.
  "header.subtitle": "多引擎自动 fallback · {summary}",
  "header.unsaved": "未保存",
  "header.engines": "{count} 引擎",
  "free.tinyfish": "搜索/抓取免费",
  "free.anysearch": "1000 次/天（每日重置）",
  "free.exa": "$10 credit/月（累积不清零）",
  "free.tavily": "1000 credits/月",
  "free.firecrawl": "1000 credits/月",
  "free.brave": "$5 额度/月（需绑卡）",
  "free.serpapi": "250 次/月",
  "free.jina": "10M tokens（一次性）",
};

const en: Record<keyof typeof zh, string> = {
  "body.loading": "Loading settings…",
  "body.unavailable":
    "This connection does not sync settings, so it cannot be configured here.",
  intro:
    "Engines with a key join the call order: the first one is tried first, and a failure falls back to the next. Drag ⋮⋮ to reorder. Each engine takes several keys (one per line), rotated in order too.",
  "fetch.label": "Enable web_fetch (URL fetching)",
  "fetch.on":
    "On: the model can call web_fetch, and the keyed engines above fetch full page text in order.",
  "fetch.off":
    "Off: web_fetch is removed from the model’s tool list, leaving search only. Takes effect immediately, no restart.",
  "caps.searchFetch": "Search · Fetch",
  "caps.searchOnly": "Search only",
  "row.rotating": "{count} key(s) · rotated in order",
  "row.cleared": "Cleared · leaves the call order on save",
  "row.joining": "{count} key(s) · joins the call order on save",
  "row.unconfigured": "Not configured",
  "row.hint": "Click to add a key",
  "row.dragTitle": "Drag to change the call order",
  "row.placeholder": "One API key per line, rotated across keys",
  "row.signup": "Get an API key ↗",
  "chain.label": "Call order",
  "chain.labelCount": "Call order · {count} engine(s) (drag ⋮⋮ to sort)",
  "chain.empty":
    "No engine is in the call order yet. Pick one below, add an API key, and it appears here once saved.",
  "rest.label": "Other available engines ({count})",
  "clear.title":
    "Delete every setting this plugin holds in the dsh settings file — run it before uninstalling to leave nothing behind",
  "clear.idle": "Clear all settings",
  "clear.armed": "Confirm clear? Cannot be undone",
  "clear.busy": "Clearing…",
  "action.discard": "Discard",
  "action.save": "Save",
  "action.saving": "Saving…",
  "error.save": "Some fields were not saved. Please try again.",
  "error.clear": "Could not clear: {names}. Please try again.",
  "list.separator": ", ",
  "summary.configured": "{count} engine(s) configured",
  "summary.none": "No engine configured yet",
  "header.title": "Web Search Free",
  "header.subtitle": "Multi-engine automatic fallback · {summary}",
  "header.unsaved": "Unsaved",
  "header.engines": "{count} engine(s)",
  "free.tinyfish": "Search & fetch free",
  "free.anysearch": "1000 calls/day (resets daily)",
  "free.exa": "$10 credit/month (rolls over)",
  "free.tavily": "1000 credits/month",
  "free.firecrawl": "1000 credits/month",
  "free.brave": "$5 credit/month (card required)",
  "free.serpapi": "250 calls/month",
  "free.jina": "10M tokens (one-time)",
};

const DICTS: Record<Lang, Record<string, string>> = { zh, en };

type TKey = keyof typeof zh;
type Translate = (key: TKey, params?: Record<string, unknown>) => string;

/**
 * Language to stand in wherever the host has no locale service to ask — the
 * same primary-subtag rule `dsh-client-locale` uses for a fresh browser.
 */
const browserLang = (): Lang =>
  typeof navigator !== "undefined" &&
  (navigator.language || "").toLowerCase().split("-")[0] === "en"
    ? "en"
    : "zh";

/**
 * Follow the host's Language preference (Settings → General), re-rendering on
 * every switch.
 *
 * `locale` is read WITHOUT declaring it in `inject`, so a host that does not
 * ship `@deepseek-ai/dsh-client-locale` leaves the card working on the
 * browser-derived language instead of never mounting it at all.
 */
const useLang = (locale: any): Lang => {
  const active = React.useSyncExternalStore(
    React.useCallback(
      (listener: () => void) =>
        locale ? locale.subscribe(listener) : () => {},
      [locale],
    ),
    React.useCallback(
      () => (locale ? locale.getSnapshot().active : null),
      [locale],
    ),
  );
  return active === "en" || active === "zh" ? active : browserLang();
};

/** Look a key up in the active language, falling back to zh, then to the key. */
const translate =
  (lang: Lang): Translate =>
  (key, params) => {
    const raw = DICTS[lang][key] ?? zh[key] ?? key;
    if (!params) return raw;
    return raw.replace(/\{(\w+)\}/g, (whole, name) =>
      name in params ? String(params[name]) : whole,
    );
  };

// `settingsScope.bind` reads `connection` and `remote` off the CALLING context,
// so both must be declared here alongside the services this plugin uses itself.
export const inject = ["slots", "settingsScope", "connection", "remote"];

export function apply(ctx: any) {
  const scope = ctx.settingsScope.bind({ namespace: NAMESPACE });

  ctx.slots.inject("settings.plugin.item", () =>
    ctx.slots.register(
      {
        name: "settings.plugin.item",
        key: NAMESPACE,
        // `reflect.get` is the read that does not require an `inject` entry: it
        // returns undefined rather than throwing when no locale plugin is loaded.
        inject: () => ({ scope, locale: ctx.reflect.get("locale") }),
      },
      WebSearchFreeCard,
    ),
  );
}

type Snapshot = {
  status: "loading" | "ready" | "unavailable";
  value?: {
    jinaApiKey?: string;
    exaApiKey?: string;
    tavilyApiKey?: string;
    firecrawlApiKey?: string;
    braveApiKey?: string;
    anysearchApiKey?: string;
    tinyfishApiKey?: string;
    serpapiApiKey?: string;
    enableFetch?: boolean;
    providerOrder?: string[];
  };
  /**
   * The raw user layer, as opposed to `value`'s base+user resolution. Only this
   * says whether a field is actually stored: `value` always carries the
   * schema's defaults, so it can never distinguish "saved" from "defaulted".
   */
  user?: unknown;
  writable?: boolean;
};

/**
 * A provider field is "configured" if either a draft holds a non-empty value or
 * the resolved value does. Centralizing this keeps the collapsed summary count
 * and the per-row badge on the same page about what counts as active.
 */
const isConfigured = (
  field: string,
  snapshot: Snapshot,
  drafts: Record<string, string>,
): boolean => {
  const draft = drafts[field];
  if (draft !== undefined) return parseKeys(draft).length > 0;
  const stored =
    snapshot.value?.[field as keyof NonNullable<Snapshot["value"]>];
  return typeof stored === "string" && parseKeys(stored).length > 0;
};

function WebSearchFreeCard({ scope, locale }: { scope: any; locale?: any }) {
  const snapshot: Snapshot = React.useSyncExternalStore(
    React.useCallback(
      (listener: () => void) => scope.subscribe(listener),
      [scope],
    ),
    () => scope.getSnapshot(),
  );
  const lang = useLang(locale);
  const t = React.useMemo(() => translate(lang), [lang]);
  const [open, setOpen] = React.useState(false);
  const [expandedRows, setExpandedRows] = React.useState<
    Record<string, boolean>
  >({});
  const [keyDrafts, setKeyDrafts] = React.useState<Record<string, string>>({});
  const [orderDraft, setOrderDraft] = React.useState<string[] | null>(null);
  const [enableFetchDraft, setEnableFetchDraft] = React.useState<
    boolean | null
  >(null);
  const [dragKey, setDragKey] = React.useState<string | null>(null);
  const [dropTarget, setDropTarget] = React.useState<string | null>(null);
  // Which row, if any, has its drag armed. Rows are NOT permanently
  // `draggable`: with the flag hard-on, dragging to select text inside a row's
  // textarea starts a row drag instead, so keys cannot be edited with a mouse.
  // Pressing the ⋮⋮ handle arms the row for the drag that immediately follows.
  const [dragArmed, setDragArmed] = React.useState<string | null>(null);
  // `null` = follow the default: collapsed once something is in the chain,
  // expanded while nothing is, so a fresh install still shows every engine.
  const [restOpen, setRestOpen] = React.useState<boolean | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [clearing, setClearing] = React.useState(false);
  // Two-click arm for the destructive clear. Deliberately NOT `window.confirm`:
  // this bundle runs in whatever webview the host embeds, and an embedded
  // webview may make `confirm()` a no-op returning false — which would leave
  // the button silently dead. An in-page arm behaves the same everywhere and
  // needs no UI primitive from the host.
  const [armed, setArmed] = React.useState(false);
  const [failed, setFailed] = React.useState("");

  // Let go of the arm if the user walks away from it.
  React.useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), 5000);
    return () => window.clearTimeout(timer);
  }, [armed]);

  const storedKey = (field: string) => {
    const value =
      snapshot.value?.[field as keyof NonNullable<Snapshot["value"]>];
    return typeof value === "string" ? value : "";
  };
  // A stored order was written against the provider set of its day, so it is a
  // subset, not the whole list — an engine added afterwards is simply absent
  // from it. Rendering the stored array verbatim therefore hides every new
  // engine forever. Union it with the current defaults, exactly as the Host's
  // own `getActiveProviders` does, so the card and the fallback chain always
  // agree on which engines exist.
  const storedOrder = (): string[] => {
    const raw = snapshot.value?.providerOrder;
    const known = Array.isArray(raw)
      ? raw.filter((k) => PROVIDERS.some((p) => p.key === k))
      : [];
    return Array.from(new Set([...known, ...DEFAULT_ORDER]));
  };
  const order = orderDraft ?? storedOrder();
  // enableFetch defaults to true (schema default); only an explicit false is "off".
  const storedEnableFetch = (): boolean =>
    snapshot.value?.enableFetch !== false;
  const enableFetch = enableFetchDraft ?? storedEnableFetch();

  const keyDirty = PROVIDERS.filter(
    (p) =>
      p.field in keyDrafts &&
      normalizeKeys(keyDrafts[p.field]) !== normalizeKeys(storedKey(p.field)),
  );
  const orderDirty =
    orderDraft !== null &&
    JSON.stringify(orderDraft) !== JSON.stringify(storedOrder());
  const enableFetchDirty =
    enableFetchDraft !== null && enableFetchDraft !== storedEnableFetch();
  const dirty = keyDirty.length > 0 || orderDirty || enableFetchDirty;
  const disabled = saving || clearing || snapshot.writable === false;
  // Anything to erase? Read the user layer, not the resolved value: the latter
  // always carries the schema defaults and would report "configured" forever.
  const userLayer =
    typeof snapshot.user === "object" && snapshot.user !== null
      ? (snapshot.user as Record<string, unknown>)
      : {};
  const configuredCount = PROVIDERS.filter((p) =>
    isConfigured(p.field, snapshot, keyDrafts),
  ).length;
  const configured = Object.keys(userLayer).length > 0;

  const toggleRow = (key: string) =>
    setExpandedRows((s) => ({ ...s, [key]: !s[key] }));

  const save = async () => {
    setSaving(true);
    setFailed("");
    const pending = keyDirty.map((p) => ({
      field: p.field,
      value: normalizeKeys(keyDrafts[p.field]),
    }));
    for (const { field, value } of pending) {
      if (value === "") await scope.unset(field);
      else await scope.set(field, value);
    }
    if (orderDirty && orderDraft !== null)
      await scope.set("providerOrder", orderDraft);
    if (enableFetchDirty && enableFetchDraft !== null)
      await scope.set("enableFetch", enableFetchDraft);
    // Writes swallow wire and revision failures and reload instead of throwing,
    // so the Host's readback is the only authority on what actually landed.
    const after = scope.getSnapshot();
    const rejectedKeys = pending.filter(
      ({ field, value }) =>
        (after.value?.[
          field as keyof NonNullable<Snapshot["value"]> as string
        ] ?? "") !== value,
    );
    const orderLanded =
      JSON.stringify(after.value?.providerOrder ?? DEFAULT_ORDER) ===
      JSON.stringify(orderDraft ?? storedOrder());
    const enableFetchLanded =
      (after.value?.enableFetch !== false) ===
      (enableFetchDraft ?? storedEnableFetch());
    setKeyDrafts(
      Object.fromEntries(
        rejectedKeys.map(({ field, value }) => [field, value]),
      ),
    );
    if (!orderLanded) setOrderDraft(null);
    if (!enableFetchLanded) setEnableFetchDraft(null);
    if (rejectedKeys.length > 0 || !orderLanded || !enableFetchLanded)
      setFailed(t("error.save"));
    setSaving(false);
  };

  // Erase every stored value in this plugin's user layer.
  //
  // Uninstalling drops the bundle patch and every registration, but nothing in
  // dsh removes a namespace's stored section — without this, the API keys
  // outlive the plugin on disk. Run it before uninstalling.
  //
  // The section KEY survives: the file provider patches a namespace by diffing
  // its children (`patchNode`), so clearing every field leaves a bare
  // `web-search-free:` entry with nothing under it. No API exposed to a client
  // can delete the key itself, and an empty key carries no secret.
  //
  // Deliberately destructive, so it confirms first.
  const clearAll = async () => {
    setArmed(false);
    setClearing(true);
    setFailed("");
    for (const field of [
      ...PROVIDERS.map((p) => p.field),
      "providerOrder",
      "enableFetch",
    ]) {
      await scope.unset(field);
    }
    // Drop the drafts too: they were edits against a section that no longer
    // exists, and keeping them would re-show the cleared keys as unsaved.
    setKeyDrafts({});
    setOrderDraft(null);
    setEnableFetchDraft(null);
    const after = scope.getSnapshot();
    const leftover = PROVIDERS.filter((p) => {
      const value =
        after.value?.[p.field as keyof NonNullable<Snapshot["value"]>];
      return typeof value === "string" && value !== "";
    });
    if (leftover.length > 0)
      setFailed(
        t("error.clear", {
          names: leftover.map((p) => p.label).join(t("list.separator")),
        }),
      );
    setClearing(false);
  };

  const reorder = (from: number, to: number) => {
    if (from === to) return;
    const next = [...order];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setOrderDraft(next);
  };
  const indexOfKey = (key: string) => order.indexOf(key);

  const cardBody = () => {
    if (snapshot.status === "loading") return [text(t("body.loading"))];
    if (snapshot.status === "unavailable") return [text(t("body.unavailable"))];
    const children: React.ReactNode[] = [];
    children.push(
      React.createElement(
        "div",
        {
          style: {
            fontSize: 13,
            color: "var(--dsw-alias-label-tertiary)",
            lineHeight: 1.6,
          },
        },
        t("intro"),
      ),
    );
    // web_fetch on/off — a top-level switch above the engine list. Search is
    // always on. The Host half owns tool-web's mount, so this genuinely adds and
    // removes the tool from the model's catalog; the copy below can say so.
    children.push(
      React.createElement(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontSize: 13,
            borderRadius: 8,
            padding: "8px 10px",
            border: "1px solid var(--dsw-alias-border-l2)",
            background: "var(--dsw-alias-bg-layer-3)",
          },
        },
        React.createElement(
          "span",
          {
            style: {
              flex: 1,
              color: "var(--dsw-alias-label-primary)",
              fontWeight: 500,
            },
          },
          t("fetch.label"),
        ),
        React.createElement(
          "button",
          {
            type: "button",
            role: "switch",
            "aria-checked": enableFetch,
            disabled,
            onClick: () => setEnableFetchDraft(!enableFetch),
            style: {
              appearance: "none",
              flex: "none",
              width: 36,
              height: 20,
              borderRadius: 999,
              border: "none",
              cursor: disabled ? "default" : "pointer",
              padding: 0,
              position: "relative",
              background: enableFetch
                ? "var(--dsw-alias-brand-primary)"
                : "var(--dsw-alias-bg-module-platform)",
              transition: "background .16s",
            },
          },
          React.createElement("span", {
            style: {
              position: "absolute",
              top: 2,
              left: enableFetch ? 18 : 2,
              width: 16,
              height: 16,
              borderRadius: "50%",
              background: "#fff",
              transition: "left .16s",
              boxShadow: "0 1px 3px rgba(0,0,0,.2)",
            },
          }),
        ),
      ),
      React.createElement(
        "div",
        {
          style: {
            fontSize: 11,
            color: "var(--dsw-alias-label-tertiary)",
            marginTop: -4,
          },
        },
        t(enableFetch ? "fetch.on" : "fetch.off"),
      ),
    );
    // Grouping is decided by what is SAVED, never by the drafts: a row that
    // hopped to the other group on the first keystroke would move out from
    // under the cursor mid-typing. Typing leaves the row in place and its
    // sub-line says where it lands on save.
    const isInChain = (provider: ProviderMeta) =>
      parseKeys(storedKey(provider.field)).length > 0;
    const chain = order.map(byKey).filter(isInChain);
    const rest = order.map(byKey).filter((p) => !isInChain(p));
    const showRest = restOpen ?? chain.length === 0;

    // `position` is the row's 1-based place in the fallback chain, or null for
    // an engine that has no key stored: only chain rows carry a number and are
    // draggable, because reordering an engine that never gets called is noise.
    const providerRow = (provider: ProviderMeta, position: number | null) => {
      const key = provider.key;
      const hasKey = isConfigured(provider.field, snapshot, keyDrafts);
      const keyCount = parseKeys(
        keyDrafts[provider.field] ?? storedKey(provider.field),
      ).length;
      const isDragging = dragKey === key;
      const isDropTarget = dropTarget === key;
      const expanded = expandedRows[key] || false;
      const capsLabel = t(
        provider.caps.fetch ? "caps.searchFetch" : "caps.searchOnly",
      );
      const sortable = position !== null && !disabled;
      const status =
        position !== null
          ? keyCount > 0
            ? t("row.rotating", { count: keyCount })
            : t("row.cleared")
          : keyCount > 0
            ? t("row.joining", { count: keyCount })
            : t(expanded ? "row.unconfigured" : "row.hint");

      return React.createElement(
        "div",
        {
          key,
          draggable: sortable && dragArmed === key,
          onDragStart: (e: any) => {
            setDragKey(key);
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", key);
          },
          onDragEnd: () => {
            setDragKey(null);
            setDropTarget(null);
            setDragArmed(null);
          },
          // Releasing the handle without dragging must disarm too, or the row
          // stays draggable and swallows the next text selection inside it.
          onMouseUp: () => setDragArmed(null),
          onDragOver: sortable
            ? (e: any) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (dragKey && dragKey !== key) setDropTarget(key);
              }
            : undefined,
          onDrop: sortable
            ? (e: any) => {
                e.preventDefault();
                if (dragKey && dragKey !== key)
                  reorder(indexOfKey(dragKey), indexOfKey(key));
                setDragKey(null);
                setDropTarget(null);
              }
            : undefined,
          // A column, not a row: the expanded panel is a real second child that
          // stacks underneath. The previous `flexBasis: '100%'` on a nowrap row
          // could not wrap, so the panel was squeezed into the header line.
          style: {
            display: "flex",
            flexDirection: "column",
            gap: 6,
            fontSize: 13,
            borderRadius: 8,
            padding: "6px 10px",
            border: isDropTarget
              ? "1px dashed var(--dsw-alias-brand-primary)"
              : "1px solid var(--dsw-alias-border-l2)",
            background: isDragging
              ? "var(--dsw-alias-bg-layer-2)"
              : "var(--dsw-alias-bg-layer-3)",
            opacity: isDragging ? 0.5 : 1,
          },
        },
        // Header line: handle · order badge · label/meta · caret
        React.createElement(
          "div",
          { style: { display: "flex", alignItems: "center", gap: 8 } },
          sortable
            ? React.createElement(
                "span",
                {
                  onMouseDown: () => setDragArmed(key),
                  title: t("row.dragTitle"),
                  style: {
                    flex: "none",
                    color: "var(--dsw-alias-label-tertiary)",
                    fontSize: 13,
                    userSelect: "none",
                    cursor: "grab",
                  },
                },
                "⋮⋮",
              )
            : null,
          position !== null
            ? React.createElement(
                "span",
                {
                  style: {
                    whiteSpace: "nowrap",
                    borderRadius: 999,
                    padding: "1px 8px",
                    fontSize: 11,
                    fontWeight: 500,
                    lineHeight: "17px",
                    flex: "none",
                    background: "var(--dsw-alias-bg-module-platform)",
                    color: "var(--dsw-alias-label-secondary)",
                  },
                },
                `#${position}`,
              )
            : null,
          // Label + meta (click to expand)
          React.createElement(
            "div",
            {
              onClick: () => !disabled && toggleRow(key),
              style: {
                display: "flex",
                flexDirection: "column",
                gap: 2,
                flex: 1,
                minWidth: 0,
                cursor: disabled ? "default" : "pointer",
              },
            },
            React.createElement(
              "div",
              {
                style: {
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  minWidth: 0,
                  flexWrap: "wrap",
                },
              },
              React.createElement(
                "span",
                {
                  style: {
                    color: hasKey
                      ? "var(--dsw-alias-label-primary)"
                      : "var(--dsw-alias-label-tertiary)",
                    fontWeight: 500,
                  },
                },
                provider.label,
              ),
              React.createElement(
                "span",
                {
                  style: {
                    whiteSpace: "nowrap",
                    borderRadius: 4,
                    padding: "0 5px",
                    fontSize: 10,
                    lineHeight: "15px",
                    flex: "none",
                    color: "var(--dsw-alias-label-tertiary)",
                    background: "var(--dsw-alias-bg-layer-2)",
                  },
                },
                capsLabel,
              ),
              React.createElement(
                "span",
                {
                  style: {
                    whiteSpace: "nowrap",
                    fontSize: 11,
                    color: "var(--dsw-alias-label-tertiary)",
                    flex: "none",
                  },
                },
                t(`free.${provider.key}` as TKey),
              ),
            ),
            React.createElement(
              "div",
              {
                style: {
                  fontSize: 11,
                  color: "var(--dsw-alias-label-tertiary)",
                },
              },
              status,
            ),
          ),
          React.createElement(
            "span",
            {
              onClick: (e: any) => {
                e.stopPropagation();
                if (!disabled) toggleRow(key);
              },
              style: {
                color: "var(--dsw-alias-label-tertiary)",
                display: "inline-flex",
                flex: "none",
                transition: "transform .16s",
                transform: expanded ? "rotate(180deg)" : "none",
                cursor: disabled ? "default" : "pointer",
                padding: 4,
              },
            },
            caret(12),
          ),
        ),
        // Expanded key input, stacked under the header line.
        expanded
          ? React.createElement(
              "div",
              {
                style: { display: "flex", flexDirection: "column", gap: 4 },
              },
              React.createElement("textarea", {
                rows: 2,
                autoComplete: "off",
                spellCheck: false,
                value: keyDrafts[provider.field] ?? storedKey(provider.field),
                disabled,
                placeholder: t("row.placeholder"),
                onChange: (event: any) =>
                  setKeyDrafts({
                    ...keyDrafts,
                    [provider.field]: event.target.value,
                  }),
                style: {
                  ...inputStyle,
                  width: "100%",
                  boxSizing: "border-box",
                  height: "auto",
                  minHeight: 30,
                  resize: "vertical",
                  padding: "6px 12px",
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  lineHeight: "20px",
                },
              }),
              React.createElement(
                "a",
                {
                  href: provider.signup,
                  target: "_blank",
                  rel: "noreferrer",
                  onClick: (e: any) => e.stopPropagation(),
                  style: {
                    fontSize: 12,
                    color: "var(--dsw-alias-brand-primary)",
                    textDecoration: "none",
                    alignSelf: "flex-start",
                  },
                },
                t("row.signup"),
              ),
            )
          : null,
      );
    };

    // Group 1 — the actual fallback chain. Usually one to three rows, so this
    // is the only part most users ever read.
    children.push(
      React.createElement(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: 6 } },
        React.createElement(
          "div",
          { style: groupLabelStyle },
          chain.length > 0
            ? t("chain.labelCount", { count: chain.length })
            : t("chain.label"),
        ),
        chain.length > 0
          ? React.createElement(
              "div",
              { style: { display: "flex", flexDirection: "column", gap: 6 } },
              ...chain.map((provider, index) =>
                providerRow(provider, index + 1),
              ),
            )
          : React.createElement(
              "div",
              {
                style: {
                  fontSize: 12,
                  color: "var(--dsw-alias-label-tertiary)",
                  lineHeight: 1.6,
                  borderRadius: 8,
                  padding: "10px 12px",
                  border: "1px dashed var(--dsw-alias-border-l2)",
                },
              },
              t("chain.empty"),
            ),
      ),
    );
    // Group 2 — everything without a key. Collapsed by default once the chain
    // has something in it: eight rows of engines the user is not using is the
    // bulk of the card, and none of it is actionable until they want a new key.
    if (rest.length > 0) {
      children.push(
        React.createElement(
          "div",
          { style: { display: "flex", flexDirection: "column", gap: 6 } },
          React.createElement(
            "button",
            {
              type: "button",
              onClick: () => setRestOpen(!showRest),
              style: {
                ...groupLabelStyle,
                appearance: "none",
                background: "none",
                border: 0,
                padding: 0,
                font: "inherit",
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
                textAlign: "left",
                display: "flex",
                alignItems: "center",
                gap: 4,
              },
            },
            t("rest.label", { count: rest.length }),
            React.createElement(
              "span",
              {
                style: {
                  display: "inline-flex",
                  transition: "transform .16s",
                  transform: showRest ? "rotate(180deg)" : "none",
                },
              },
              caret(11),
            ),
          ),
          showRest
            ? React.createElement(
                "div",
                { style: { display: "flex", flexDirection: "column", gap: 6 } },
                ...rest.map((provider) => providerRow(provider, null)),
              )
            : null,
        ),
      );
    }
    children.push(
      React.createElement(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            gap: 8,
            justifyContent: "flex-end",
            borderTop: "1px solid var(--dsw-alias-border-l2)",
            paddingTop: 12,
          },
        },
        // Left-aligned and outlined, away from 保存: this one is for uninstalling
        // cleanly, not part of the edit/commit pair on the right.
        React.createElement(
          "button",
          {
            type: "button",
            disabled: disabled || !configured,
            onClick: () => (armed ? clearAll() : setArmed(true)),
            title: t("clear.title"),
            style: {
              ...btnOutlineStyle,
              marginRight: "auto",
              color: "var(--dsw-alias-label-error)",
              ...(armed
                ? {
                    borderColor: "var(--dsw-alias-label-error)",
                    fontWeight: 600,
                  }
                : {}),
              ...(disabled || !configured
                ? { opacity: 0.4, cursor: "default" }
                : {}),
            },
          },
          t(clearing ? "clear.busy" : armed ? "clear.armed" : "clear.idle"),
        ),
        failed === ""
          ? null
          : React.createElement(
              "span",
              {
                style: {
                  flex: 1,
                  minWidth: 0,
                  fontSize: 12,
                  color: "var(--dsw-alias-label-error)",
                },
              },
              failed,
            ),
        React.createElement(
          "button",
          {
            type: "button",
            disabled: disabled || !dirty,
            onClick: () => {
              setKeyDrafts({});
              setOrderDraft(null);
              setEnableFetchDraft(null);
              setArmed(false);
              setFailed("");
            },
            style: {
              ...btnOutlineStyle,
              ...(disabled || !dirty
                ? { opacity: 0.4, cursor: "default" }
                : {}),
            },
          },
          t("action.discard"),
        ),
        React.createElement(
          "button",
          {
            type: "button",
            disabled: disabled || !dirty,
            onClick: save,
            style: {
              ...btnPrimaryStyle,
              ...(disabled || !dirty
                ? { opacity: 0.4, cursor: "default" }
                : {}),
            },
          },
          t(saving ? "action.saving" : "action.save"),
        ),
      ),
    );
    return children;
  };

  // Collapsed summary: how many engines are configured, surfaced on the
  // header so the user can see at a glance whether the plugin is ready.
  const summary =
    configuredCount > 0
      ? t("summary.configured", { count: configuredCount })
      : t("summary.none");

  return React.createElement(
    "li",
    {
      style: {
        listStyle: "none",
        borderRadius: 12,
        border: "1px solid var(--dsw-alias-border-l2)",
        background: open
          ? "var(--dsw-alias-bg-layer-2)"
          : "var(--dsw-alias-bg-layer-3)",
        transition: "border-color .16s, background .16s",
      },
    },
    React.createElement(
      "button",
      {
        type: "button",
        onClick: () => setOpen(!open),
        style: {
          appearance: "none",
          width: "100%",
          font: "inherit",
          textAlign: "left",
          cursor: "pointer",
          background: "none",
          border: "0",
          borderRadius: 12,
          color: "inherit",
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "14px 16px",
        },
      },
      React.createElement(
        "div",
        {
          style: {
            display: "flex",
            flexDirection: "column",
            flex: 1,
            gap: 2,
            minWidth: 0,
          },
        },
        React.createElement(
          "div",
          { style: { display: "flex", alignItems: "center", gap: 8 } },
          React.createElement(
            "span",
            {
              style: {
                fontSize: 15,
                fontWeight: 600,
                color: "var(--dsw-alias-label-primary)",
              },
            },
            t("header.title"),
          ),
          dirty
            ? React.createElement(
                "span",
                {
                  style: {
                    whiteSpace: "nowrap",
                    background: "var(--dsw-alias-bg-module-platform)",
                    color: "var(--dsw-alias-label-secondary)",
                    borderRadius: 999,
                    padding: "1px 8px",
                    fontSize: 11,
                    fontWeight: 500,
                    lineHeight: "17px",
                  },
                },
                t("header.unsaved"),
              )
            : null,
          configuredCount > 0
            ? React.createElement(
                "span",
                {
                  style: {
                    whiteSpace: "nowrap",
                    background: "var(--dsw-alias-brand-primary)",
                    color: "#fff",
                    borderRadius: 999,
                    padding: "1px 8px",
                    fontSize: 11,
                    fontWeight: 500,
                    lineHeight: "17px",
                  },
                },
                t("header.engines", { count: configuredCount }),
              )
            : null,
        ),
        React.createElement(
          "div",
          { style: { fontSize: 13, color: "var(--dsw-alias-label-tertiary)" } },
          t("header.subtitle", { summary }),
        ),
      ),
      React.createElement(
        "span",
        {
          style: {
            color: "var(--dsw-alias-label-tertiary)",
            display: "inline-flex",
            flex: "none",
            transition: "transform .16s",
            transform: open ? "rotate(180deg)" : "none",
          },
        },
        React.createElement(
          "svg",
          {
            width: 14,
            height: 14,
            viewBox: "0 0 14 14",
            fill: "none",
            "aria-hidden": true,
          },
          React.createElement("path", {
            d: "M3.5 5.5L7 9l3.5-3.5",
            stroke: "currentColor",
            strokeWidth: 1.5,
            strokeLinecap: "round",
            strokeLinejoin: "round",
          }),
        ),
      ),
    ),
    open
      ? React.createElement(
          "div",
          {
            style: {
              display: "flex",
              flexDirection: "column",
              gap: 16,
              margin: "0 16px 4px",
              borderTop: "1px solid var(--dsw-alias-border-l2)",
              paddingTop: 12,
            },
          },
          ...cardBody(),
        )
      : null,
  );
}

const inputStyle = {
  height: 34,
  padding: "0 12px",
  font: "inherit",
  fontSize: 13,
  borderRadius: 8,
  border: "1px solid var(--dsw-alias-border-l2)",
  background: "var(--dsw-alias-bg-layer-3)",
  color: "var(--dsw-alias-label-primary)",
};

const btnOutlineStyle = {
  font: "inherit",
  fontSize: 13,
  padding: "5px 14px",
  borderRadius: 8,
  cursor: "pointer",
  border: "1px solid var(--dsw-alias-border-l2)",
  background: "none",
  color: "var(--dsw-alias-label-secondary)",
};

const btnPrimaryStyle = {
  font: "inherit",
  fontSize: 13,
  padding: "5px 14px",
  borderRadius: 8,
  cursor: "pointer",
  border: "1px solid transparent",
  background: "var(--dsw-alias-label-primary)",
  color: "var(--dsw-alias-bg-layer-3)",
};

const groupLabelStyle = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: ".2px",
  color: "var(--dsw-alias-label-tertiary)",
};

/** The single chevron used by every expander in this card. */
function caret(size: number) {
  return React.createElement(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 14 14",
      fill: "none",
      "aria-hidden": true,
    },
    React.createElement("path", {
      d: "M3.5 5.5L7 9l3.5-3.5",
      stroke: "currentColor",
      strokeWidth: 1.5,
      strokeLinecap: "round",
      strokeLinejoin: "round",
    }),
  );
}

function text(value: string) {
  return React.createElement(
    "span",
    { style: { fontSize: 13, color: "var(--dsw-alias-label-tertiary)" } },
    value,
  );
}
