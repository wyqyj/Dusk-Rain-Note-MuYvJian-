import { describe, expect, it } from 'vitest';
import { renderMarkdown, normalizeMathMarkdown } from './markdown';

describe('renderMarkdown inline math heuristics', () => {
  it('leaves currency-like dollar text untouched', () => {
    const html = renderMarkdown('价格在 $5 到 $10 之间浮动');
    expect(html).toContain('$5');
    expect(html).toContain('$10');
    expect(html).not.toContain('katex');
  });

  it('renders a real inline formula', () => {
    expect(renderMarkdown('质能方程 $E = mc^2$ 很有名')).toContain('katex');
  });

  it('does not treat an opening dollar followed by whitespace as math', () => {
    expect(renderMarkdown('找零 $ 三块钱')).not.toContain('katex');
  });

  it('does not swallow text when a closing dollar is preceded by whitespace', () => {
    expect(renderMarkdown('苹果 $5 元')).not.toContain('katex');
  });
});

describe('normalizeMathMarkdown delimiter bounds', () => {
  it('does not let an unclosed \\[ swallow the rest of the document', () => {
    const output = normalizeMathMarkdown('\\[ x^2\n\n后续正文不会被吞掉');
    expect(output).toContain('后续正文不会被吞掉');
    expect(output).toContain('\\[ x^2');
  });

  it('normalizes inline paren math on a single line', () => {
    expect(normalizeMathMarkdown('已知 \\(a+b\\) 成立')).toContain('$a+b$');
  });
});
