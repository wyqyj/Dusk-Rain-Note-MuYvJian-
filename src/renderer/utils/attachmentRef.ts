/**
 * 图片素材的磁盘化存储（#10）。
 *
 * 图片二进制写入工作台根目录下的 attachments/ 目录，笔记与画布内容中只保留
 * `attachment:<文件名>` 令牌。渲染时在 Markdown 管线末端把令牌解析为
 * `file://` 绝对路径；目录迁移后令牌无需变更，只需重新设置根路径。
 * 旧数据中的 dataURI 图片不强制迁移，仍然可以正常渲染。
 */

export const ATTACHMENT_TOKEN_PREFIX = 'attachment:';

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

let cachedRoot: string | null = null;

/** 应用启动后调用一次；工作台根目录迁移后需重新调用。 */
export function setAttachmentRoot(root: string): void {
  cachedRoot = root;
}

export function isAttachmentToken(value: string): boolean {
  return value.startsWith(ATTACHMENT_TOKEN_PREFIX);
}

/** 将令牌解析为可渲染的 file:// URL；根路径未知时返回空串。 */
export function attachmentTokenToUrl(token: string): string {
  if (!cachedRoot || !isAttachmentToken(token)) return '';
  const fileName = token.slice(ATTACHMENT_TOKEN_PREFIX.length).replace(/[\\/]/g, '');
  if (!fileName) return '';
  const base = cachedRoot.replace(/\\/g, '/').replace(/\/+$/, '');
  const prefix = base.startsWith('/') ? `file://${base}` : `file:///${base}`;
  return `${prefix}/attachments/${encodeURIComponent(fileName)}`;
}

/** 在已消毒的 HTML 中把 attachment: 令牌 src/href 解析为真实路径。 */
export function resolveAttachmentTokens(html: string): string {
  if (!html.includes(ATTACHMENT_TOKEN_PREFIX)) return html;
  return html.replace(/(src|href)="(attachment:[^"]*)"/g, (raw, attr: string, token: string) => {
    const url = attachmentTokenToUrl(token);
    return url ? `${attr}="${url}"` : raw;
  });
}

/** 把图片文件写入 attachments/ 目录，返回 attachment: 令牌（浏览器环境回退为 dataURI）。 */
export async function saveImageToAttachments(file: File): Promise<string> {
  if (file.size > MAX_IMAGE_BYTES) throw new Error('图片大小不能超过 20MB');
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  if (!window.electronAPI?.writeAttachmentFile) return dataUrl;
  const result = await window.electronAPI.writeAttachmentFile(file.name, dataUrl);
  if (!result.success || !result.fileName) throw new Error(result.error || '图片保存失败');
  return ATTACHMENT_TOKEN_PREFIX + result.fileName;
}
