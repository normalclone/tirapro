import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from 'react';

/**
 * Sổ "nội dung chưa lưu" của một hộp thoại sửa: các form con (thêm trạng thái, thêm chuyển tiếp…) báo mình đang có bản nháp
 * (`useReportDraft`); hộp thoại hỏi xác nhận trước khi đóng nếu còn bản nháp. Ngoài hộp thoại thì không làm gì.
 */
interface DraftRegistry {
  report: (key: string, dirty: boolean) => void;
  hasDrafts: () => boolean;
}

const Ctx = createContext<DraftRegistry['report'] | null>(null);

export function useDraftRegistry(): DraftRegistry {
  const set = useRef(new Set<string>());
  const report = useCallback((key: string, dirty: boolean) => {
    if (dirty) set.current.add(key);
    else set.current.delete(key);
  }, []);
  return { report, hasDrafts: () => set.current.size > 0 };
}

export function DraftProvider({
  registry,
  children,
}: {
  registry: DraftRegistry;
  children: ReactNode;
}) {
  return <Ctx.Provider value={registry.report}>{children}</Ctx.Provider>;
}

/** Báo cho hộp thoại bao quanh biết form này đang có nội dung chưa lưu. */
export function useReportDraft(dirty: boolean) {
  const key = useId();
  const report = useContext(Ctx);
  useEffect(() => {
    report?.(key, dirty);
    return () => report?.(key, false);
  }, [key, dirty, report]);
}
