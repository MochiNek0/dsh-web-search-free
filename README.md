# dsh-web-search-free

中文 | [English](https://github.com/MochiNek0/dsh-web-search-free/blob/main/README.en.md)

[DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) 的免费 Web Search / 网页抓取插件。它把 dsh 默认的 `deepseek-official` 通道换成**多引擎 + 自动 fallback**：按你排的顺序依次尝试已填 Key 的引擎，失败或额度用尽就换下一个；同一引擎可填多个 Key（每行一个），按序轮换。

- **不烧模型 token**：直接调各引擎的检索端点，不经过任何 LLM。
- **装上即接管，卸载即回落**：以 dsh bundle 层安装，无需手改 profile。
- **自带配置卡片**：拖动排序、填 Key、测试 Key、查看用量，界面语言跟随 dsh。
- **请求只从宿主进程发出**：浏览器侧只有配置卡片，不直接访问任何外部服务。

## 为什么是 "free"

官方通道 `deepseek-official` 的每次搜索都是一次**完整的模型调用**（带服务端 `web_search` 工具），搜索请求本身和回灌进上下文的 sources 都从 `DEEPSEEK_API_KEY` 余额扣 token。

|            | 官方 `deepseek-official`                    | 本插件 `web-search-free`            |
| ---------- | ------------------------------------------- | ----------------------------------- |
| 检索方式   | LLM 调用 + 服务端搜索工具                   | 直接调引擎检索端点                  |
| 模型 token | 每次搜索都消耗                              | **0**                               |
| 计费       | DeepSeek API 余额                           | 各搜索 API 自身额度（多数有免费层） |
| 凭据       | **必须** `DEEPSEEK_API_KEY`                 | 各引擎自己的 Key                    |
| 结果       | 只有 sources，未被模型引用的结果没有 snippet | sources + snippet；Tavily 另给直接回答 |

> 如果你的对话模型走第三方渠道、没配 `DEEPSEEK_API_KEY`，官方通道仍会被选中，直到模型真正调用 `web_search` 才报 `WEB_PROVIDER_CREDENTIAL_MISSING`。本插件不依赖任何 LLM 凭据。

## 支持的引擎

| 引擎                 | 搜索 | 抓取 | 结果日期 | 免费额度                                   | 获取 API Key                                             |
| -------------------- | :--: | :--: | :------: | ------------------------------------------ | -------------------------------------------------------- |
| TinyFish             |  ✓   |  ✓   |   部分   | 免费，仅限速率                             | <https://www.tinyfish.ai/pricing>                        |
| SearXNG              |  ✓   |  ✗   |   部分   | 自建实例，不限量（「Key」填实例地址）      | <https://docs.searxng.org/admin/installation.html>       |
| AnySearch            |  ✓   |  ✓   |    ✗     | 1,000 次/天                                | <https://anysearch.com/pricing>                          |
| 百度千帆             |  ✓   |  ✗   |   部分   | 每日免费额度（以控制台为准）               | <https://console.bce.baidu.com/iam/#/iam/apikey/list>    |
| Tavily               |  ✓   |  ✓   |    ✗     | 1,000 credits/月                           | <https://app.tavily.com/>                                |
| Brave Search         |  ✓   |  ✗   | **多数** | $5 额度/月（需绑卡，不扣费）               | <https://api-dashboard.search.brave.com/register>        |
| Exa (Metaphor)       |  ✓   |  ✓   |   部分   | 注册送 $20 + 每月补 $10（累积）            | <https://dashboard.exa.ai/>                              |
| Firecrawl            |  ✓   |  ✓   |    ✗     | 1,000 credits/月（搜索 2 credits/10 结果） | <https://www.firecrawl.dev/>                             |
| 火山引擎（豆包搜索） |  ✓   |  ✗   |   部分   | 500 次/月                                  | <https://console.volcengine.com/search-infinity/api-key> |
| SerpApi              |  ✓   |  ✗   |    弱    | 250 次/月                                  | <https://serpapi.com/users/sign_up>                      |
| Jina AI              |  ✓   |  ✓   |   部分   | 新 Key 送 10M tokens（一次性）             | <https://jina.ai/api-key>                                |
| Serping API          |  ✓   |  ✗   |   部分   | 每账号 1,000 次（一次性，无需绑卡）        | <https://serpingapi.com/signup?ref=dsh-web-search-free>  |

表格顺序即默认调用顺序：按可持续免费次数从多到少（不限量 > 每日重置 > 每月重置 > 一次性），相当时注册/绑卡门槛低的优先。

- **抓取**：只能搜索的引擎（✗）不参与抓取。没有可用的抓取引擎时，`web_fetch` 退回无 Key 的 Jina Reader 和 dsh 本地抓取（见[高级设置](#高级设置)）。
- **结果日期**：决定模型能否判断时效。Brave 最全（实测 18/20）；Tavily 通用搜索不返回日期，Firecrawl、AnySearch 没有该字段。在意时效可把 Brave 往前挪。

<details>
<summary>各引擎注意事项</summary>

- **Jina**：`s.jina.ai` 每次扣 1 万 token，约够 1,000 次搜索，用完不重置。
- **Exa**：余额不清零，约 1,400 次基础搜索。
- **TinyFish**：免费层 Search 30 次/分钟、Fetch 150 URL/分钟。
- **SearXNG**：「Key」框填实例地址（如 `https://searx.example.com`），每行一个。实例需在 `settings.yml` 的 `search.formats` 里加上 `json`，否则返回 403。
- **百度千帆**：Key 在百度智能云 API Key（V2）页面创建，旧版 AK/SK 不可用。只搜中文网页。
- **火山引擎**：Key 来自联网搜索控制台的「API Key 管理」，火山方舟（Ark）的 Key 不可用。每月 1 日重置，只搜中文网页。

</details>

## 安装

前置条件：**dsh ≥ 0.1.2-rc.1**，`pnpm` 在 `PATH` 上。配置卡片只在 Web 界面出现，因此一般装到 `web` profile：

```sh
dsh plugin --profile web add dsh-web-search-free
```

安装后 dsh 自动对账 `dsh.profile.bundles`，插件即接管 web 搜索与抓取。

<details>
<summary>从本地源码安装</summary>

```sh
pnpm install
pnpm build                          # 生成 dist/（已 gitignore）
dsh plugin --profile web add .
```

本地目录以链接方式安装，之后重新 `pnpm build` 即生效；改客户端代码后刷新浏览器即可。

</details>

> dsh ≤ 0.1.2-alpha.5 不挂载 web 工具，装本插件后只有搜索、没有 `web_fetch`，请改用插件 1.3.0。

## 配置

运行 `dsh web`，找到配置卡片：

| dsh 版本 | 卡片位置                                                |
| -------- | ------------------------------------------------------- |
| ≥ 0.1.6  | 侧栏 **插件** → 「已安装」→ **web-search-free**         |
| ≤ 0.1.5  | **设置 → 插件 → 插件配置 → 免费网页搜索**               |

1. **点击引擎行**展开，粘贴 Key（每行一个）；行内「获取 API Key ↗」直达申请页。
2. **拖动 `⋮⋮` 手柄**调整「调用顺序」：靠前的先调，失败按序 fallback。
3. 顶部开关 **「启用 web_fetch」**：关闭后模型调用 `web_fetch` 会收到明确的错误。
4. 点 **保存**，下一次搜索即生效，无需重启。

至少要配一个引擎，否则搜索报 `No web search providers configured.`

卡片还提供（需 dsh 支持插件路由，已在 0.2.0-rc.2 验证；旧版本自动隐藏）：

- **测试 Key**：每个 Key 做一次小搜索，显示成功与否、条数、耗时或原始报错。每个 Key 消耗一次额度。
- **用量统计**：按引擎、Key 显示调用次数、成功率、平均耗时、最近错误、冷却状态和缓存命中。仅存内存，重启清零。
- **检查更新**：由宿主进程查询 npm registry，有新版时给出升级命令。

### 高级设置

卡片底部「高级设置」默认收起，不改也能用。顶部的**快捷预设**（省额度 / 速度优先 / 质量优先 / 中文优先 / 恢复默认）可叠加，保存后生效。

| 设置            | 字段                  | 说明                                                                                                                                   |
| --------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 搜索策略        | `searchStrategy`      | `fallback`（默认）逐个尝试，最省额度；`race` 同时调前 N 个、取最快；`merge` 同时调前 N 个并合并去重，结果最全但消耗 N 倍额度           |
| 并发引擎数      | `parallelEngines`     | 2–4，默认 2，仅 `race` / `merge` 使用                                                                                                  |
| 结果地区 / 语言 | `region` / `language` | 默认 `auto`。Brave、SerpApi、Serping API、TinyFish、AnySearch 两项都支持；Tavily、Exa 仅地区；SearXNG 仅语言；其余不支持            |
| 时间范围        | `freshness`           | `any`（默认）/ `day` / `week` / `month` / `year`。AnySearch、Jina 不支持；百度千帆的 `day` 按一周查                                    |
| 屏蔽域名        | `blockedDomains`      | 每行一个，含子域名                                                                                                                     |
| 优先域名        | `preferredDomains`    | 每行一个，这些域名的结果排到最前                                                                                                       |
| 摘要长度        | `snippetLength`       | 100–1000，默认 300                                                                                                                     |
| Tavily 搜索深度 | `tavilySearchDepth`   | `basic`（默认，1 credit）/ `advanced`（2 credits）                                                                                     |
| 抓取来源        | `fetchSource`         | `providers`（默认）：有 Key 的引擎 → 无 Key Jina → dsh 本地抓取；`dsh`：只用 dsh 本地抓取（免费、不经第三方，但不渲染 JS）             |
| 无 Key 抓取兜底 | `keylessJinaFetch`    | 默认开启，有 Key 的抓取都失败时用无 Key 的 Jina Reader（20 次/分钟，URL 会发给 Jina）                                                  |
| 缓存时长        | `cacheMinutes`        | 0–60 分钟，默认 10；相同请求直接返回缓存，不耗额度。0 为关闭                                                                           |

每次 (引擎, Key) 尝试单独限时（搜索 10 秒、抓取 20 秒）。返回 401/402/403/429 或提示额度用尽的 Key 会暂时排到链尾（429 为 2 分钟，其余 30 分钟）。全部失败时，报错会列出每次尝试的原因（Key 已打码）。

### 手动配置

找不到卡片时（浏览器控制台会打印 `[web-search-free] no settings card mounted: …`，欢迎贴到 issue），可以直接编辑 `~/.dsh/profiles/web/cordis.patch.yml`。插件安装时已插入 `web-search-free` 行，这里**按 id 覆盖它的 config**，不要再写 `insert`：

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

字段名见 `src/index.ts` 的 `Config`：`<引擎>ApiKey`（多个 Key 用多行字符串）、`enableFetch`、`providerOrder` 以及上表字段。改完重启 dsh 生效。dsh ≥ 0.1.7 的卡片也写这个文件，保存时会覆盖同名字段。

### 升级到 dsh 0.1.7 后 Key 不见了

dsh 0.1.7 把配置从 `~/.dsh/settings.yaml` 迁移到 profile 的 `cordis.patch.yml`，迁移只跑一次。如果当时插件没能启动（1.5.x 在 0.1.7 上会卡在 "Failed to load plugins"），Key 会留在 `~/.dsh/settings.yaml.imported` 里。插件检测到这种情况时，会在日志和卡片上提示。可以在卡片里重新填 Key，或者把下面这段交给 dsh：

> 把 dsh 主目录（默认 ~/.dsh）下 settings.yaml.imported 里 web-search-free 段的所有字段，原样写进当前 profile 的 cordis.patch.yml，作为 id 为 web-search-free 的 entry 的 config；该 entry 不存在就新增。保留原文件的注释和格式，改动前先备份。

## 更新与卸载

```sh
dsh plugin --profile web update dsh-web-search-free
dsh plugin --profile web remove dsh-web-search-free
```

卸载后 web 搜索/抓取回落到 `deepseek-official`。注意：

- **卸载前先点卡片底部「清空全部配置」**，否则 Key 会留在 dsh 的配置文件里。
- **卸载后重启 dsh**，否则搜索会报 `WEB_PROVIDER_CONFIGURED_MISSING`。

## 工作原理

插件是一个 dsh bundle 层：`cordis.patch.yml` 插入 `web-search-free` 行，并把 `web` 行的 `searchProvider` / `fetchProvider` 指向它。宿主半边（`src/index.ts`）注册搜索与抓取 provider，按 `providerOrder` 依次调用；客户端半边（`src/client.tsx`）提供配置卡片。实现细节见源码注释。

开发提示：`@deepseek-ai/*` 不能进 `dependencies` 或非 optional 的 `peerDependencies`，否则会在用户 profile 里装出一份私有副本、遮蔽宿主实例。改动 `package.json` 后请运行 `pnpm run check`（发布前也会自动检查）。

## 反馈

dsh 仍在快速迭代，插件可能有跟不上的时候。遇到问题请提 [issue](https://github.com/MochiNek0/dsh-web-search-free/issues)，附上 dsh 版本和报错信息。

## 许可证

[MIT](https://github.com/MochiNek0/dsh-web-search-free/blob/main/LICENSE)
