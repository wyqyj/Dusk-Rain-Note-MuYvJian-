import * as fs from 'fs';
import * as path from 'path';

export type DshPresetId = 'muyujian' | 'research';

export interface DshPreset {
  id: DshPresetId;
  label: string;
  systemPrompt: string;
  description: string;
}

export const PRESETS: Record<DshPresetId, DshPreset> = {
  muyujian: {
    id: 'muyujian',
    label: '暮雨笺预设',
    description: '专注于考研备考与学习任务治理：管理笔记、题册、计划并检索知识库。',
    systemPrompt: `你是「暮雨笺」内置的学习与备考助理，工作目录为暮雨笺工作区。
你拥有操作暮雨笺便签、计划、题册及知识库检索的能力：
- 遇到便签、复习计划、题册相关任务时，优先调用 muyujian 工具集进行结构化管理，而非读写裸文件；
- 对便签与计划的所有写操作，向用户说明意图并通过确认闸门执行；
- 当用户询问笔记或题册内容时，主动调用 knowledge_search 检索工作区资料进行准确解答；
- 当用户提到知识库大包或想限定资料范围时，先用 knowledge_bundles 列出已打包的知识库包，再用 knowledge_search 的 bundleId 参数在包内检索。`,
  },
  research: {
    id: 'research',
    label: '研究预设',
    description: '专注于学术文献、论文著作与深度资料分析：先建 research-db 索引，先检索后作答。',
    systemPrompt: `你是「暮雨笺」学术研究助手，专注于文献研读、论文著作分析与概念考证。
工作原则：
1. 首次分析或资料可能更新时，先调用 research_scan 扫描工作区文档（PDF/DOCX/XLSX/MD/TXT），在 research-db/ 建立索引数据库；
2. 回答论文、著作或资料问题前，必须先调用 research_search 检索研究库，再用 research_read 精读命中文档，回答时标注来源文件与章节；
3. 严谨标注文献出处、段落与依据，避免未经佐证的臆断；
4. 输出结构清晰，分层阐述核心论点、论据与总结。`,
  },
};

export function getPreset(id?: string): DshPreset {
  if (id === 'research') return PRESETS.research;
  return PRESETS.muyujian;
}

/** 为预设生成自定义 Cordis 配置文件或系统指令追加 */
export function buildPresetPatch(homeDir: string, presetId: DshPresetId = 'muyujian'): string {
  const preset = getPreset(presetId);
  const patchFile = path.join(homeDir, `muyujian-preset-${preset.id}.cordis.yml`);
  const lines = [
    `# 由 DshPreset 自动生成（预设：${preset.label}）`,
    '- insert:',
    '    - id: muyujian-tools',
    "      name: 'muyujian-dsh-tools'",
    '',
  ];
  fs.writeFileSync(patchFile, lines.join('\n'), 'utf-8');
  return patchFile;
}

/**
 * 将暮雨笺预设和研究预设作为原生 Agent Preset 同步到用户级 /.agent-presets/
 * 使其与标准模式、极简模式、创造模式等在 DeepSeek Harness Web GUI 预设下拉列表中完全等价原生并列。
 */
export function syncNativeAgentPresets(homeDir: string, pluginSourceDir: string): void {
  const userPresetsDir = path.join(homeDir, '.agent-presets');
  fs.mkdirSync(userPresetsDir, { recursive: true });

  let standardComposition = '';
  try {
    const { resolveDshRuntimePaths } = require('./dshWebProfile');
    const { dshBin } = resolveDshRuntimePaths();
    const shippedPresetsDir = path.join(path.dirname(dshBin), '..', '..', 'dsh-agent-presets', 'presets');
    const stdFile = path.join(shippedPresetsDir, 'standard', 'agent.cordis.yml');
    if (fs.existsSync(stdFile)) {
      standardComposition = fs.readFileSync(stdFile, 'utf-8');
    }
  } catch {}

  const presetsToSync: Array<{
    id: DshPresetId;
    name: string;
    description: string;
    order: number;
    personaPrefix: string;
  }> = [
    {
      id: 'muyujian',
      name: '暮雨笺预设',
      description: '暮雨笺学习与考研备考治理预设',
      order: 5,
      personaPrefix: '你是「暮雨笺」内置的学习与备考助理，工作目录为 {{cwd}}，由 {{model}} 模型驱动。拥有操作暮雨笺便签、计划、题册及知识库检索能力。',
    },
    {
      id: 'research',
      name: '研究模式',
      description: '专注于学术文献、论文著作与深度资料分析：先建 research-db 索引，先检索后作答。',
      order: 6,
      personaPrefix: '你是「暮雨笺」学术研究助手，工作目录为 {{cwd}}，由 {{model}} 模型驱动。回答前先用 research_scan 建立 research-db 索引，再用 research_search / research_read 检索精读并标注出处。',
    },
  ];

  for (const p of presetsToSync) {
    const targetDir = path.join(userPresetsDir, p.id);
    fs.mkdirSync(targetDir, { recursive: true });

    const presetYml = 'name: ' + p.name + '\ndescription: ' + p.description + '\norder: ' + p.order + '\n';
    fs.writeFileSync(path.join(targetDir, 'preset.yml'), presetYml, 'utf-8');

    let composition = standardComposition;
    if (composition) {
      composition = composition.replace(
        /prefix: >-\s+You are a coding agent powered by the \{\{model\}\} model\./,
        'prefix: >-\n      ' + p.personaPrefix
      );
      if (!composition.includes("name: './tools/index.js'")) {
        composition += "\n\n- id: muyujian-tools\n  name: './tools/index.js'\n";
      }
    } else {
      composition = [
        '- id: persona',
        "  name: '@deepseek-ai/dsh-persona'",
        '  config:',
        '    suffix: Your working directory is {{cwd}}.',
        '    prefix: >-',
        '      ' + p.personaPrefix,
        '- id: tool-fs',
        "  name: '@deepseek-ai/dsh-tool-fs'",
        '- id: muyujian-tools',
        "  name: './tools/index.js'",
        '',
      ].join('\n');
    }
    fs.writeFileSync(path.join(targetDir, 'agent.cordis.yml'), composition, 'utf-8');

    const toolsDir = path.join(targetDir, 'tools');
    fs.mkdirSync(toolsDir, { recursive: true });
    for (const file of ['package.json', 'index.js']) {
      const src = path.join(pluginSourceDir, file);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(toolsDir, file));
      }
    }
  }
}
