import { describe, expect, it } from 'vitest';
import { sanitizeHtml } from './sanitizeHtml';
import { extractTasks, renderMarkdown } from './markdown';

describe('sanitizeHtml', () => {
  it('removes scripts, event handlers, and javascript URLs', () => {
    const result = sanitizeHtml('<p onclick="alert(1)">safe</p><script>alert(1)</script><a href="javascript:alert(1)">link</a>');
    expect(result).not.toContain('<script');
    expect(result).not.toContain('onclick');
    expect(result).not.toContain('javascript:');
    expect(result).toContain('safe');
  });

  it('keeps Markdown and KaTeX-compatible markup', () => {
    const result = sanitizeHtml('<h2 class="katex"><span data-title="笔记">标题</span></h2><svg viewBox="0 0 10 10"><line x1="0" y1="0" x2="10" y2="10" /></svg>');
    expect(result).toContain('<h2 class="katex">');
    expect(result).toContain('data-title="笔记"');
    expect(result).toContain('<svg');
    expect(result).toContain('<line');
  });

  it('sanitizes rendered Markdown and preserves task extraction', () => {
    const html = renderMarkdown('# 标题\n\n<script>alert(1)</script>\n\n- [ ] 待复盘');
    expect(html).toContain('<h1>标题</h1>');
    expect(html).not.toContain('<script');
    expect(extractTasks('- [ ] 待复盘\n- [x] 已完成')).toEqual([
      { text: '待复盘', checked: false, lineIndex: 0 },
      { text: '已完成', checked: true, lineIndex: 1 },
    ]);
  });
});
