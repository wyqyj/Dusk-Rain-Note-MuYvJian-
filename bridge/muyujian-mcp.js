#!/usr/bin/env node
/**
 * 暮雨笺 Agent 桥 —— MCP（stdio）适配器。
 * 把 MCP 客户端（Codex 等）的 tool 调用翻译成对本地桥服务的 HTTP POST。
 *
 * 环境变量：
 *   MUYUJIAN_BRIDGE_URL   桥服务地址，默认 http://127.0.0.1:18921
 *   MUYUJIAN_BRIDGE_TOKEN 桥服务令牌（必填）
 *
 * 依赖零第三方包，Node >= 18 即可。
 */
'use strict';

const BASE_URL = (process.env.MUYUJIAN_BRIDGE_URL || 'http://127.0.0.1:18921').replace(/\/+$/, '');
const TOKEN = process.env.MUYUJIAN_BRIDGE_TOKEN || '';

const TOOLS = [
  {
    name: 'muyujian_status',
    description: '查看暮雨笺工作台状态（数据目录、笔记数、题册数、任务数）。',
    inputSchema: { type: 'object', properties: {} },
    capability: 'workspace.status',
  },
  {
    name: 'muyujian_notes_list',
    description: '列出暮雨笺中的笔记摘要（id、标题、类型、分类、更新时间）。',
    inputSchema: { type: 'object', properties: {} },
    capability: 'notes.list',
  },
  {
    name: 'muyujian_notes_get',
    description: '按 id 读取一篇笔记的完整内容。',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: '笔记 id' } }, required: ['id'] },
    capability: 'notes.get',
  },
  {
    name: 'muyujian_notes_create',
    description: '在暮雨笺中新建一篇笔记。',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '标题' },
        content: { type: 'string', description: '正文（Markdown）' },
        category: { type: 'string', description: '分类，可选' },
        noteType: { type: 'string', enum: ['note', 'todo'], description: '笔记类型，默认 note' },
      },
      required: ['content'],
    },
    capability: 'notes.create',
  },
  {
    name: 'muyujian_notes_update',
    description: '更新已有笔记的标题、正文或分类。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '笔记 id' },
        title: { type: 'string' },
        content: { type: 'string' },
        category: { type: 'string' },
      },
      required: ['id'],
    },
    capability: 'notes.update',
  },
  {
    name: 'muyujian_plan_list',
    description: '列出暮雨笺学习计划中的任务。',
    inputSchema: { type: 'object', properties: {} },
    capability: 'plan.list',
  },
  {
    name: 'muyujian_plan_add_task',
    description: '向学习计划中添加一个任务。',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '任务名称' },
        subject: { type: 'string', description: '科目，可选' },
        date: { type: 'string', description: '日期 YYYY-MM-DD，可选' },
      },
      required: ['title'],
    },
    capability: 'plan.addTask',
  },
  {
    name: 'muyujian_plan_complete_task',
    description: '将某个任务标记为完成。',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: '任务 id' } }, required: ['id'] },
    capability: 'plan.completeTask',
  },
  {
    name: 'muyujian_question_book_list',
    description: '列出已导入的题册。',
    inputSchema: { type: 'object', properties: {} },
    capability: 'questionBook.list',
  },
  {
    name: 'muyujian_question_book_import',
    description: '把整理好的 questions.md 内容导入为新题册。',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '题册名称' },
        content: { type: 'string', description: 'questions.md 的完整内容' },
      },
      required: ['name', 'content'],
    },
    capability: 'questionBook.import',
  },
];

async function callCapability(capability, params) {
  if (!TOKEN) throw new Error('缺少环境变量 MUYUJIAN_BRIDGE_TOKEN');
  const response = await fetch(BASE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ capability, params: params || {} }),
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, ...payload };
}

// ---- 极简 JSON-RPC / MCP stdio 循环 ----

const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

function result(id, value) {
  send({ jsonrpc: '2.0', id, result: value });
}

function failure(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

rl.on('line', async (line) => {
  let request;
  try { request = JSON.parse(line); } catch { return; }
  const { id, method, params } = request;
  try {
    if (method === 'initialize') {
      result(id, {
        protocolVersion: params?.protocolVersion || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'muyujian-bridge', version: '0.1.0' },
      });
    } else if (method === 'notifications/initialized') {
      // 无需响应
    } else if (method === 'tools/list') {
      result(id, { tools: TOOLS.map(({ capability, ...tool }) => tool) });
    } else if (method === 'tools/call') {
      const tool = TOOLS.find((item) => item.name === params?.name);
      if (!tool) { failure(id, -32602, `未知工具：${params?.name}`); return; }
      const outcome = await callCapability(tool.capability, params.arguments || {});
      result(id, { content: [{ type: 'text', text: JSON.stringify(outcome, null, 2) }], isError: outcome.ok !== true });
    } else if (method === 'ping') {
      result(id, {});
    } else if (id !== undefined) {
      failure(id, -32601, `不支持的方法：${method}`);
    }
  } catch (error) {
    if (id !== undefined) failure(id, -32603, error instanceof Error ? error.message : String(error));
  }
});
