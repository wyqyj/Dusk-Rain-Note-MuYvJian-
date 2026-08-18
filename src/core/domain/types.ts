export type Subject = '政治' | '英语' | '数学' | '业务课';
export type TaskBucket = 'daily' | 'monthly' | 'backlog' | 'ignored';
export type Mastery = 1 | 2 | 3 | 4 | 5;
export type BookSort = 'recent' | 'progress' | 'title';

export interface Task { id: string; title: string; subject: Subject; date: string; completed: boolean; bucket: TaskBucket; sourceDate?: string; due?: string; }
export interface FocusRecord { id: string; taskName: string; subject: Subject; date: string; minutes: number; completed: boolean; }
export interface Book { id: string; title: string; author: string; shelf: string; sourcePath?: string; originalPath?: string; coverPath?: string; progress: number; lastOpenedAt?: number; noteIds: string[]; questionBookIds: string[]; }
export interface Question { id: string; chapter: string; number: string; status: 'correct' | 'wrong'; prompt: string; answer: string; mine?: string; reason?: string; mastery: Mastery; passed: boolean; tags: string[]; }
export interface QuestionBook { id: string; title: string; volume: string; subject: Subject; sourcePath?: string; originalPath?: string; sourcePaths?: string[]; originalPaths?: string[]; canvasId?: string; questions: Question[]; overrides: Record<string, Pick<Question, 'mastery' | 'passed' | 'tags'>>; }
export interface Workspace { version: 3; examDate: string; phases: { name: string; start: string; end: string }[]; tasks: Task[]; focusRecords: FocusRecord[]; shelves: string[]; books: Book[]; questionBooks: QuestionBook[]; checkins: string[]; customTags: string[]; }

export type NoteType = 'note' | 'todo' | 'canvas';
export type CanvasItemType = 'text' | 'image' | 'note';
export interface CanvasItem { id: string; type: CanvasItemType; x: number; y: number; width: number; height?: number; content: string; color?: string; attachmentId?: string; }
export interface CanvasLink { id: string; fromId: string; toId: string; label?: string; color?: string; }
export interface CanvasOutlineItem { label: string; itemId: string; }
export interface NoteVersion { id: string; savedAt: number; title: string; content: string; canvasItems?: CanvasItem[]; canvasLinks?: CanvasLink[]; canvasWallpaper?: string; canvasWallpaperFit?: 'cover' | 'contain' | 'repeat'; canvasOutline?: CanvasOutlineItem[]; }
export interface Note { id: string; title: string; content: string; tags: string[]; createdAt: number; updatedAt: number; deadline?: number; isTodayPlan: boolean; noteType: NoteType; isArchived: boolean; isPinned?: boolean; pinnedInTags?: string[]; isDeleted?: boolean; deletedAt?: number; canvasItems?: CanvasItem[]; canvasLinks?: CanvasLink[]; canvasWallpaper?: string; canvasWallpaperFit?: 'cover' | 'contain' | 'repeat'; canvasOutline?: CanvasOutlineItem[]; kanbanStatus?: 'todo' | 'doing' | 'done'; history?: NoteVersion[]; }
