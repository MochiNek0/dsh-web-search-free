# dsh-web-search-free

中文 | [English](README.en.md)

面向 [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/dsh) 的免费 Web Search / 网页抓取插件。

它把 dsh 默认的 `deepseek-official` 搜索/抓取通道，替换成一个**多引擎 + 自动 fallback** 的通道：你填入哪些引擎的 API Key，它就按你排定的顺序依次尝试，前一个失败（或额度耗尽）会自动落到下一个；同一引擎也可以填多个 Key（每行一个），引擎内 Key 同样按顺序轮换。所有请求都从你的浏览器侧发起，不经过官方搜索后端。

- 注册为 dsh 的 `web` 能力通道（同时提供 `searchProvider` 与 `fetchProvider`，id 均为 `web-search-free`）。
- 自带一个 Web 设置卡片（设置 → 插件 → **Web Search Free**），可拖动排序、逐个填 Key。
- 作为 dsh bundle 层安装：装上即接管 web 搜索/抓取，卸载即自动回落到默认通道，无需手改 profile。

## 为什么是 free 的：与官方通道的计费差异

dsh 默认的官方通道 `deepseek-official`（由 `@deepseek-ai/dsh-web-search-deepseek` 提供）**不是一个专用搜索端点**：每次搜索都会发起一次**完整的 Messages 模型调用**（`POST …/anthropic/v1/messages`，带原生 `web_search` 服务端工具），由 DeepSeek 在服务端执行搜索、返回结构化结果块。因此每次搜索都要烧两份 token：

1. **辅助搜索请求本身**——一个独立模型收到 `Perform a web search for the query: <query>` + 工具定义，产生 input + output token（`maxTokens` 默认 4096、`maxUses` 默认 5）；这是一次完整的模型轮次，延迟与生成都按模型调用计。
2. **结果回灌对话**——解析出的 sources（URL/标题/片段）注入回对话模型上下文，作为对话 token 一直重发直到压缩。

两份都从 `DEEPSEEK_API_KEY` 余额扣除。

本插件走各引擎的**专用检索端点**（如 Tavily `/search`、Exa `/search`、Jina `s.jina.ai`），是纯检索，不经任何 LLM：

| | 官方 `deepseek-official` | 本插件 `web-search-free` |
|---|---|---|
| 检索方式 | 一次完整 LLM 模型调用 + 服务端搜索工具 | 直接调各引擎专用检索端点 |
| 模型 token | 每次搜索都烧（input + output） | **0**（纯检索，不碰任何 LLM） |
| 计费来源 | DeepSeek API 余额 | 各搜索 API 自身额度（多数有免费层） |
| 凭据 | `DEEPSEEK_API_KEY` | 各引擎各自的 API Key |

这正是插件名为 "free" 的核心理由——官方每次搜索烧一整轮模型 token，这里只走检索、不烧 token。

## 支持的引擎

| 引擎 | 搜索 | 抓取 | 获取 API Key |
|---|:---:|:---:|---|
| Jina AI | ✓ | ✓ | <https://jina.ai/api-key> |
| Exa (Metaphor) | ✓ | ✓ | <https://dashboard.exa.ai/> |
| Tavily | ✓ | ✓ | <https://app.tavily.com/> |
| Firecrawl | ✓ | ✓ | <https://www.firecrawl.dev/> |
| Brave Search | ✓ | ✗ | <https://api-dashboard.search.brave.com/register> |

> Brave 仅支持搜索，不支持 URL 抓取。若你的抓取链路上只有 Brave 有 Key，抓取会失败——请再给一个支持抓取的引擎配上 Key。

## 前置条件

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

打开 **设置 → 插件 → Web Search Free** 卡片：

1. 点开卡片，每一行对应一个引擎。
2. 在对应引擎的输入框粘贴 API Key，点行内「获取 API Key ↗」可直达各引擎的申请页。每个引擎支持填多个 Key：**每行一个**，引擎内会按行顺序轮换。
3. **拖动每一行**调整调用顺序：排在前面的引擎优先调用，失败则按顺序 fallback；同一引擎的多个 Key 也会逐个尝试，任一 (引擎, Key) 成功即返回，全部失败才报错。未填 Key 的引擎不进入调用链。
4. 点「保存」。Key 通过 dsh 的设置命名空间（`web-search-free`）持久化，下一次搜索即时生效，无需重启。

**至少配置一个引擎的 Key**，否则搜索/抓取会以 `No web search providers configured.` 报错。

## 验证

1. `dsh web` 启动 Web 界面。
2. 在对话里让模型用 Web 搜索/抓取（例如「搜一下今天的新闻」或「抓取 https://example.com 的内容」）。
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

对账会把本插件从 `dsh.profile.bundles` 移除，web 搜索/抓取**自动回落到 dsh-base 的 `deepseek-official` 默认通道**——无需手改 profile 或 patch。

## 工作原理

本插件是一个 dsh **bundle 层**（`package.json` 里声明 `dsh.bundle.patch: ./cordis.patch.yml`）。`cordis.patch.yml` 做两件事：

- `insert` 一行 `web-search-free`，把本插件的宿主半边纳入组合；
- 用一条同 id 的 `web` 覆盖层，把 `searchProvider` 与 `fetchProvider` 都重指到 `web-search-free`，从而盖过 `dsh-base` 里钉死的 `deepseek-official`。

宿主半边（`src/index.ts`，`inject: ['web']`）向 `ctx.web` 注册搜索与抓取 provider，内部按 `providerOrder` 顺序遍历「已配 Key」的引擎做 fallback；每个引擎的 Key 字段可填多个（每行一个），引擎内也会按行顺序逐个轮换。客户端半边（`src/client.tsx`）在「插件」设置页注册一张 React 卡片，读写同一命名空间 `web-search-free` 的设置。两层靠这个命名空间字符串对齐。

构建分两步（包声明 `"type": "module"`）：`tsconfig.json`（`module: NodeNext`）把宿主半边编成 ESM 产物（`dist/index.js` 等，与 dsh 运行时同为 ESM，避免 CJS `require()` 一个 ESM 依赖时触发的加载竞态）；`tsconfig.client.json`（`module: CommonJS`）单独编出 `dist/client.js`，再由 `wrap-client.cjs` 包成 `window.__ModuleLoader__.load(...)`，使其能被 dsh 的浏览器侧模块加载器加载。宿主半边从 `@deepseek-ai/schemastery` 取 `Schema`（而非旧版 `cordis`），`Context` 仅作类型从 `@deepseek-ai/cordis` 引入。

## 许可证

MIT，见 [LICENSE](LICENSE)。
