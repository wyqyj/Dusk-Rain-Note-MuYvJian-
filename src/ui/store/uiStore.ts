import { create } from 'zustand';

interface UIStore {
  searchQuery: string;
  filterTag: string | null;
  filterTags: string[];
  showTodayPlan: boolean;
  showKanban: boolean;
  showWorkbench: boolean;
  sortBy: 'updatedAt' | 'createdAt' | 'title' | 'deadline';
  sortDirection: 'asc' | 'desc';
  setSearchQuery: (query: string) => void;
  setFilterTag: (tag: string | null) => void;
  setFilterTags: (tags: string[]) => void;
  toggleFilterTag: (tag: string) => void;
  clearFilterTags: () => void;
  setShowTodayPlan: (show: boolean) => void;
  setShowKanban: (show: boolean) => void;
  setShowWorkbench: (show: boolean) => void;
  setSortBy: (by: 'updatedAt' | 'createdAt' | 'title' | 'deadline') => void;
  setSortDirection: (dir: 'asc' | 'desc') => void;
}

export const useUIStore = create<UIStore>((set, get) => ({
  searchQuery: '',
  filterTag: null,
  filterTags: [],
  showTodayPlan: false,
  showKanban: false,
  showWorkbench: true,
  sortBy: 'updatedAt',
  sortDirection: 'desc',
  setSearchQuery: (query) => set({ searchQuery: query }),
  setFilterTag: (tag) => set({ filterTag: tag, filterTags: tag ? [tag] : [] }),
  setFilterTags: (tags) => set({ filterTags: tags, filterTag: tags.length === 1 ? tags[0] : null }),
  toggleFilterTag: (tag) => {
    const current = get().filterTags;
    const next = current.includes(tag)
      ? current.filter(t => t !== tag)
      : [...current, tag];
    set({ filterTags: next, filterTag: next.length === 1 ? next[0] : null });
  },
  clearFilterTags: () => set({ filterTags: [], filterTag: null }),
  setShowTodayPlan: (show) => set({ showTodayPlan: show }),
  setShowKanban: (show) => set({ showKanban: show }),
  setShowWorkbench: (show) => set({ showWorkbench: show }),
  setSortBy: (sortBy) => set({ sortBy }),
  setSortDirection: (sortDirection) => set({ sortDirection }),
}));
