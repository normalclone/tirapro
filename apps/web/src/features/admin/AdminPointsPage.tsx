import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  DIFFICULTIES,
  DIFFICULTY_LABELS,
  explainPoints,
  type Difficulty,
  type PointsFormula,
} from '@tirapro/shared';
import { PageFrame } from '@/components/layout/PageFrame';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { QueryError } from '@/components/ui/QueryError';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { Skeleton } from '@/components/ui/primitives';
import { apiErrorMessage } from '@/lib/api';
import { ADMIN_LABELS } from '@/lib/navLabels';
import { useUnsavedChanges } from '@/lib/useUnsavedChanges';
import { useAdminPointsFormula, useSavePointsFormula } from './api';
import {
  BASE_KEYS,
  BASE_LABELS,
  DEFAULT_DRAFT,
  PRIORITY_NAMES,
  draftErrors,
  draftToFormula,
  fieldKey,
  isDraftDirty,
  toDraft,
  type FormulaDraft,
  type FormulaGroup,
  type FormulaKey,
} from './pointsFormulaForm';

export const POINTS_SAVED_TOAST = 'Đã lưu — đang tính lại điểm toàn hệ thống';

/** Một bảng nhỏ: cột tên + cột hệ số (ô nhập tự do, lời lỗi ngay dưới ô sai). */
function CoefTable({
  title,
  hint,
  group,
  rows,
  draft,
  errors,
  onChange,
  disabled,
}: {
  title: string;
  hint: string;
  group: FormulaGroup;
  rows: ReadonlyArray<{ name: string; label: string }>;
  draft: FormulaDraft;
  errors: Partial<Record<FormulaKey, string>>;
  onChange: (key: FormulaKey, value: string) => void;
  disabled: boolean;
}) {
  return (
    <section className="py-5 first:pt-0 last:pb-0">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      <p className="mt-0.5 text-xs text-muted">{hint}</p>
      <table className="mt-3 w-full max-w-sm text-sm">
        <thead className="sr-only">
          <tr>
            <th scope="col">Tên</th>
            <th scope="col">Hệ số</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const key = fieldKey(group, r.name);
            const err = errors[key];
            return (
              <tr key={key}>
                <th scope="row" className="py-1 pr-4 text-left align-top font-normal text-ink">
                  <span className="mt-2 inline-block">{r.label}</span>
                </th>
                <td className="py-1">
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={draft[key] ?? ''}
                    onChange={(e) => onChange(key, e.target.value)}
                    aria-label={`${title}: ${r.label}`}
                    invalid={err}
                    disabled={disabled}
                    className="tabular w-24"
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

const TYPE_OPTIONS = BASE_KEYS.map((k) => ({ value: k, label: BASE_LABELS[k] }));
const DIFFICULTY_OPTIONS = DIFFICULTIES.map((d) => ({ value: d, label: DIFFICULTY_LABELS[d] }));
const PRIORITY_OPTIONS = PRIORITY_NAMES.map((p) => ({ value: p, label: p }));

/** Dòng ví dụ sống: chọn loại/độ khó/ưu tiên, thấy ngay điểm theo bảng đang gõ (chưa lưu). */
function ExampleRow({ formula }: { formula: PointsFormula | null }) {
  const [type, setType] = useState<(typeof BASE_KEYS)[number]>('BUG');
  const [difficulty, setDifficulty] = useState<Difficulty>('HARD');
  const [priority, setPriority] = useState<(typeof PRIORITY_NAMES)[number]>('High');
  return (
    <section className="border-t border-border pt-5" aria-label="Ví dụ">
      <h2 className="text-sm font-semibold text-ink">Thử một ví dụ</h2>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <SearchSelect
          value={type}
          onChange={(v) => v && setType(v as typeof type)}
          options={TYPE_OPTIONS}
          ariaLabel="Ví dụ: loại việc"
          className="h-8 w-32"
        />
        <SearchSelect
          value={difficulty}
          onChange={(v) => v && setDifficulty(v as Difficulty)}
          options={DIFFICULTY_OPTIONS}
          ariaLabel="Ví dụ: độ khó"
          className="h-8 w-32"
        />
        <SearchSelect
          value={priority}
          onChange={(v) => v && setPriority(v as typeof priority)}
          options={PRIORITY_OPTIONS}
          ariaLabel="Ví dụ: mức ưu tiên"
          className="h-8 w-32"
        />
      </div>
      <p className="tabular mt-3 text-base font-medium text-ink-strong" aria-live="polite">
        {formula
          ? explainPoints(formula, type, BASE_LABELS[type], difficulty, priority)
          : 'Sửa các ô đang báo lỗi để xem ví dụ.'}
      </p>
    </section>
  );
}

/** Quản trị hệ thống → Cách tính điểm: điểm = gốc theo loại × hệ số độ khó × hệ số ưu tiên (làm tròn). */
export function AdminPointsPage() {
  const { data, isLoading, isError, error, refetch } = useAdminPointsFormula();
  const save = useSavePointsFormula();
  const [draft, setDraft] = useState<FormulaDraft>(DEFAULT_DRAFT);

  // Nạp từ máy chủ; đang gõ dở (bản nháp khác bản đã lưu) thì không đè.
  const [loaded, setLoaded] = useState<PointsFormula | null>(null);
  useEffect(() => {
    if (!data) return;
    setDraft((cur) => (loaded && isDraftDirty(cur, loaded) ? cur : toDraft(data)));
    setLoaded(data);
    // `loaded` chỉ để so sánh; chạy lại khi máy chủ trả bản mới
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const errors = useMemo(() => draftErrors(draft), [draft]);
  const formula = useMemo(() => draftToFormula(draft), [draft]);
  const dirty = !!loaded && isDraftDirty(draft, loaded);
  const canSave = dirty && !!formula && !save.isPending;

  function onSave() {
    if (!formula) return;
    save.mutate(formula, {
      onSuccess: () => toast.success(POINTS_SAVED_TOAST),
      onError: (e) => toast.error(apiErrorMessage(e)),
    });
  }

  useUnsavedChanges({
    dirty,
    saving: save.isPending,
    canSave,
    onSave,
    onReset: () => loaded && setDraft(toDraft(loaded)),
    description: 'Bảng hệ số điểm bạn vừa sửa chưa được lưu.',
  });

  const header = (
    <PageHeader
      title={ADMIN_LABELS.points}
      description="Điểm của một việc = điểm gốc theo loại × hệ số độ khó × hệ số ưu tiên, làm tròn thành số nguyên. Việc có việc con thì điểm bằng tổng điểm các việc con; Epic là tổng điểm các việc trong Epic — hai loại này không dùng bảng hệ số."
    />
  );
  if (isError) {
    return (
      <PageFrame size="lg">
        {header}
        <QueryError error={error} onRetry={() => void refetch()} />
      </PageFrame>
    );
  }
  if (isLoading || !data) {
    return (
      <PageFrame size="lg">
        {header}
        <Skeleton className="h-96 w-full" />
      </PageFrame>
    );
  }

  const set = (key: FormulaKey, value: string) => setDraft((d) => ({ ...d, [key]: value }));
  const busy = save.isPending;
  return (
    <PageFrame size="lg">
      {header}
      <div className="rounded-lg border border-border bg-surface p-5">
        <div className="divide-y divide-border">
          <CoefTable
            title="Điểm gốc theo loại"
            hint="Loại tuỳ chỉnh dùng điểm gốc của Task."
            group="base"
            rows={BASE_KEYS.map((k) => ({ name: k, label: BASE_LABELS[k] }))}
            draft={draft}
            errors={errors}
            onChange={set}
            disabled={busy}
          />
          <CoefTable
            title="Hệ số độ khó"
            hint="Mỗi việc chọn một độ khó; mặc định Trung bình."
            group="difficulty"
            rows={DIFFICULTIES.map((d) => ({ name: d, label: DIFFICULTY_LABELS[d] }))}
            draft={draft}
            errors={errors}
            onChange={set}
            disabled={busy}
          />
          <CoefTable
            title="Hệ số ưu tiên"
            hint="Theo tên mức ưu tiên hệ thống; mức khác hoặc không đặt ưu tiên tính hệ số 1."
            group="priority"
            rows={PRIORITY_NAMES.map((p) => ({ name: p, label: p }))}
            draft={draft}
            errors={errors}
            onChange={set}
            disabled={busy}
          />
          <ExampleRow formula={formula} />
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button onClick={onSave} disabled={!canSave} aria-busy={busy || undefined}>
          {busy ? 'Đang lưu…' : 'Lưu bảng hệ số'}
        </Button>
        <Button variant="ghost" onClick={() => setDraft(DEFAULT_DRAFT)} disabled={busy}>
          Khôi phục mặc định
        </Button>
        <p className="text-xs text-muted">
          Lưu sẽ tính lại điểm mọi việc trên toàn hệ thống, trừ việc đã được chỉnh tay.
        </p>
      </div>
    </PageFrame>
  );
}
