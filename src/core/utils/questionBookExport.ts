import type { Question, QuestionBook } from '../domain/types';

export type QuestionExportScope = 'all' | 'filtered' | 'chapter';

export function selectQuestionExportItems(
  book: QuestionBook,
  filteredQuestions: Question[],
  scope: QuestionExportScope,
  chapter: string | undefined,
  count: number,
): Question[] {
  const candidates = scope === 'all'
    ? book.questions
    : scope === 'chapter'
      ? filteredQuestions.filter((question) => question.chapter === chapter)
      : filteredQuestions;
  if (!Number.isInteger(count) || count < 1 || count > candidates.length) return [];
  return candidates.slice(0, count);
}

function questionStatus(question: Question): string {
  if (question.status === 'wrong') return question.passed ? '错误题 · 已通过' : '错误题 · 待复盘';
  return '正确题';
}

function appendField(lines: string[], label: string, value?: string): void {
  if (!value?.trim()) return;
  lines.push(`### ${label}`, '', value.trim(), '');
}

export function renderQuestionBookMarkdown(book: QuestionBook, questions: Question[], exportedTitle?: string): string {
  const lines = [`# ${exportedTitle || book.title}`, '', `> 科目：${book.subject} · ${book.volume} · 共 ${questions.length} 题`, ''];
  questions.forEach((question, index) => {
    lines.push(`## ${index + 1}. ${question.number} · ${question.chapter}`, '', `**状态：** ${questionStatus(question)}`, '');
    appendField(lines, '题干', question.prompt);
    appendField(lines, '标准答案', question.answer);
    appendField(lines, '我的答案', question.mine);
    appendField(lines, '错误原因', question.reason);
    if (question.tags.length) lines.push(`**标签：** ${question.tags.join('、')}`, '');
    lines.push('---', '');
  });
  return `${lines.join('\n').trim()}\n`;
}

export function sanitizeExportFileName(value: string): string {
  return value.replace(/[<>:"/\\|?*\x00-\x1F]/g, '·').replace(/\s+/g, ' ').trim().slice(0, 120) || '暮雨笺题册';
}
