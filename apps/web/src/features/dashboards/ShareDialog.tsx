import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { SearchSelect, type SearchSelectOption } from '@/components/ui/SearchSelect';
import { useProjects } from '@/features/projects/api';
import { useTeams } from '@/features/teams/api';
import { useAuth } from '@/stores/auth';
import { cn } from '@/lib/utils';
import { DASHBOARD_SCOPES, type DashboardScopeValue } from '@tirapro/shared';
import { shareValidation } from './layoutOps';

export interface ShareValue {
  scope: DashboardScopeValue;
  projectId: string;
  teamId: string;
}

const SCOPE_META: Record<DashboardScopeValue, { label: string; note: string }> = {
  PRIVATE: { label: 'Chỉ mình tôi', note: 'Chỉ bạn xem được bảng tổng quan này.' },
  GLOBAL: {
    label: 'Cả không gian làm việc',
    note: 'Mọi thành viên sẽ thấy bảng tổng quan này; dữ liệu từng ô vẫn theo quyền của người xem.',
  },
  PROJECT: {
    label: 'Thành viên dự án…',
    note: 'Thành viên của dự án sẽ thấy bảng tổng quan này; dữ liệu từng ô vẫn theo quyền của người xem.',
  },
  TEAM: {
    label: 'Thành viên nhóm…',
    note: 'Thành viên của nhóm sẽ thấy bảng tổng quan này; dữ liệu từng ô vẫn theo quyền của người xem.',
  },
};

/**
 * "Ai xem được" — 4 mức chia sẻ. Dự án chọn trong số dự án bạn thấy và chưa lưu trữ; nhóm chọn trong số nhóm bạn thuộc
 * (admin: mọi nhóm). Tính hợp lệ qua `shareValidation` (cùng luật với máy chủ) trước khi cho bấm Xong.
 */
export function ShareDialog({
  open,
  onOpenChange,
  value,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: ShareValue;
  onApply: (v: ShareValue) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [prevOpen, setPrevOpen] = useState(open);
  // Mở lại hộp: bắt đầu từ giá trị đang áp dụng (điều chỉnh state khi prop đổi — không cần effect).
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setDraft(value);
  }

  const user = useAuth((s) => s.user);
  const isAdmin = useAuth((s) => s.can('workspace:admin'));
  const { data: projects } = useProjects(true);
  const { data: teams } = useTeams();

  const projectOptions = useMemo<SearchSelectOption[]>(() => {
    // Dự án đang gắn vào dashboard luôn hiện, kể cả khi vừa bị lưu trữ (giá trị vẫn hợp lệ, không hiện ô trống).
    const list = (projects ?? []).filter((p) => !p.isArchived || p.id === value.projectId);
    return list.map((p) => ({ value: p.id, label: p.name, hint: p.key }));
  }, [projects, value.projectId]);

  const teamOptions = useMemo<SearchSelectOption[]>(() => {
    const mine = (teams ?? []).filter(
      (t) =>
        isAdmin ||
        user?.isSystemAdmin ||
        t.lead?.id === user?.id ||
        t.members.some((m) => m.id === user?.id),
    );
    // Nhóm đang gắn vào dashboard luôn hiện, kể cả khi người sửa không còn thuộc nhóm (giữ nguyên không bị chặn).
    const current = (teams ?? []).find((t) => t.id === value.teamId);
    const all = current && !mine.includes(current) ? [...mine, current] : mine;
    return all.map((t) => ({ value: t.id, label: t.name }));
  }, [teams, isAdmin, user, value.teamId]);

  const selectedProject = (projects ?? []).find((p) => p.id === draft.projectId);
  const error = shareValidation(draft.scope, draft.projectId, draft.teamId);

  function pickScope(scope: DashboardScopeValue) {
    setDraft((d) => ({
      scope,
      projectId: scope === 'PROJECT' ? d.projectId : '',
      teamId: scope === 'TEAM' ? d.teamId : '',
    }));
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Ai xem được bảng tổng quan này"
      size="md"
      onSubmit={() => {
        if (!error) {
          onApply(draft);
          onOpenChange(false);
        }
      }}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Huỷ
          </Button>
          <Button
            disabled={!!error}
            onClick={() => {
              onApply(draft);
              onOpenChange(false);
            }}
          >
            Xong
          </Button>
        </>
      }
    >
      <fieldset className="space-y-2">
        <legend className="sr-only">Mức chia sẻ</legend>
        {DASHBOARD_SCOPES.map((scope) => {
          const checked = draft.scope === scope;
          return (
            <div
              key={scope}
              className={cn(
                'rounded-lg border p-3 transition-colors',
                checked ? 'border-primary bg-primary-subtle' : 'border-border',
              )}
            >
              <label className="flex cursor-pointer items-start gap-2.5">
                <input
                  type="radio"
                  name="dashboard-scope"
                  value={scope}
                  checked={checked}
                  onChange={() => pickScope(scope)}
                  className="mt-1 accent-[var(--primary)]"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink-strong">
                    {SCOPE_META[scope].label}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted">{SCOPE_META[scope].note}</span>
                </span>
              </label>
              {checked && scope === 'PROJECT' && (
                <div className="mt-2 pl-6">
                  <SearchSelect
                    value={draft.projectId}
                    onChange={(projectId) => setDraft((d) => ({ ...d, projectId }))}
                    options={projectOptions}
                    placeholder="Chọn dự án…"
                    searchPlaceholder="Tìm dự án…"
                    ariaLabel="Dự án được chia sẻ"
                  />
                  {selectedProject?.isPrivate && (
                    <p className="mt-1 text-xs text-muted">
                      Dự án riêng tư: chỉ thành viên dự án thấy.
                    </p>
                  )}
                </div>
              )}
              {checked && scope === 'TEAM' && (
                <div className="mt-2 pl-6">
                  <SearchSelect
                    value={draft.teamId}
                    onChange={(teamId) => setDraft((d) => ({ ...d, teamId }))}
                    options={teamOptions}
                    placeholder="Chọn nhóm…"
                    searchPlaceholder="Tìm nhóm…"
                    ariaLabel="Nhóm được chia sẻ"
                  />
                </div>
              )}
            </div>
          );
        })}
      </fieldset>
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
    </Dialog>
  );
}
