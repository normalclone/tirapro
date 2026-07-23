import { create } from 'zustand';

/** Ngữ cảnh mở popup tạo issue (mở được ở bất kỳ đâu). */
export interface CreateIssuePreset {
  /** Dự án chọn sẵn (key). */
  projectKey?: string;
  /** Tạo sub-task của issue này. */
  parentId?: string;
  /** Ưu tiên loại sub-task khi mở. */
  subtask?: boolean;
}

interface CreateIssueModalState {
  open: boolean;
  preset: CreateIssuePreset;
  openCreate: (preset?: CreateIssuePreset) => void;
  close: () => void;
}

/**
 * Điều khiển popup "Tạo issue" toàn cục. Bất kỳ chỗ nào cũng gọi `openCreate({...})`
 * để mở; modal được gắn một lần ở khung ứng dụng.
 */
export const useCreateIssueModal = create<CreateIssueModalState>((set) => ({
  open: false,
  preset: {},
  openCreate: (preset = {}) => set({ open: true, preset }),
  close: () => set({ open: false }),
}));
