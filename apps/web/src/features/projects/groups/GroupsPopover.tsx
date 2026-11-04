import { useId, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { toast } from 'sonner';
import type { ProjectDto, ProjectProgramRefDto } from '@tirapro/types';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAuth } from '@/stores/auth';
import { ShareChecklist, type ChecklistItem } from '@/features/saved-filters/ShareChecklist';
import { useCreateProgram } from '@/features/portfolio/api';
import { useLazyProjectCan, useProjectPermissions } from '../permissions';
import { useSetProjectPrograms } from './api';
import { groupCountLabel } from './groupModel';
import { sameIds, toggleId } from './groupsDraft';

/** Chấm màu của nhóm (màu nhận diện, không phải thông tin duy nhất — luôn kèm tên). */
export function GroupDot({ color }: { color: string | null }) {
  return (
    <span
      className="h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ background: color ?? 'var(--faint)' }}
      aria-hidden
    />
  );
}

/**
 * Ô "Nhóm" của một dự án: "N nhóm" (0 → "—"); bấm mở popover liệt kê các nhóm của dự án. Quản trị dự án đó (hoặc Quản
 * trị chung) đổi được tập nhóm ngay trong popover (chọn nhiều, tìm theo tên, tạo nhóm mới tại chỗ nếu có quyền quản lý
 * nhóm); người khác chỉ đọc danh sách. Quyền tra LƯỜI (chỉ khi mở) nên trang nhiều dự án không bắn N yêu cầu quyền.
 */
export function GroupsCell({
  project,
  programs,
}: {
  project: ProjectDto;
  programs: readonly ProjectProgramRefDto[];
}) {
  const [open, setOpen] = useState(false);
  const label = groupCountLabel(project.programs.length);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cn(
            'relative z-10 -mx-1.5 inline-flex min-h-8 items-center rounded px-1.5 text-left text-sm tabular-nums',
            'text-muted hover:bg-surface-3 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
            '[@media(pointer:coarse)]:min-h-11',
          )}
        >
          {label}
          <span className="sr-only"> của dự án {project.name}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          collisionPadding={12}
          className="z-dropdown w-[min(20rem,calc(100vw-1.5rem))] rounded-lg border border-border bg-surface p-3 shadow-lg outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          {/* Mỗi lần mở là một lần mount mới → bản nháp khởi tạo lại từ dữ liệu hiện tại. */}
          <GroupsPopoverBody
            project={project}
            programs={programs}
            open={open}
            onClose={() => setOpen(false)}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function GroupsPopoverBody({
  project,
  programs,
  open,
  onClose,
}: {
  project: ProjectDto;
  programs: readonly ProjectProgramRefDto[];
  open: boolean;
  onClose: () => void;
}) {
  const titleId = useId();
  const canAdmin = useLazyProjectCan(project.id, 'project:admin', open);
  const permsPending = useProjectPermissions(open ? project.id : null).isPending && !canAdmin;
  const current = project.programs;
  return (
    <div aria-labelledby={titleId} role="group">
      <h3 id={titleId} className="mb-2 truncate text-sm font-medium text-ink-strong">
        Nhóm của {project.name}
      </h3>
      {permsPending ? (
        <p className="py-2 text-sm text-muted">Đang kiểm tra quyền…</p>
      ) : canAdmin ? (
        <GroupsEditor project={project} programs={programs} onClose={onClose} />
      ) : (
        <ReadOnlyGroups groups={current} />
      )}
    </div>
  );
}

function ReadOnlyGroups({ groups }: { groups: readonly ProjectProgramRefDto[] }) {
  if (groups.length === 0)
    return <p className="py-1 text-sm text-muted">Dự án chưa thuộc nhóm nào.</p>;
  return (
    <>
      <ul className="space-y-1">
        {groups.map((g) => (
          <li key={g.id} className="flex items-center gap-2 text-sm text-ink">
            <GroupDot color={g.color} />
            <span className="min-w-0 truncate">{g.name}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted">Chỉ quản trị dự án mới đổi được nhóm.</p>
    </>
  );
}

function GroupsEditor({
  project,
  programs,
  onClose,
}: {
  project: ProjectDto;
  programs: readonly ProjectProgramRefDto[];
  onClose: () => void;
}) {
  const initial = project.programs.map((g) => g.id);
  const [ids, setIds] = useState<string[]>(initial);
  const [created, setCreated] = useState<ProjectProgramRefDto[]>([]);
  const [newName, setNewName] = useState('');
  const canCreate = useAuth((s) => s.can('program:manage'));
  const save = useSetProjectPrograms();
  const create = useCreateProgram();
  const changed = !sameIds(ids, initial);

  const items: ChecklistItem[] = [
    ...programs,
    ...created.filter((c) => !programs.some((p) => p.id === c.id)),
  ]
    .map((g) => ({ id: g.id, label: g.name }))
    .sort((a, b) => a.label.localeCompare(b.label, 'vi'));

  async function submit() {
    if (!changed || save.isPending) return;
    try {
      await save.mutateAsync({ projectId: project.id, programIds: ids });
      toast.success(`Đã cập nhật nhóm của dự án ${project.name}.`);
      onClose();
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  async function addGroup() {
    const name = newName.trim();
    if (!name || create.isPending) return;
    try {
      const g = await create.mutateAsync({ name });
      setCreated((c) => [...c, { id: g.id, name: g.name, color: g.color }]);
      setIds((cur) => (cur.includes(g.id) ? cur : [...cur, g.id]));
      setNewName('');
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  return (
    <div>
      <ShareChecklist
        label="Nhóm"
        items={items}
        selected={new Set(ids)}
        onToggle={(id) => setIds((cur) => toggleId(cur, id))}
        searchPlaceholder="Tìm nhóm theo tên…"
        emptyText={programs.length === 0 ? 'Chưa có nhóm nào.' : 'Không có nhóm nào khớp.'}
        disabled={save.isPending}
      />
      {canCreate && (
        <div className="mt-2 flex items-center gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void addGroup();
              }
            }}
            placeholder="Tên nhóm mới"
            aria-label="Tên nhóm mới"
            maxLength={120}
            className="h-8 text-sm"
          />
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void addGroup()}
            loading={create.isPending}
            disabled={!newName.trim()}
          >
            Tạo nhóm
          </Button>
        </div>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onClose}>
          Huỷ
        </Button>
        <Button
          size="sm"
          onClick={() => void submit()}
          loading={save.isPending}
          disabled={!changed}
        >
          Lưu
        </Button>
      </div>
    </div>
  );
}
