# 暮雨笺 · 知识库 + Agent 预设系统 计划书

最后更新：2026-09-11
前置状态：阶段 0（streaming BUG 修复、调试日志清理、基线全绿）已完成，全部工作已提交（`f72ec31`）。

---

## 0. 前置任务（接手先行项）

1. 修复 AiChat streaming BUG（光标不消失，线索见 HANDOVER.md「🔴 正在修的 BUG」），并清理 `[ai-rx]`/`[ai]` 调试日志。
2. `npm run build:renderer && npm test && npm run typecheck` 全绿后，才进入本计划。

---

## 1. 需求总览

| # | 需求 | 说明 |
| - | ---- | ---- |
| F1 | AI 助手知识库 | 问答时可圈选知识来源：指定笔记、导入文件、题册等；检索到的内容注入问答上下文 |
| F2 | Agent 预设系统 | 预设 = 一份 dsh profile 变体（系统提示词 + 默认工具/插件集 + 启动行为），Agent 一级页可切换 |
| F2a | 暮雨笺预设 | 默认连接暮雨笺：整理/新建笔记、题册、画布、计划，导入文件 |
| F2b | 研究预设 | 启动先通读工作区全部文件，在 `research-db/` 建索引数据库，再基于此做著作/论文的分析与检索 |
| F3 | 文档生成插件 | Word / Excel（表格）/ PDF 生成，供两个预设的 Agent 调用 |

统一原则：全部能力沉淀进 `src/main/capabilities.ts` 注册表 → 对外 Bridge、内置 Agent、AI 问答三方共用；所有写操作继续走 `enqueueFile` + 确认闸门。

---

## 2. 总体架构

```
┌─ 渲染端 ─────────────────────────────────────────────┐
│ AiChat（问答 + 知识库选择器）   AgentView（预设切换）   │
└──────────────┬──────────────────────┬────────────────┘
        IPC: knowledge.*        IPC: dshPreset.*
┌──────────────┴──────────────────────┴────────────────┐
│ 主进程                                                │
│  capabilities.ts（+knowledge.* 能力注册）              │
│  knowledgeService.ts（数据源挂载/解析/索引/检索）        │
│  dshPreset.ts（预设定义/物化 profile/patch）            │
│  dshRuntime.ts / dshWeb.ts（预设参数化启动）            │
└──────────────┬──────────────────────┬────────────────┘
        plugins/muyujian-dsh-tools（既有：暮雨笺能力）
        plugins/muyujian-doc-tools（新增：docx/xlsx/pdf）
        plugins/muyujian-research-tools（新增：研究库检索）
```

---

## 3. F1 知识库模块（AI 助手）

### 3.1 数据源模型
- 三类来源，均复用既有数据层，不新建存储副本：
  - `note`：`notesData.ts` 便签（勾选特定条目）；
  - `questionBook`：题册（按题册勾选）；
  - `file`：导入文件（弹系统文件对话框复制到工作区 `knowledge/`，用 markitdown 思路解析为 Markdown 文本）。
- 选择状态持久化在设置 store（`knowledgeSelection`: 带类型前缀的 id 数组），AiChat 顶部新增「📚 知识库」弹出勾选面板。

### 3.2 索引与检索
- 新增 `src/main/knowledgeService.ts`：
  - 解析/归一化各来源为「片段（chunk）」（按标题/固定长度切分，记录来源引用）；
  - 本地检索引擎 **FlexSearch**（pure JS、零原生依赖、可进主进程）做倒排全文索引；中文按字/词组（bigram）分词；
  - 每来源缓存 `mtime` 做增量重建，避免每次问答全量重扫。
- 检索 API：`searchKnowledge(query, { sources?, limit })` → 返回 `{ text, source: {type, id, title}, score }[]`。

### 3.3 注入问答与 Agent
- AI 问答：`requestAi` 前取用户最后一条消息检索 Top-N（默认 6 片段、总长不超过 4K 字符），以 `### 参考知识库` 段落拼进 system prompt（不进用户消息，避免污染历史记录）。
- Agent：在 `capabilities.ts` 注册 `knowledge.search` 能力（复用同一 searchKnowledge），dsh 侧 `muyujian-dsh-tools` 插件追加同名工具，暮雨笺/研究预设都可调用。
- 溯源：问答 UI 在回复气泡下方折叠显示命中来源（笔记标题/题册名），点击跳转到对应视图。

### 3.4 测试
- `knowledgeService.test.ts`：分块、中文检索命中、mtime 增量、来源过滤、空选择行为；不少于 8 例。

---

## 4. F2 Agent 预设系统

### 4.1 预设定义
新增 `src/main/dshPreset.ts`，预设为纯数据：

```ts
type DshPresetId = 'muyujian' | 'research'
interface DshPreset {
  id: DshPresetId
  label: string            // 展示名
  systemPrompt: string     // 追加到 dsh system prompt
  plugins: string[]        // 启用的内置插件
  initScript?: string      // 启动钩子（如研究预设的建库流程）
}
```

- 物化：每预设独立 `$DSH_HOME/<preset>/`（复用 `prepareSdkProfile` 思路），patch 只挂预设声明的插件；预设选择存设置 store。
- 启动：Agent 页顶栏加预设切换（segmented 控件）；切换 → `dshWeb.restart(preset)`。SDK 运行时与 Web 运行时读同一预设。

### 4.2 暮雨笺预设（F2a，默认）
- 工具：`muyujian-dsh-tools` 全量能力 + `knowledge.search` + 文档生成插件（F3）。
- system prompt 要点（写入预设）：
  - 你是「暮雨笺」内置学习助理，工作目录 = 暮雨笺工作区；
  - 默认优先调用暮雨笺工具而非读写裸文件；
  - 写操作（整理/新建题册/画布/计划/导入文件）主动说明意图并等待用户确认闸门；
  - 整理计划时使用 plan.addTask，整理题册使用 questionBook.import。

### 4.3 研究预设（F2b）
- 目录约定：工作区下 `research-db/` 为研究数据库（此目录不暴露给暮雨笺预设的写能力）：
  - `index.json`（SQLite 备选）：每文档 `{ id, 文件名, 路径, 类型, 题目, 摘要, 关键词[], 提取时间, 章节大纲[] }`；
  - `texts/`：每篇文档的解析全文（Markdown/txt）；
  - `vectors/`（可选后置）：若后续接 embedding。
- 启动流程（initScript，由插件侧提供 `research.init` 工具，prompt 里追加引导语让其先跑）：
  1. `research.scan`：递归扫描工作区（跳过 node_modules/dist/resources/dsh-runtime，限深度与单文件 50MB 上限）；
  2. 文件解析：PDF/DOCX/PPT/XLSX/EPUB/MD 等先转文本 —— 解析矩阵参考 microsoft/markitdown，Node 侧用 pdf-parse / mammoth / xlsx 等组合实现；
  3. 逐文档写入 `research-db/` 索引（标题/摘要/关键词可由 LLM 提炼，经确认闸门）。
- 运行时工具（新插件 `plugins/muyujian-research-tools/`）：`research.scan / research.list / research.read / research.search（FlexSearch 全文，与 knowledgeService 同引擎）/ research.summary`。
- system prompt 要点：你是研究助理；默认先保证 `research-db/` 索引为最新（mtime 比对）；回答论文/著作问题必须先检索研究库再作答，并标注来源文件与页/章节。

---

## 5. F3 文档生成插件（Word / Excel / PDF）

新插件 `plugins/muyujian-doc-tools/`（Cordis 插件，与 muyujian-dsh-tools 同构），工具集：

| 工具 | 说明 | 实现（Node 库） |
| ---- | ---- | -------------- |
| `doc.createWord` | Markdown/结构化内容 → .docx | docx（npm） |
| `doc.createSheet` | 表头 + 行数据 → .xlsx | exceljs |
| `doc.createPdf` | Markdown/HTML → .pdf | 优先 Electron 渲染端隐藏窗口 printToPDF（无外部依赖、中文字体好）；兜底 pdf-lib |

PDF 路线说明：本项目已有 Electron，用 Chromium printToPDF 输出质量与中文支持最佳，且不引入 LaTeX/pandoc 重依赖；仅当需要离线多格式转换时才考虑 pandoc 备用路线。

安全约束统一照旧：输出路径限定工作区内 + `toLongRealPath` 归一化；写文件一律走确认闸门与审计。

---

## 6. 开源参考清单（引用登记，持续更新）

dsh 插件体系为 Node/TS（Cordis），下列多为 Python 的 MCP server，定位为「接口/能力设计参考」而非直接嵌入代码；直接复用的 Node 库单独注明。每集成一项须在此表补「实际使用方式」列。

| 项目 | 作者 / 仓库 | License | 参考点 | 实际使用方式（待补） |
| ---- | ----------- | ------- | ------ | ------------------ |
| Office Word MCP Server | GongRzhe · https://github.com/GongRzhe/Office-Word-MCP-Server | MIT | Word 生成工具集划分（create/format/table/样式） | 接口设计参考，Node 侧以 docx 库自实现 |
| Excel MCP Server | haris-musa · https://github.com/haris-musa/excel-mcp-server | MIT | 表格工具面（workbook/sheet/数据/格式操作） | 接口设计参考，Node 侧以 exceljs 自实现 |
| MarkItDown | microsoft · https://github.com/microsoft/markitdown | MIT | 各格式 → Markdown 的解析矩阵与管线设计 | 设计参考，Node 侧 pdf-parse/mammoth/xlsx 组合 |
| mcp-pandoc | vivekVells · https://github.com/vivekVells/mcp-pandoc | MIT | pandoc 式文档转换工具抽象 | 备用方案参考（若启用 pandoc 路线再登记） |
| markdown2pdf-mcp | 2b3pro · https://github.com/2b3pro/markdown2pdf-mcp | MIT | Markdown→PDF 工具参数设计 | 接口设计参考 |
| FlexSearch（npm 库） | nextapps-de · https://github.com/nextapps-de/flexsearch | Apache-2.0 | 本地全文检索 | 已集成：`src/main/knowledgeService.ts` 检索引擎（tokenize: full），Top-5 注入问答与 `knowledge.search` 能力，单测 8 例；研究库检索（F2b）复用同引擎 |
| dsh 本体 | deepseek-ai/deepseek-harness（_ref/ 参考） | 见其仓库 | profile/patch/插件机制 | 既有内置（已定） |

红线：以上任何参考项目的代码片段若被拷贝进入仓库，必须在文件头注明来源；优先「借鉴设计 + Node 生态自实现」。

---

## 7. 实施分期

- 阶段 0（前置）：✅ 已完成——streaming BUG 修复、调试日志清理、基线全绿。
- 阶段 1（F1 知识库）：✅ 已完成——knowledgeService + FlexSearch + AiChat 选择器与注入 + `knowledge.search` 能力 + 测试（8 例全绿）。
- 阶段 2（F2 预设框架）：✅ 已完成——dshPreset + profile 物化参数化 + Agent 页预设切换。
- 阶段 3（F2b 研究预设）：待实施——文件解析管线 + research-db 建库 + muyujian-research-tools 5 工具 + 预设提示词；端到端样例工作区验证（`_ref/samples/` 放 2-3 篇示例 PDF/DOCX）。
- 阶段 4（F3 文档插件）：待实施——muyujian-doc-tools 三工具 + 确认闸门接入 + 真实生成验证（Word 含表格、xlsx、中文字体 PDF）。
- 阶段 5（收尾）：进行中——README / HANDOVER / WORK_LOG 已更新；本计划表「实际使用方式」列待 F2b/F3 补齐；截图与日志不留 Key。

每阶段完成即跑：`npm run build:renderer && npm test && npm run typecheck`；需要真网关时沿用 `DSH_LIVE_KEY` 门控用例模式新增 live 测试。

---

## 8. 风险与注意事项

1. dist 优先加载：渲染端任何改动必须 `npm run build:renderer` 再验，否则看到旧界面。
2. 凭证红线：`dsh-home/.credentials.yaml` 含真实 Key，截图/日志/提交不得外泄；研究预设扫描工作区时排除 `dsh-home`、`.credentials*`。
3. 扫描范围：研究预设初扫需排除 `node_modules`、`resources/dsh-runtime`（约 300MB）、`dist`；限制并发与文件大小，解析放 worker/子进程防卡主进程。
4. LLM 提炼成本：建库摘要走真网关产生 Token 消耗；实现时支持「仅元数据不摘要」的默认模式。
5. 预设与配置单一事实源：所有预设继续共用 `dshConfig.ts` 的网关/Key 配置，杜绝再长出第二份配置。
6. 不做打包验证（沿用用户既有决定），发布前需补一次 electron-builder 验证。
