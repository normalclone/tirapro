import { create } from 'zustand';

interface CreateDialogsState {
  projectOpen: boolean;
  aiOpen: boolean;
  openProject: () => void;
  openAi: () => void;
  closeProject: () => void;
  closeAi: () => void;
}

/**
 * Điều khiển hai hộp thoại "Tạo dự án" và "Tạo bằng AI" mở từ nút nổi (desktop) lẫn sheet "Tạo" (mobile).
 * Hộp thoại được mount một lần ở khung ứng dụng (`CreateDialogsHost`) — nút nổi không còn mount dưới `lg`.
 */
export const useCreateDialogs = create<CreateDialogsState>((set) => ({
  projectOpen: false,
  aiOpen: false,
  openProject: () => set({ projectOpen: true }),
  openAi: () => set({ aiOpen: true }),
  closeProject: () => set({ projectOpen: false }),
  closeAi: () => set({ aiOpen: false }),
}));
