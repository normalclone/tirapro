import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { ReportIssuePreset } from '@/stores/reportIssue';
import { hasDraftContent, reportTemplate, type ReportDraft, type RequestKind } from './reportForm';

const DRAFT_KEY = (projectKey: string) => `tirapro:report-draft:${projectKey || '_'}`;
const DETAILS_KEY = 'tirapro:report:details';

function loadDraft(projectKey: string): ReportDraft {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_KEY(projectKey)) || '{}') as ReportDraft;
  } catch {
    return {};
  }
}
function saveDraft(projectKey: string, d: ReportDraft) {
  try {
    if (hasDraftContent(d)) localStorage.setItem(DRAFT_KEY(projectKey), JSON.stringify(d));
    else localStorage.removeItem(DRAFT_KEY(projectKey));
  } catch {
    /* storage bị chặn */
  }
}
export function clearDraft(projectKey: string) {
  try {
    localStorage.removeItem(DRAFT_KEY(projectKey));
  } catch {
    /* storage bị chặn */
  }
}
export function loadDetailsOpen(): boolean {
  try {
    return localStorage.getItem(DETAILS_KEY) === '1';
  } catch {
    return false;
  }
}
export function saveDetailsOpen(v: boolean) {
  try {
    localStorage.setItem(DETAILS_KEY, v ? '1' : '0');
  } catch {
    /* storage bị chặn */
  }
}

/**
 * Giá trị khởi tạo của form: preset > bản nháp của dự án đích. Chữ preset (vd từ form Tạo việc) thắng bản nháp.
 * Báo "đã khôi phục" một lần khi nạp lại nháp.
 */
export function useReportInitial(
  open: boolean,
  preset: ReportIssuePreset,
  targetKey: string | undefined,
) {
  const [initial] = useState(() => {
    const key = preset.projectKey ?? targetKey ?? '';
    const draft: ReportDraft =
      preset.summary != null || preset.description != null ? {} : loadDraft(key);
    const kind: RequestKind = preset.kind ?? draft.kind ?? 'BUG';
    return {
      key,
      kind,
      summary: preset.summary ?? draft.summary ?? '',
      description: preset.description ?? draft.description ?? reportTemplate(kind),
      restored: hasDraftContent(draft),
    };
  });
  useEffect(() => {
    if (open && initial.restored) toast.info('Đã khôi phục nội dung bạn nhập dở lần trước');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return initial;
}

/**
 * Tự lưu bản nháp theo dự án (UX_CONVENTIONS #17) — chỉ khi đang mở và có chữ thật; lưu NGAY khi đóng hộp
 * (không rơi nháp của <400ms gõ cuối). `discard()` xoá nháp và huỷ lần lưu đang chờ (gọi sau khi gửi thành công).
 */
export function useDraftAutosave(open: boolean, projectKey: string, draft: ReportDraft) {
  const { kind, summary, description } = draft;
  const latest = useRef({ projectKey, draft: { kind, summary, description } });
  latest.current = { projectKey, draft: { kind, summary, description } };
  const dirty = useRef(false);

  useEffect(() => {
    if (!open) return;
    dirty.current = true;
    const t = setTimeout(() => {
      saveDraft(latest.current.projectKey, latest.current.draft);
      dirty.current = false;
    }, 400);
    return () => clearTimeout(t);
  }, [open, projectKey, kind, summary, description]);

  // Đóng hộp (hoặc rời trang) khi còn lần lưu chờ → lưu ngay.
  useEffect(() => {
    const flush = () => {
      if (!dirty.current) return;
      dirty.current = false;
      saveDraft(latest.current.projectKey, latest.current.draft);
    };
    if (!open) flush();
    return flush;
  }, [open]);

  return {
    discard: () => {
      dirty.current = false;
      clearDraft(latest.current.projectKey);
    },
  };
}
