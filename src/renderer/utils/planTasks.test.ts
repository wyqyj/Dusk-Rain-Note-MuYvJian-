import { describe, expect, it } from 'vitest';
import { parseMarkdownTasks } from './planTasks';

describe('parseMarkdownTasks', () => {
  it('parses unchecked and checked Markdown task items', () => {
    expect(parseMarkdownTasks('说明\n  - [ ] 数学：极限 20 题\n* [x] 英语单词\n+ [ ]')).toEqual([
      { title: '数学：极限 20 题', completed: false },
      { title: '英语单词', completed: true },
    ]);
  });
});
