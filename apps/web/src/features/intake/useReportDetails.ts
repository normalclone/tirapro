import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProjectMeta } from '@/features/ai/api';
import {
  detectEnvironment,
  mergeDetected,
  toDraft,
  type EnvironmentDraft,
} from '@/features/issue-edit/environment';
import { defaultSeverityId } from '@/features/issue-edit/severity';

/**
 * Chi tiết của báo cáo: mức nghiêm trọng, môi trường, tệp đính kèm. Chạy ở CẢ hai chế độ: Bug luôn được chọn sẵn mức
 * mặc định (trừ khi người dùng tự bỏ chọn) và tự ghi môi trường từ phiên hiện tại (chỉ khi các ô còn trống) — nên chế độ Cơ bản
 * gửi đủ thông tin dù người dùng không mở Nâng cao. `onNeedAdvanced`: có lỗi cần người dùng sửa ở khối Nâng cao.
 */
export function useReportDetails({
  initialFiles = [],
  isBug,
  meta,
  onNeedAdvanced,
}: {
  initialFiles?: File[];
  isBug: boolean;
  meta: ProjectMeta | undefined;
  onNeedAdvanced: () => void;
}) {
  const [severityId, setSeverityId] = useState('');
  const [envDraft, setEnvDraft] = useState(() => toDraft(null));
  const [envError, setEnvError] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>(initialFiles);
  const severityTouched = useRef(false);

  const updateEnv = useCallback((u: (d: EnvironmentDraft) => EnvironmentDraft) => {
    setEnvError(null);
    setEnvDraft(u);
  }, []);

  useEffect(() => {
    if (isBug && meta && !severityTouched.current && !severityId)
      setSeverityId(defaultSeverityId(meta.severities) ?? '');
  }, [isBug, meta, severityId]);

  const envFilled = useRef(false);
  useEffect(() => {
    if (!isBug || envFilled.current) return;
    envFilled.current = true;
    setEnvDraft((d) =>
      Object.values(d).some(Boolean)
        ? d
        : mergeDetected(d, detectEnvironment(navigator, window.screen, window.location)),
    );
  }, [isBug]);

  return {
    envDraft,
    files,
    /** Ảnh dán (Ctrl+V) vào ô mô tả: gom vào tệp đính kèm (cả hai chế độ đều hiện thumbnail). */
    pasteFiles: (fs: File[]) => setFiles((prev) => [...prev, ...fs]),
    /** Môi trường sai định dạng: chuyển sang Nâng cao và báo lỗi tại ô. */
    showEnvError: (m: string) => {
      onNeedAdvanced();
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
