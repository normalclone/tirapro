import { create } from 'zustand';

export interface RecentIssue {
  key: string;
  summary: string;
}

const LS_KEY = 'tirapro:recentIssues';
const MAX = 8;

function load(): RecentIssue[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((x) => x && typeof x.key === 'string').slice(0, MAX) : [];
  } catch {
    return [];
  }
}

interface RecentsState {
  items: RecentIssue[];
  /** Ghi 1 issue vừa mở lên đầu danh sách (dedup theo key, giữ tối đa 8). */
  record: (issue: RecentIssue) => void;
  clear: () => void;
}

/** Danh sách issue xem gần đây (lưu localStorage) — dùng cho Cmd+K & Trang tổng quan. */
export const useRecents = create<RecentsState>((set, get) => ({
  items: load(),
  record: (issue) => {
    if (!issue.key) return;
    const cur = get().items;
    // Không cập nhật nếu đã ở đầu với cùng tiêu đề (tránh set state thừa).
    if (cur[0]?.key === issue.key && cur[0]?.summary === issue.summary) return;
    const next = [{ key: issue.key, summary: issue.summary }, ...cur.filter((x) => x.key !== issue.key)].slice(0, MAX);
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(next));
    } catch {
      /* ignore quota */
    }
    set({ items: next });
  },
  clear: () => {
    try {
      localStorage.removeItem(LS_KEY);
    } catch {
      /* ignore */
    }
    set({ items: [] });
  },
}));
