import * as fs from 'fs';
import * as path from 'path';
import { resolveDshRuntimePaths } from './dshRuntime';

export { resolveDshRuntimePaths };
export { resolveDshToolsDir } from './dshRuntime';

/** 业务插件源码位置（与 dshRuntime 的 private helper 同一规则）。 */
export function defaultPluginDirFor(): string {
  const proc = process as NodeJS.Process & { resourcesPath?: string };
  if (proc.resourcesPath && __dirname.includes('app.asar')) {
    return path.join(proc.resourcesPath, 'plugins', 'muyujian-dsh-tools');
  }
  return path.join(__dirname, '..', '..', 'plugins', 'muyujian-dsh-tools');
}

/** 把 muyujian-dsh-tools 插件源码同步进 profile node_modules（bare import 可解析）。 */
export function syncBusinessPlugin(pluginDir: string, profileModules: string): void {
  const target = path.join(profileModules, 'muyujian-dsh-tools');
  fs.mkdirSync(target, { recursive: true });
  for (const file of ['package.json', 'index.js']) {
    fs.copyFileSync(path.join(pluginDir, file), path.join(target, file));
  }
}

/** 只挂载业务插件、不禁用任何内置工具的 patch（web GUI 保留 dsh 全部功能）。 */
export function buildMountPatch(homeDir: string): string {
  const patchFile = path.join(homeDir, 'muyujian-web.cordis.yml');
  const lines = [
    '# 由 DshWebGui 自动生成，请勿手改（启动时重写）',
    '- insert:',
    '    - id: muyujian-tools',
    "      name: 'muyujian-dsh-tools'",
    '',
  ];
  fs.writeFileSync(patchFile, lines.join('\n'), 'utf-8');
  return patchFile;
}
