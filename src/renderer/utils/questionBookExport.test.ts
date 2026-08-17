import { describe, expect, it } from 'vitest';
import type { QuestionBook } from '../../shared/types';
import { renderQuestionBookMarkdown, sanitizeExportFileName, selectQuestionExportItems } from './questionBookExport';

const book: QuestionBook = {
  id: 'book', title: '高数题册', volume: '第一册', subject: '数学', questions: [
    { id: 'q1', chapter: '极限', number: 'Q001', status: 'wrong', prompt: '求极限', answer: '1', mastery: 1, passed: false, tags: ['基础'] },
    { id: 'q2', chapter: '导数', number: 'Q002', status: 'correct', prompt: '求导', answer: '2x', mastery: 4, passed: true, tags: [] },
  ], overrides: {},
};

describe('questionBookExport', () => {
  it('selects the requested number from the selected scope', () => {
    expect(selectQuestionExportItems(book, book.questions, 'chapter', '导数', 1).map((item) => item.id)).toEqual(['q2']);
    expect(selectQuestionExportItems(book, book.questions, 'all', undefined, 1).map((item) => item.id)).toEqual(['q1']);
    expect(selectQuestionExportItems(book, book.questions, 'filtered', undefined, 3)).toEqual([]);
  });

  it('renders fields and cleans the Windows filename', () => {
    const markdown = renderQuestionBookMarkdown(book, book.questions.slice(0, 1), '高数:第一册');
    expect(markdown).toContain('### 标准答案');
    expect(markdown).toContain('**标签：** 基础');
    expect(sanitizeExportFileName('高数:第一册?.pdf')).toBe('高数·第一册·.pdf');
  });
});
