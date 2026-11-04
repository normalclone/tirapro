import { useId, useState, type ReactNode } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { toast } from 'sonner';
import type { ProjectDto, ProjectProgramRefDto } from '@tirapro/types';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAuth } from '@/stores/auth';
import { ShareChecklist, type ChecklistItem } from '@/features/saved-filters/ShareChecklist';
import { useCreateProgram, usePrograms } from './programsApi';
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
 * nhóm — nhóm chỉ được tạo khi bấm Lưu); người khác chỉ đọc danh sách. Quyền tra LƯỜI (chỉ khi mở) nên trang nhiều dự án
 * không bắn N yêu cầu quyền. Đang tải / lỗi của quyền và của danh mục nhóm được báo rõ, không giả làm "trống"/"không có quyền".
 */
export function GroupsCell({ project }: { project: ProjectDto }) {
  const [open, setOpen] = useState(false);
  const none = project.programs.length === 0;
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
          {groupCountLabel(project.programs.length)}
          <span className="sr-only">
            {none ? ' chưa thuộc nhóm nào, ' : ' của '}dự án {project.name}
          </span>
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
          <GroupsPopoverBody project={project} open={open} onClose={() => setOpen(false)} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Dòng trạng thái trong popover: đang tải (có `role="status"`) hoặc lỗi kèm "Thử lại". */
function Status({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 py-2 text-sm text-muted">
      <p role={onRetry ? 'alert' : 'status'}>{text}</p>
      {onRetry && (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          Thử lại
        </Button>
      )}
    </div>
  );
}

function GroupsPopoverBody({
  project,
  open,
  onClose,
}: {
  project: ProjectDto;
  open: boolean;
  onClose: () => void;
}) {
  const titleId = useId();
  const canAdmin = useLazyProjectCan(project.id, 'project:admin', open);
  const perms = useProjectPermissions(open ? project.id : null);
  let content: ReactNode;
  if (canAdmin) content = <GroupsEditor project={project} onClose={onClose} />;
  else if (perms.isError)
    content = (
      <Status
        text="Không tải được quyền của bạn ở dự án này."
        onRetry={() => void perms.refetch()}
      />
    );
  else if (perms.isPending) content = <Status text="Đang kiểm tra quyền…" />;
  else content = <ReadOnlyGroups groups={project.programs} />;
  return (
    <div aria-labelledby={titleId} role="group">
      <h3 id={titleId} className="mb-2 truncate text-sm font-medium text-ink-strong">
        Nhóm của {project.name}
      </h3>
      {content}
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

/** Nhóm gõ tại chỗ nhưng CHƯA tạo trên máy chủ — chỉ thành thật khi bấm Lưu (Huỷ/Esc không để lại gì). */
const DRAFT_PREFIX = 'new:';
const isDraft = (id: string) => id.startsWith(DRAFT_PREFIX);

function GroupsEditor({ project, onClose }: { project: ProjectDto; onClose: () => void }) {
  const catalog = usePrograms();
  const programs: readonly ProjectProgramRefDto[] = (catalog.data ?? []).map(
    ({ id, name, color }) => ({ id, name, color }),
  );
  const initial = project.programs.map((g) => g.id);
  const [ids, setIds] = useState<string[]>(initial);
  /** Nhóm mới gõ tại chỗ: id tạm `new:<n>` → tên. Bỏ tích = bỏ nhóm nháp. */
  const [drafts, setDrafts] = useState<{ id: string; name: string }[]>([]);
  const [newName, setNewName] = useState('');
  const canCreate = useAuth((s) => s.can('program:manage'));
  const save = useSetProjectPrograms();
  const create = useCreateProgram();
  const busy = save.isPending || create.isPending;
  const changed = !sameIds(ids, initial) || drafts.length > 0;

  const items: ChecklistItem[] = [
    ...programs.map((g) => ({ id: g.id, label: g.name })),
    ...drafts.map((d) => ({ id: d.id, label: d.name, hint: 'Nhóm mới' })),
  ].sort((a, b) => a.label.localeCompare(b.label, 'vi'));

  function toggle(id: string) {
    setIds((cur) => toggleId(cur, id));
    if (isDraft(id)) setDrafts((cur) => cur.filter((d) => d.id !== id));
  }

  /** Thêm nhóm nháp; tên trùng nhóm có sẵn (hoặc nháp khác) thì chỉ tích nhóm đó thay vì tạo trùng. */
  function addDraft() {
    const name = newName.trim();
    if (!name) return;
    const same = (n: string) => n.localeCompare(name, 'vi', { sensitivity: 'base' }) === 0;
    const existing = programs.find((g) => same(g.name)) ?? drafts.find((d) => same(d.name));
    if (existing) setIds((cur) => (cur.includes(existing.id) ? cur : [...cur, existing.id]));
    else {
      const id = `${DRAFT_PREFIX}${Date.now().toString(36)}${drafts.length}`;
      setDrafts((cur) => [...cur, { id, name }]);
      setIds((cur) => [...cur, id]);
    }
    setNewName('');
  }

  async function submit() {
    if (!changed || busy) return;
    let finalIds = ids;
    try {
      // Tạo các nhóm nháp (tuần tự); mỗi nhóm đã tạo được thay vào danh sách để lần thử lại không tạo trùng.
      for (const d of drafts) {
        const g = await create.mutateAsync({ name: d.name });
        finalIds = finalIds.map((x) => (x === d.id ? g.id : x));
        setIds(finalIds);
        setDrafts((cur) => cur.filter((x) => x.id !== d.id));
      }
      await save.mutateAsync({
        projectId: project.id,
        programIds: finalIds.filter((x) => !isDraft(x)),
      });
      toast.success(`Đã cập nhật nhóm của dự án ${project.name}.`);
      onClose();
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  if (catalog.isError)
    return <Status text="Không tải được danh sách nhóm." onRetry={() => void catalog.refetch()} />;
  if (catalog.isPending) return <Status text="Đang tải danh sách nhóm…" />;

  return (
    <div>
      <ShareChecklist
        label="Nhóm"
        items={items}
        selected={new Set(ids)}
        onToggle={toggle}
        searchPlaceholder="Tìm nhóm theo tên…"
        emptyText={items.length === 0 ? 'Chưa có nhóm nào.' : 'Không có nhóm nào khớp.'}
        disabled={busy}
      />
      {canCreate && (
        <div className="mt-2 flex items-center gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addDraft();
              }
            }}
            placeholder="Tên nhóm mới"
            aria-label="Tên nhóm mới"
            maxLength={120}
            className="h-8 text-sm"
          />
          <Button size="sm" variant="secondary" onClick={addDraft} disabled={!newName.trim()}>
            Thêm nhóm
          </Button>
        </div>
      )}
      {drafts.length > 0 && (
        <p className="mt-1.5 text-xs text-muted">Nhóm mới chỉ được tạo khi bạn bấm Lưu.</p>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onClose}>
          Huỷ
        </Button>
        <Button size="sm" onClick={() => void submit()} loading={busy} disabled={!changed}>
          Lưu
        </Button>
      </div>
    </div>
  );
}
