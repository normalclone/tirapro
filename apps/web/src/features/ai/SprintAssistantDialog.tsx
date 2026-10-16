import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import type { AiSprintPlanResult } from '@tirapro/shared';
import { apiErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';
import { useBulkUpdateIssues } from '@/features/backlog/api';
import { useAiCapabilities, useSprintPlan } from './api';
import { AiFallbackNote } from './AiFallbackNote';
import { aiSourceLabel } from './fallbackNote';

/** Nhãn ô mục tiêu: chế độ cơ bản không nhận mình là AI. */
const goalLabel = (basic: boolean) =>
  basic
    ? 'Mục tiêu sprint (tuỳ chọn, để ưu tiên việc có từ khoá khớp mục tiêu)'
    : 'Mục tiêu sprint (tuỳ chọn, để AI chọn việc khớp mục tiêu)';

/**
 * Trợ lý lập sprint: nhập năng lực (bỏ trống = theo velocity) và mục tiêu (tuỳ chọn) → nhận danh sách
 * việc từ Việc chờ tick sẵn, chỉnh được, rồi "Đưa vào sprint" qua bulk update (khoá lạc quan theo version).
 */
export function SprintAssistantDialog({
  open,
  onClose,
  projectId,
  sprint,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  sprint: { id: string; name: string; goal?: string | null };
}) {
  const plan = useSprintPlan();
  const basic = useAiCapabilities().data?.available === false;
  const bulkUpdate = useBulkUpdateIssues(projectId);
  const [capacity, setCapacity] = useState('');
  const [goal, setGoal] = useState(sprint.goal ?? '');
  const [result, setResult] = useState<(AiSprintPlanResult & { hasGoal: boolean }) | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());

  // Cha gắn `key` theo lần mở nên mỗi lần mở là mount mới (kết quả/năng lực cũ không còn); chỉ đồng bộ lại
  // mục tiêu nếu sprint đổi mục tiêu khi hộp đang mở.
  useEffect(() => {
    if (open) setGoal(sprint.goal ?? '');
  }, [open, sprint.goal]);

  const capacityNum = capacity.trim() === '' ? undefined : Number(capacity);
  const capacityInvalid =
    capacityNum !== undefined && (!Number.isFinite(capacityNum) || capacityNum <= 0);

  function run() {
    plan.mutate(
      {
        projectId,
        sprintId: sprint.id,
        capacityPoints: capacityNum,
        goal: goal.trim() || undefined,
      },
      {
        onSuccess: (r) => {
          setResult({ ...r, hasGoal: goal.trim() !== '' });
          setTicked(new Set(r.picks.map((p) => p.issueId)));
        },
      },
    );
  }

  const chosen = result?.picks.filter((p) => ticked.has(p.issueId)) ?? [];
  const chosenPoints = chosen.reduce((s, p) => s + p.storyPoints, 0);
  const overCapacity =
    !!result && result.capacityPoints > 0 && chosenPoints > result.capacityPoints;

  async function apply() {
    if (chosen.length === 0) return;
    try {
      const { updated, conflicts } = await bulkUpdate.mutateAsync({
        items: chosen.map((p) => ({ id: p.issueId, version: p.version })),
        patch: { sprintId: sprint.id },
      });
      if (conflicts.length > 0) {
        toast.warning(
          `Đã đưa ${updated.length} việc vào “${sprint.name}”, còn ${conflicts.length} việc chưa được`,
          {
            description: 'Người khác vừa sửa những việc đó. Hãy đề xuất lại để lấy bản mới nhất.',
          },
        );
      } else {
        toast.success(`Đã đưa ${updated.length} việc vào “${sprint.name}”.`);
      }
      onClose();
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={`Trợ lý lập sprint — ${sprint.name}`}
      icon={<Sparkles className="h-4 w-4" />}
      description="Đề xuất việc trong Việc chờ vừa với năng lực của đội. Bạn xem lại và bỏ tick việc nào không muốn đưa vào."
      size="lg"
      footer={
        <>
          <p className={cn('mr-auto', overCapacity ? 'text-sm text-danger' : 'text-sm text-muted')}>
            {result
              ? `Đã chọn ${chosen.length} việc · ${chosenPoints} điểm${overCapacity ? ' — vượt năng lực' : ''}`
              : ''}
          </p>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Đóng
          </Button>
          <Button
            size="sm"
            onClick={() => void apply()}
            loading={bulkUpdate.isPending}
            disabled={chosen.length === 0}
          >
            Đưa vào sprint
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
          <label className="block text-sm">
            <span className="mb-1 block text-muted">Năng lực (điểm)</span>
            <Input
              type="number"
              min={1}
              inputMode="decimal"
              value={capacity}
              placeholder={result ? String(result.velocityAvg) : 'Theo velocity'}
              onChange={(e) => setCapacity(e.target.value)}
              aria-invalid={capacityInvalid}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted">{goalLabel(basic)}</span>
            <Input
              value={goal}
              maxLength={500}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="Ví dụ: Hoàn thiện luồng thanh toán"
            />
          </label>
        </div>
        {capacityInvalid && <p className="text-sm text-danger">Năng lực phải là số lớn hơn 0.</p>}
        <div>
          <Button size="sm" onClick={run} loading={plan.isPending} disabled={capacityInvalid}>
            <Sparkles className="h-4 w-4" />
            {result ? 'Đề xuất lại' : 'Đề xuất việc'}
          </Button>
        </div>

        {plan.isError && <p className="text-sm text-danger">{apiErrorMessage(plan.error)}</p>}

        {result && (
          <PlanResult
            result={result}
            hasGoal={result.hasGoal}
            ticked={ticked}
            onToggle={(id, on) =>
              setTicked((prev) => {
                const next = new Set(prev);
                if (on) next.add(id);
                else next.delete(id);
                return next;
              })
            }
          />
        )}
      </div>
    </Dialog>
  );
}

/** Kết quả đề xuất: tóm tắt năng lực, danh sách tick được và phần việc chưa vừa. */
function PlanResult({
  result,
  hasGoal,
  ticked,
  onToggle,
}: {
  result: AiSprintPlanResult;
  /** Lần đề xuất này có gửi mục tiêu sprint hay không (quyết định câu mô tả cách chọn). */
  hasGoal: boolean;
  ticked: Set<string>;
  onToggle: (issueId: string, on: boolean) => void;
}) {
  return (
    <section aria-live="polite" className="space-y-3">
      <p className="text-sm text-muted">
        Năng lực <b className="text-ink">{result.capacityPoints}</b> điểm
        {result.velocityAvg > 0 && (
          <>
            {' '}
            · velocity trung bình <b className="text-ink">{result.velocityAvg}</b>
          </>
        )}
        {' · '}
        {result.source === 'claude'
          ? 'Chọn bởi AI theo mục tiêu'
          : `${hasGoal ? 'Chọn theo từ khoá của mục tiêu, hạn chót và độ ưu tiên' : 'Chọn theo độ ưu tiên và hạn chót'} · Nguồn: ${aiSourceLabel(result.source, result.reason)}`}
      </p>
      <AiFallbackNote reason={result.reason} />
      {result.capacityPoints <= 0 && (
        <p className="rounded-md bg-surface-2 px-3 py-2 text-sm text-muted">
          Chưa có sprint nào kết thúc để tính velocity. Hãy nhập năng lực của đội rồi đề xuất lại.
        </p>
      )}
      {result.picks.length === 0 && result.capacityPoints > 0 && (
        <p className="text-sm text-muted">
          Việc chờ chưa có việc đã ước lượng điểm nào vừa với năng lực này.
        </p>
      )}
      {result.picks.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {result.picks.map((p) => (
            <li key={p.issueId}>
              <label className="flex cursor-pointer items-start gap-3 p-3 hover:bg-surface-2">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={ticked.has(p.issueId)}
                  onChange={(e) => onToggle(p.issueId, e.target.checked)}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="shrink-0 text-xs text-muted">{p.key}</span>
                    <span className="truncate text-sm text-ink-strong">{p.summary}</span>
                  </span>
                  <span className="mt-0.5 block text-xs text-muted">{p.reason}</span>
                </span>
                <span className="shrink-0 rounded-full bg-surface-3 px-2 py-0.5 text-xs font-medium">
                  {p.storyPoints} điểm
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {(result.leftovers > 0 || result.unestimated > 0) && (
        <p className="text-xs text-muted">
          {result.leftovers > 0 && (
            <>Còn {result.leftovers} việc đã ước lượng chưa vừa năng lực. </>
          )}
          {result.unestimated > 0 && (
            <>{result.unestimated} việc chưa có điểm nên bị bỏ qua — hãy ước lượng trước.</>
          )}
        </p>
      )}
    </section>
  );
}
