import { Input } from '@/components/ui/Input';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { ENV_KIND_LABEL, type EnvironmentDraft } from './environment';

const KIND_OPTIONS = [
  { value: '', label: '—' },
  ...Object.entries(ENV_KIND_LABEL).map(([value, label]) => ({ value, label })),
];

function Field({
  id,
  label,
  className,
  children,
}: {
  id: string;
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-muted">
        {label}
      </label>
      {children}
    </div>
  );
}

/**
 * Sáu ô môi trường của Bug (loại, build, trình duyệt, hệ điều hành, màn hình, URL) — dùng chung cho khối
 * "Môi trường" ở trang công việc và form Báo lỗi. Chỉ trình bày: trạng thái do nơi gọi giữ.
 */
export function EnvironmentFields({
  idPrefix,
  draft,
  onChange,
  invalid,
}: {
  idPrefix: string;
  draft: EnvironmentDraft;
  onChange: (k: keyof EnvironmentDraft) => (v: string) => void;
  /** Đánh dấu ô URL không hợp lệ (nơi gọi hiển thị thông báo). */
  invalid?: boolean;
}) {
  const id = (k: string) => `${idPrefix}-${k}`;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field id={id('kind')} label="Loại môi trường">
        <SearchSelect
          id={id('kind')}
          ariaLabel="Loại môi trường"
          value={draft.env}
          options={KIND_OPTIONS}
          onChange={onChange('env')}
          placeholder="—"
        />
      </Field>
      <Field id={id('build')} label="Build / phiên bản">
        <Input
          id={id('build')}
          value={draft.build}
          maxLength={120}
          placeholder="vd 2.3.1"
          onChange={(e) => onChange('build')(e.target.value)}
        />
      </Field>
      <Field id={id('browser')} label="Trình duyệt">
        <Input
          id={id('browser')}
          value={draft.browser}
          maxLength={120}
          placeholder="vd Chrome 126"
          onChange={(e) => onChange('browser')(e.target.value)}
        />
      </Field>
      <Field id={id('os')} label="Hệ điều hành">
        <Input
          id={id('os')}
          value={draft.os}
          maxLength={120}
          placeholder="vd macOS 14"
          onChange={(e) => onChange('os')(e.target.value)}
        />
      </Field>
      <Field id={id('viewport')} label="Kích thước màn hình">
        <Input
          id={id('viewport')}
          value={draft.viewport}
          maxLength={20}
          placeholder="vd 1440×900"
          onChange={(e) => onChange('viewport')(e.target.value)}
        />
      </Field>
      <Field id={id('url')} label="URL" className="sm:col-span-2">
        <Input
          id={id('url')}
          type="url"
          value={draft.url}
          maxLength={500}
          placeholder="https://…"
          aria-invalid={invalid ? true : undefined}
          onChange={(e) => onChange('url')(e.target.value)}
        />
      </Field>
    </div>
  );
}
