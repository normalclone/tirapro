import { useMemo, useRef, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { MemberDto } from '@tirapro/types';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { RadioCard } from '@/components/ui/RadioCard';
import { Avatar } from '@/components/ui/primitives';
import { CopyLinkRow } from '@/features/sharing/CopyLinkRow';
import { useWorkspaceMembers } from '@/features/members/api';
import { useProjects } from '@/features/projects/api';
import { api, apiErrorMessage } from '@/lib/api';
import { filterUrl } from '@/lib/copyText';
import { fmtNumber } from '@/lib/locale';
import { keys } from '@/lib/queryKeys';
import { useOpenSession } from '@/lib/useOpenSession';
import { useAuth } from '@/stores/auth';
import { useUpdateFilter, type FilterVisibility, type SavedFilter } from './api';
import {
  audienceOf,
  canChangeFilterShare,
  draftChanged,
  draftError,
  draftFrom,
  draftPatch,
  type AudiencePerson,
  type ShareDraft,
} from './filterShare';
import { ShareChecklist, type ChecklistItem } from './ShareChecklist';

/** Tối đa chừng này avatar trong khối "Ai có quyền xem"; phần còn lại gộp "+N". */
const AVATAR_LIMIT = 6;

/**
 * "Chia sẻ" của một bộ lọc đã lưu: "Chỉ mình tôi" hoặc "Chia sẻ" với NHIỀU dự án (thành viên dự án thấy) và/hoặc từng
 * người cụ thể cùng lúc. Chủ (`filter:manage`) chọn rồi bấm "Lưu" (PATCH ngay, Cmd/Ctrl+Enter cũng lưu); người khác chỉ xem
 * ai có quyền + sao chép liên kết `/filters/:id`. Kết quả chạy luôn theo quyền của người xem.
 * Luôn mount (có hiệu ứng đóng): `filter = null` là đóng; mỗi lần mở là một lần mount mới nên bản nháp khởi tạo lại.
 */
export function FilterShareDialog({
  filter,
  canManage,
  onClose,
}: {
  filter: SavedFilter | null;
  canManage: boolean;
  onClose: () => void;
}) {
  const open = filter !== null;
  const session = useOpenSession(open);
  // Giữ bộ lọc cuối cùng trong lúc hiệu ứng đóng chạy (nội dung không nhảy thành trống).
  const last = useRef<SavedFilter | null>(filter);
  if (filter) last.current = filter;
  const shown = filter ?? last.current;
  if (!shown) return null;
  return (
    <ShareDialogInner
      key={session}
      open={open}
      filter={shown}
      canManage={canManage}
      onClose={onClose}
    />
  );
}

const MODE_OPTIONS = [
  {
    value: 'PRIVATE' as const,
    label: 'Chỉ mình tôi',
    description: 'Chỉ bạn xem được bộ lọc này.',
  },
  {
    value: 'SHARED' as const,
    label: 'Chia sẻ',
    description:
      'Thành viên của các dự án bạn chọn và những người bạn chọn sẽ thấy bộ lọc; kết quả vẫn theo quyền của người xem.',
  },
];

function toggled(list: readonly string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

function ShareDialogInner({
  open,
  filter,
  canManage,
  onClose,
}: {
  open: boolean;
  filter: SavedFilter;
  canManage: boolean;
  onClose: () => void;
}) {
  const saved = draftFrom(filter);
  const [draft, setDraft] = useState<ShareDraft>(saved);
  const update = useUpdateFilter();
  const editable = canChangeFilterShare(filter, canManage);
  const error = draftError(draft);
  const changed = draftChanged(draft, saved);

  async function save() {
    // Chặn gửi lặp: Cmd/Ctrl+Enter đi vòng qua trạng thái loading của nút.
    if (!editable || error || !changed || update.isPending) return;
    try {
      await update.mutateAsync({ id: filter.id, ...draftPatch(draft) });
      toast.success(
        draft.visibility === 'PRIVATE'
          ? `Bộ lọc “${filter.name}” giờ chỉ mình bạn xem được.`
          : `Đã cập nhật chia sẻ của bộ lọc “${filter.name}”.`,
      );
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
      title="Chia sẻ bộ lọc"
      description={filter.name}
      size="md"
      onSubmit={editable ? () => void save() : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {editable ? 'Huỷ' : 'Đóng'}
          </Button>
          {editable && (
            <Button
              onClick={() => void save()}
              loading={update.isPending}
              disabled={!!error || !changed}
            >
              Lưu
            </Button>
          )}
        </>
      }
    >
      {editable ? (
        <>
          <RadioCard<FilterVisibility>
            ariaLabel="Ai xem được bộ lọc"
            size="sm"
            value={draft.visibility}
            onChange={(visibility) => setDraft((d) => ({ ...d, visibility }))}
            options={MODE_OPTIONS}
          />
          {draft.visibility === 'SHARED' && <SharedTargets draft={draft} onChange={setDraft} />}
          {error && (
            <p role="alert" className="mt-3 text-sm text-danger">
              {error}
            </p>
          )}
        </>
      ) : (
        <ReadOnlyShare filter={filter} />
      )}
      <AudienceBlock filter={filter} draft={editable ? draft : saved} />
      <CopyLinkRow url={filterUrl(filter.id)} unsavedChange={editable && changed} />
    </Dialog>
  );
}

/** Chọn nhiều dự án + nhiều người. Dự án: những dự án CHỦ thấy (máy chủ lọc) và chưa lưu trữ — dự án đã chọn luôn hiện. */
function SharedTargets({
  draft,
  onChange,
}: {
  draft: ShareDraft;
  onChange: (d: ShareDraft) => void;
}) {
  const me = useAuth((s) => s.user?.id);
  const { data: projects } = useProjects(true);
  const { data: members } = useWorkspaceMembers();

  const projectItems: ChecklistItem[] = useMemo(
    () =>
      (projects ?? [])
        .filter((p) => !p.isArchived || draft.projectIds.includes(p.id))
        .map((p) => ({ id: p.id, label: p.name, hint: p.key })),
    [projects, draft.projectIds],
  );
  const peopleItems: ChecklistItem[] = useMemo(
    () =>
      (members ?? [])
        .filter((m) => m.user.id !== me && m.user.status !== 'DEACTIVATED')
        .map((m) => ({
          id: m.user.id,
          label: m.user.displayName,
          hint: m.user.email,
          person: { avatarUrl: m.user.avatarUrl },
        })),
    [members, me],
  );
  const selectedProjects = useMemo(() => new Set(draft.projectIds), [draft.projectIds]);
  const selectedUsers = useMemo(() => new Set(draft.userIds), [draft.userIds]);

  return (
    <div className="mt-4 space-y-4">
      <ShareChecklist
        label="Dự án — thành viên dự án thấy"
        items={projectItems}
        selected={selectedProjects}
        onToggle={(id) => onChange({ ...draft, projectIds: toggled(draft.projectIds, id) })}
        searchPlaceholder="Tìm dự án theo tên hoặc mã…"
        emptyText={projects ? 'Không có dự án nào khớp.' : 'Đang tải dự án…'}
      />
      <ShareChecklist
        label="Người cụ thể"
        items={peopleItems}
        selected={selectedUsers}
        onToggle={(id) => onChange({ ...draft, userIds: toggled(draft.userIds, id) })}
        searchPlaceholder="Tìm theo tên hoặc email…"
        emptyText={members ? 'Không có ai khớp.' : 'Đang tải danh sách…'}
      />
    </div>
  );
}

/** Người không phải chủ: chỉ xem (chủ, dự án họ thấy, chính họ nếu được chia sẻ trực tiếp). */
function ReadOnlyShare({ filter }: { filter: SavedFilter }) {
  return (
    <div className="space-y-2 text-sm text-muted">
      <p>
        {filter.owner ? `${filter.owner.displayName} chia sẻ` : 'Bộ lọc này được chia sẻ'} cho bạn.
        Chỉ người tạo mới đổi được ai xem bộ lọc.
      </p>
      {filter.sharedProjects.length > 0 && (
        <p>
          Qua dự án:{' '}
          <span className="text-ink">{filter.sharedProjects.map((p) => p.name).join(', ')}</span>
        </p>
      )}
    </div>
  );
}

/**
 * "Ai có quyền xem": số người = HỢP thành viên các dự án đã chọn và người được chọn cụ thể, không đếm trùng, không tính
 * chủ bộ lọc. Thành viên từng dự án lấy từ `GET /projects/:id/members` (cache chung). Chỉ chủ thấy danh sách đầy đủ; người
 * khác chỉ thấy phần được chia sẻ cho họ nên khối này hiện số theo dữ liệu họ có.
 */
function AudienceBlock({ filter, draft }: { filter: SavedFilter; draft: ShareDraft }) {
  const { data: members } = useWorkspaceMembers(filter.isOwner);
  const shared = draft.visibility === 'SHARED';
  const projectIds = shared ? draft.projectIds : [];
  const memberQueries = useQueries({
    queries: projectIds.map((pid) => ({
      queryKey: keys.members.project(pid),
      queryFn: async () => (await api.get<MemberDto[]>(`/projects/${pid}/members`)).data,
      enabled: filter.isOwner,
    })),
  });

  const projectMembers: Record<string, (AudiencePerson & { active: boolean })[] | undefined> = {};
  projectIds.forEach((pid, i) => {
    const data = memberQueries[i]?.data;
    projectMembers[pid] = data?.map((m) => ({
      id: m.user.id,
      name: m.user.displayName,
      avatarUrl: m.user.avatarUrl,
      active: m.user.status !== 'DEACTIVATED',
    }));
  });
  const people: Record<string, AudiencePerson> = {};
  for (const m of members ?? [])
    people[m.user.id] = { id: m.user.id, name: m.user.displayName, avatarUrl: m.user.avatarUrl };
  if (!filter.isOwner)
    for (const u of filter.sharedUsers)
      people[u.id] = { id: u.id, name: u.displayName, avatarUrl: u.avatarUrl };

  const failed = memberQueries.some((q) => q.isError);
  const aud = audienceOf({
    projectIds,
    userIds: shared ? draft.userIds : [],
    projectMembers,
    people,
    ownerId: filter.ownerId,
  });
  const shown = aud.people.slice(0, AVATAR_LIMIT);
  const extra = aud.people.length - shown.length;
  const headline = !shared
    ? 'Chỉ bạn'
    : aud.loading
      ? 'Đang tính số người xem được…'
      : `${fmtNumber(aud.people.length)} người xem được (ngoài chủ bộ lọc)`;
  const names =
    shown.length > 0
      ? `Gồm ${shown.map((p) => p.name).join(', ')}${extra > 0 ? ` và ${extra} người khác` : ''}.`
      : null;

  return (
    <section aria-labelledby="share-audience" className="mt-4 rounded-lg border border-border p-3">
      <h3 id="share-audience" className="text-xs font-medium text-muted">
        Ai có quyền xem
      </h3>
      <div className="mt-2 flex items-center gap-2.5">
        {shown.length > 0 && (
          <span className="flex shrink-0 -space-x-1.5" aria-hidden="true">
            {shown.map((p) => (
              <span key={p.id} className="rounded-full ring-2 ring-surface">
                <Avatar name={p.name} src={p.avatarUrl} size={24} decorative />
              </span>
            ))}
            {extra > 0 && (
              <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-surface-2 px-1.5 text-[11px] font-medium text-muted ring-2 ring-surface">
                +{fmtNumber(extra)}
              </span>
            )}
          </span>
        )}
        <div className="min-w-0">
          <p className="text-sm text-ink">
            {headline}
            {names && <span className="sr-only">. {names}</span>}
          </p>
          {shared && failed && (
            <p className="text-xs text-muted">
              Không tải được danh sách thành viên của một số dự án.
            </p>
          )}
          {shared && !filter.isOwner && (
            <p className="text-xs text-muted">Bạn chỉ thấy phần được chia sẻ cho bạn.</p>
          )}
        </div>
      </div>
    </section>
  );
}
