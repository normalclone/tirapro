import { useCallback, useRef, useState } from 'react';
import { toDraft, type EnvironmentDraft } from '@/features/issue-edit/environment';
import { loadDetailsOpen, saveDetailsOpen } from './useReportDraft';

/** Trạng thái khối "Thêm chi tiết": đóng/mở (nhớ theo người), mức nghiêm trọng, môi trường, tệp đính kèm. */
export function useReportDetails(initialFiles: File[] = []) {
  // Có tệp mang sang từ form khác → mở sẵn khối để người dùng thấy tệp của mình.
  const [open, setOpen] = useState(() => initialFiles.length > 0 || loadDetailsOpen());
  const [severityId, setSeverityId] = useState('');
  const [envDraft, setEnvDraft] = useState(() => toDraft(null));
  const [envError, setEnvError] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>(initialFiles);
  const severityTouched = useRef(false);

  const updateEnv = useCallback((u: (d: EnvironmentDraft) => EnvironmentDraft) => {
    setEnvError(null);
    setEnvDraft(u);
  }, []);
  const toggle = () => {
    saveDetailsOpen(!open);
    setOpen(!open);
  };
  return {
    open,
    toggle,
    envDraft,
    files,
    /** Ảnh dán (Ctrl+V) vào ô mô tả: gom vào tệp đính kèm và mở khối để người dùng thấy thumbnail. */
    pasteFiles: (fs: File[]) => {
      setFiles((prev) => [...prev, ...fs]);
      setOpen(true);
    },
    /** Môi trường sai định dạng: mở khối ra và báo lỗi tại ô. */
    showEnvError: (m: string) => {
      setOpen(true);
      setEnvError(m);
    },
    /** Props cho `<ReportDetails />`. */
    props: {
      severityId,
      onSeverity: setSeverityId,
      severityTouched,
      envDraft,
      onEnvDraft: updateEnv,
      envError,
      onEnvChange: (k: keyof EnvironmentDraft) => (v: string) =>
        updateEnv((d) => ({ ...d, [k]: v })),
      files,
      onFiles: setFiles,
    },
  };
}
