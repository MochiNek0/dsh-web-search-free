# dsh-web-search-free

中文 | [English](https://github.com/MochiNek0/dsh-web-search-free/blob/main/README.en.md)

面向 [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) 的免费 Web Search / 网页抓取插件。它把 dsh 默认的 `deepseek-official` 通道换成**多引擎 + 自动 fallback**：你填哪些引擎的 Key，它就按你排的顺序依次尝试，失败或额度用尽自动落到下一个；同一引擎可填多个 Key（每行一个），引擎内也按序轮换。

- **不烧模型 token**——走各引擎的专用检索端点，全程不经过任何 LLM。
- **装上即接管，卸载即回落**——作为 dsh bundle 层安装，无需手改 profile。
- **自带配置卡片**——拖动排序、逐个填 Key，文案跟随 dsh 的语言设置中英切换。
- **可开关 `web_fetch`**——关闭后模型每次调用都会收到明确的「后端已停用」错误。

所有检索请求都由 dsh 的**宿主进程（Node）**直接发往各引擎，不经过官方搜索后端；浏览器侧只有那张配置卡片，不发任何网络请求。

## 为什么是 "free"

官方通道 `deepseek-official`（由 `@deepseek-ai/dsh-web-search-deepseek` 提供）**不是一个专用搜索端点**：每次搜索都会发起一次**完整的 Messages 模型调用**（带原生 `web_search` 服务端工具），由 DeepSeek 在服务端执行搜索。所以每次搜索烧两份 token——辅助搜索请求本身（input + output，`maxTokens` 默认 4096、`maxUses` 默认 5），以及回灌进对话上下文、一直重发到压缩为止的 sources。两份都从 `DEEPSEEK_API_KEY` 余额扣除。

本插件直接调各引擎的检索端点（Tavily `/search`、Exa `/search`、Jina `s.jina.ai` 等），纯检索：

|            | 官方 `deepseek-official`                                                 | 本插件 `web-search-free`                   |
| ---------- | ------------------------------------------------------------------------ | ------------------------------------------ |
| 检索方式   | 一次完整 LLM 模型调用 + 服务端搜索工具                                   | 直接调各引擎专用检索端点                   |
| 模型 token | 每次搜索都烧（input + output）                                           | **0**（纯检索，不碰任何 LLM）              |
| 计费来源   | DeepSeek API 余额                                                        | 各搜索 API 自身额度（多数有免费层）        |
| 凭据       | **必须** `DEEPSEEK_API_KEY`                                              | 各引擎各自的 API Key                       |
| 结果内容   | 只有 sources；snippet 取自模型引用的片段，未被引用的结果**没有 snippet** | sources + snippet；Tavily 另给一段直接回答 |

> **一个容易踩的坑**：官方通道强制依赖 `DEEPSEEK_API_KEY`。如果你的对话模型走第三方渠道（自建 provider、中转站等），很可能根本没配这个 key——而官方 provider 的 `available()` 只检查"有没有 key 解析器"（永远有），所以 dsh 会照常选中它，**直到模型真的调用 `web_search` 才抛 `WEB_PROVIDER_CREDENTIAL_MISSING`**，UI 上看不出问题。本插件不依赖任何 LLM 凭据。

## 支持的引擎

| 引擎           | 搜索 | 抓取 | 结果日期 | 免费额度                                           | 获取 API Key                                      |
| -------------- | :--: | :--: | :------: | -------------------------------------------------- | ------------------------------------------------- |
| TinyFish       |  ✓   |  ✓   |   部分   | 搜索/抓取免费（仅按速率限）                        | <https://www.tinyfish.ai/pricing>                 |
| AnySearch      |  ✓   |  ✓   |    ✗     | 1,000 次/天（每天重置）                            | <https://anysearch.com/pricing>                   |
| Exa (Metaphor) |  ✓   |  ✓   |   部分   | 注册送 $20 + 每月补 $10 credit（累积，不按月清零） | <https://dashboard.exa.ai/>                       |
| Tavily         |  ✓   |  ✓   |    ✗     | 1,000 credits/月（每月重置）                       | <https://app.tavily.com/>                         |
| Firecrawl      |  ✓   |  ✓   |    ✗     | 1,000 credits/月（搜索 2 credits/10 结果）         | <https://www.firecrawl.dev/>                      |
| Serping API    |  ✓   |  ✗   |   部分   | 1,000 次/月（每月重置，无需绑卡）                  | <https://serpingapi.com/signup>                   |
| Brave Search   |  ✓   |  ✗   | **多数** | $5 额度/月（需绑卡，不扣费）                       | <https://api-dashboard.search.brave.com/register> |
| SerpApi        |  ✓   |  ✗   |   弱     | 250 次/月（每月重置）                              | <https://serpapi.com/users/sign_up>               |
| Jina AI        |  ✓   |  ✓   |   部分   | 新 key 送 10M tokens（一次性，用完即止）           | <https://jina.ai/api-key>                         |

表格顺序即默认调用顺序（按可持续免费量从大到小排）。两点要注意：

- **抓取**：Brave、Serping API、SerpApi 是纯 SERP，没有 URL 抓取端点，只进搜索链。如果只配了这三家，抓取链为空，会报 `No web fetch providers configured.`——请再给一个支持抓取的引擎配上 Key。
- **结果日期**：`publishedAt` 决定模型能否判断结果的时效性，各家差别很大。Brave 最全（实测 18/20），Exa、Jina、TinyFish、Serping API、SerpApi 部分带；Tavily 的 `published_date` 仅在 `topic: 'news'` 下返回，本插件走通用搜索因此为空；Firecrawl 和 AnySearch 没有这个字段。在意时效性可以把 Brave 往前挪，代价是丢掉 Tavily 的直接回答段和较长摘录。

<details>
<summary>各家免费额度的重置机制（点击展开）</summary>

- **Jina**：一次性 token，新 key 送 10M，`s.jina.ai` 每次固定扣 1 万，约够 1,000 次搜索，用完只能充值或换 key，不重置。
- **Exa**：可累积 credit，注册送 $20 + 每月补 $10，余额不清零，约能跑 1,400 次基础搜索。
- **AnySearch**：每日重置，1,000 次/天（约 3 万次/月）。
- **Tavily / Firecrawl / Serping API / SerpApi / Brave**：每月重置。
- **TinyFish**：搜索/抓取完全免费，只卡速率（免费层 Search 30 req/min、Fetch 150 url/min）。

</details>

## 安装

前置条件：**dsh ≥ 0.1.2-rc.1**、`pnpm` 在 `PATH` 上、目标 profile 一般是 `web`（本插件客户端半边声明 `platform: web`，配置卡片只在 Web 界面出现；`web` profile 首次使用时自动从模板初始化）。

```sh
dsh plugin --profile web add dsh-web-search-free
```

`dsh plugin` 会把 pnpm 参数转发到 profile 目录里执行，成功后**自动对账 `dsh.profile.bundles`**——本插件声明了 `dsh.bundle.patch`，所以装上即接管 web 搜索/抓取，无需手改 profile。

<details>
<summary>从本地源码安装（二次开发用）</summary>

本仓库 `dist/` 被 gitignore，安装前需要先构建：

```sh
cd /path/to/dsh-web-search-free
pnpm install
pnpm build                          # 生成 dist/index.js 与 dist/client.js
dsh plugin --profile web add .      # "." 锚定到当前目录，也可用绝对路径
```

pnpm 对本地目录默认以链接方式安装，所以之后重新 `pnpm build`，profile 会即时拿到新产物。改完客户端半边刷新浏览器即可。

</details>

<details>
<summary>更早的 dsh（≤ 0.1.2-alpha.5）</summary>

那些版本的组合不挂载 web 工具，装本插件后**搜索可用，但 `web_fetch` 不会出现**——请改用 1.3.0，它自行挂载 `tool-web`。

</details>

## 配置

启动 Web 界面（`dsh web`）后找到配置卡片。它的位置由 dsh 版本决定，插件会自动落到当前版本存在的那个位置：

| dsh 版本 | 卡片位置 |
| --- | --- |
| ≥ 0.1.6 | 侧栏 **插件** → 「已安装」里的 **web-search-free**，表单在包说明与「包含的组件」之间 |
| ≤ 0.1.5 | **设置 → 插件 → 插件配置 → 免费网页搜索**（英文界面下为 **Web Search Free**） |

卡片里的引擎分成两组：**「调用顺序」**是已存过 Key、真正参与调用的（带 `#1`、`#2` 序号），**「其他可用引擎 (n)」**是还没填 Key 的。

1. **点击一行**展开，粘贴 API Key；行内「获取 API Key ↗」直达申请页。一个引擎可填多个 Key，**每行一个**，按行顺序轮换。保存后该行自动移进「调用顺序」。
2. **拖行左侧的 `⋮⋮` 手柄**改调用顺序：靠前的先调，失败按序 fallback，任一 (引擎, Key) 成功即返回。只有「调用顺序」组里的行可拖；点行体是展开/收起，要拖请抓 `⋮⋮`。
3. 顶部的 **「启用 web_fetch（URL 抓取）」** 开关控制模型能否抓取 URL 全文。关闭后调用会收到明确的错误提示，而不是从工具表移除工具。
4. 点**保存**。配置存在 dsh 的设置命名空间 `web-search-free` 里，下一次搜索即时生效，无需重启。

**至少配置一个引擎的 Key**，否则搜索会报 `No web search providers configured.`

### 找不到配置卡片时

dsh 的插件配置界面还在快速演进，卡片所在的插槽名换过不止一次。插件同时认识历史上出现过的几个插槽，但如果你的 dsh 比本插件更新、插槽又改名了，卡片就不会出现——这时浏览器控制台会打印一行 `[web-search-free] no settings card mounted: …`，附上这版 dsh 实际声明的插槽名，**欢迎把这行贴到 issue 里**。

不用等新版本：**所有配置都能直接写进 profile 的 `~/.dsh/profiles/web/cordis.patch.yml`**，这条路径不依赖任何界面。插件装上时已由自己的 bundle 层插入了 `web-search-free` 这一行，所以这里写的是**按 id 覆盖它的 config**（不要再写 `insert`，那会插出重复的行）：

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

字段名与卡片一一对应（见 `src/index.ts` 的 `Config`）：`<引擎名>ApiKey`（多 Key 用多行字符串）、`enableFetch`、`providerOrder`。写完重启 dsh 生效；卡片里保存的值属于用户层，会覆盖这里的 base 值。

## 验证

启动 `dsh web`，在对话里让模型搜索或抓取（「搜一下今天的新闻」「抓取 https://example.com 的内容」）。某个引擎失败时日志里会出现 `Provider <name> ... failed. Trying next provider ...`，随后自动尝试下一个。

## 更新与卸载

```sh
dsh plugin --profile web update dsh-web-search-free    # 升级
dsh plugin --profile web remove dsh-web-search-free    # 卸载
```

两者都会触发对账：卸载后 web 搜索/抓取**回落到 dsh-base 的 `deepseek-official` 默认通道**，无需手改 profile。

卸载前后有两点要注意：

- **先点卡片底部的「清空全部配置」**。dsh 的卸载流程不会删设置命名空间里的东西，你的 API Key 会留在 `$DSH_HOME/settings.yaml`。这个按钮会清掉本插件写入的所有值（需点两次确认）。
- **卸载后要重启 dsh**。`web` 行的 provider 选择是启动时组合出来的，重启前搜索会报 `WEB_PROVIDER_CONFIGURED_MISSING`。

## 工作原理

本插件是一个 dsh **bundle 层**（`package.json` 声明 `dsh.bundle.patch: ./cordis.patch.yml`）。patch 做两件事：`insert` 一行 `web-search-free` 把宿主半边纳入组合，再用一条同 id 的 `web` 覆盖层把 `searchProvider` 与 `fetchProvider` 都重指到 `web-search-free`，盖过 `dsh-base` 钉死的 `deepseek-official`。

宿主半边（`src/index.ts`）向 `ctx.web` 注册搜索与抓取 provider，按 `providerOrder` 遍历「已配 Key」的引擎做 fallback。客户端半边（`src/client.tsx`）注册那张 React 配置卡片，读写同一命名空间 `web-search-free`。两层靠这个命名空间字符串对齐。

<details>
<summary>更细的实现说明（点击展开）</summary>

**为什么不自己挂载 `tool-web`**：`web_fetch` 工具的挂载归组合层所有（dsh ≥ 0.1.5）——TUI/headless 下由 `dsh-base` 的 `tool-web` 行挂载，Web 界面上由每条 agent preset 各自挂载同名行。preset 文件由 dsh-agent-presets 从自己的根目录加载、不属于 profile patch 栈，bundle patch 够不到，也不需要够到：这些行都通过同一条能力通道（seam）取数，上面那条 `web` 覆盖层已把通道指向本插件。自挂载只会和 preset 行重复注册 `web_fetch`，而 per-agent 作用域会遮蔽全局注册，卸载自己的 fiber 也动不到 preset 那份。

**`enableFetch` 为什么是 provider 开关**：它实现为抓取 provider 的**可用性**——seam 每次执行时读 `available()`，关闭后 `web_fetch` 仍在工具表里，但每次调用返回结构化的 `WEB_PROVIDER_CONFIGURED_UNAVAILABLE` 错误（dsh 官方语义）。切换即时生效，无需 watch 或重挂载。两个 provider 的注册接在 `ctx.effect` 上，插件禁用或热重载时会把自己从 seam 摘除，避免下次 apply 撞上 `WEB_DUPLICATE_PROVIDER`。

**配置卡片如何跟上 dsh 的插槽改名**：客户端半边持有一张候选插槽表（`SLOT_CANDIDATES`），每个候选各用一次 `ctx.slots.inject`——它对宿主没有的槽名只是等待、不抛错，所以一份产物能同时适配多个 dsh 版本。一个仲裁器保证同一时刻只挂一张卡，即使某个过渡版本两个槽都在。都没等到时打印上面那行诊断。

**构建为什么分两步**（包声明 `"type": "module"`）：`tsconfig.json`（`module: NodeNext`）把宿主半边编成 ESM 产物，与 dsh 运行时一致，避免 CJS `require()` 一个 ESM 依赖时的加载竞态；`tsconfig.client.json`（`module: CommonJS`）单独编出 `dist/client.js`，再由 `wrap-client.cjs` 包成 `window.__ModuleLoader__.load(...)`，交给 dsh 浏览器侧的模块加载器。

**发布门禁**：插件装在 profile **旁边**，所有宿主服务必须解析到运行中 dsh 的那**一份**实例。任何 `@deepseek-ai/*` 一旦进了 `dependencies`（或非 optional 的 `peerDependencies`——pnpm 会自动装它），就会在用户 profile 里多出一份私有副本并遮蔽宿主那份，Cordis Service 身份不再相等。这类问题只在别人机器上出现，所以 `prepublishOnly` 会跑 `scripts/check-package.cjs` 挡在发布之前。改动 `package.json` 后请跑 `pnpm run check`。

</details>

## 反馈与更新

上游 dsh 还在快速迭代，插槽位置、接口语义、组合方式都可能随版本变化，本插件难免会有跟不上的时候。遇到任何问题——卡片不显示、某个引擎报错、新版本 dsh 上行为不对——都欢迎提 [issue](https://github.com/MochiNek0/dsh-web-search-free/issues)，附上 dsh 版本号和报错信息即可。插件会持续跟进更新。

感谢大家的支持 🙏

## 许可证

MIT，见 [LICENSE](https://github.com/MochiNek0/dsh-web-search-free/blob/main/LICENSE)。
