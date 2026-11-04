import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, GitBranch, Search } from 'lucide-react';
import { toast } from 'sonner';
import type { AffectedRuleDto, NameRefDto, WorkflowChangeDto } from '@tirapro/types';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { Skeleton } from '@/components/ui/primitives';
import { QueryError } from '@/components/ui/QueryError';
import { apiErrorCode, apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { Workflow } from './api';
import {
  missingMappingIds,
  sendChange,
  useChangePreview,
  useRefreshAfterChange,
  type ChangeRequest,
} from './schemeApi';
import {
  NAME_REF_LABEL,
  buildFlatStatusMap,
  buildStatusMapByType,
  groupMoves,
  statusOptionsFor,
  targetOf,
  unmappedGroups,
  type MoveGroup,
} from './schemeModel';

/**
 * Hộp thoại XEM TRƯỚC một thay đổi quy trình (của tổ chức hoặc ghi đè của dự án) rồi mới xác nhận:
 *  1. việc sẽ chuyển — gộp theo (loại việc, trạng thái cũ), mỗi nhóm một ô chọn trạng thái mới (đã điền gợi ý);
 *  2. quy tắc tự động sẽ được sửa/tắt — trước → sau từng trạng thái;
 *  3. bộ lọc/bảng/thẻ/quy tắc/mục tiêu lọc theo TÊN trạng thái cũ sẽ không còn khớp (chỉ báo, không tự sửa).
 * Xác nhận gửi lại cùng yêu cầu (không dryRun) kèm đích đã chọn. Lỗi nghiệp vụ (BUSINESS_RULE_VIOLATION) hiện ngay trong hộp;
 * 422 STATUS_MAPPING_REQUIRED đánh dấu đúng các dòng còn thiếu đích.
 */
export function ChangePreviewDialog({
  request,
  title,
  workflows,
  targetWorkflowOf,
  onClose,
  onApplied,
}: {
  /** null = đóng. Giữ cùng object trong lúc mở để không gọi xem trước lại. */
  request: ChangeRequest | null;
  title: string;
  workflows: Workflow[];
  /** Quy trình đích của một loại việc (dự phòng liệt kê trạng thái khi máy chủ không gợi ý được đích nào). */
  targetWorkflowOf: (issueTypeId: string) => string | undefined;
  onClose: () => void;
  onApplied?: (result: WorkflowChangeDto) => void;
}) {
  const preview = useChangePreview(request);
  const refresh = useRefreshAfterChange();
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [missing, setMissing] = useState<string[]>([]);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  // Đổi yêu cầu (mở lại hộp) → xoá lựa chọn/lỗi cũ.
  useEffect(() => {
    setChoices({});
    setMissing([]);
    setApplyError(null);
  }, [request]);

  const data = preview.data;
  const groups = useMemo(() => groupMoves(data?.moves ?? []), [data]);
  const blockers = unmappedGroups(groups, choices);
  const error = preview.error ?? null;
  const businessError =
    error && apiErrorCode(error) === 'BUSINESS_RULE_VIOLATION' ? apiErrorMessage(error) : null;

  async function confirm() {
    if (!request || !data) return;
    setApplying(true);
    setApplyError(null);
    setMissing([]);
    const body =
      request.scope === 'workspace'
        ? { ...request.body, statusMapByType: buildStatusMapByType(groups, choices) }
        : { ...request.body, statusMap: buildFlatStatusMap(groups, choices) };
    try {
      const result = await sendChange({ ...request, body } as ChangeRequest, false);
      refresh();
      toast.success(
        result.totalIssues > 0
          ? `Đã đổi quy trình · chuyển ${result.totalIssues} việc sang trạng thái mới`
          : 'Đã đổi quy trình',
      );
      // Cột bảng chỉ còn trạng thái cũ (còn việc ở đó): không tự gỡ được → nói rõ để người quản trị dọn ở Cài đặt bảng.
      if (result.ghostColumns && result.ghostColumns.length > 0)
        toast.warning(
          `${result.ghostColumns.length} cột bảng chỉ còn trạng thái của quy trình cũ`,
          {
            description: `${result.ghostColumns.join('; ')}. Chuyển các việc còn ở đó rồi dọn trong Cài đặt bảng.`,
            duration: 12000,
          },
        );
      onApplied?.(result);
      onClose();
    } catch (e) {
      const ids = missingMappingIds(e);
      if (ids.length > 0) {
        // 422 STATUS_MAPPING_REQUIRED: đánh dấu các dòng thiếu đích, giữ hộp để chọn tiếp.
        setMissing(ids);
        setApplyError(apiErrorMessage(e));
      } else {
        // BUSINESS_RULE_VIOLATION và các lỗi khác: hiện ngay trong hộp, không đóng.
        setApplyError(apiErrorMessage(e));
      }
    } finally {
      setApplying(false);
    }
  }

  const rules = data?.affectedRules ?? [];
  const refs = data?.nameRefs ?? [];
  const nothing = !!data && groups.length === 0 && rules.length === 0 && refs.length === 0;
  const disabledRules = rules.filter((r) => r.outcome === 'disabled' && r.wasEnabled);

  return (
    <Dialog
      open={request !== null}
      onOpenChange={(o) => {
        if (!o && !applying) onClose();
      }}
      title={title}
      description="Xem trước điều sẽ thay đổi, rồi xác nhận. Chưa có gì được lưu."
      icon={<GitBranch className="h-4 w-4" />}
      size="xl"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={applying}>
            Huỷ
          </Button>
          <Button
            size="sm"
            onClick={() => void confirm()}
            loading={applying}
            disabled={!data || blockers.length > 0}
            data-testid="confirm-change"
          >
            {data && data.totalIssues > 0
              ? `Áp dụng và chuyển ${data.totalIssues} việc`
              : 'Áp dụng'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {preview.isPending && request && (
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        )}
        {error && (
          <div role="alert" className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm">
            <p className="font-medium text-ink">
              {businessError ?? 'Không xem trước được thay đổi này.'}
            </p>
            {!businessError && <QueryError error={error} onRetry={() => void preview.refetch()} />}
          </div>
        )}
        {nothing && (
          <p className="text-sm text-muted" role="status">
            Không có việc nào phải chuyển và không có quy tắc hay bộ lọc nào bị ảnh hưởng.
          </p>
        )}
        {groups.length > 0 && (
          <MovesSection
            groups={groups}
            choices={choices}
            missing={missing}
            workflows={workflows}
            targetWorkflowOf={targetWorkflowOf}
            onChoose={(key, id) => {
              setChoices((c) => ({ ...c, [key]: id }));
              setMissing((m) => m.filter((x) => !key.endsWith(`:${x}`)));
            }}
            total={data?.totalIssues ?? 0}
          />
        )}
        {rules.length > 0 && <RulesSection rules={rules} disabledCount={disabledRules.length} />}
        {refs.length > 0 && <NameRefsSection refs={refs} />}
        {applyError && (
          <p role="alert" className="text-sm text-danger">
            {applyError}
          </p>
        )}
      </div>
    </Dialog>
  );
}

function MovesSection({
  groups,
  choices,
  missing,
  workflows,
  targetWorkflowOf,
  onChoose,
  total,
}: {
  groups: MoveGroup[];
  choices: Record<string, string>;
  missing: string[];
  workflows: Workflow[];
  targetWorkflowOf: (issueTypeId: string) => string | undefined;
  onChoose: (key: string, statusId: string) => void;
  total: number;
}) {
  return (
    <section aria-labelledby="chg-moves">
      <h3 id="chg-moves" className="mb-1 text-sm font-medium text-ink">
        Việc sẽ chuyển trạng thái ({total})
      </h3>
      <p className="mb-2 text-xs text-muted">
        Việc đang ở trạng thái của quy trình cũ sẽ sang trạng thái mới bên dưới (gợi ý theo tên,
        không có thì theo nhóm). Đổi nếu cần.
      </p>
      <ul className="divide-y divide-border rounded-md border border-border">
        {groups.map((g) => {
          const to = targetOf(g, choices);
          const options = statusOptionsFor(workflows, g.toStatusId, targetWorkflowOf(g.typeId));
          const isMissing = missing.some((id) => g.key.endsWith(`:${id}`)) || !to;
          return (
            <li
              key={g.key}
              data-move-row={g.key}
              className={cn(
                'flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 text-sm',
                isMissing && 'bg-danger/5',
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="font-medium text-ink">
                  {g.total} {g.typeName}
                </span>{' '}
                <span className="text-muted">
                  ({g.projects.map((p) => `${p.key} ${p.count}`).join(', ')})
                </span>
                <span className="mt-0.5 flex items-center gap-1.5 text-muted">
                  {g.fromStatusName}
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </span>
                {g.projects.length > 1 && (
                  <span className="mt-0.5 block text-xs text-faint">
                    Áp chung cho {g.projects.length} dự án
                  </span>
                )}
              </span>
              <SearchSelect
                value={to ?? ''}
                onChange={(v) => onChoose(g.key, v)}
                options={options.map((o) => ({ value: o.id, label: o.name }))}
                placeholder="Chọn trạng thái mới"
                ariaLabel={`Trạng thái mới cho ${g.typeName} đang ở ${g.fromStatusName}`}
                invalid={isMissing}
                className="w-full sm:w-56"
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function RulesSection({
  rules,
  disabledCount,
}: {
  rules: AffectedRuleDto[];
  disabledCount: number;
}) {
  return (
    <section aria-labelledby="chg-rules">
      <h3 id="chg-rules" className="mb-1 text-sm font-medium text-ink">
        Quy tắc tự động bị ảnh hưởng ({rules.length})
      </h3>
      <p className="mb-2 text-xs text-muted">
        Quy tắc của dự án nhắc tới trạng thái cũ được đổi sang trạng thái mới tương ứng
        {disabledCount > 0
          ? '; quy tắc không còn trạng thái thay thế sẽ bị TẮT và người tạo được báo'
          : ''}
        .
      </p>
      <ul className="divide-y divide-border rounded-md border border-border">
        {rules.map((r) => (
          <li key={r.ruleId} className="px-3 py-2 text-sm" data-rule-row={r.ruleId}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-ink">{r.name}</span>
              {r.outcome === 'disabled' ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-danger">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                  {r.wasEnabled ? 'Sẽ bị tắt' : 'Đang tắt, giữ nguyên'}
                </span>
              ) : r.outcome === 'needsReview' ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-warning-ink">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                  Áp toàn tổ chức — cần quản trị chung xem lại
                </span>
              ) : (
                <span className="text-xs text-muted">Sẽ được sửa</span>
              )}
            </div>
            {r.outcome !== 'needsReview' &&
              (r.statusRefs ?? []).map((ref) => (
                <p key={ref.fromId} className="mt-0.5 text-xs text-muted">
                  {ref.fromName} <ArrowRight className="inline h-3 w-3" aria-hidden />{' '}
                  {ref.toNames.length > 0
                    ? ref.toNames.join(', ')
                    : '(không có trạng thái thay thế)'}
                </p>
              ))}
            {r.outcome === 'needsReview' && (
              <p className="mt-0.5 text-xs text-muted">
                Quy tắc này không bị đổi từ thay đổi của một dự án; nhờ quản trị chung kiểm tra lại
                các trạng thái nó nhắc tới.
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function NameRefsSection({ refs }: { refs: NameRefDto[] }) {
  return (
    <section aria-labelledby="chg-refs">
      <h3 id="chg-refs" className="mb-1 flex items-center gap-1.5 text-sm font-medium text-ink">
        <Search className="h-4 w-4 text-muted" aria-hidden />
        Lọc theo tên trạng thái cũ ({refs.length})
      </h3>
      <p className="mb-2 text-xs text-muted">
        Các mục này lọc theo TÊN trạng thái cũ nên sẽ không còn khớp việc nào sau khi đổi. Hệ thống
        không tự sửa — hãy cập nhật câu lọc sau khi lưu.
      </p>
      <ul className="divide-y divide-border rounded-md border border-border">
        {refs.map((n) => (
          <li key={`${n.kind}:${n.id}`} className="px-3 py-2 text-sm" data-name-ref={n.id}>
            <span className="font-medium text-ink">{n.label}</span>{' '}
            <span className="text-xs text-muted">· {NAME_REF_LABEL[n.kind]}</span>
            <p className="mt-0.5 text-xs text-muted">Tên không còn: {n.names.join(', ')}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
