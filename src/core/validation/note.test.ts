import { describe, expect, it } from 'vitest';
import { migrateNotes, validateNotes } from './note';

describe('core/validation/note — 便签校验与迁移', () => {
  it('校验合法便签并补全缺省字段', () => {
    const notes = validateNotes([{ id: 'a', title: '标题', content: '内容' }]);
    expect(notes).toHaveLength(1);
    expect(notes[0].noteType).toBe('note');
    expect(notes[0].kanbanStatus).toBe('todo');
    expect(notes[0].history).toEqual([]);
  });

  it('过滤结构非法条目', () => {
    expect(validateNotes([null, { id: 1 }, { id: 'x' }, { id: 'y', title: 't', content: '' }])).toHaveLength(1);
  });

  it('画布数据校验保留合法项', () => {
    const notes = validateNotes([{
      id: 'c1', title: '画布', content: '', noteType: 'canvas',
      canvasItems: [
        { id: 'i1', type: 'text', x: 0, y: 0, content: 'hi' },
        { id: 'bad', type: 'text', x: 0, y: 0 },
        null,
      ],
    }]);
    expect(notes[0]?.canvasItems).toHaveLength(1);
    expect(notes[0]?.canvasItems?.[0]?.id).toBe('i1');
  });

  it('isTodayPlan → noteType 迁移', () => {
    const { migrated } = migrateNotes([{ id: 't1', title: '待办', content: '- [ ] x', isTodayPlan: true } as never]);
    expect(migrated).toBe(true);
  });
});