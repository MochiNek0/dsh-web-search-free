# dsh-web-search-free

中文 | [English](https://github.com/MochiNek0/dsh-web-search-free/blob/main/README.en.md)

面向 [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) 的免费 Web Search / 网页抓取插件。

它把 dsh 默认的 `deepseek-official` 搜索/抓取通道，替换成一个**多引擎 + 自动 fallback** 的通道：你填入哪些引擎的 API Key，它就按你排定的顺序依次尝试，前一个失败（或额度耗尽）会自动落到下一个；同一引擎也可以填多个 Key（每行一个），引擎内 Key 同样按顺序轮换。所有检索请求都由 dsh 的**宿主进程（Node）**直接发往各引擎，不经过官方搜索后端、也不经过任何 LLM；浏览器侧只有那张设置卡片，不发任何网络请求。

- 注册为 dsh 的 `web` 能力通道（同时提供 `searchProvider` 与 `fetchProvider`，id 均为 `web-search-free`）。
- 自带一个 Web 设置卡片（设置 → 插件 → **免费 Web 搜索**，英文界面下为 **Web Search Free**），可拖动排序、逐个填 Key；卡片文案跟随 dsh 的语言设置在中英之间切换。
- 作为 dsh bundle 层安装：装上即接管 web 搜索/抓取，卸载（并重启 dsh）后回落到默认通道，无需手改 profile。
- 可在卡片里开关 `web_fetch`（URL 抓取）——关闭后模型每次调用都会收到明确的"后端已停用"错误，而不是继续抓取。

## 为什么是 free 的：与官方通道的计费差异

dsh 默认的官方通道 `deepseek-official`（由 `@deepseek-ai/dsh-web-search-deepseek` 提供）**不是一个专用搜索端点**：每次搜索都会发起一次**完整的 Messages 模型调用**（`POST …/anthropic/v1/messages`，带原生 `web_search` 服务端工具），由 DeepSeek 在服务端执行搜索、返回结构化结果块。因此每次搜索都要烧两份 token：

1. **辅助搜索请求本身**——一个独立模型收到 `Perform a web search for the query: <query>` + 工具定义，产生 input + output token（`maxTokens` 默认 4096、`maxUses` 默认 5）；这是一次完整的模型轮次，延迟与生成都按模型调用计。
2. **结果回灌对话**——解析出的 sources（URL/标题/片段）注入回对话模型上下文，作为对话 token 一直重发直到压缩。

两份都从 `DEEPSEEK_API_KEY` 余额扣除。

本插件走各引擎的**专用检索端点**（如 Tavily `/search`、Exa `/search`、Jina `s.jina.ai`），是纯检索，不经任何 LLM：

|            | 官方 `deepseek-official`                                                 | 本插件 `web-search-free`                   |
| ---------- | ------------------------------------------------------------------------ | ------------------------------------------ |
| 检索方式   | 一次完整 LLM 模型调用 + 服务端搜索工具                                   | 直接调各引擎专用检索端点                   |
| 模型 token | 每次搜索都烧（input + output）                                           | **0**（纯检索，不碰任何 LLM）              |
| 计费来源   | DeepSeek API 余额                                                        | 各搜索 API 自身额度（多数有免费层）        |
| 凭据       | **必须** `DEEPSEEK_API_KEY`                                              | 各引擎各自的 API Key                       |
| 结果内容   | 只有 sources；snippet 取自模型引用的片段，未被引用的结果**没有 snippet** | sources + snippet；Tavily 另给一段直接回答 |

这正是插件名为 "free" 的核心理由——官方每次搜索烧一整轮模型 token，这里只走检索、不烧 token。

> 还有一个容易踩的坑：官方通道**强制依赖 `DEEPSEEK_API_KEY`**。如果你的对话模型走的是第三方渠道（自建 provider、中转站等），你很可能根本没配这个 key——而官方 provider 的 `available()` 只检查"有没有 key 解析器"（永远有），所以 dsh 会照常选中它，**直到模型真的调用 `web_search` 才抛 `WEB_PROVIDER_CREDENTIAL_MISSING`**，UI 上看不出问题。本插件不依赖任何 LLM 凭据。

## 支持的引擎

| 引擎           | 搜索 | 抓取 | 结果日期 | 免费额度                                           | 获取 API Key                                      |
| -------------- | :--: | :--: | :------: | -------------------------------------------------- | ------------------------------------------------- |
| TinyFish       |  ✓   |  ✓   |   部分   | 搜索/抓取免费（仅按速率限）                        | <https://www.tinyfish.ai/pricing>                 |
| AnySearch      |  ✓   |  ✓   |    ✗     | 1,000 次/天（每天重置）                            | <https://anysearch.com/pricing>                   |
| Exa (Metaphor) |  ✓   |  ✓   |   部分   | 注册送 $20 + 每月补 $10 credit（累积，不按月清零） | <https://dashboard.exa.ai/>                       |
| Tavily         |  ✓   |  ✓   |    ✗     | 1,000 credits/月（每月重置）                       | <https://app.tavily.com/>                         |
| Firecrawl      |  ✓   |  ✓   |    ✗     | 1,000 credits/月（搜索 2 credits/10 结果）         | <https://www.firecrawl.dev/>                      |
| Brave Search   |  ✓   |  ✗   | **多数** | $5 额度/月（需绑卡，不扣费）                       | <https://api-dashboard.search.brave.com/register> |
| Serping API    |  ✓   |  ✗   |   部分   | 1,000 次/月（每月重置，无需绑卡）                  | <https://serpingapi.com/signup>                   |
| SerpApi        |  ✓   |  ✗   |   弱\*   | 250 次/月（每月重置）                              | <https://serpapi.com/users/sign_up>               |
| Jina AI        |  ✓   |  ✓   |   部分   | 新 key 送 10M tokens（一次性，用完即止）           | <https://jina.ai/api-key>                         |

> 表格顺序即默认调用顺序（按可持续免费量从大到小排）。Jina 虽是一次性额度，但仍会进入抓取链——只要填了 Key，`supportsFetch` 为真的引擎都会被 `getActiveProviders('fetch')` 选中，与它在搜索链里的位置无关。

> **关于额度的几种机制**：Jina 是**一次性 token**（新 key 送 10M，搜索 `s.jina.ai` 每次固定扣 1 万 token，约够 1,000 次搜索，用完只能充值或换 key，不重置）；Exa 是**可累积 credit**（注册送 $20 + 每月补 $10，余额不清零、不重置，约能跑 1,400 次基础搜索）；AnySearch 是**每日重置**（1,000 次/天，约 3 万次/月）；Tavily / Firecrawl / Serping API / SerpApi 是**每月重置**；Brave 也是每月 $5 credit 重置；TinyFish 的搜索/抓取则完全免费，只卡速率（免费层 Search 30 req/min、Fetch 150 url/min）。

**关于抓取**：Brave Search、Serping API 和 SerpApi 都是纯 SERP，没有 URL 抓取端点，所以它们**不会进入抓取链**（只在搜索链里）。如果只配了这几家的 Key，抓取链为空、会以 `No web fetch providers configured.` 报错——请再给一个支持抓取的引擎配上 Key。

**关于结果日期**：`publishedAt` 决定模型能否判断一条结果的时效性，各引擎差别很大（下面是单次查询的实测覆盖率，仅供参考）：Brave `page_age` 18/20、Exa `publishedDate` 4/10、Jina `publishedTime` 1~3/10、TinyFish `date`（新闻结果较全、网页结果部分）、Serping API `date`（部分结果带，显示串）、SerpApi `date`（弱，显示串）；Tavily 的 `published_date` **仅在 `topic: 'news'` 下返回**，本插件走通用网页搜索，因此实际为空；Firecrawl 和 AnySearch 的搜索结果没有日期字段。

> 如果时效性判断对你重要，可以把 Brave 往调用顺序前面挪——代价是丢掉 Tavily 的直接回答段和较长的摘录。

## 前置条件

- **dsh ≥ 0.1.2-rc.1**。从这个版本起，宿主组合（dsh-base 的 `tool-web` 行与各 agent preset）统一挂载 `web_search`/`web_fetch` 并经 `@deepseek-ai/dsh-web` seam 取数，本插件只向 seam 注册 provider。更早的版本（≤ 0.1.2-alpha.5）里组合不挂载 web 工具，装本插件后**搜索可用，但 `web_fetch` 不会出现**（那类组合请用 1.3.0，它自行挂载 tool-web）。
- 已安装 dsh，且 `dsh` 命令可用（在 dsh 源码检出里开发时用 `pnpm dsh ...` 代替）。
- `pnpm` 在 `PATH` 上（`dsh plugin` 通过 pnpm 在 profile 目录里管理依赖）。
- 目标 profile 一般是 `web`（本插件的客户端半边声明 `platform: web`，设置卡片只在 Web 界面出现）。`web` profile 首次使用时会从模板自动初始化。

## 安装

`dsh plugin --profile <name> <pnpm args>` 会把 pnpm 参数转发到 profile 目录里执行，**执行成功后自动对账 `dsh.profile.bundles`**：凡解析到声明了 `dsh.bundle` 的依赖，都会被自动追加进 bundle 层栈——本插件正好声明了 `dsh.bundle.patch`，所以装上即接管 web 搜索/抓取，无需手改 profile。

### 从 npm 安装（推荐）

```sh
dsh plugin --profile web add dsh-web-search-free
```

### 从本地源码安装（开发 / 二次开发用）

本仓库 `dist/` 被 gitignore，安装前需要先构建出产物。

```sh
# 1) 在插件仓库目录里构建
cd /path/to/dsh-web-search-free
pnpm install
pnpm build            # 生成 dist/index.js 与 dist/client.js

# 2) 装进 web profile（在插件目录里执行，"." 会被锚定到当前目录）
dsh plugin --profile web add .
```

> 也可以用绝对路径，从任意目录执行：
> `dsh plugin --profile web add /absolute/path/to/dsh-web-search-free`
>
> pnpm 对本地目录默认以链接方式安装，所以**之后在源码里重新 `pnpm build`，profile 会即时拿到新产物**，适合二次开发。改完客户端半边后刷新浏览器即可（客户端插件的热更新需要 `pnpm run dev:web` 这类重建监听在跑）。

## 配置

安装后启动 dsh Web 界面：

```sh
dsh web          # 等价于 dsh --profile web
```

打开 **设置 → 插件 → 免费网页搜索**（英文界面下为 **Web Search Free**）卡片：

1. 点开卡片，引擎分成两组：**「调用顺序」**里是已存过 Key、真正参与调用的引擎（带 `#1`、`#2` 序号）；**「其他可用引擎 (n)」**里是还没填 Key 的，默认折叠，点标题展开。每一行显示引擎名、能力徽章（`搜索 · 抓取` 或 `仅搜索`）、免费额度，以及已配置的 Key 数量。
2. **点击某一行**展开它，会出现输入框；在输入框粘贴 API Key，点行内「获取 API Key ↗」可直达各引擎的申请页。每个引擎支持填多个 Key：**每行一个**，引擎内会按行顺序轮换。再点一次行可收起。保存后该行会自动移进「调用顺序」组。
3. **拖动行左侧的 `⋮⋮` 手柄**调整调用顺序：排在前面的引擎优先调用，失败则按顺序 fallback；同一引擎的多个 Key 也会逐个尝试，任一 (引擎, Key) 成功即返回，全部失败才报错。未填 Key 的引擎不进入调用链，也没有排序的必要，所以只有「调用顺序」组里的行可拖。注意点行体会触发展开/收起，要拖动请抓 `⋮⋮`。
4. 引擎列表上方有 **「启用 web_fetch（URL 抓取）」** 开关。开启时模型可对指定 URL 调用 `web_fetch` 取全文；关闭后每次调用会收到明确的错误提示（`web_fetch` 工具由 dsh 统一挂载，开关控制的是本插件的抓取后端，不再从工具表移除工具）。切换即时生效，无需重启。
5. 点「保存」。配置通过 dsh 的设置命名空间（`web-search-free`）持久化，下一次搜索即时生效，无需重启。卡片头部会显示已配置的引擎数量徽章，不用展开就能看出插件是否就绪。

**至少配置一个引擎的 Key**，否则搜索/抓取会以 `No web search providers configured.` 报错。

> 关于 `web_fetch`：dsh 0.1.5 起官方组合默认启用它（TUI/headless 由 dsh-base 的 `tool-web` 行挂载，Web 界面由各 agent preset 的行挂载），工具始终在模型工具表里。本插件把"抓取走哪个后端"接了过来，并提供一个开关：关闭后调用会收到明确的错误提示。若你在意出网面，关掉即可——代价是模型无法读取你贴给它的 URL，也无法精读长文档，只能靠搜索摘要。

## 验证

1. `dsh web` 启动 Web 界面。
2. 在对话里让模型用 Web 搜索/抓取（例如「搜一下今天的新闻」或「抓取 https://example.com 的内容」）。抓取需要卡片里的 **「启用 web_fetch」** 处于开启状态，否则模型调用 `web_fetch` 会收到"后端已停用"的错误提示。
3. 请求会经 `web-search-free` 通道按你排定的引擎顺序执行；某个引擎失败时会在日志里看到 `Provider <name> ... failed. Trying next provider ...`，随后自动尝试下一个。

## 更新

```sh
# 本地源码：重新构建即可（链接安装，无需重装）
cd /path/to/dsh-web-search-free && pnpm build

# npm：升级到新版本
dsh plugin --profile web update dsh-web-search-free
```

`update` 同样会触发对账：新版本若新增/移除了 `dsh.bundle` 声明，bundle 层栈会自动跟进。

## 卸载

```sh
dsh plugin --profile web remove dsh-web-search-free
```

对账会把本插件从 `dsh.profile.bundles` 移除，web 搜索/抓取**回落到 dsh-base 的 `deepseek-official` 默认通道**——无需手改 profile 或 patch。

两点需要注意：

- **卸载前先点卡片底部的「清空全部配置」**。dsh 的卸载流程不会删除设置命名空间里存的东西，你的 API Key 会留在 `$DSH_HOME/settings.yaml` 里。这个按钮会把本插件写入的所有值清掉（需点两次确认）。清空后文件里会剩一个空的 `web-search-free:` 键——不含任何值，客户端没有 API 能删掉键本身。
- **卸载后需要重启 dsh** 才能真正回落到官方通道。`web` 行的 provider 选择是启动时组合出来的，卸载只会让本插件的条目在当前进程里失效；重启前搜索会报 `WEB_PROVIDER_CONFIGURED_MISSING`。

## 工作原理

本插件是一个 dsh **bundle 层**（`package.json` 里声明 `dsh.bundle.patch: ./cordis.patch.yml`）。`cordis.patch.yml` 做两件事：

- `insert` 一行 `web-search-free`，把本插件的宿主半边纳入组合；
- 用一条同 id 的 `web` 覆盖层，把 `searchProvider` 与 `fetchProvider` 都重指到 `web-search-free`，从而盖过 `dsh-base` 里钉死的 `deepseek-official`。

宿主半边（`src/index.ts`，`inject: ['web']`）向 `ctx.web` 注册搜索与抓取 provider，内部按 `providerOrder` 顺序遍历「已配 Key」的引擎做 fallback；每个引擎的 Key 字段可填多个（每行一个），引擎内也会按行顺序逐个轮换。客户端半边（`src/client.tsx`）在「插件」设置页注册一张 React 卡片，读写同一命名空间 `web-search-free` 的设置。两层靠这个命名空间字符串对齐。

`web_fetch` 工具本身的挂载归组合层所有（dsh ≥ 0.1.5）：TUI/headless 下由 `dsh-base` 的 `tool-web` 行挂载（`fetch: true`），Web 界面上由每条 agent preset 各自挂载同名的 `tool-web` 行。preset 文件由 dsh-agent-presets 从自己的根目录加载、不属于 profile patch 栈，bundle patch 够不到——也不需要：所有这些行都通过同一条能力通道（seam）取数，上面那条 `web` 覆盖层已把通道指向本插件。因此本插件**不**自行挂载 `dsh-tool-web`（0.1.2 时代的做法）：per-agent 作用域的注册会遮蔽全局注册，自挂载只会和 preset 行重复注册 `web_fetch`，卸载自己的 fiber 也动不到 preset 那份。

`enableFetch` 开关据此实现为**抓取 provider 的可用性**：seam 在每次执行时读取 `available()`，关闭后 `web_fetch` 仍在工具表里，但每次调用都返回结构化的 `WEB_PROVIDER_CONFIGURED_UNAVAILABLE` 错误（dsh 官方语义）。切换即时生效，无需 watch/重挂载接线。两个 provider 的注册接在 `ctx.effect` 上：dsh-web 的 `register*` 返回注销函数，插件被禁用或热重载时会把自己的 provider 从 seam 摘除，避免下次 apply 撞上 `WEB_DUPLICATE_PROVIDER`。

构建分两步（包声明 `"type": "module"`）：`tsconfig.json`（`module: NodeNext`）把宿主半边编成 ESM 产物（`dist/index.js` 等，与 dsh 运行时同为 ESM，避免 CJS `require()` 一个 ESM 依赖时触发的加载竞态）；`tsconfig.client.json`（`module: CommonJS`）单独编出 `dist/client.js`，再由 `wrap-client.cjs` 包成 `window.__ModuleLoader__.load(...)`，使其能被 dsh 的浏览器侧模块加载器加载。宿主半边从 `@deepseek-ai/schemastery` 取 `Schema`（而非旧版 `cordis`），`Context` 仅作类型从 `@deepseek-ai/cordis` 引入。

插件是装在 profile **旁边**的，所有宿主服务必须解析到运行中 dsh 的那**一份**实例。任何 `@deepseek-ai/*` 一旦进了 `dependencies`（或进了非 optional 的 `peerDependencies`——pnpm 会自动装它），就会在用户的 profile 里多出一份私有副本；hoisted 布局下它平铺到 profile 根目录，遮蔽宿主自己那份，Cordis Service 身份不再相等。这类问题只在别人机器上出现，本地 `pnpm build` 永远看不见，所以 `prepublishOnly` 会跑 `scripts/check-package.cjs` 把它挡在发布之前：禁止宿主包进 `dependencies`、要求宿主 peer 标 optional、核对 dist 的实际 import 与声明的依赖双向一致、校验 `exports` 条件顺序与客户端 bundle 是否已包装。改动 `package.json` 后请跑 `pnpm run check`。

## 许可证

MIT，见 [LICENSE](https://github.com/MochiNek0/dsh-web-search-free/blob/main/LICENSE)。
