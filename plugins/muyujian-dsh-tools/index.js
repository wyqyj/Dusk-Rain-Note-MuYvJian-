/**
 * 暮雨笺业务工具 dsh 插件。
 *
 * 能力清单（名称/描述/参数 schema/读写性）由主进程写入 MUYUJIAN_TOOL_MANIFEST；
 * 执行体统一回调主进程的 Agent Bridge（Bearer token 经环境变量注入，不落盘）。
 * 本插件无任何业务逻辑，只负责把能力表翻译成 dsh 工具注册。
 *
 * 环境变量（由 DshRuntime 注入）：
 *   MUYUJIAN_TOOL_MANIFEST  能力清单 JSON 路径
 *   MUYUJIAN_BRIDGE_URL     本机 Agent Bridge 地址
 *   MUYUJIAN_BRIDGE_TOKEN   Bearer token
 */

const fs = require('fs');

exports.name = 'muyujian-dsh-tools';
exports.inject = ['tools'];

/** JSON Schema 属性 → dsh ParameterPropertySpec（能力参数只用 string/boolean 标量）。 */
function toParameterSpec(property, required) {
  const spec = { type: property.type === 'boolean' ? 'boolean' : 'string' };
  if (property.description) spec.description = property.description;
  if (Array.isArray(property.enum)) spec.enum = property.enum;
  if (property.default !== undefined) spec.default = property.default;
  if (required) spec.required = true;
  return spec;
}

exports.apply = (ctx) => {
  const { defineTool } = require('@deepseek-ai/dsh-tools');
  const manifestFile = process.env.MUYUJIAN_TOOL_MANIFEST;
  const bridgeUrl = process.env.MUYUJIAN_BRIDGE_URL;
  const bridgeToken = process.env.MUYUJIAN_BRIDGE_TOKEN;
  if (!manifestFile || !bridgeUrl || !bridgeToken) {
    ctx.logger?.warn?.('muyujian-dsh-tools: 缺少 MUYUJIAN_* 环境变量，未注册任何工具');
    return;
  }
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));

  for (const capability of manifest) {
    const properties = (capability.inputSchema && capability.inputSchema.properties) || {};
    const requiredSet = new Set((capability.inputSchema && capability.inputSchema.required) || []);
    const parameters = {};
    for (const key of Object.keys(properties)) {
      parameters[key] = toParameterSpec(properties[key], requiredSet.has(key));
    }

    // 能力名带点号（notes.create），function calling 工具名不允许，统一转下划线
    const toolName = capability.name.replace(/\./g, '_');

    ctx.tools.register(defineTool({
      name: toolName,
      description: `${capability.description}（暮雨笺数据能力：${capability.name}）`,
      parameters,
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
      },
      async execute(args, exec) {
        const response = await fetch(bridgeUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bridgeToken}` },
          body: JSON.stringify({ capability: capability.name, params: args }),
          signal: exec.signal,
        });
        if (!response.ok) throw new Error(`暮雨笺桥服务异常（HTTP ${response.status}）`);
        const result = await response.json();
        if (!result.ok) throw new Error(result.error || `能力 ${capability.name} 执行失败`);
        return result;
      },
    }));
  }

  ctx.logger?.info?.(`muyujian-dsh-tools: 已注册 ${manifest.length} 个暮雨笺能力工具`);
};
