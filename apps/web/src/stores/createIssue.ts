import { create } from 'zustand';

/** Ngữ cảnh mở popup tạo issue (mở được ở bất kỳ đâu). */
interface CreateIssuePreset {
  /** Dự án chọn sẵn (key). */
  projectKey?: string;
  /** Dự án hiện tại đã lưu trữ → để ô Dự án TRỐNG, focus ô đó kèm gợi ý (không tự chọn dự án nào). */
  pickProject?: boolean;
  /** Tạo sub-task của issue này. */
  parentId?: string;
  /** Ưu tiên loại sub-task khi mở. */
  subtask?: boolean;
  /** Điền sẵn tiêu đề (giữ nguyên token `! @ # ~ ^` — hộp tự áp). Có giá trị này thì KHÔNG khôi phục bản nháp cũ. */
  summary?: string;
  /** Chọn sẵn loại việc (id thuộc dự án `projectKey`) — dùng cùng `projectKey`. */
  typeId?: string;
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
