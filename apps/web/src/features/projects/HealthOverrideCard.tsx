import { useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import type { ProjectHealth } from '@tirapro/types';
import type { ProjectHealthDto } from '@tirapro/shared';
import { Button } from '@/components/ui/Button';
import { HealthBadge, HealthDetails } from '@/components/ui/HealthBadge';
import { healthLabel } from '@/components/ui/healthLabel';
import { Input } from '@/components/ui/Input';
import { useSetProjectHealth } from '@/features/reports/api';
import { Card } from '@/features/reports/charts';
import { apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useProjectCan } from './permissions';
import { canSubmit, HEALTH_NOTE_MAX } from './healthOverride';

const LEVELS: ProjectHealth[] = ['GREEN', 'YELLOW', 'RED'];

/**
 * Thẻ "Sức khoẻ dự án" đầu tab Tổng quan của Báo cáo: mức hiện tại + lý do tự tính, và (chỉ với `project:admin`)
 * ghi đè bằng 3 nút Tốt / Cần chú ý / Nguy cơ + ghi chú bắt buộc, hoặc "Bỏ ghi đè".
 * Ghi đè đặt ở đây (nơi PM làm việc, quyền tính theo dự án) chứ không ở bảng nhiều dự án — tránh bấm rồi 403.
 */
export function HealthOverrideCard({
  project,
  health,
}: {
  project: { id: string; key: string; archivedAt: string | null };
  health: ProjectHealthDto | null;
}) {
  const can = useProjectCan(project);
  const canOverride = can('project:admin');
  const setHealth = useSetProjectHealth(project.id);
  const noteId = useId();

  const current = health?.override ?? null;
  const [level, setLevel] = useState<ProjectHealth | null>(current?.level ?? null);
  const [note, setNote] = useState(current?.note ?? '');

  // Đồng bộ khi ghi đè đổi từ nơi khác (lưu xong, người khác sửa, nạp lại).
  const overrideKey = current ? `${current.level}|${current.note}|${current.updatedAt}` : '';
  useEffect(() => {
    setLevel(current?.level ?? null);
    setNote(current?.note ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ theo dấu vân tay của ghi đè
  }, [overrideKey]);

  const dirty = level !== (current?.level ?? null) || note.trim() !== (current?.note ?? '');
  const ready = level !== null && canSubmit(level, note) && dirty;

  async function save() {
    if (!level || !canSubmit(level, note)) return;
    try {
      await setHealth.mutateAsync({ health: level, note: note.trim() });
      toast.success(`Đã đặt sức khoẻ dự án: ${healthLabel(level)}`);
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  async function clear() {
    try {
      await setHealth.mutateAsync({ health: null });
      toast.success('Đã bỏ ghi đè — sức khoẻ về giá trị tự tính');
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  return (
    <Card
      title="Sức khoẻ dự án"
      caption="Tự tính từ việc quá hạn, sprint và rủi ro; PM có thể ghi đè"
    >
      <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
        <div className="min-w-[16rem] flex-1">
          <div className="mb-2">
            <HealthBadge health={health} />
          </div>
          <HealthDetails health={health} />
        </div>

        {canOverride ? (
          <form
            className="min-w-[16rem] flex-1 space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <div role="radiogroup" aria-label="Mức ghi đè" className="flex flex-wrap gap-1.5">
              {LEVELS.map((l) => (
                <button
                  key={l}
                  type="button"
                  role="radio"
                  aria-checked={level === l}
                  onClick={() => setLevel(l)}
                  className={cn(
                    'h-8 rounded-md border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
                    level === l
                      ? 'border-primary bg-primary-subtle text-ink-strong'
                      : 'border-border text-ink hover:bg-surface-2',
                  )}
                >
                  {healthLabel(l)}
                </button>
              ))}
            </div>
            <div>
              <label htmlFor={noteId} className="mb-1 block text-xs text-muted">
                Ghi chú lý do (bắt buộc khi ghi đè)
              </label>
              <Input
                id={noteId}
                value={note}
                maxLength={HEALTH_NOTE_MAX}
                placeholder="Ví dụ: Chờ khách duyệt thiết kế"
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="submit"
                size="sm"
                disabled={!ready}
                loading={setHealth.isPending}
                title={
                  level === null
                    ? 'Chọn mức Tốt / Cần chú ý / Nguy cơ'
                    : !canSubmit(level, note)
                      ? 'Cần ghi chú lý do'
                      : undefined
                }
              >
                Lưu ghi đè
              </Button>
              {current && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={setHealth.isPending}
                  onClick={() => void clear()}
                >
                  Bỏ ghi đè
                </Button>
              )}
            </div>
          </form>
        ) : (
          <p className="min-w-[16rem] flex-1 text-xs text-muted">
            Chỉ quản trị dự án mới ghi đè được sức khoẻ.
          </p>
        )}
      </div>
    </Card>
  );
}
