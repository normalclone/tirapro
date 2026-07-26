import { useId, type ReactNode } from 'react';
import { Input } from '@/components/ui/Input';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { MarkdownEditor } from '@/features/issue-edit/DescriptionEditor';
import { useProjectMeta } from '@/features/ai/api';
import type { IssuePayload } from './api';

/** Nhãn + trường nhập + câu gợi ý, dùng chung cho các hộp thoại của trang Tự động hoá. */
export function Field({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-muted">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-faint">{hint}</p>}
    </div>
  );
}

/**
 * Nội dung điền sẵn của công việc (loại, độ ưu tiên, tiêu đề, mô tả) — dùng chung cho
 * mẫu công việc và công việc lặp lại. Loại & độ ưu tiên lấy theo cấu hình workspace qua
 * `/projects/:key/meta`; cần một mã dự án bất kỳ để nạp.
 */
export function IssueDefaultsFields({
  projectKey,
  value,
  onChange,
  summaryPlaceholder = 'Tiêu đề sẽ được điền sẵn…',
  summaryHint,
}: {
  projectKey: string | undefined;
  value: IssuePayload;
  onChange: (next: IssuePayload) => void;
  summaryPlaceholder?: string;
  summaryHint?: string;
}) {
  const { data: meta, isLoading } = useProjectMeta(projectKey);
  const uid = useId();
  const set = (patch: Partial<IssuePayload>) => onChange({ ...value, ...patch });

  const typeOptions = (meta?.issueTypes ?? []).map((t) => ({ value: t.id, label: t.name, color: t.color }));
  const priorityOptions = [
    { value: '', label: 'Mặc định của workspace' },
    ...(meta?.priorities ?? []).map((p) => ({ value: p.id, label: p.name, color: p.color })),
  ];

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Loại công việc" htmlFor={`${uid}-type`}>
          <SearchSelect
            id={`${uid}-type`}
            value={value.typeId ?? ''}
            onChange={(v) => set({ typeId: v || null })}
            options={typeOptions}
            placeholder={isLoading ? 'Đang tải…' : 'Chọn loại…'}
            searchPlaceholder="Tìm loại…"
            ariaLabel="Loại công việc"
            disabled={!projectKey}
          />
        </Field>
        <Field label="Độ ưu tiên" htmlFor={`${uid}-priority`}>
          <SearchSelect
            id={`${uid}-priority`}
            value={value.priorityId ?? ''}
            onChange={(v) => set({ priorityId: v || null })}
            options={priorityOptions}
            placeholder="Mặc định của workspace"
            searchPlaceholder="Tìm độ ưu tiên…"
            ariaLabel="Độ ưu tiên"
            disabled={!projectKey}
          />
        </Field>
      </div>

      <Field label="Tiêu đề điền sẵn" htmlFor={`${uid}-summary`} hint={summaryHint}>
        <Input
          id={`${uid}-summary`}
          value={value.summary ?? ''}
          onChange={(e) => set({ summary: e.target.value })}
          placeholder={summaryPlaceholder}
          maxLength={255}
        />
      </Field>

      <Field label="Mô tả điền sẵn" hint="Ví dụ: các bước cần làm, thông tin phải thu thập. Người tạo việc vẫn sửa được.">
        <MarkdownEditor
          value={value.description ?? ''}
          onChange={(v) => set({ description: v })}
          rows={6}
          placeholder="Nội dung điền sẵn — hỗ trợ Markdown cơ bản (# tiêu đề, **đậm**, - gạch đầu dòng)…"
        />
      </Field>
    </>
  );
}
