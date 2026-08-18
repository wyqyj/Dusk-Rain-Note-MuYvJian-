/**
 * core/export/html.ts — 导出排版纯函数（组装完整 HTML 文档骨架）
 *
 * 移动端 Word/PDF 的降级链路复用 renderMarkdown 已产出的正文 HTML，
 * 本模块只负责套文档骨架；样式 CSS 由调用方（adapter）注入，保证 core 零平台依赖。
 */

export interface ExportHtmlOptions {
  title: string;
  bodyHtml: string;
  /** 可选内联 CSS（如 KaTeX/highlight.js 样式文本） */
  styleCss?: string;
}

export function buildExportHtml({ title, bodyHtml, styleCss }: ExportHtmlOptions): string {
  const style = styleCss ? `<style>${styleCss}</style>` : '';
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(title)}</title>
${style}
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<article class="muyujian-export">${bodyHtml}</article>
</body>
</html>`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 生成可分享/下载的文件名（去除非法字符）。 */
export function sanitizeExportFileName(title: string): string {
  return (title || '暮雨笺').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 120) || '暮雨笺';
}