import { useMemo, type ComponentType, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, ChevronRight } from 'lucide-react';
import type { IssueDto } from '@tirapro/types';
import { useProjectMeta } from '@/features/ai/api';
import { useProjectSprints } from '@/features/backlog/api';
import { buildSprintOptions } from '@/features/issue-edit/sprintOptions';
import { useProjects } from '@/features/projects/api';
import { useCanEditIssue, useCanIn } from '@/features/projects/permissions';
import { useWorkflows } from '@/features/workflow-settings/api';
import { openIssueInNewTab } from '@/lib/rowOpen';
import { cn } from '@/lib/utils';
import { useAuth } from '@/stores/auth';
import { computeNextStatuses } from '../nextStatuses';
import { useIssueCopy } from '../useIssueCopy';
import { runIssueAction } from './issueActions';
import { issueMenuModel, type MenuItemId, type MenuSurface } from './issueMenuModel';

/**
 * Bộ thành phần menu mà `IssueMenuItems` vẽ lên. ContextMenu và DropdownMenu của Radix có cùng hình dạng API
 * (Item/Sub/…); truyền bộ nào thì ra menu đó — MỘT nguồn nội dung cho cả chuột phải lẫn nút "…".
 */
export interface MenuKit {
  Item: ComponentType<{
    className?: string;
    onSelect?: (e: Event) => void;
    disabled?: boolean;
    children?: ReactNode;
  }>;
  Separator: ComponentType<{ className?: string }>;
  Sub: ComponentType<{ children?: ReactNode }>;
  SubTrigger: ComponentType<{ className?: string; disabled?: boolean; children?: ReactNode }>;
  SubContent: ComponentType<{ className?: string; sideOffset?: number; children?: ReactNode }>;
  Portal: ComponentType<{ children?: ReactNode }>;
  RadioGroup: ComponentType<{ value?: string; children?: ReactNode }>;
  RadioItem: ComponentType<{
    value: string;
    className?: string;
    onSelect?: (e: Event) => void;
    children?: ReactNode;
  }>;
  ItemIndicator: ComponentType<{ className?: string; children?: ReactNode }>;
}

export const MENU_CONTENT_CLS =
  'z-dropdown min-w-52 max-w-[min(20rem,calc(100vw-1rem))] overflow-hidden rounded-lg border border-border bg-surface p-1 shadow-lg animate-in fade-in zoom-in-95 duration-150 motion-reduce:animate-none print:hidden';

const ITEM_CLS =
  'flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-ink outline-none transition-colors data-[highlighted]:bg-surface-2 data-[disabled]:cursor-not-allowed data-[disabled]:text-disabled-fg';
const DANGER_CLS = 'text-danger data-[highlighted]:bg-danger/10';

const subContent = (kit: MenuKit, children: ReactNode) => (
  <kit.Portal>
    <kit.SubContent sideOffset={4} className={MENU_CONTENT_CLS}>
      {children}
    </kit.SubContent>
  </kit.Portal>
);

/** Một lựa chọn trong menu con (radio có dấu ✓ ở mục hiện tại). */
function Choice({
  kit,
  value,
  label,
  onSelect,
}: {
  kit: MenuKit;
  value: string;
  label: string;
  onSelect: () => void;
}) {
  return (
    <kit.RadioItem value={value} className={cn(ITEM_CLS, 'pl-2')} onSelect={onSelect}>
      <kit.ItemIndicator className="grid h-4 w-4 place-items-center">
        <Check className="h-3.5 w-3.5 text-primary" aria-hidden />
      </kit.ItemIndicator>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </kit.RadioItem>
  );
}

/** Dữ liệu + quyền cho menu của một việc (chỉ chạy khi menu mở — xem `IssueMenuItems`). */
function useIssueMenuData(issue: IssueDto, surface: MenuSurface, hasPeek: boolean) {
  const can = useCanIn(issue.projectId);
  const canEdit = useCanEditIssue(issue.projectId)(issue);
  const me = useAuth((s) => s.user);
  const { data: workflows } = useWorkflows();
  const nextStatuses = useMemo(
    () => computeNextStatuses(workflows, issue.status.id),
    [workflows, issue.status.id],
  );
  const { data: projects } = useProjects(true);
  const projectKey = projects?.find((p) => p.id === issue.projectId)?.key;
  const { data: meta } = useProjectMeta(projectKey);
  const priorities = meta?.priorities ?? [];
  const { data: sprints } = useProjectSprints(surface === 'backlog' ? issue.projectId : undefined);
  const sprintOptions = useMemo(
    () => buildSprintOptions(sprints, issue.sprintId ?? null),
    [sprints, issue.sprintId],
  );
  const entries = issueMenuModel({
    surface,
    hasPeek,
    canEdit,
    canTransition: can('issue:transition'),
    canDelete: can('issue:delete'),
    isMine: !!me && issue.assigneeId === me.id,
    statusOptions: nextStatuses.length,
    priorityOptions: priorities.length,
    sprintOptions: surface === 'backlog' && sprints ? sprintOptions.length : 0,
  });
  return { entries, nextStatuses, priorities, sprintOptions };
}

/** Các mục đơn (không có menu con). Sao chép chạy ngay trong sự kiện chọn (cần thao tác người dùng để ghi clipboard). */
function SimpleItem({
  kit,
  id,
  label,
  issue,
  onPeek,
  origin,
}: {
  kit: MenuKit;
  id: MenuItemId;
  label: string;
  issue: IssueDto;
  onPeek?: (key: string) => void;
  origin?: () => HTMLElement | null;
}) {
  const navigate = useNavigate();
  const copy = useIssueCopy(issue.key);
  const onSelect: Record<MenuItemId, () => void> = {
    peek: () => onPeek?.(issue.key),
    open: () => navigate(`/issue/${issue.key}`),
    openTab: () => openIssueInNewTab(issue.key),
    copyKey: () => copy.copyKey(),
    copyLink: () => copy.copyLink(),
    assignMe: () => runIssueAction({ kind: 'assignMe', issue }),
    delete: () => runIssueAction({ kind: 'delete', issue, returnFocus: origin?.() ?? null }),
  };
  return (
    <kit.Item className={cn(ITEM_CLS, id === 'delete' && DANGER_CLS)} onSelect={onSelect[id]}>
      {label}
    </kit.Item>
  );
}

/**
 * Nội dung menu của MỘT công việc. Chỉ được dựng khi menu đang MỞ (Radix chỉ gắn Content lúc mở) nên danh sách hàng trăm
 * dòng không chạy các hook này cho từng dòng. Mục ghi không tự ghi: giao cho `IssueActionHost` qua `runIssueAction`
 * (menu đóng ngay khi chọn).
 */
export function IssueMenuItems({
  kit,
  issue,
  surface,
  onPeek,
  origin,
}: {
  kit: MenuKit;
  issue: IssueDto;
  surface: MenuSurface;
  /** Có → bề mặt có panel xem nhanh để mở. */
  onPeek?: (key: string) => void;
  /** Phần tử đã mở menu (trả focus về đó khi huỷ hộp xác nhận xoá). */
  origin?: () => HTMLElement | null;
}) {
  const { entries, nextStatuses, priorities, sprintOptions } = useIssueMenuData(
    issue,
    surface,
    !!onPeek,
  );
  return (
    <>
      {entries.map((e, i) => {
        if (e.kind === 'separator')
          return <kit.Separator key={`sep${i}`} className="my-1 h-px bg-border" />;
        if (e.kind === 'item')
          return (
            <SimpleItem
              key={e.id}
              kit={kit}
              id={e.id}
              label={e.label}
              issue={issue}
              onPeek={onPeek}
              origin={origin}
            />
          );
        const trigger = (
          <kit.SubTrigger className={ITEM_CLS} disabled={e.disabled}>
            <span className="flex-1">{e.label}</span>
            <ChevronRight className="h-4 w-4 text-faint" aria-hidden />
          </kit.SubTrigger>
        );
        const prio = (p: (typeof priorities)[number] | null) =>
          runIssueAction({
            kind: 'priority',
            issue,
            priority: p ? { ...p, iconKey: null } : null,
            priorityName: p?.name ?? 'Không đặt',
          });
        return (
          <kit.Sub key={e.id}>
            {trigger}
            {e.id === 'status' &&
              subContent(
                kit,
                nextStatuses.map((o) => (
                  <kit.Item
                    key={o.id}
                    className={ITEM_CLS}
                    onSelect={() => runIssueAction({ kind: 'transition', issue, toStatusId: o.id })}
                  >
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  </kit.Item>
                )),
              )}
            {e.id === 'priority' &&
              subContent(
                kit,
                <kit.RadioGroup value={issue.priority?.id ?? ''}>
                  <Choice kit={kit} value="" label="Không đặt" onSelect={() => prio(null)} />
                  {priorities.map((p) => (
                    <Choice
                      key={p.id}
                      kit={kit}
                      value={p.id}
                      label={p.name}
                      onSelect={() => prio(p)}
                    />
                  ))}
                </kit.RadioGroup>,
              )}
            {e.id === 'sprint' &&
              subContent(
                kit,
                <kit.RadioGroup value={issue.sprintId ?? ''}>
                  {sprintOptions.map((o) => (
                    <Choice
                      key={o.value || '_backlog'}
                      kit={kit}
                      value={o.value}
                      label={o.label}
                      onSelect={() =>
                        runIssueAction({
                          kind: 'sprint',
                          issue,
                          sprintId: o.value || null,
                          sprintName: o.label,
                        })
                      }
                    />
                  ))}
                </kit.RadioGroup>,
              )}
          </kit.Sub>
        );
      })}
    </>
  );
}
