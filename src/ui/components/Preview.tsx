import React, { useCallback, useState, useEffect, useRef } from 'react';
import { useNoteStore } from '../store/noteStore';
import { useSettingsStore } from '../store/settingsStore';
import { renderMarkdown, toggleTaskCheckbox, postProcessPandocHtml } from '../../core/utils/markdown';
import { getBridge } from '../../platform/container';

type SourceFormat = 'auto' | 'markdown' | 'latex' | 'rst' | 'html';

const FORMAT_OPTIONS: { value: SourceFormat; label: string }[] = [
  { value: 'auto', label: '自动检测' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'latex', label: 'LaTeX' },
  { value: 'rst', label: 'reStructuredText' },
  { value: 'html', label: 'HTML' },
];

function isLatexDocument(text: string): boolean {
  if (/\\documentclass/.test(text) || /\\begin\{document\}/.test(text)) return true;
  if (/\\\[[\s\S]*?\\\]/.test(text)) return true;
  if (/\\\([\s\S]*?\\\)/.test(text)) return true;
  if (/\\begin\{(equation|align|gather|eqnarray)\*?\}/.test(text)) return true;
  return false;
}

function wrapLatexFragment(text: string): string {
  if (/\\documentclass/.test(text) || /\\begin\{document\}/.test(text)) return text;
  return `\\documentclass[12pt]{article}\n\\usepackage{amsmath,amssymb}\n\\begin{document}\n${text}\n\\end{document}`;
}

export const Preview: React.FC<{ onClose?: () => void }> = ({ onClose }) => {
  const { notes, activeNoteId, updateNote } = useNoteStore();
  const { t } = useSettingsStore();
  const activeNote = notes.find((n) => n.id === activeNoteId);
  const [exporting, setExporting] = useState(false);
  const [compiling, setCompiling] = useState(false);
  const [html, setHtml] = useState('');
  const [sourceFormat, setSourceFormat] = useState<SourceFormat>('auto');
  const compileIdRef = useRef(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!activeNote) { setHtml(''); return; }

    const content = activeNote.content;
    const id = ++compileIdRef.current;

    if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }

    const usePandoc = sourceFormat === 'latex' || sourceFormat === 'rst' || sourceFormat === 'html'
      || (sourceFormat === 'auto' && isLatexDocument(content));

    if (usePandoc) {
      setCompiling(true);
      const pandocFormat = sourceFormat === 'auto' ? 'latex' : sourceFormat;
      const source = pandocFormat === 'latex' ? wrapLatexFragment(content) : content;
      getBridge().exporter.pandocCompile(source, pandocFormat).then((result) => {
        if (compileIdRef.current !== id) return;
        if (result.success && result.html) {
          setHtml(postProcessPandocHtml(result.html));
        } else {
          // 移动端无 pandoc：自动回退 KaTeX 渲染
          setHtml(renderMarkdown(content));
        }
        setCompiling(false);
      }).catch(() => {
        if (compileIdRef.current !== id) return;
        setHtml(renderMarkdown(content));
        setCompiling(false);
      });
    } else {
      debounceRef.current = setTimeout(() => {
        if (compileIdRef.current !== id) return;
        setHtml(renderMarkdown(content));
      }, 150);
    }

    return () => { if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; } };
  }, [activeNote?.content, activeNoteId, sourceFormat]);

  const handleContentClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!activeNote || !activeNoteId) return;
      const target = e.target as HTMLElement;

      // 任务勾选
      if (target.tagName === 'INPUT' && target.getAttribute('type') === 'checkbox') {
        const li = target.closest('li');
        if (!li) return;
        const listItems = Array.from(li.parentElement?.children || []);
        const itemIndex = listItems.indexOf(li);
        const lines = activeNote.content.split('\n');
        let taskIndex = 0;
        let lineIndex = -1;
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line && /^\s*[-*+]\s*\[/.test(line)) {
            if (taskIndex === itemIndex) { lineIndex = i; break; }
            taskIndex++;
          }
        }
        if (lineIndex >= 0) {
          const isChecked = (target as HTMLInputElement).checked;
          updateNote(activeNoteId, { content: toggleTaskCheckbox(activeNote.content, lineIndex, isChecked) });
        }
        return;
      }

      // Wiki 链接跳转
      const wikiLink = target.closest('.wiki-link') as HTMLElement;
      if (wikiLink) {
        e.preventDefault();
        const title = wikiLink.dataset.title;
        if (title) {
          const allNotes = useNoteStore.getState().notes;
          const matched = allNotes.find(n => !n.isDeleted && n.title.toLowerCase().includes(title.toLowerCase()));
          if (matched) {
            useNoteStore.getState().setActiveNoteId(matched.id);
          }
        }
      }
    }, [activeNote, activeNoteId, updateNote]);

  const handleExportWord = async () => {
    if (!activeNote) return;
    setExporting(true);
    const result = await getBridge().exporter.exportWord(activeNote.title, activeNote.content);
    setExporting(false);
    if (result.success) alert(`已导出为 Word：${result.path}`);
    else if (result.error !== 'cancelled') alert(`导出失败：${result.error}`);
  };

  const handleExportPdf = async () => {
    if (!activeNote) return;
    const confirmed = confirm(
      '导出 PDF 在移动端将生成可直接打印的 HTML/PDF 文件。\n\n' +
      '点击「确定」继续导出。'
    );
    if (!confirmed) return;
    setExporting(true);
    const result = await getBridge().exporter.exportPdf(activeNote.title, activeNote.content);
    setExporting(false);
    if (result.success) alert(`已导出为 PDF：${result.path}`);
    else if (result.error !== 'cancelled') {
      alert(`导出失败：${result.error}`);
    }
  };

  if (!activeNote) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50/50 dark:bg-gray-800/50">
        <div className="text-center text-gray-300 dark:text-gray-600">
          <svg className="w-20 h-20 mx-auto mb-4 opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          <p className="text-base">{t.previewPlaceholder}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="preview-shell flex-1 flex flex-col bg-gray-50/50 dark:bg-gray-800/30 min-w-0 border-l border-indigo-100/60 dark:border-gray-800">
      {/* 标题栏 */}
      <div className="preview-header flex items-center justify-between px-4 py-2 border-b border-indigo-100/40 dark:border-gray-800">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-indigo-300 dark:text-gray-600 tracking-wider">{t.preview}</span>
          {compiling && <span className="text-[10px] text-amber-500 animate-pulse">Pandoc 编译中…</span>}
        </div>
        <div className="flex items-center gap-1">
          {onClose && <button onClick={onClose}
            className="p-1 rounded text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-200 transition-colors"
            title="关闭预览" aria-label="关闭预览">×</button>}
          {/* 源码格式选择 */}
          <select value={sourceFormat} onChange={(e) => setSourceFormat(e.target.value as SourceFormat)}
            className="text-[10px] px-1.5 py-1 rounded bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 outline-none cursor-pointer">
            {FORMAT_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
          <button onClick={handleExportWord} disabled={exporting || !activeNote?.content}
            className="flex items-center gap-1 px-2 py-1 text-[10px] rounded-md bg-indigo-50 dark:bg-indigo-900/20 text-indigo-500 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/30 disabled:opacity-50 transition-all"
            title="导出为 Word">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Word
          </button>
          <button onClick={handleExportPdf} disabled={exporting || !activeNote?.content}
            className="flex items-center gap-1 px-2 py-1 text-[10px] rounded-md bg-rose-50 dark:bg-rose-900/20 text-rose-500 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-900/30 disabled:opacity-50 transition-all"
            title="导出为 PDF（需安装 LaTeX）">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
            PDF
          </button>
        </div>
      </div>
      {/* 预览内容 */}
      <div ref={contentRef}
        className="preview-content flex-1 overflow-auto p-6 prose prose-sm dark:prose-invert max-w-none break-words prose-headings:text-gray-800 dark:prose-headings:text-gray-100 prose-p:text-gray-600 dark:prose-p:text-gray-300 prose-a:text-indigo-500 prose-code:text-indigo-600 dark:prose-code:text-indigo-400 prose-pre:bg-gray-100 dark:prose-pre:bg-gray-800/80"
        onClick={handleContentClick} dangerouslySetInnerHTML={{ __html: html }} />
      <style>{`
        .wiki-link { color: #6366f1; text-decoration: underline; text-decoration-style: dashed; text-underline-offset: 2px; cursor: pointer; transition: color 0.15s; }
        .wiki-link:hover { color: #ec4899; }
      `}</style>
    </div>
  );
};
