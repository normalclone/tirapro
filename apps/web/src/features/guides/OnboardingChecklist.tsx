import { useId, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { AddMemberPanel } from '@/features/members/AddMemberPanel';
import { CreateProjectModal } from '@/features/projects/CreateProjectModal';
import { useProjects } from '@/features/projects/api';
import { keys } from '@/lib/queryKeys';
import { cn } from '@/lib/utils';
import { useDismissOnboarding, useOnboarding, type OnboardingItem } from './api';
import { onboardingActionLabel, onboardingTarget } from './onboarding';

/**
 * Khối "Bắt đầu" ở đầu Tổng quan quản trị: bốn mục, mỗi mục là NÚT dẫn đúng tới hành động; mục xong tự đánh dấu
 * (server tính từ dữ liệu thật); "Ẩn khối này" ghi theo người; tự biến mất khi xong cả bốn hoặc workspace quá 30 ngày.
 * Danh sách dọc (không lưới thẻ) theo DESIGN.md.
 */
export function OnboardingChecklist() {
  const { data } = useOnboarding();
  const dismiss = useDismissOnboarding();
  const { data: projects } = useProjects();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const titleId = useId();
  const [createOpen, setCreateOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  // Server quyết định có hiện không (403 với người không phải quản trị → data rỗng → không hiện).
  if (!data?.visible) return null;

  const firstProjectKey = projects?.[0]?.key ?? null;
  const refresh = () => void qc.invalidateQueries({ queryKey: keys.guides.onboarding });
  const percent = data.total > 0 ? Math.round((data.doneCount / data.total) * 100) : 0;

  function act(item: OnboardingItem) {
    const target = onboardingTarget(item, { firstProjectKey });
    if (target.kind === 'modal-create-project') setCreateOpen(true);
    else if (target.kind === 'modal-add-member') setAddOpen(true);
    else if (target.kind === 'link') navigate(target.to);
  }

  return (
    <section
      aria-labelledby={titleId}
      data-tour="home-checklist"
      className="mb-6 rounded-lg border border-border bg-surface print:hidden"
    >
      <div className="flex items-center gap-3 px-5 pt-4">
        <h2 id={titleId} className="text-base font-semibold text-ink-strong">
          Bắt đầu
        </h2>
        <span className="tabular text-sm text-muted">
          {data.doneCount}/{data.total}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto text-muted"
          onClick={() => dismiss.mutate()}
          loading={dismiss.isPending}
        >
          Ẩn khối này
        </Button>
      </div>
      <div
        role="progressbar"
        aria-label="Tiến độ bắt đầu"
        aria-valuemin={0}
        aria-valuemax={data.total}
        aria-valuenow={data.doneCount}
        className="mx-5 mt-3 h-1 overflow-hidden rounded-full bg-surface-2"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-base"
          style={{ width: `${percent}%` }}
        />
      </div>
      <ol className="divide-y divide-border px-5 py-1">
        {data.items.map((item) => {
          const target = onboardingTarget(item, { firstProjectKey });
          const disabledReason = target.kind === 'disabled' ? target.reason : null;
          return (
            <li key={item.key} className="flex items-center gap-3 py-2.5">
              <span
                aria-hidden
                className={cn(
                  'grid h-5 w-5 shrink-0 place-items-center rounded-full border',
                  item.done
                    ? 'border-transparent bg-primary text-primary-fg'
                    : 'border-border text-transparent',
                )}
              >
                <Check className="h-3 w-3" />
              </span>
              <span
                className={cn(
                  'min-w-0 flex-1 truncate text-sm',
                  item.done ? 'text-muted line-through' : 'text-ink',
                )}
              >
                {item.label}
                {item.done && <span className="sr-only"> (đã xong)</span>}
              </span>
              {!item.done && (
                <span className="flex shrink-0 items-center gap-2">
                  {disabledReason && <span className="text-xs text-faint">{disabledReason}</span>}
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={disabledReason !== null}
                    onClick={() => act(item)}
                  >
                    {onboardingActionLabel(item.key)}
                  </Button>
                </span>
              )}
            </li>
          );
        })}
      </ol>

      <CreateProjectModal
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          refresh();
        }}
      />
      <Dialog
        open={addOpen}
        onOpenChange={(o) => {
          setAddOpen(o);
          if (!o) refresh();
        }}
        title="Thêm thành viên"
        description="Chọn người có sẵn trong hệ thống hoặc tạo tài khoản mới."
        size="lg"
      >
        <AddMemberPanel />
      </Dialog>
    </section>
  );
}
