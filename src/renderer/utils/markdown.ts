import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import markdown_lang from 'highlight.js/lib/languages/markdown';
import java from 'highlight.js/lib/languages/java';
import cpp from 'highlight.js/lib/languages/cpp';
import rust from 'highlight.js/lib/languages/rust';
import go from 'highlight.js/lib/languages/go';
import sql from 'highlight.js/lib/languages/sql';
import yaml from 'highlight.js/lib/languages/yaml';
import latex_lang from 'highlight.js/lib/languages/latex';
import katex from 'katex';
import 'katex/dist/katex.min.css';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('css', css);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('json', json);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('shell', bash);
hljs.registerLanguage('markdown', markdown_lang);
hljs.registerLanguage('java', java);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('c', cpp);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('go', go);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('latex', latex_lang);

// ========== 数学公式预渲染（KaTeX → HTML，在 markdown-it 之前执行）==========

function preRenderMath(text: string): { text: string; hasMath: boolean } {
  let result = text;
  let hasMath = false;

  // 1. 块级公式 $$...$$ → KaTeX HTML
  result = result.replace(/\$\$([\s\S]*?)\$\$/g, (_, math) => {
    hasMath = true;
    try { return `<div class="katex-block">${katex.renderToString(math.trim(), { throwOnError: false, displayMode: true })}</div>`; }
    catch { return `<div class="katex-error">${math}</div>`; }
  });

  // 2. 块级公式 \[...\] → KaTeX HTML
  result = result.replace(/\\\[([\s\S]*?)\\\]/g, (_, math) => {
    hasMath = true;
    try { return `<div class="katex-block">${katex.renderToString(math.trim(), { throwOnError: false, displayMode: true })}</div>`; }
    catch { return `<div class="katex-error">${math}</div>`; }
  });

  // 3. 数学环境 equation/align/gather → KaTeX HTML
  const envs = ['equation', 'align', 'gather', 'multline', 'eqnarray'];
  for (const env of envs) {
    const re = new RegExp(`\\\\begin\\{${env}\\*?\\}\\s*([\\s\\S]*?)\\\\end\\{${env}\\*?\\}`, 'g');
    result = result.replace(re, (_, math) => {
      hasMath = true;
      const content = env === 'align' || env === 'eqnarray'
        ? `\\begin{aligned}${math.trim()}\\end{aligned}`
        : math.trim();
      try { return `<div class="katex-block">${katex.renderToString(content, { throwOnError: false, displayMode: true })}</div>`; }
      catch { return `<div class="katex-error">${math}</div>`; }
    });
  }

  // 4. 行内公式 $...$ → KaTeX HTML（逐字符扫描，处理嵌套花括号）
  result = renderInlineMath(result);

  // 5. 行内公式 \(...\) → KaTeX HTML
  result = result.replace(/\\\((.+?)\\\)/g, (_, math) => {
    hasMath = true;
    try { return katex.renderToString(math, { throwOnError: false, displayMode: false }); }
    catch { return `<span class="katex-error">${math}</span>`; }
  });

  return { text: result, hasMath };
}

/** 逐字符扫描提取 $...$ 行内公式，正确处理嵌套花括号 */
function renderInlineMath(text: string): string {
  let result = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] === '$') {
      // 跳过 $$（块级公式已处理）
      if (i + 1 < text.length && text[i + 1] === '$') {
        result += '$$';
        i += 2;
        continue;
      }
      // 查找匹配的闭合 $
      let j = i + 1;
      let depth = 0;
      while (j < text.length) {
        if (text[j] === '{') depth++;
        else if (text[j] === '}') depth--;
        else if (text[j] === '$' && depth === 0) break;
        j++;
      }
      if (j < text.length) {
        const mathContent = text.slice(i + 1, j);
        try {
          result += katex.renderToString(mathContent, { throwOnError: false, displayMode: false });
        } catch {
          result += `<span class="katex-error">${mathContent}</span>`;
        }
        i = j + 1;
      } else {
        result += text[i];
        i++;
      }
    } else {
      result += text[i];
      i++;
    }
  }
  return result;
}

// ========== LaTeX 文档检测 ==========

function isLatexDocument(text: string): boolean {
  return /\\documentclass/.test(text) || /\\begin\{document\}/.test(text);
}

// ========== LaTeX 文档结构预处理 ==========

function preprocessLatexStructure(text: string): string {
  let result = text;

  // 导言区：剥离
  result = result.replace(/\\documentclass(\[.*?\])?\{.*?\}\s*/g, '');
  result = result.replace(/\\usepackage(\[.*?\])?\{.*?\}\s*/g, '');
  result = result.replace(/\\geometry(\{[^}]*\})\s*/g, '');
  result = result.replace(/\\(author|date|thanks)\{[^}]*\}\s*/g, '');
  result = result.replace(/\\(newcommand|renewcommand|DeclareMathOperator|setlength|addtolength)\b[^\n]*/gm, '');
  result = result.replace(/\\(bibliographystyle|bibliography)\{[^}]*\}\s*/g, '');

  // 标题
  const titleMatch = result.match(/\\title\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/);
  if (titleMatch) {
    result = result.replace(/\\title\{[^}]*(?:\{[^}]*\}[^}]*)*\}\s*/, `# ${titleMatch[1].trim()}\n\n`);
  }

  // document 环境
  result = result.replace(/\\begin\{document\}\s*/g, '');
  result = result.replace(/\\end\{document\}\s*/g, '');
  result = result.replace(/\\maketitle\s*/g, '');

  // 注释行
  result = result.replace(/^%.*$/gm, '');

  // 章节（支持星号 * 版本）
  result = result.replace(/\\(part|chapter)\*?\{([^}]*)\}/g, '# $2');
  result = result.replace(/\\section\*?\{([^}]*)\}/g, '## $1');
  result = result.replace(/\\subsection\*?\{([^}]*)\}/g, '### $1');
  result = result.replace(/\\subsubsection\*?\{([^}]*)\}/g, '#### $1');
  result = result.replace(/\\paragraph\*?\{([^}]*)\}/g, '**$1.** ');
  result = result.replace(/\\subparagraph\*?\{([^}]*)\}/g, '**$1.** ');

  // 文字格式
  result = result.replace(/\\textbf\{([^}]*)\}/g, '**$1**');
  result = result.replace(/\\textit\{([^}]*)\}/g, '*$1*');
  result = result.replace(/\\emph\{([^}]*)\}/g, '*$1*');
  result = result.replace(/\\underline\{([^}]*)\}/g, '<u>$1</u>');
  result = result.replace(/\\texttt\{([^}]*)\}/g, '`$1`');
  result = result.replace(/\\textsc\{([^}]*)\}/g, '**$1**');
  result = result.replace(/\\textrm\{([^}]*)\}/g, '$1');
  result = result.replace(/\\text\{([^}]*)\}/g, '$1');
  result = result.replace(/\\textsuperscript\{([^}]*)\}/g, '<sup>$1</sup>');
  result = result.replace(/\\textsubscript\{([^}]*)\}/g, '<sub>$1</sub>');
  result = result.replace(/\\mbox\{([^}]*)\}/g, '$1');

  // 链接和引用
  result = result.replace(/\\href\{([^}]*)\}\{([^}]*)\}/g, '[$2]($1)');
  result = result.replace(/\\url\{([^}]*)\}/g, '[$1]($1)');
  result = result.replace(/\\label\{([^}]*)\}/g, '');
  result = result.replace(/\\ref\{([^}]*)\}/g, '[$1]');
  result = result.replace(/\\eqref\{([^}]*)\}/g, '($1)');
  result = result.replace(/\\cite\{([^}]*)\}/g, '[$1]');

  // 摘要
  result = result.replace(/\\begin\{abstract\}\s*/g, '> **摘要**\n> ');
  result = result.replace(/\\end\{abstract\}\s*/g, '\n\n');

  // center 环境
  result = result.replace(/\\begin\{center\}\s*/g, '');
  result = result.replace(/\\end\{center\}\s*/g, '\n');

  // 有序列表
  result = result.replace(/\\begin\{enumerate\}\s*/g, '');
  result = result.replace(/\\end\{enumerate\}\s*/g, '\n');
  let enumIdx = 0;
  const enumLines = result.split('\n');
  for (let i = 0; i < enumLines.length; i++) {
    if (/^\s*\d+\.\s/.test(enumLines[i])) { /* keep */ }
    else if (/^\s*\\item\b/.test(enumLines[i])) { enumIdx++; enumLines[i] = enumLines[i].replace(/\\item\b\s*/, `${enumIdx}. `); }
    else { enumIdx = 0; }
  }
  result = enumLines.join('\n');

  // 无序列表
  result = result.replace(/\\begin\{itemize\}\s*/g, '');
  result = result.replace(/\\end\{itemize\}\s*/g, '\n');
  result = result.replace(/^\s*\\item\b\s*/gm, '- ');

  // 描述列表
  result = result.replace(/\\begin\{description\}\s*/g, '');
  result = result.replace(/\\end\{description\}\s*/g, '\n');
  result = result.replace(/\\item\[([^\]]*)\]\s*/g, '**$1** — ');

  // 表格
  result = preprocessLatexTable(result);

  // 图片
  result = result.replace(/\\begin\{figure\*?\}(\[.*?\])?\s*/g, '');
  result = result.replace(/\\end\{figure\*?\}\s*/g, '\n');
  result = result.replace(/\\includegraphics(\[.*?\])?\{([^}]*)\}/g, '![]($2)');
  result = result.replace(/\\caption\{([^}]*)\}/g, '\n*图：$1*\n');

  // 代码环境
  result = result.replace(/\\begin\{verbatim\*?\}\s*/g, '```\n');
  result = result.replace(/\\end\{verbatim\*?\}\s*/g, '\n```\n');
  result = result.replace(/\\begin\{lstlisting\}(\[.*?\])?\s*/g, '```\n');
  result = result.replace(/\\end\{lstlisting\}\s*/g, '\n```\n');
  result = result.replace(/\\begin\{minted\}\{[^}]*\}\s*/g, '```\n');
  result = result.replace(/\\end\{minted\}\s*/g, '\n```\n');

  // 换行和间距
  result = result.replace(/\\\\(\[.*?\])?\s*/g, '\n');
  result = result.replace(/\\newline\s*/g, '\n');
  result = result.replace(/\\par\b\s*/g, '\n\n');
  result = result.replace(/\\noindent\b\s*/g, '');
  result = result.replace(/\\bigskip\b\s*/g, '\n\n---\n\n');
  result = result.replace(/\\medskip\b\s*/g, '\n\n');
  result = result.replace(/\\smallskip\b\s*/g, '\n');
  result = result.replace(/\\newpage\b\s*/g, '\n\n---\n\n');
  result = result.replace(/\\hrule\b\s*/g, '\n---\n');

  // booktabs
  result = result.replace(/\\toprule(\[.*?\])?\s*/g, '');
  result = result.replace(/\\midrule\s*/g, '');
  result = result.replace(/\\bottomrule(\[.*?\])?\s*/g, '');
  result = result.replace(/\\hline\s*/g, '');
  result = result.replace(/\\cline\{[^}]*\}\s*/g, '');

  // 常用符号
  result = result.replace(/\\ldots/g, '…');
  result = result.replace(/\\cdots/g, '⋯');
  result = result.replace(/\\dots/g, '…');
  result = result.replace(/\\today/g, new Date().toLocaleDateString('zh-CN'));
  result = result.replace(/\\footnote\{([^}]*)\}/g, '<sup>[$1]</sup>');

  // 清理残留的未知 LaTeX 命令
  result = result.replace(/\\[a-zA-Z]+\*?(\{[^}]*\})*\s*/g, '');

  // 清理多余空行
  result = result.replace(/\n{3,}/g, '\n\n').trim();

  return result;
}

// ========== LaTeX tabular → HTML table ==========

function preprocessLatexTable(text: string): string {
  return text.replace(/(?:\\begin\{table\*?\}(\[.*?\])?\s*)?\\begin\{tabular\}\{([^}]*)\}\s*([\s\S]*?)\\end\{tabular\}(?:\s*\\end\{table\*?\})?/g,
    (_, _opts, alignSpec, body) => {
      const captionMatch = body.match(/\\caption\{([^}]*)\}/);
      const caption = captionMatch ? `\n*表：${captionMatch[1]}*\n` : '';
      const cleanedBody = body.replace(/\\caption\{[^}]*\}\s*/g, '');
      const rows = cleanedBody.trim().split(/\\\\(?:\[.*?\])?\s*/);
      const aligns = parseAlignSpec(alignSpec);

      let html = '<table>\n';
      let isHeader = true;
      for (const row of rows) {
        const trimmed = row.trim();
        if (!trimmed || /^\\[a-z]/.test(trimmed)) continue;
        const cells = trimmed.split('&').map(c => c.trim());
        const tag = isHeader ? 'th' : 'td';
        html += '  <tr>\n';
        cells.forEach((cell, i) => {
          const align = aligns[i] ? ` style="text-align:${aligns[i]}"` : '';
          html += `    <${tag}${align}>${cell}</${tag}>\n`;
        });
        html += '  </tr>\n';
        isHeader = false;
      }
      html += '</table>';
      return html + caption;
    });
}

function parseAlignSpec(spec: string): string[] {
  const aligns: string[] = [];
  for (const ch of spec) {
    if (ch === 'l') aligns.push('left');
    else if (ch === 'c') aligns.push('center');
    else if (ch === 'r') aligns.push('right');
  }
  return aligns;
}

// ========== Markdown-it ==========

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  highlight(str: string, lang: string) {
    if (lang && hljs.getLanguage(lang)) {
      try { return `<pre class="hljs"><code>${hljs.highlight(str, { language: lang }).value}</code></pre>`; } catch {}
    }
    return `<pre class="hljs"><code>${md.utils.escapeHtml(str)}</code></pre>`;
  },
});

md.use(taskLists, { enabled: true, label: true, labelAfter: true });

// 行内公式 $...$ 和单行 $$...$$（用于非 LaTeX 文档的普通 Markdown 中的数学片段）
function latexPlugin(md: MarkdownIt): void {
  // 单行块级公式 $$...$$
  md.inline.ruler.after('escape', 'math_display', (state, silent) => {
    if (state.src.charCodeAt(state.pos) !== 0x24 || state.src.charCodeAt(state.pos + 1) !== 0x24) return false;
    const start = state.pos + 2;
    let end = start;
    while (end < state.posMax - 1) {
      if (state.src.charCodeAt(end) === 0x24 && state.src.charCodeAt(end + 1) === 0x24) break;
      end++;
    }
    if (end >= state.posMax - 1 || end === start) return false;
    if (!silent) {
      const token = state.push('math_block', 'math', 0);
      token.content = state.src.slice(start, end).trim();
      token.markup = '$$';
      token.block = true;
    }
    state.pos = end + 2;
    return true;
  });

  // 行内公式 $...$
  md.inline.ruler.after('math_display', 'math_inline', (state, silent) => {
    if (state.src.charCodeAt(state.pos) !== 0x24) return false;
    // 跳过 $$（已由 math_display 处理）
    if (state.src.charCodeAt(state.pos + 1) === 0x24) return false;
    const start = state.pos + 1;
    let end = start;
    let depth = 0;
    while (end < state.posMax) {
      if (state.src.charCodeAt(end) === 0x7B) depth++;
      else if (state.src.charCodeAt(end) === 0x7D) depth--;
      else if (state.src.charCodeAt(end) === 0x24 && depth === 0) break;
      end++;
    }
    if (end >= state.posMax || end === start) return false;
    if (!silent) {
      const token = state.push('math_inline', 'math', 0);
      token.content = state.src.slice(start, end);
      token.markup = '$';
    }
    state.pos = end + 1;
    return true;
  });

  md.block.ruler.before('fence', 'math_block', (state, startLine, endLine, silent) => {
    const startPos = state.bMarks[startLine] + state.tShift[startLine];
    if (state.src.charCodeAt(startPos) !== 0x24 || state.src.charCodeAt(startPos + 1) !== 0x24) return false;
    let nextLine = startLine + 1;
    let found = false;
    while (nextLine < endLine) {
      const lineStart = state.bMarks[nextLine] + state.tShift[nextLine];
      if (state.src.slice(lineStart, state.eMarks[nextLine]).trim() === '$$') { found = true; break; }
      nextLine++;
    }
    if (!found) return false;
    if (silent) return true;
    const token = state.push('math_block', 'math', 0);
    token.block = true;
    token.content = state.getLines(startLine + 1, nextLine, state.blkIndent, false).trim();
    token.markup = '$$';
    token.map = [startLine, nextLine + 1];
    state.line = nextLine + 1;
    return true;
  });

  md.renderer.rules.math_inline = (tokens, idx) => {
    try { return katex.renderToString(tokens[idx].content, { throwOnError: false, displayMode: false }); }
    catch { return `<span class="katex-error">${tokens[idx].content}</span>`; }
  };
  md.renderer.rules.math_block = (tokens, idx) => {
    try { return `<div class="katex-block">${katex.renderToString(tokens[idx].content, { throwOnError: false, displayMode: true })}</div>`; }
    catch { return `<div class="katex-error">${tokens[idx].content}</div>`; }
  };
}

md.use(latexPlugin);

// ========== 导出函数 ==========

/**
 * 渲染 Markdown/LaTeX 文本为 HTML
 */
function preprocessWikiLinks(text: string): string {
  return text.replace(/\[\[([^\]]+)\]\]/g, (_, title) => {
    const escaped = title.replace(/"/g, '&quot;');
    return `<a class="wiki-link" data-title="${escaped}" href="javascript:void(0)">${title}</a>`;
  });
}

/** Accept math written as inline code by older question-book examples. */
export function normalizeMathMarkdown(text: string): string {
  const codeNormalized = text.replace(/`([^`\n]+)`/g, (source, raw: string) => {
    const expression = raw.trim();
    const looksLikeMath = /^[-+]?\d+(?:\.\d+)?$/.test(expression)
      || /\\[a-zA-Z]+|[=^_]|->|[<>≤≥±×÷∫∑∏√∞]|(?:^|\s)(?:lim|sin|cos|tan|cot|sec|csc|ln|log|exp|sqrt)\b/.test(expression);
    if (!looksLikeMath) return source;
    return `$${expression.replace(/->/g, '\\to')}$`;
  });
  return codeNormalized
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, math) => `$$\n${math.trim()}\n$$`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, math) => `$${math.trim()}$`);
}

export function renderMarkdown(text: string): string {
  const normalized = normalizeMathMarkdown(text);
  if (isLatexDocument(normalized)) {
    const { text: mathRendered } = preRenderMath(normalized);
    const structured = preprocessLatexStructure(mathRendered);
    return md.render(preprocessWikiLinks(structured));
  }
  return md.render(preprocessWikiLinks(normalized));
}

export function toggleTaskCheckbox(source: string, lineIndex: number, checked: boolean): string {
  const lines = source.split('\n');
  if (lineIndex < 0 || lineIndex >= lines.length) return source;
  const line = lines[lineIndex];
  if (checked && /^\s*[-*+]\s*\[ \]/.test(line)) {
    lines[lineIndex] = line.replace(/^(\s*[-*+]\s*)\[ \]/, '$1[x]');
  } else if (!checked && /^\s*[-*+]\s*\[x\]/i.test(line)) {
    lines[lineIndex] = line.replace(/^(\s*[-*+]\s*)\[x\]/i, '$1[ ]');
  }
  return lines.join('\n');
}

export function extractTasks(content: string): { text: string; checked: boolean; lineIndex: number }[] {
  const lines = content.split('\n');
  const tasks: { text: string; checked: boolean; lineIndex: number }[] = [];
  lines.forEach((line, index) => {
    const uncheckedMatch = line.match(/^\s*[-*+]\s*\[ \]\s*(.*)/);
    const checkedMatch = line.match(/^\s*[-*+]\s*\[x\]\s*(.*)/i);
    if (uncheckedMatch) tasks.push({ text: uncheckedMatch[1], checked: false, lineIndex: index });
    else if (checkedMatch) tasks.push({ text: checkedMatch[1], checked: true, lineIndex: index });
  });
  return tasks;
}

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function getDeadlineInfo(deadline: number): { text: string; shortText: string; isExpired: boolean; color: string; bgColor: string; urgent: boolean } {
  const now = Date.now();
  const diff = deadline - now;
  if (diff < 0) {
    const absDiff = -diff;
    const days = Math.floor(absDiff / 86400000);
    const hours = Math.floor((absDiff % 86400000) / 3600000);
    const minutes = Math.floor((absDiff % 3600000) / 60000);
    const seconds = Math.floor((absDiff % 60000) / 1000);
    const parts: string[] = [];
    if (days > 0) parts.push(`${days}天`);
    if (hours > 0) parts.push(`${hours}时`);
    parts.push(`${minutes}分`, `${seconds}秒`);
    return { text: `已过期 ${parts.join(' ')}`, shortText: '已过期', isExpired: true, color: 'text-red-500', bgColor: 'bg-red-50 dark:bg-red-900/20', urgent: true };
  }
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}天`);
  if (hours > 0) parts.push(`${hours}时`);
  if (minutes > 0 || days > 0) parts.push(`${minutes}分`);
  parts.push(`${seconds}秒`);
  let color: string, bgColor: string, urgent = false;
  if (days > 3) { color = 'text-emerald-600 dark:text-emerald-400'; bgColor = 'bg-emerald-50 dark:bg-emerald-900/20'; }
  else if (days > 0) { color = 'text-blue-600 dark:text-blue-400'; bgColor = 'bg-blue-50 dark:bg-blue-900/20'; urgent = true; }
  else if (hours > 0) { color = 'text-amber-600 dark:text-amber-400'; bgColor = 'bg-amber-50 dark:bg-amber-900/20'; urgent = true; }
  else { color = 'text-red-500'; bgColor = 'bg-red-50 dark:bg-red-900/20'; urgent = true; }
  return { text: `剩余 ${parts.join(' ')}`, shortText: parts.join(' '), isExpired: false, color, bgColor, urgent };
}

export function formatDeadlineDate(timestamp: number): string {
  const d = new Date(timestamp);
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  let timeStr = '';
  if (d.getHours() !== 0 || d.getMinutes() !== 0) {
    const period = d.getHours() < 6 ? '凌晨' : d.getHours() < 12 ? '上午' : d.getHours() < 18 ? '下午' : '晚上';
    const h = d.getHours() > 12 ? d.getHours() - 12 : d.getHours() === 0 ? 12 : d.getHours();
    timeStr = ` ${period} ${h}:${d.getMinutes().toString().padStart(2, '0')}`;
  }
  return `${d.getMonth() + 1}月${d.getDate()}日（周${weekdays[d.getDay()]}）${timeStr}`;
}

export function postProcessPandocHtml(html: string): string {
  html = html.replace(/\\\((.+?)\\\)/g, (_, math) => {
    try { return katex.renderToString(math, { throwOnError: false, displayMode: false }); }
    catch { return `<span class="katex-error">${math}</span>`; }
  });
  html = html.replace(/\\\[([\s\S]*?)\\\]/g, (_, math) => {
    try { return `<div class="katex-block">${katex.renderToString(math.trim(), { throwOnError: false, displayMode: true })}</div>`; }
    catch { return `<div class="katex-error">${math}</div>`; }
  });
  return html;
}
