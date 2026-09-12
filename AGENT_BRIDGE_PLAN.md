# 对外接入 Agent（Agent Bridge）实现计划

## 目标

打开一个开关后，外部 Agent 工具（Codex CLI、WorkBuddy、自行编写的脚本等）能够调用暮雨笺暴露的能力，操作软件中的数据：新建/更新笔记、导入题册、查询与调整计划任务等。

## 总体架构

```
Agent 工具 (Codex / WorkBuddy / MCP 客户端)
    │  MCP (stdio)                    或直接 HTTP
    ▼                                ▼
muyujian-mcp 桥接脚本          其他 HTTP 客户端
    │  HTTP (<绑定地址>:<port>，Bearer Token)
    ▼
暮雨笺主进程内的 Agent Bridge 服务（默认关闭）
    │
    ▼
能力注册表 → 复用现有 IPC 层的数据逻辑（notes/workspace/question books/…）
```

设计要点：

- **桥不接 AI、只接数据**。Agent 自带自己的模型；我们提供的只是工具调用通道，不与应用内 AI 配置耦合。
- **双层暴露**：主进程内置一个 HTTP 服务，绑定地址可配置（默认 `127.0.0.1` 仅本机，可切换为 `0.0.0.0` 允许局域网内其他设备的 Agent 访问）；同时发布一个独立的 `muyujian-mcp` 桥接脚本（Node，零依赖），Agent 侧按标准 MCP server 配置即可，桥接脚本负责把 MCP tool call 翻译成 HTTP 调用。
- **安全默认**：开关默认关闭；随机 Token；局域网模式下 Token 为强制的唯一防线，因此在界面中突出显示并支持一键重置；能力白名单。

## 分阶段实施

### 阶段 1：主进程 Agent Bridge 服务（约 1 天）

- 新增 `src/main/agentBridge.ts`：
  - `http.createServer`，绑定地址由设置决定：`127.0.0.1`（仅本机，默认）或 `0.0.0.0`（局域网可被其他设备访问）；端口从 `18921` 起自动探测空闲端口。
  - 认证：`Authorization: Bearer <token>`，token 存于工作台 `agent-token.json`（0600 语义 + 仅当用户开启时生成）。
  - 请求限流（每 10 秒 30 次）与请求体上限 512KB。
  - 启动/停止受设置开关控制；`Settings` 持久化在 `settings.json`。
- 能力注册表 `capabilities`：
  - `notes.list` / `notes.get` / `notes.create` / `notes.update`（走 `enqueueFile` 写队列，与 UI 写路径一致）
  - `notes.appendTodo`（向待办便签追加任务行）
  - `plan.list` / `plan.addTask` / `plan.completeTask`（工作台 plan 数据）
  - `questionBook.import`（接收 Markdown 文本 → 复用题目导入管线）
  - `questionBook.list`
  - `workspace.status`（版本、数据目录、各模块条目数）
- 写操作全部返回结构化结果 `{ ok, id?, error? }`；日志写入 `agent-audit.log`（环形，上限 200 条）。

### 阶段 2：MCP 桥接脚本与文档（约 0.5 天）

- `bridge/muyujian-mcp.js`：stdio MCP server，工具列表映射阶段 1 的能力。
- 说明文档 `bridge/README.md`：
  - Codex：`config.toml` 中加 `[mcp_servers.muyujian] command="node" args=["...muyujian-mcp.js"]` 示例。
  - 其他 Agent：给出原始 HTTP 端点表。

### 阶段 3：设置 UI（约 0.5 天）

- 「设置」页新增「对外接入 Agent」面板：
  - 开关、绑定地址（仅本机 / 局域网）、当前端口与 Token（可一键复制、可重新生成）。
  - 能力清单开关（按模块粒度：笔记 / 计划 / 题册 / 画布只读…）。
  - 连接自检按钮（桥自己做一次 health 检查）与最近 5 条审计记录。

### 阶段 4：测试与加固（约 1 天）

- 单测：token 校验失败、非白名单能力 404、请求体超限、notes.create 落盘正确且走写队列。
- 验证一段真实链路：本机用脚本通过 MCP/HTTP 新建一条笔记，UI 端应能看到（写队列合并逻辑 #1 已保证安全）。

## 安全边界

- 绑定地址默认 `127.0.0.1`；切换到 `0.0.0.0` 局域网模式时弹出明确风险提示，并由 Windows 防火墙做网络层限制；bridge 脚本与 App 版本同仓库发布，不自动联网更新。
- 默认不允许的能力：删除数据、导出备份、读写 AI 配置与 API Key、执行任意文件操作。即使 token 泄露，破坏面也限制在应用内数据。
- 写路径全部经 `enqueueFile` 串行队列，与 UI 侧写入互不覆盖（#1 的机制直接复用）。

## 待确认

- Token 策略：**每次启动重新生成**（更安全、重连时要改配置）还是**持久化+手动重新生成**（更省心）？初步倾向持久化 + 界面可一键重置。
- 是否需要"只读模式"细分开关（仅查询不允许写）。
