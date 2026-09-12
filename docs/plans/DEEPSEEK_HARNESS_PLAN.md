# 暮雨笺内置 DeepSeek Harness 计划书

日期：2026-09-10
状态：**已决策**——暮雨笺的 Agent 功能确定通过内置 DeepSeek Harness（dsh）实现，采用本文方案，待实施。本文取代 `../archive/INLINE_AGENT_PLAN.md` 作为内置 Agent 的唯一实施依据；其中「确认闸门、能力白名单、复用 enqueueFile」三条原则全部保留。
参考源码：`_ref/deepseek-harness/`（已 gitignore，仅本机参考，可删）

## 一、实施方案

暮雨笺 Electron 主进程通过官方 TS SDK（`@deepseek-ai/dsh-sdk-client`，stdio JSON-RPC）拉起一个 dsh 运行时（`--profile sdk`），**不开任何监听端口**。暮雨笺自有 UI 不变，dsh 只当「大脑」；暮雨笺的笔记/计划/题册数据通过一个**自定义 dsh 插件**暴露给模型，插件内部回调现有的 Agent Bridge HTTP 接口执行数据操作——Bridge 白名单、限流、审计全部继续生效，权限面零扩大。

关键事实（来自源码阅读，`_ref/deepseek-harness/`）：
- dsh 是 Cordis 插件架构，"一切皆插件"：agent loop、工具表、LLM 适配器全是可替换插件。我们只需要**新增插件**，不碰其内核。
- 自定义工具 = 一个 Cordis 插件 + `ctx.tools.register(defineTool({...}))`；schema 自动进入系统提示词组装（`docs/cookbook/adding-a-tool.zh.md`）。
- 审批/权限闸门 = 监听 `tools/pre-execute` 瀑布事件，可实现 允许/拒绝/询问 策略，无需改工具本身。
- SDK 客户端（`packages/sdk/client`）：`DeepSeekHarness({ profile, provider, model }).run()`，子进程惰性启动、跨 `run()` 复用、关闭阶梯完备；`HarnessClient` 提供低层订阅。
- **已知限制**：SDK 协议暂无"轮次中取消"（放弃轮次 = 关掉运行时进程）；无逐提示词结果归属。我们的应用形态（重活走确认卡片、可重启运行时）与这两个限制兼容。
- dsh 处于**开发者预览期，官方明示会有破坏性变更** → 必须钉死精确版本号，升级作为一项独立工作对待。
- 官方自己的 Electron 桌面壳（`apps/desktop`）明确要求 **dsh 跑在内置上游 Node.js 上，绝不用 Electron 自带 Node**（ABI/fuse/生命周期原因）；依赖通过内置 pnpm + 离线 seed 安装。我们的打包阶段遵循同一约束。

## 二、目标与非目标

目标：
1. AI 助手页内置完整 agent：多轮工具调用、自主规划、流式输出，由 dsh 驱动。
2. 模型侧默认 DeepSeek（`deepseek-official` provider），兼容现有接口设置里的自定义 OpenAI 兼容端点。
3. 数据能力 = 现有 Bridge 白名单（notes.*/plan.*/questionBook.*/workspace.status），写操作弹确认卡片。
4. dsh 运行时及其 Node.js 依赖随应用内置，用户机器**零安装**。

非目标（本期）：
- 不启用 dsh 自带的 shell/文件系统/终端等通用工具（沙箱外操作超出暮雨笺数据域）——只注册暮雨笺业务工具。
- 不做 subagent、定时巡航、多 agent 协作（dsh 支持，后续再开）。
- 不做打包验证（沿用既有决定，打包阶段只做准备不执行 electron-builder）。

## 三、总体架构

```
渲染端  AiChat（Agent 模式开关、确认卡片、流式消息）
           │ IPC: dsh-agent-* （新增）
主进程  src/main/dshRuntime.ts        运行时生命周期管理（启动/健康检查/重启/关闭）
           │  stdio JSON-RPC（@deepseek-ai/dsh-sdk-client）
子进程  dsh --profile sdk
           ├─ patch: 禁用 shell/fs 等内置工具
           ├─ 插件 muyujian-tools   把 notes/plan/questionBook 能力注册成 dsh 工具
           │     └─ 执行体: HTTP 回调本机 Agent Bridge（Bearer token，端口动态获取）
           └─ 插件 muyujian-approval 监听 tools/pre-execute
                 └─ 写操作 → HTTP 调 Bridge 新端点请求用户确认（阻塞至用户选择）
主进程  Agent Bridge（现有 agentBridge.ts 扩展）
           ├─ 新增内部能力: agent.confirm（挂起→渲染端弹卡片→返回 approved/rejected）
           └─ token 经安全通道注入给 dsh 插件（不落盘）
能力层  capabilities.ts（INLINE_AGENT_PLAN 阶段 A 的抽取仍然要做）
```

为什么"插件回调 Bridge"而不是"插件直接调数据层"：dsh 在独立 Node 进程，无法 import 主进程模块；而 Bridge 已有 Bearer 认证、限流、审计、`enqueueFile` 串行写——插件只是一个很薄的 HTTP 客户端，所有数据语义只有一份实现。

## 四、交付物清单

| 交付物 | 位置 | 说明 |
| --- | --- | --- |
| 共享能力层 | `src/main/capabilities.ts` | 沿用原阶段 A：Bridge 改用它，签名/测试不变 |
| Bridge 扩展 | `src/main/agentBridge.ts` | 新增 `agent.confirm` 内部能力、确认请求转发渲染端、token 注入接口 |
| 运行时管理 | `src/main/dshRuntime.ts` | spawn/健康检查/crash 自动重启/优雅关闭；会话持久化目录放用户数据下 |
| dsh 插件 ×2 | `plugins/muyujian-tools/`、`plugins/muyujian-approval/` | Cordis 插件， npm 包形态 |
| IPC + 类型 | `preload.ts`、`vite-env.d.ts`、`index.ts` | `dsh-agent-run`（流式事件转发）、`dsh-agent-stop`、确认应答通道 |
| 渲染端 | `src/renderer/components/AiChat.tsx` + 新组件 | Agent 模式开关、动作卡片（同意/拒绝）、流式渲染 |
| 依赖内置 | `resources/dsh/` | 钉版 `@deepseek-ai/dsh` + 离线 node_modules、内置 Node.js |
| 测试 | `dshRuntime.test.ts`、插件单测、E2E 冒烟 | mock LLM 适配器跑离线测试 |

## 五、里程碑

| 阶段 | 内容 | 验收 | 预估 |
| --- | --- | --- | --- |
| A 能力层抽取 | 抽 `capabilities.ts`，Bridge 改用 | 现有 bridge 测试全绿 | 0.5 天 |
| B 运行时拉通 | 主进程内嵌 dsh + SDK 客户端，DeepSeek key 走现有安全存储注入；渲染端能发一句话拿到流式回复 | dev 下聊天闭环 | 1.5 天 |
| C 业务工具插件 | `muyujian-tools` 把 capabilityRegistry 全量映射为 dsh 工具（schema 从能力层生成，单一来源） | 模型能列笔记/建笔记；数据出现在 UI | 1 天 |
| D 确认闸门 | `muyujian-approval` + Bridge `agent.confirm` + 渲染端确认卡片 + 审计 | 写操作必弹卡片，拒绝后 agent 不重试 | 1 天 |
| E 依赖内置 | pnpm 导出离线依赖 + 内置 Node；spawn 指向内置 Node；清理 dev 直跑路径 | 干净环境（无全局 node）下可启动 agent | 1 天 |
| F 加固收尾 | 崩溃重启、并发互斥、审计完整性、文档、全套测试 | npm test + typecheck 全绿 | 0.5 天 |

合计约 5.5 个工作日（比原手写循环方案多约 2.5 天，换来多 agent/记忆/工具生态的扩展空间）。

## 六、风险与对策

1. **dsh 预览期 API 漂移**：钉精确版本号 + lockfile；升级 dsh 单独走一个阶段（含冒烟脚本）；所有与 dsh 的接触面收敛在 `dshRuntime.ts` 和两个插件里，业务代码不直接 import dsh 类型。
2. **SDK 无轮次中取消**：UI 的"停止" = 重启运行时进程（SDK 关闭阶梯已完备）；会话历史在 dsh 侧持久化，重启后不受影响，向用户显示"已中断"。
3. **确认流程跨两个进程**：`agent.confirm` 采用"Bridge 挂起 HTTP 响应直到渲染端回话"模式，设 120s 超时自动拒绝；该端点豁免限流，审计记录 approved/rejected/timeout。
4. **token 下发安全**：Bridge 监听 127.0.0.1；token 经 SDK `env` 注入子进程，不落盘、不进 patch 文件；重置 token 时重启 dsh 运行时。
5. **体积增长**：内置 Node + dsh 依赖预计增加 80–150MB 安装体积；阶段 E 做一次实测，超限则裁剪 dsh 组合包（禁用 mcp/lsp/web 等未用包）。
6. **打包**：仍按既有决定不做 electron-builder 验证；但阶段 E 的目录布局、extraResources 清单按官方 desktop 模式设计好，打包时只补验证不返工。
7. **代理环境**：本机 `127.0.0.1:7897` 代理 + `NODE_USE_ENV_PROXY=1`，dsh 子进程环境注入 `NO_PROXY=127.0.0.1,localhost`，避免回调 Bridge 被代理拦截。

## 七、决策记录（与旧计划差异）

- **放弃手写 function-calling 循环**（原 INLINE_AGENT_PLAN 阶段 B/C 的 `agentRunner.ts`）→ 由 dsh agent-loop 承担；但能力白名单、确认闸门、审计三项安全设计完整迁移。
- UI 侧"问答/Agent"双模式保留：普通问答继续走现有 `aiService` 直连（轻量、离线可降级），Agent 模式走 dsh。
- `../archive/INLINE_AGENT_PLAN.md` 保留作历史参考，不再更新；后续状态以本文件为准。