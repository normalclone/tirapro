import { useCallback, useRef, useState } from 'react';
import { toDraft, type EnvironmentDraft } from '@/features/issue-edit/environment';
import { loadDetailsOpen, saveDetailsOpen } from './useReportDraft';

/** Trạng thái khối "Thêm chi tiết": đóng/mở (nhớ theo người), mức nghiêm trọng, môi trường, tệp đính kèm. */
export function useReportDetails() {
  const [open, setOpen] = useState(loadDetailsOpen);
  const [severityId, setSeverityId] = useState('');
  const [envDraft, setEnvDraft] = useState(() => toDraft(null));
  const [envError, setEnvError] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
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
