# 暮雨笺内置 Agent 功能计划书

日期：2026-09-10

## 一、背景与定位

当前已完成「对外接入 Agent」（Agent Bridge）：暮雨笺作为**被操作方**，Codex 等外部 Agent 经本地桥服务调用白名单能力（见 `AGENT_BRIDGE_PLAN.md` 与 `src/main/agentBridge.ts`）。

「内置 Agent」是相反方向：暮雨笺在应用内部内置一个自主智能体，用户在左侧「AI 助手」聊天，Agent 自己规划并调用工具直接改数据（新建笔记、整理题册、调整计划），无需任何外部 Agent 工具。

两者关系：

- Bridge：外部 Agent → 操作暮雨笺（已有）。
- 内置 Agent：用户 → 暮雨笺内的 Agent → 操作暮雨笺数据（本计划）。
- 两者可复用同一套能力执行层（见三.2），能力白名单只写一次。

## 二、目标与非目标

目标：

1. 在现有 AI 助手页中提供「Agent 模式」开关：开启后，模型回复可驱动工具调用，直接在笔记/题册/计划上生效。
2. 工具集合 = Bridge 白名单能力（notes.* / plan.* / questionBook.*），不扩大权限面。
3. 所有破坏性动作（更新笔记、完成任务、导入题册）执行前在聊天区弹出确认卡片，用户可逐条同意/拒绝。
4. 完整支持流式输出与多轮（工具调用→观察→续写）循环。

非目标（本期不做）：

- 自主定时/巡航任务、跨应用操作（截图、控制其他软件）。
- 多 Agent 协作、长期记忆索引（向量库）。
- 语音输入输出。

## 三、技术方案

### 1. 架构分层

```
渲染端  AiChat（Agent 模式开关、确认卡片、消息流）
            │ IPC: ai-agent-run（流式事件）
主进程  AgentRunner（新增 src/main/agentRunner.ts）
            │ 复用 capabilityRegistry（从 agentBridge.ts 抽出共享）
            ├─ LLM 客户端（沿用 aiService 的 OpenAI 兼容协议）
            └─ 工具执行器（白名单 + 用户确认闸门 + 审计）
能力层  notes/plan/questionBook 能力（与 Bridge 共用实现）
```

### 2. 抽取共享能力层

当前 `agentBridge.ts` 的 `registerCapabilities()` 内含全部数据逻辑。计划把它抽成独立模块 `src/main/capabilities.ts`：

```ts
export interface CapabilitySpec {
  name: string;
  description: string;      // 供 LLM 的 tools 定义使用
  inputSchema: JSONSchema;  // 供 function calling
  sideEffect: 'read' | 'write';
  handler(params): Promise<Record<string, unknown>>;
}
export const capabilityRegistry: Map<string, CapabilitySpec>;
```

Bridge 与 AgentRunner 都只是「调用通道」：前者是 HTTP+Token，后者是 LLM function calling + 用户确认。

### 3. LLM 工具调用协议

- 复用 `aiService` 的 OpenAI 兼容 Chat Completions 客户端，开启 `tools`（function calling）。
- 循环：发送对话 → 收到 `tool_calls` → 逐个弹确认（写操作）→ 执行 → 以 `role: tool` 回填结果 → 继续请求 → 直到无 tool_calls 或达到 8 轮上限。
- 超时/取消沿用现有 `ai-cancel` 机制。

### 4. 安全闸门

- 写操作必须经用户确认卡片；读操作不确认。
- 单次会话工具调用总数上限 20 次。
- 能力与 Bridge 完全同构：不暴露删除、导出、AI Key。
- 审计：写操作全部记入现有 audit（用户确认结果 `approved/rejected` 一并入库）。

### 5. 渲染端交互

- 「AI 助手」页顶部新增模式切换：`问答` / `Agent`（分段控件）。
- Agent 模式下，工具调用渲染为消息流中的「动作卡片」：能力名 + 参数摘要 + [同意]/[拒绝]；执行后变为结果摘要。
- 拒绝则向模型回填“用户拒绝了该操作”，由模型决定后续。

## 四、里程碑

| 阶段 | 内容 | 产出 | 预计工作量 |
| --- | --- | --- | --- |
| A | 抽取 `capabilities.ts` 共享层，Bridge 改用它 | bridge 测试保持全绿 | 0.5 天 |
| B | `agentRunner.ts`：function calling 循环 + 确认闸门 + IPC | 主进程可用、`agentRunner.test.ts` 过 | 1 天 |
| C | AiChat Agent 模式 UI（开关、动作卡片、流式渲染） | 界面可完整走一遍改数据 | 1 天 |
| D | 审计/上限/错误兜底 + 文档 | 全套测试绿、`AGENT_PLAN` 改为已完成态 | 0.5 天 |

合计约 3 个工作日。

## 五、风险与对策

- **模型不返回合法 tool_calls**：对不支持的模型做降级提示（回退普通问答）；JSON schema 校验失败重试一次。
- **长循环跑飞**：写死单轮最多 8 次工具调用、总会话 20 次，超限自动终止并提示。
- **与 Bridge 写路径并发**：两者都走 `enqueueFile` 串行队列，天然安全。
- **本地视觉/界面回归**：Agent 模式默认关；普通问答路径代码不动。

## 六、验收标准

1. 在 AI 助手页开启 Agent 模式，输入“建一个数学错题笔记，内容写 xxxx”→ 弹出确认卡片 → 同意后笔记出现在左侧笔记列表。
2. 输入“列出我的题册并总结”→ 只读调用，不弹确认，直接给出结果。
3. 拒绝一次写操作后，Agent 不再重试该动作并说明原因。
4. `npm test` 全绿，`npm run typecheck` 双侧通过。

