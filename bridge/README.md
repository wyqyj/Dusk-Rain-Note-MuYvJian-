# 暮雨笺 Agent 桥（Agent Bridge）

让 Codex、WorkBuddy 或其他 Agent 工具通过本地桥服务直接操作暮雨笺：新建笔记、导入题册、调整计划等。

## 使用方法

1. 打开暮雨笺 →「设置」→「对外接入 Agent」，打开“启用本地桥”。
2. 保持默认的“仅本机（127.0.0.1）”，复制令牌。
3. 任选一种接入方式：

### 方式一：直接 HTTP 调用

```
POST http://127.0.0.1:18921
Authorization: Bearer <令牌>
Content-Type: application/json

{ "capability": "notes.create", "params": { "title": "示例", "content": "正文" } }
```

端口以设置页实际显示为准。

### 方式二：MCP 适配器（推荐，配 Codex 等 MCP 客户端）

`muyujian-mcp.js` 是零依赖的 stdio MCP server。在 Codex 的 `config.toml` 中加入：

```toml
[mcp_servers.muyujian]
command = "node"
args = ["D:/路径/到/bridge/muyujian-mcp.js"]

[mcp_servers.muyujian.env]
MUYUJIAN_BRIDGE_URL = "http://127.0.0.1:18921"
MUYUJIAN_BRIDGE_TOKEN = "<令牌>"
```

随后在 Agent 中即可使用 `muyujian_notes_create`、`muyujian_plan_add_task` 等工具。

## 能力清单

| 能力 | 工具名 | 说明 |
| --- | --- | --- |
| `workspace.status` | `muyujian_status` | 数据目录、笔记/题册/任务数量 |
| `notes.list` | `muyujian_notes_list` | 笔记摘要列表 |
| `notes.get` | `muyujian_notes_get` | 读取指定笔记全文 |
| `notes.create` | `muyujian_notes_create` | 新建笔记 |
| `notes.update` | `muyujian_notes_update` | 更新笔记标题/正文/分类 |
| `plan.list` | `muyujian_plan_list` | 任务列表 |
| `plan.addTask` | `muyujian_plan_add_task` | 添加任务 |
| `plan.completeTask` | `muyujian_plan_complete_task` | 完成任务 |
| `questionBook.list` | `muyujian_question_book_list` | 题册列表 |
| `questionBook.import` | `muyujian_question_book_import` | 导入 questions.md 为新题册 |

## 安全说明

- 仅接受 `Bearer` 令牌认证；令牌只保存在本机配置中，不会写入备份导出。
- 默认只绑定 127.0.0.1；“局域网可访问”需你明确选择并二次确认。
- 请求体上限 512KB，窗口限流 30 次 / 10 秒。
- 只开放白名单能力：不开放删除数据、导出备份、读取 AI Key。
- 设置页面板可查看最近的调用审计记录。
