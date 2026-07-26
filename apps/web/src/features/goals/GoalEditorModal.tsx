import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { PeoplePicker, type PersonOption } from '@/components/ui/PeoplePicker';
import { apiErrorMessage } from '@/lib/api';
import { useProjects } from '@/features/projects/api';
import { useWorkspaceUsers } from '@/features/members/api';
import {
  useCreateGoal, useUpdateGoal,
  type GoalDto, type KeyResultInput, type KeyResultUnit, type ObjectiveStatus,
} from './api';

const STATUS_OPTIONS: { value: ObjectiveStatus; label: string }[] = [
  { value: 'DRAFT', label: 'Nháp' },
  { value: 'ACTIVE', label: 'Đang theo đuổi' },
  { value: 'CLOSED', label: 'Đã chốt' },
];

const UNIT_OPTIONS: { value: KeyResultUnit; label: string }[] = [
  { value: 'NUMBER', label: 'Số' },
  { value: 'PERCENT', label: 'Phần trăm' },
  { value: 'CURRENCY', label: 'Tiền' },
];

interface DraftKr extends KeyResultInput {
  /** Khoá React ổn định cho dòng chưa lưu. */
  rowKey: string;
}

let rowSeq = 0;
function newRow(): DraftKr {
  rowSeq += 1;
  return { rowKey: `new-${rowSeq}`, name: '', unit: 'NUMBER', startValue: 0, targetValue: 100, currentValue: 0 };
}

function Field({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-muted">
        {label}
        {hint && <span className="font-normal text-faint"> {hint}</span>}
      </label>
      {children}
    </div>
  );
}

/** Gợi ý kỳ theo quý hiện tại và 3 quý kế tiếp (vd 2026-Q3). */
function suggestPeriods(): string[] {
  const now = new Date();
  const out: string[] = [];
  let year = now.getFullYear();
  let quarter = Math.floor(now.getMonth() / 3) + 1;
  for (let i = 0; i < 4; i += 1) {
    out.push(`${year}-Q${quarter}`);
    quarter += 1;
    if (quarter > 4) { quarter = 1; year += 1; }
  }
  return out;
}

/** Modal tạo/sửa mục tiêu (OKR) — thông tin chung + danh sách kết quả then chốt. */
export function GoalEditorModal({
  open, goal, defaultPeriod, onClose,
}: {
  open: boolean;
  goal?: GoalDto | null;
  defaultPeriod?: string;
  onClose: () => void;
}) {
  const { data: projects } = useProjects();
  const { data: users } = useWorkspaceUsers();
  const create = useCreateGoal();
  const update = useUpdateGoal();
  const editing = !!goal;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [period, setPeriod] = useState('');
  const [status, setStatus] = useState<ObjectiveStatus>('ACTIVE');
  const [projectId, setProjectId] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [krs, setKrs] = useState<DraftKr[]>([]);

  useEffect(() => {
    if (!open) return;
    setName(goal?.name ?? '');
    setDescription(goal?.description ?? '');
    setPeriod(goal?.period ?? defaultPeriod ?? suggestPeriods()[0] ?? '');
    setStatus(goal?.status ?? 'ACTIVE');
    setProjectId(goal?.projectId ?? '');
    setOwnerId(goal?.owner?.id ?? '');
    setKrs(
      goal?.keyResults.map((kr) => ({
        rowKey: kr.id,
        id: kr.id,
        name: kr.name,
        unit: kr.unit,
        startValue: kr.startValue,
        targetValue: kr.targetValue,
        currentValue: kr.currentValue,
      })) ?? [newRow()],
    );
  }, [open, goal, defaultPeriod]);

  const projectOptions = useMemo(
    () => [
      { value: '', label: 'Toàn workspace' },
      ...(projects ?? []).map((p) => ({ value: p.id, label: p.name, hint: p.key })),
    ],
    [projects],
  );

  const periodOptions = useMemo(() => {
    const set = new Set<string>(suggestPeriods());
    if (period) set.add(period);
    if (defaultPeriod) set.add(defaultPeriod);
    return [...set].sort().reverse().map((p) => ({ value: p, label: p }));
  }, [period, defaultPeriod]);

  const people: PersonOption[] = useMemo(
    () =>
      (users ?? []).map((u) => ({
        id: u.id,
        name: u.displayName,
        avatarUrl: u.avatarUrl,
        email: u.email,
        search: `${u.displayName} ${u.email}`.toLowerCase(),
      })),
    [users],
  );

  if (!open) return null;

  const busy = create.isPending || update.isPending;
  const validKrs = krs.filter((kr) => kr.name.trim().length > 0);
  const canSave = name.trim().length > 0 && period.trim().length > 0 && !busy;

  function setKr(rowKey: string, patch: Partial<DraftKr>) {
    setKrs((prev) => prev.map((kr) => (kr.rowKey === rowKey ? { ...kr, ...patch } : kr)));
  }

  async function save() {
    if (!canSave) return;
    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      period: period.trim(),
      status,
      projectId: projectId || null,
      ownerId: ownerId || null,
      keyResults: validKrs.map((kr) => ({
        id: kr.id,
        name: kr.name.trim(),
        unit: kr.unit ?? 'NUMBER',
        startValue: Number(kr.startValue ?? 0),
        targetValue: Number(kr.targetValue ?? 0),
        currentValue: Number(kr.currentValue ?? 0),
      })),
    };
    try {
      if (editing && goal) {
        await update.mutateAsync({ id: goal.id, ...payload });
        toast.success('Đã lưu mục tiêu');
      } else {
        await create.mutateAsync(payload);
        toast.success('Đã tạo mục tiêu');
      }
      onClose();
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  return (
    <div className="fixed inset-0 z-modal flex items-start justify-center p-4 pt-[6vh]">
      <button className="absolute inset-0 bg-black/30 animate-in fade-in duration-200" onClick={onClose} aria-label="Đóng" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={editing ? 'Sửa mục tiêu' : 'Tạo mục tiêu'}
        className="relative flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-lg animate-in fade-in zoom-in-95 duration-200"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void save();
        }}
      >
        <header className="flex items-center gap-2 border-b border-border px-5 py-3">
          <span className="text-sm font-medium text-ink">{editing ? 'Sửa mục tiêu' : 'Tạo mục tiêu'}</span>
          <Button variant="ghost" size="icon" className="ml-auto" onClick={onClose} aria-label="Đóng">
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <Field label="Tên mục tiêu" htmlFor="goal-name">
            <Input
              id="goal-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="VD: Rút ngắn thời gian giao hàng xuống một nửa"
              autoFocus
              maxLength={160}
            />
          </Field>

          <Field label="Mô tả" hint="(tùy chọn)" htmlFor="goal-desc">
            <Input
              id="goal-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Vì sao mục tiêu này quan trọng?"
              maxLength={2000}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Kỳ" hint="(khoảng thời gian theo đuổi, vd 2026-Q3 là quý 3 năm 2026)" htmlFor="goal-period">
              <SearchSelect
                id="goal-period"
                value={period}
                onChange={setPeriod}
                options={periodOptions}
                ariaLabel="Kỳ"
                placeholder="Chọn kỳ"
                searchPlaceholder="Tìm kỳ…"
              />
            </Field>
            <Field label="Trạng thái" htmlFor="goal-status">
              <SearchSelect
                id="goal-status"
                value={status}
                onChange={(v) => setStatus(v as ObjectiveStatus)}
                options={STATUS_OPTIONS}
                ariaLabel="Trạng thái mục tiêu"
              />
            </Field>
            <Field label="Dự án" hint="(để trống = mục tiêu chung của cả workspace)" htmlFor="goal-project">
              <SearchSelect
                id="goal-project"
                value={projectId}
                onChange={setProjectId}
                options={projectOptions}
                ariaLabel="Dự án"
                placeholder="Toàn workspace"
                searchPlaceholder="Tìm dự án…"
              />
            </Field>
            <Field label="Người phụ trách" hint="(tùy chọn — người chịu trách nhiệm chính)" htmlFor="goal-owner">
              <PeoplePicker
                id="goal-owner"
                value={ownerId}
                onChange={setOwnerId}
                options={people}
                emptyLabel="Chưa chọn"
                ariaLabel="Người phụ trách mục tiêu"
              />
            </Field>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p
                className="text-sm font-medium text-muted"
                title="Thước đo bằng số cho biết mục tiêu đã đạt tới đâu. Nên có 2–4 kết quả cho mỗi mục tiêu."
              >
                Kết quả then chốt
              </p>
              <Button variant="ghost" size="sm" onClick={() => setKrs((prev) => [...prev, newRow()])}>
                <Plus className="h-4 w-4" /> Thêm kết quả
              </Button>
            </div>

            {krs.length === 0 ? (
              <p className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-faint">
                Chưa có kết quả then chốt nào. Bấm “Thêm kết quả” để đặt thước đo bằng số, hoặc thêm sau cũng được.
              </p>
            ) : (
              <ul className="space-y-2">
                {krs.map((kr) => (
                  <li key={kr.rowKey} className="rounded-md border border-border bg-bg p-2.5">
                    <div className="flex items-center gap-2">
                      <Input
                        value={kr.name}
                        onChange={(e) => setKr(kr.rowKey, { name: e.target.value })}
                        placeholder="VD: Thời gian phản hồi trung bình (phút)"
                        maxLength={160}
                        aria-label="Tên kết quả then chốt"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="shrink-0 text-muted hover:text-danger"
                        title="Xoá kết quả then chốt này khỏi mục tiêu"
                        aria-label={`Xoá kết quả then chốt ${kr.name || 'chưa đặt tên'}`}
                        onClick={() => setKrs((prev) => prev.filter((x) => x.rowKey !== kr.rowKey))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <label className="text-xs text-faint" title="Cách hiển thị số đo: số thường, phần trăm hay tiền">
                        Đơn vị
                        <SearchSelect
                          value={kr.unit ?? 'NUMBER'}
                          onChange={(v) => setKr(kr.rowKey, { unit: v as KeyResultUnit })}
                          options={UNIT_OPTIONS}
                          ariaLabel="Đơn vị của số đo"
                          className="mt-1"
                        />
                      </label>
                      <label className="text-xs text-faint" title="Số đo lúc bắt đầu kỳ — mốc để tính tiến độ">
                        Bắt đầu
                        <Input
                          type="number"
                          className="mt-1 tabular-nums"
                          value={String(kr.startValue ?? 0)}
                          onChange={(e) => setKr(kr.rowKey, { startValue: Number(e.target.value) })}
                        />
                      </label>
                      <label className="text-xs text-faint" title="Số đo mới nhất tính đến hôm nay">
                        Hiện tại
                        <Input
                          type="number"
                          className="mt-1 tabular-nums"
                          value={String(kr.currentValue ?? 0)}
                          onChange={(e) => setKr(kr.rowKey, { currentValue: Number(e.target.value) })}
                        />
                      </label>
                      <label className="text-xs text-faint" title="Số cần đạt để coi kết quả này là hoàn thành 100%">
                        Cần đạt
                        <Input
                          type="number"
                          className="mt-1 tabular-nums"
                          value={String(kr.targetValue ?? 0)}
                          onChange={(e) => setKr(kr.rowKey, { targetValue: Number(e.target.value) })}
                        />
                      </label>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <span className="mr-auto text-xs text-faint">Ctrl/Cmd + Enter để lưu</span>
          <Button variant="ghost" onClick={onClose}>Hủy</Button>
          <Button onClick={() => void save()} loading={busy} disabled={!canSave}>
            {editing ? 'Lưu thay đổi' : 'Tạo mục tiêu'}
          </Button>
        </footer>
      </div>
    </div>
  );
}
