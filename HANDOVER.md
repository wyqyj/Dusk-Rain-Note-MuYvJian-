# 暮雨笺工作交接文件

最后更新：2026-09-11
接手前请先读本文件，再按「执行顺序」一节开始。

> ✅ **当前状态**：第二阶段（Agent 一级化 + AI 统一配置 + 流式光标 BUG）已全部修复闭环并真实验证。第三阶段 F1（AI 助手知识库）、F2（Agent 预设基础框架）、F2b（研究预设 research-db 建库与检索）与 F3（文档生成 docx/xlsx/pdf）已落地；dsh 配置热重载（GUI 改配置自动重启运行时）已完成。2026-09-12：全部工作已提交（`f72ec31`、`5b26094`、`a0d6760`、`f75907a`），临时调试脚本已清理，README 已补 AI/Agent 章节，质量基线 86 用例通过 / 2 跳过 + 双侧 typecheck 全绿；研究模式插件加载（.agent-presets 路径缺 node_modules）已用 MUYUJIAN_DSH_TOOLS_PATH 回退解析修复；知识库打包 UI 已美化并新增 knowledge.bundles / bundleId 与 Agent 联动；AgentView 预设切换缺失的 dsh-web-restart IPC 已补齐；文档生成含 doc.createPpt（pptxgenjs）共 22 个能力，四件套（Word/PDF/PPT/Excel）经真实桥 HTTP 链路实测通过。

## 一、项目速览

- 名称：暮雨笺（MuYuJian），考研备考工作台 + 便签。
- 技术栈：Electron（主进程 `src/main/`）+ React 18 + TypeScript（渲染端 `src/renderer/`，vite，dev 端口 5173）。
- 仓库：`github.com/wyqyj/Dusk-Rain-Note-MuYvJian-`，本地工作目录 `D:\工作区\暮雨沉山`（循环目录即仓库本体）。
- 包脚本：`npm run dev:renderer`（vite dev）、`npx tsc -p tsconfig.main.json && npx electron .`（主进程编译+启动）、`npm test`（vitest）、`npm run typecheck`（双侧 tsc）。

## 二、已完成工作

### 1. 安全与健壮性审查修复（全部完成）
- 15 项问题清单与修复记录见根目录 `FIX_PLAN.md`；测试 36 个用例全绿（`npm test`）。
- 曾出现 CSP meta 导致开发模式白屏的回归，已修复（dev 下由 vite 注入资源，meta 只保留在打包产物）。

### 2. AI 助手重构（完成）
- `src/renderer/components/AiChat.tsx`：左历史会话、右聊天框；接口设置收进右上角弹窗，默认隐藏。
- `src/main/aiService.ts`：OpenAI 兼容协议 + 流式输出；Key 存系统安全存储，不进配置文件。

### 3. 对外接入 Agent（Agent Bridge，完成）
- `src/main/agentBridge.ts`：本地 HTTP 桥服务，Bearer 令牌、512KB 上限、10s/30 次限流、200 条审计环形日志；能力白名单 = notes.list/get/create/update、plan.list/addTask/completeTask、questionBook.list/import、workspace.status；写路径全走 `enqueueFile`。
- `src/main/index.ts`：IPC `agent-bridge-get/save/reset-token/token`；启动时按保存的配置自动拉起；导出备份不含 token。
- 设置页「对外接入 Agent」面板：`src/renderer/components/AgentBridgePanel.tsx`（开关 / 仅本机或局域网（有二次确认）/ 令牌复制与重置 / 最近调用）。
- MCP 适配器：`bridge/muyujian-mcp.js`（零依赖 stdio MCP server，Node >= 18），用法与能力表见 `bridge/README.md`。
- 测试：`src/main/agentBridge.test.ts` 8 个用例全绿。

### 4. 内置 Agent（DeepSeek Harness，阶段 A–E 已实现）
- 方案：内置 dsh 子进程，见 `DEEPSEEK_HARNESS_PLAN.md`；旧方案 `INLINE_AGENT_PLAN.md` 仅作历史参考。dsh 源码参考在 `_ref/deepseek-harness/`（已 gitignore，可删）。
- A 能力层：`src/main/capabilities.ts` 共享能力注册表，`agentBridge.ts` 改消费它。
- B 运行时：`src/main/dshRuntime.ts`（惰性拉起 `node dsh --profile sdk`、崩溃重建、停止=重启运行时）；IPC `dsh-agent-run/stop/status`；AiChat 有「问答/Agent」模式切换。
- C 业务工具：`src/main/agentToolManifest.ts` 序列化能力清单；`plugins/muyujian-dsh-tools/` Cordis 插件把能力注册成 dsh 工具，执行体回调内置 Bridge；`prepareSdkProfile()` 物化 profile、同步插件、生成 `--patch`（挂载插件 + 禁用 tool-bash/pwsh/fs/fs-search/web/subagent/workflow 等危险内置工具）。已用真实 dsh 启动冒烟验证插件加载。
- D 确认闸门：Bridge `confirmWrite` 钩子（写操作挂起→渲染端卡片同意/拒绝→120s 超时拒绝→审计）；内部桥独立实例（loopback、随机 token 不落盘）。IPC `dsh-agent-confirm-resolve` + 事件 `dsh-agent-confirm-request`。
- 模型接入：`DshRuntime` 的 `getModelConfig` 依赖生成 `$DSH_HOME/settings.yaml`（自定义 provider `muyujian-gateway`，`api: openai-completions`，Key 经 `MUYUJIAN_LLM_API_KEY` 环境变量注入不落盘）；当前配置网关 `https://api.yujianwudi.top`、模型 `kimi-k3`；保存 AI 配置时自动重启运行时。
- 路径归一化：`toLongRealPath()`（win32 下 `realpathSync.native` 归一 8.3 短名/链接），修复 dsh 导入工作区时中文路径被裁剪的问题；`workspace-migrate` 后重启 dsh 与内部 Bridge。
- E 依赖内置：`scripts/vendor-dsh.mjs`（导出钉版 dsh 闭包到 `resources/dsh-runtime/`，实测 212.7MB）、`scripts/fetch-node.mjs`（内置 Node 22.14.0，79.5MB）；`resolveDshRuntimePaths()` 打包/开发双路径解析；package.json 已配 extraResources。用户已明确：不做体积裁剪，212.7MB 全量内置。
- 测试：`dshRuntime.test.ts`（含 toLongRealPath 2 例）、bridge 确认闸门 3 例、`dshProfile.integration.test.ts`（`DSH_INTEGRATION=1` 时真跑 dsh）、`dshE2E.live.test.ts`（`DSH_LIVE_KEY` 门控，真实 kimi-k3 调 notes_create）。`npm test` 47 绿 / 2 跳过、`typecheck` 与 `build:main` 通过；真实 E2E 已通过。
- ⚠️ 未做：electron-builder 打包验证（沿用既有决定）。

### 追加：启动实测修复 + Agent 升级为完整 dsh Web GUI（接入完成，待最终目视验证）
- 修复 1（重要）：`@deepseek-ai/dsh-sdk-client` 是 ESM-only，主进程 CJS require 导致启动即崩；已改动态 `import()`（`dshRuntime.ts`），真实启动验证通过。
- 修复 2（重要）：dsh CLI 依赖 `import.meta.main`（Node 24+），内置 Node 22.14 完全跑不起 dsh；`scripts/fetch-node.mjs` 已升 24.19.0 并重新下载。
- Web GUI 接入已完成：`src/main/dshWeb.ts`（子进程拉起、stdout 截 URL、30s 超时、启停/重启）、`src/main/dshWebProfile.ts`（web profile 物化 + 只挂业务插件的 patch，不禁用内置工具）、IPC `dsh-web-start/stop/status`、preload/vite-env 同步、AiChat.tsx Agent 面板改 `<webview>` 嵌入（惰性启动 + 错误重试态）、CSS `ai-agent-*`。
- 09-11 补修两处：CSP `frame-src` 放行回环地址（否则 webview 必白屏）；`dshWeb.launch()` 补写 `muyujian-tools.json` 清单（此前只在 SDK 运行时写，web 路径报 ENOENT 退出）。
- 验证状态：已完成端到端实测（2026-09-11）：webview GUI 正常渲染（截图 scripts/webview-gui-check.png）、走网关问答成功、web GUI 内 `notes_list` 工具调用成功。期间补了两个修复：`writeLlmSettings` 增加 `agent-default-model`（否则 GUI 默认为 deepseek-official 路由）、`validateAiBaseUrl` 自动补 `/v1`（否则 baseUrl 无 v1 时请求落到网关 SPA 首页，`Stream ended without finish_reason`）。详见 WORK_LOG_2026-09-11.md 首部。

### 追加：第二阶段 —— Agent 升为一级导航 + AI 助手与 Agent 共用配置（功能已落地，BUG 未修完）

用户要求：1) Agent 升一级导航（与画布/AI 助手/笔记/题册同级），整页内嵌 dsh Web GUI，AI 助手不再占大画幅；2) AI 助手（问答）与 dsh Agent 共用同一份网关/模型/Key；3) 点 AI 助手的设置直接跳到 dsh GUI 的配置界面。

已完成：
- **配置单一事实源迁移**：新 `src/main/dshConfig.ts`（`readHarnessModelConfig` / `seedHarnessModelConfig` 不覆盖 GUI 里的用户修改 / `upsertHarnessModelConfig` 显式保存覆盖）。配置读写都走 `%APPDATA%\muyujian\dsh-home\settings.yaml` + `.credentials.yaml`（records key `llm-pi-ai/<providerId>`，providerId=`muyujian-gateway`，Key 用环境变量名 `MUYUJIAN_LLM_API_KEY` 存在 credentials 里）。`dshRuntime.ts` 删掉了旧的 `writeLlmSettings`，启动时先播种旧配置再读回；`dshWeb.ts` 同样改读 harness 配置；`index.ts` 的 `getAiConfig`/`resolveAiConnection` 改为 harness 优先、旧 store 兜底，并带一次性迁移标记 `legacyAiMigrated`。
- **AI 问答链路**：`requestAi` 改 `/chat/completions`（messages + max_tokens=2400 + SSE 解析 `choices[0].delta.content`）；`aiFetch` 用 Electron `net.fetch`（Chromium 走系统代理，undici 直连 api.yujianwudi.top 会超时）——这是已修复的大坑，别回退。
- **AI 助手页重写**（`src/renderer/components/AiChat.tsx`）：纯问答页（删掉 Agent 模式/webview/dshAgentRun），左历史会话右聊天框；设置按钮 dispatch `muyujian:open-agent-settings` 事件；旧的 `AiConfigPanel.tsx` 已删。
- **Agent 一级页**：新 `src/renderer/components/AgentView.tsx`（整页 webview + 确认卡片栈 + 监听 `muyujian:open-agent-settings` 事件 → webview executeJavaScript 点击 GUI 设置按钮）。`StudyWorkbench.tsx` 导航加 `['agent','Agent']` + 视图分支 + 事件监听（收到 open-agent-settings 就 setView('agent')）。CSS 加 `.agent-view` 等。
- 测试：新 `src/main/dshConfig.test.ts` 4 例；全量 51 绿 + 2 跳过；typecheck 全绿。已验证：Agent 页整页 GUI 渲染（截图 `scripts/agent-view-check.png`）、AI 助手点设置 → 跳 Agent 页并自动打开 GUI 设置面板、dsh home 配置正确读回（状态徽标 kimi-k3）、主进程侧已看到 `status=200` + delta + `stream done`。

**✅ 已彻底修复的 BUG：AI 问答收到 stream done 后，assistant 消息的 streaming 正常置为 false（转圈光标销毁），经 CDP 自动化问答实测闭环通过。
- 调试手段已在代码里：AiChat.tsx 里 `[ai-rx]` console.log（订阅计数、每个事件、patch 前后 streaming 值），用 `node scripts/ai-chat-debug.mjs` 跑（electron 需带 `--remote-debugging-port=9333` 启动）。
- 已定位线索：done 事件确实到达且通过 requestId 过滤；patch updater 执行了但 done 分支没生效（日志 `streaming true -> true`）；且整页出现 **4 次 `[ai-rx] subscribe`**，疑似有多个 AiChat 实例/重复订阅（AiChat 只在 StudyWorkbench 引用一次，需查是否 App 多窗口或多 StudyWorkbench 挂载导致 localStorage 共享会话但互相同步干扰）。刚给每个实例加了 instanceId 日志（**改动未构建**），下次跑 `npm run build:renderer` 后重跑 `ai-chat-debug.mjs` 看 instanceId 即可定位。
- 收尾时记得删掉全部 `[ai-rx]`/`[ai]` 调试 console.log（AiChat.tsx 与 main/index.ts 里 `requestAi` 的诊断日志）。

**第二阶段清单收尾状态（2026-09-12 更新）**：streaming BUG 已修复并端到端验证；调试日志与临时脚本已清理；README/WORK_LOG 已更新。dsh GUI 改配置后的自动热重载仍未做（见第六节遗留）。原清单如下：
1. 修上面的 streaming BUG 并端到端复验（发消息→delta→done→光标消失→会话持久化）。
2. 复验：在 dsh GUI 改模型/Key 后 AI 助手状态徽标同步（注意：dsh sdk 运行时与 web 子进程缓存 apiKey 于 env，改配置后可能需要重启 Agent 页或应用——此为已知未做的完善项，可考虑监听配置变化自动重启运行时）。
3. 删除调试日志与临时脚本（`scripts/ai-chat-debug.mjs`、`ai-chat-smoke.mjs`、`main-fetch-smoke.mjs`、`app-stdout.log` 可留可删）。
4. 更新 `WORK_LOG_2026-09-11.md` 与 README 的 AI/Agent 章节。
5. 凭证红线：`dsh-home/.credentials.yaml` 含真实 Key，任何截图/日志/提交不得外泄。


### 追加：第三阶段 —— 知识库 + Agent 预设系统（F1/F2 主干已落地）
- **F1 AI 助手知识库**：
  - src/main/knowledgeService.ts：纯 JS 检索引擎 flexsearch（tokenize: full），对便签、题册、工作区 knowledge/ 目录切块索引与全文检索，单测 8 例全绿。
  - src/main/capabilities.ts：注册 knowledge.sources 与 knowledge.search。
  - src/main/index.ts：实例化挂载知识库服务，AI 问答前检索 Top-5 片段自动拼接注入 System Prompt。
  - src/renderer/components/AiChat.tsx：顶部增加「📚 知识库」数据源抽屉，支持全选/清空/单选，持久化于 localStorage。
- **F2 Agent 预设系统**：
  - src/main/dshPreset.ts：定义「暮雨笺预设」与「研究预设」，生成 Cordis patch，单测 3 例全绿。
  - src/main/dshWeb.ts：支持 ensureUrl(preset) 与 restart(preset) 带预设重启子进程。
  - src/renderer/components/AgentView.tsx：增加预设 Segmented 切换控件并持久化。
- **质量基线**：npm run typecheck 通过、npm test (66 passed / 2 skipped) 全绿、npm run build:renderer 编译通过。

## 三、关键文件索引

| 文件 | 作用 |
| --- | --- |
| `FIX_PLAN.md` | 15 项审查问题与修复计划 |
| `WORK_LOG_2026-09-10.md` | 逐阶段工作日志（阶段 A–F + 启动实测修复） |
| `WORK_LOG_2026-09-11.md` | dsh Web GUI 收尾验证日志（当前最新） |
| `AGENT_BRIDGE_PLAN.md` | 对外桥方案（已实现） |
| `DEEPSEEK_HARNESS_PLAN.md` | 内置 Agent（dsh）方案与里程碑 |
| `INLINE_AGENT_PLAN.md` | 内置 Agent 旧方案（历史参考，不再更新） |
| `bridge/README.md` | Agent 调用方式与能力清单 |
| `src/main/notesData.ts` | 便签文件读写、`enqueueFile`、`mergeNotes`、`sanitizeNoteUpdates` |
| `src/main/index.ts` | 主进程入口、全部 IPC、窗口/菜单 |
| `src/renderer/components/StudyWorkbench.tsx` | 工作台主界面（settings 视图为超长单行 JSX，编辑要用子串替换） |
| `src/renderer/vite-env.d.ts` | `window.electronAPI` 类型声明，新增 IPC 必须同步这里 |

## 四、环境注意事项（重要）

1. 本机 PowerShell 7；`Set-Content/Add-Content` 默认 UTF-8 无 BOM，可安全写中文文件。
2. `apply_patch` 对超长单行中文 JSX 经常匹配失败；用 `[IO.File]::ReadAllText + .Replace + WriteAllFile` 做法。
3. 本机有 HTTP 代理（`127.0.0.1:7897`）且 `NODE_USE_ENV_PROXY=1`：任何本机 curl/Invoke-WebRequest 测试要加 `-NoProxy`（PowerShell）或绕过代理，否则 502。
4. npm allow-scripts 拦 postinstall：若重装依赖后缺 electron/esbuild 二进制，先 `npm approve-scripts`。
5. dev 模式下渲染端依赖 vite dev server（5173）；主进程改动必须 `tsc -p tsconfig.main.json` 后重启 electron（前台跑可加 `$env:ELECTRON_ENABLE_LOGGING=1` 看渲染端 console）。
6. 用户明确要求：不进行打包（不做 electron-builder 验证）。
7. `loadRenderer` 优先 `loadFile(dist/renderer)`：dev 下改了渲染端必须 `npm run build:renderer`，否则看到的是旧界面（vite 改动不会生效于 file 加载路径）。
8. UI 自动化验证推荐：`node_modules\electron\dist\electron.exe . --remote-debugging-port=9333` + `node scripts/cdp-eval.mjs "<表达式>"`；HTTP 请求加 `-Proxy $null`。截图 `pwsh -File scripts\shot.ps1`（按「暮雨笺」标题过滤，-Click 偏移是窗口物理像素；本机 125% DPI）。

## 五、建议执行顺序（接手后）

1. **F2b 研究预设**（`KNOWLEDGE_PRESETS_PLAN.md` 阶段 3）：✅ 已完成——`research.*` 五能力经共享注册表透出（scan/list/read/search/summary），research-db 建库与检索就绪，8 例单测 + 真实 PDF 冒烟通过。
2. **F3 文档生成插件**（阶段 4）：✅ 已完成——doc.createWord / doc.createSheet / doc.createPdf 经共享注册表透出（写入 `documents/`，走确认闸门），真实 Electron PDF 冒烟通过。
3. dsh 配置热重载：GUI 改配置后自动重启 sdk/web 运行时。
4. 发布前关卡：electron-builder 打包验证 + 全量手工回归 + `DSH_LIVE_KEY` live 测试。
5. 「内置 Agent」阶段 A–F 已全部完成（含 kimi-k3 真实 E2E 与中文路径修复）；改 dsh 前先读 `DEEPSEEK_HARNESS_PLAN.md` 与 `src/main/dshRuntime.ts`。
6. 若要改设置页：优先在 `StudyWorkbench.tsx` 的 settings 视图插入独立组件文件，不要再往超长行里堆 JSX。
7. 每次新增 IPC / 能力，同步三处：`preload.ts`、`vite-env.d.ts`、对应面板；能力结构变化还要同步 `bridge/muyujian-mcp.js` 与 `bridge/README.md`。

## 六、已知遗留事项

dsh 配置热重载已实现（`dshConfigWatcher.ts` 监听 settings.yaml/.credentials.yaml，防抖 + 指纹比对，仅有效配置变化时重启；web 子进程仅运行中才重启）。
- Agent Bridge 的 `notes.update` 同时接受 `{ id, updates }` 与扁平参数 `{ id, title/content/category }`，以扁平为推荐写法（MCP 工具已按扁平暴露）。
- 桥服务端口默认 18921，被占时自动顺延到 18971；设置页显示实际端口。
- `electronAPI.getAgentBridge` 返回的 `audit` 是字符串数组（时间戳 + 描述），不是结构化对象。
- 打包验证（electron-builder）按用户要求暂未执行，发布前需补一次完整验证。
