import { normalizeEnvironment, type EnvironmentInput } from '@tirapro/shared';

/** Loại yêu cầu của form "Báo lỗi / Gửi yêu cầu" (khớp `kind` của POST /intake/report). */
export type RequestKind = 'BUG' | 'FEATURE' | 'QUESTION';

export const REPORT_KINDS: readonly RequestKind[] = ['BUG', 'FEATURE', 'QUESTION'];

const REPORT_TEMPLATES: Record<RequestKind, string> = {
  BUG: 'Các bước tái hiện:\n1. \n2. \n3. \n\nKết quả hiện tại:\n\nKết quả mong muốn:\n',
  FEATURE: 'Bạn muốn làm được gì:\n\nVì sao cần (bối cảnh, khách hàng nào):\n',
  QUESTION: 'Câu hỏi:\n\nBối cảnh:\n',
};

const KIND_LABEL: Record<RequestKind, string> = {
  BUG: 'Bug',
  FEATURE: 'Yêu cầu tính năng',
  QUESTION: 'Câu hỏi',
};

export const reportTemplate = (k: RequestKind): string => REPORT_TEMPLATES[k];
export const isReportTemplate = (s: string): boolean => Object.values(REPORT_TEMPLATES).includes(s);
export const reportKindLabel = (k: RequestKind): string => KIND_LABEL[k];

export interface ReportFormState {
  projectId: string;
  kind: RequestKind;
  summary: string;
  description: string;
  severityId: string;
  environment: EnvironmentInput;
  mergeIntoIssueId: string | null;
  forceNew: boolean;
}

export interface ReportPayload {
  projectId: string;
  kind: RequestKind;
  summary: string;
  description?: string;
  severityId?: string;
  environment?: EnvironmentInput;
  mergeIntoIssueId?: string;
  forceNew?: boolean;
}

/** Cần dự án + tiêu đề ≥ 3 ký tự sau trim (khớp schema BE). */
export const canSubmitReport = (f: ReportFormState): boolean =>
  !!f.projectId && f.summary.trim().length >= 3;

/**
 * Body gửi `POST /intake/report`. Mô tả chỉ còn mẫu thì bỏ; Severity + Môi trường chỉ có ý nghĩa với Bug
 * (các loại khác không gửi, dù người dùng đã chọn rồi đổi loại); khoá rỗng bị lược.
 */
export function buildReportPayload(f: ReportFormState): ReportPayload {
  const description =
    f.description.trim() && !isReportTemplate(f.description) ? f.description : undefined;
  const env = f.kind === 'BUG' ? normalizeEnvironment(f.environment) : null;
  return {
    projectId: f.projectId,
    kind: f.kind,
    summary: f.summary.trim(),
    ...(description ? { description } : {}),
    ...(f.kind === 'BUG' && f.severityId ? { severityId: f.severityId } : {}),
    ...(env ? { environment: env } : {}),
    ...(f.mergeIntoIssueId
      ? { mergeIntoIssueId: f.mergeIntoIssueId }
      : f.forceNew
        ? { forceNew: true }
        : {}),
  };
}

/** Tiêu đề hộp: "Báo lỗi" cho Bug, "Gửi yêu cầu" cho loại khác. */
export const reportDialogTitle = (k: RequestKind): string =>
  k === 'BUG' ? 'Báo lỗi' : 'Gửi yêu cầu';

/** Bản nháp: chỉ lưu khi có chữ thật (tiêu đề hoặc mô tả không phải mẫu). */
export interface ReportDraft {
  kind?: RequestKind;
  summary?: string;
  description?: string;
}

export function hasDraftContent(d: ReportDraft): boolean {
  return !!d.summary?.trim() || (!!d.description?.trim() && !isReportTemplate(d.description));
}
