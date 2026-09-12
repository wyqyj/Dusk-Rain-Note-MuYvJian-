/**
 * 内置 Agent（DeepSeek Harness）的模型配置读写。
 *
 * 配置唯一事实源 = dsh 自己的 home 目录：
 *   $DSH_HOME/settings.yaml       llm-pi-ai.providers / agent-default-model
 *   $DSH_HOME/.credentials.yaml   records: { llm-pi-ai/<providerId>: { kind: api-key, env: {...} } }
 * App 侧不再保存一份 AI 配置；旧版（electron-store + safeStorage）配置只做一次性迁移播种。
 */
import * as fs from 'fs';
import * as path from 'path';
import YAML from 'yaml';

export interface HarnessModelConfig {
  /** OpenAI 兼容基地址（已带 /v1 等路径，直接拼端点即可） */
  baseUrl: string;
  model: string;
  providerId: string;
  /** 解析出的 API Key；dsh 凭据服务里查不到时为 null */
  apiKey: string | null;
}

interface DshHomePaths {
  settings: string;
  credentials: string;
}

function homePaths(homeDir: string): DshHomePaths {
  return { settings: path.join(homeDir, 'settings.yaml'), credentials: path.join(homeDir, '.credentials.yaml') };
}

function readYamlFile(file: string): Record<string, unknown> {
  try {
    const parsed = YAML.parse(fs.readFileSync(file, 'utf-8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** 在 dsh 凭据文件中按 provider 找 key；写法与 dsh Web GUI 的模型设置页一致（api-key 记录 + env 表）。 */
function resolveApiKey(credentials: Record<string, unknown>, providerId: string, apiKeyEnv: unknown): string | null {
  const records = asRecord(credentials.records);
  const record = asRecord(records[`llm-pi-ai/${providerId}`]);
  if (record.kind === 'api-key') {
    if (typeof record.key === 'string' && record.key) return record.key;
    const env = asRecord(record.env);
    if (typeof apiKeyEnv === 'string' && typeof env[apiKeyEnv] === 'string' && env[apiKeyEnv]) return env[apiKeyEnv];
    const first = Object.values(env).find((value): value is string => typeof value === 'string' && value.length > 0);
    if (first) return first;
  }
  return null;
}

/** 读取 harness 当前选定的模型路由（agent-default-model → provider 资料 → 凭据）。 */
export function readHarnessModelConfig(homeDir: string): HarnessModelConfig | null {
  const settings = readYamlFile(homePaths(homeDir).settings);
  const llm = asRecord(settings['llm-pi-ai']);
  const providers = asRecord(llm.providers);
  const defaults = asRecord(settings['agent-default-model']);
  let providerId = typeof defaults.provider === 'string' ? defaults.provider : '';
  let model = typeof defaults.model === 'string' ? defaults.model : '';
  let provider = asRecord(providers[providerId]);
  if (!Object.keys(provider).length) {
    // 默认路由缺失时退到唯一一个可用 provider，保证 GUI 单 provider 场景问答可用
    const ids = Object.keys(providers).filter((id) => !!asRecord(providers[id]).baseURL);
    if (!ids.length) return null;
    providerId = ids[0];
    provider = asRecord(providers[providerId]);
    model = '';
  }
  const baseUrl = typeof provider.baseURL === 'string' ? provider.baseURL.replace(/\/+$/, '') : '';
  if (!baseUrl) return null;
  if (!model) {
    const models = Array.isArray(provider.models) ? provider.models : [];
    const first = asRecord(models[0]);
    model = typeof first.id === 'string' ? first.id : '';
  }
  if (!model) return null;
  const apiKey = resolveApiKey(readYamlFile(homePaths(homeDir).credentials), providerId, provider.apiKeyEnv);
  return { baseUrl, model, providerId, apiKey };
}

/**
 * 播种模型配置：仅在 provider 尚未存在时写入，绝不覆盖用户在 dsh GUI 里的修改。
 * 返回本次是否写入了新配置。
 */
export function seedHarnessModelConfig(
  homeDir: string,
  init: { baseUrl: string; model: string; apiKey?: string | null; providerId?: string },
): boolean {
  const providerId = init.providerId ?? 'muyujian-gateway';
  const paths = homePaths(homeDir);
  fs.mkdirSync(homeDir, { recursive: true });
  const settingsDoc = readYamlFile(paths.settings);
  const llm = asRecord(settingsDoc['llm-pi-ai']);
  const providers = asRecord(llm.providers);
  let settingsChanged = false;
  if (!providers[providerId]) {
    providers[providerId] = {
      name: '暮雨笺自定义网关',
      apiKeyEnv: 'MUYUJIAN_LLM_API_KEY',
      api: 'openai-completions',
      baseURL: init.baseUrl,
      models: [{ id: init.model }],
    };
    settingsChanged = true;
  }
  const defaults = asRecord(settingsDoc['agent-default-model']);
  if (!defaults.provider || !defaults.model) {
    // 用户没自己选过默认模型时指向播种的 provider，GUI 选过的值不动
    if (!providers[defaults.provider as string]) {
      settingsDoc['agent-default-model'] = { provider: providerId, model: init.model };
      settingsChanged = true;
    }
  }
  if (settingsChanged) {
    llm.providers = providers;
    settingsDoc['llm-pi-ai'] = llm;
    fs.writeFileSync(paths.settings, `${YAML.stringify(settingsDoc)}`, 'utf-8');
  }
  // Key 播种进 dsh 凭据（与 GUI 保存行为同构）；已有记录（含用户改过的）不动
  let credentialsChanged = false;
  if (init.apiKey) {
    const credentials = readYamlFile(paths.credentials);
    credentials.version = credentials.version ?? 1;
    const records = asRecord(credentials.records);
    const key = `llm-pi-ai/${providerId}`;
    if (!records[key]) {
      records[key] = { kind: 'api-key', env: { MUYUJIAN_LLM_API_KEY: init.apiKey } };
      credentials.records = records;
      credentialsChanged = true;
      fs.writeFileSync(paths.credentials, `${YAML.stringify(credentials)}`, 'utf-8');
    }
  }
  return settingsChanged || credentialsChanged;
}

/**
 * 显式写入（用户在旧版 AI 设置里点保存）：覆盖 provider 路由与凭据。
 * 与播种的差别是这里以调用方的值为准，用户确认的改动必须落地。
 */
export function upsertHarnessModelConfig(
  homeDir: string,
  init: { baseUrl: string; model: string; apiKey?: string | null; providerId?: string; clearApiKey?: boolean },
): void {
  const providerId = init.providerId ?? 'muyujian-gateway';
  const paths = homePaths(homeDir);
  fs.mkdirSync(homeDir, { recursive: true });
  const settingsDoc = readYamlFile(paths.settings);
  const llm = asRecord(settingsDoc['llm-pi-ai']);
  const providers = asRecord(llm.providers);
  providers[providerId] = {
    name: '暮雨笺自定义网关',
    apiKeyEnv: 'MUYUJIAN_LLM_API_KEY',
    api: 'openai-completions',
    baseURL: init.baseUrl,
    models: [{ id: init.model }],
  };
  llm.providers = providers;
  settingsDoc['llm-pi-ai'] = llm;
  settingsDoc['agent-default-model'] = { provider: providerId, model: init.model };
  fs.writeFileSync(paths.settings, `${YAML.stringify(settingsDoc)}`, 'utf-8');

  const credentials = readYamlFile(paths.credentials);
  credentials.version = credentials.version ?? 1;
  const records = asRecord(credentials.records);
  const key = `llm-pi-ai/${providerId}`;
  if (init.clearApiKey) delete records[key];
  else if (init.apiKey) records[key] = { kind: 'api-key', env: { MUYUJIAN_LLM_API_KEY: init.apiKey } };
  credentials.records = records;
  fs.writeFileSync(paths.credentials, `${YAML.stringify(credentials)}`, 'utf-8');
}
