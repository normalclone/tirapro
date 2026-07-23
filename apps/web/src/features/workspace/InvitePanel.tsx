import { useMemo, useState, type FormEvent } from 'react';
import { Check, Copy, Mail, UserPlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { SYSTEM_ROLES } from '@tirapro/types';
import { Avatar } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { RoleMultiSelect } from '@/components/ui/RoleMultiSelect';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAuth } from '@/stores/auth';
import { useRoles } from '@/features/roles/api';
import { useAddMember, useAllUsers, useWorkspaceMembers } from '@/features/members/api';
import { useInvite } from './api';

/**
 * Thẻ "Thêm thành viên": luồng CHÍNH là chọn một người dùng CÓ SẴN từ pool hệ thống
 * (do system admin quản lý ở nơi khác) rồi gán vai trò và thêm vào workspace. Luồng
 * phụ "Mời bằng email" (tạo tài khoản mới + mật khẩu tạm) nằm sau một nút gạt.
 * Gated bằng `member:manage` — trùng với cách MembersPage kiểm tra quyền.
 */
export function InvitePanel() {
  const can = useAuth((s) => s.can);
  if (!can('member:manage')) return null;
  return <InvitePanelInner />;
}

function InvitePanelInner() {
  const [byEmail, setByEmail] = useState(false);

  return (
    <section className="rounded-lg border border-border bg-surface">
      <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary-subtle text-primary">
            <UserPlus className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-ink-strong">Thêm thành viên</h2>
            <p className="mt-0.5 text-sm text-muted">
              {byEmail
                ? 'Tạo tài khoản mới và cấp mật khẩu tạm để đăng nhập.'
                : 'Chọn người dùng có sẵn trong hệ thống và gán vai trò.'}
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setByEmail((v) => !v)}
        >
          {byEmail ? (
            <>
              <UserPlus className="h-4 w-4" />
              Chọn từ danh sách
            </>
          ) : (
            <>
              <Mail className="h-4 w-4" />
              Mời bằng email
            </>
          )}
        </Button>
      </div>

      {byEmail ? <InviteByEmail /> : <AddExistingUser />}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Luồng chính — chọn người dùng có sẵn                                 */
/* ------------------------------------------------------------------ */

function AddExistingUser() {
  const [search, setSearch] = useState('');
  const [userId, setUserId] = useState('');
  const [roleIds, setRoleIds] = useState<string[]>([]);

  const { data: members } = useWorkspaceMembers();
  const { data: users, isLoading: usersLoading } = useAllUsers(search);
  const { data: wsRoles } = useRoles('WORKSPACE');
  const addMember = useAddMember();

  const roleOptions = (wsRoles ?? []).map((r) => ({ id: r.id, name: r.name, color: r.color }));

  // Mặc định chọn vai trò "Workspace Member" khi có danh sách vai trò.
  const defaultRoleIds = useMemo(() => {
    const member = (wsRoles ?? []).find((r) => r.name === SYSTEM_ROLES.WORKSPACE_MEMBER);
    return member ? [member.id] : [];
  }, [wsRoles]);
  const effectiveRoleIds = roleIds.length > 0 ? roleIds : defaultRoleIds;

  // Loại người đã ở trong workspace khỏi pool.
  const memberUserIds = useMemo(
    () => new Set((members ?? []).map((m) => m.user.id)),
    [members],
  );
  const addableUsers = (users ?? []).filter((u) => !memberUserIds.has(u.id));
  const userSelectOptions = addableUsers.map((u) => ({
    value: u.id,
    label: u.displayName,
    hint: u.email,
  }));
  const picked = addableUsers.find((u) => u.id === userId);

  function reset() {
    setUserId('');
    setRoleIds([]);
    setSearch('');
  }

  function submit() {
    if (!userId) {
      toast.error('Chọn một người dùng.');
      return;
    }
    if (effectiveRoleIds.length === 0) {
      toast.error('Chọn ít nhất một vai trò.');
      return;
    }
    addMember.mutate(
      { userId, roleIds: effectiveRoleIds },
      {
        onSuccess: (m) => {
          toast.success(`Đã thêm ${m.user.displayName} vào workspace`);
          reset();
        },
        onError: (e) => toast.error(apiErrorMessage(e)),
      },
    );
  }

  return (
    <div className="space-y-4 p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <span className="text-sm font-medium text-ink">Người dùng</span>
          <SearchSelect
            value={userId}
            onChange={setUserId}
            options={userSelectOptions}
            placeholder="Chọn người dùng…"
            searchPlaceholder="Tìm theo tên hoặc email…"
            ariaLabel="Chọn người dùng để thêm vào workspace"
          />
          {!usersLoading && addableUsers.length === 0 && (
            <p className="text-xs text-faint">
              Mọi người dùng trong hệ thống đã là thành viên workspace.
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <span className="text-sm font-medium text-ink">Vai trò</span>
          <RoleMultiSelect
            options={roleOptions}
            value={effectiveRoleIds}
            onChange={setRoleIds}
            requireOne={false}
            disabled={addMember.isPending}
            placeholder="Mặc định (Workspace Member)"
            ariaLabel="Vai trò cho thành viên mới"
          />
        </div>
      </div>

      {picked && (
        <div className="flex items-center gap-3 rounded-md border border-border bg-surface-2 px-3 py-2.5">
          <Avatar name={picked.displayName} src={picked.avatarUrl} size={32} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ink">{picked.displayName}</p>
            <p className="truncate text-xs text-faint">{picked.email}</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setUserId('')}
            aria-label="Bỏ chọn người dùng"
            title="Bỏ chọn"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      <Button
        type="button"
        size="sm"
        onClick={submit}
        loading={addMember.isPending}
        disabled={!userId || effectiveRoleIds.length === 0}
      >
        <UserPlus className="h-4 w-4" />
        Thêm vào workspace
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Luồng phụ — mời bằng email (tạo tài khoản mới)                        */
/* ------------------------------------------------------------------ */

function InviteByEmail() {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const invite = useInvite();
  const { data: wsRoles } = useRoles('WORKSPACE');

  const roleOptions = (wsRoles ?? []).map((r) => ({ id: r.id, name: r.name, color: r.color }));

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim() || !displayName.trim() || invite.isPending) return;
    setTempPassword(null);
    invite.mutate(
      {
        email: email.trim(),
        displayName: displayName.trim(),
        roleIds: roleIds.length > 0 ? roleIds : undefined,
      },
      {
        onSuccess: (data) => {
          toast.success(`Đã mời ${data.email}`);
          setEmail('');
          setDisplayName('');
          setRoleIds([]);
          setCopied(false);
          setTempPassword(data.tempPassword ?? null);
        },
        onError: (err) => toast.error(apiErrorMessage(err)),
      },
    );
  }

  async function copyPassword() {
    if (!tempPassword) return;
    try {
      await navigator.clipboard.writeText(tempPassword);
      setCopied(true);
      toast.success('Đã sao chép mật khẩu tạm');
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Không sao chép được, hãy chọn và sao chép thủ công');
    }
  }

  return (
    <>
      <form onSubmit={onSubmit} className="space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-ink">Email</span>
            <Input
              type="email"
              required
              autoComplete="off"
              placeholder="ten@congty.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={invite.isPending}
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-ink">Tên hiển thị</span>
            <Input
              required
              placeholder="Nguyễn Văn A"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={invite.isPending}
            />
          </label>
        </div>

        <div className="space-y-1.5">
          <span className="text-sm font-medium text-ink">
            Vai trò <span className="font-normal text-faint">(tuỳ chọn)</span>
          </span>
          <RoleMultiSelect
            options={roleOptions}
            value={roleIds}
            onChange={setRoleIds}
            requireOne={false}
            disabled={invite.isPending}
            placeholder="Mặc định (Workspace Member)"
            ariaLabel="Vai trò cho người được mời"
          />
        </div>

        <Button
          type="submit"
          size="sm"
          loading={invite.isPending}
          disabled={!email.trim() || !displayName.trim()}
        >
          <UserPlus className="h-4 w-4" />
          Mời
        </Button>
      </form>

      {tempPassword && (
        <div className="border-t border-border px-5 py-4">
          <p className="text-sm font-medium text-ink-strong">Mật khẩu tạm</p>
          <p className="mt-0.5 text-sm text-muted">
            Gửi mật khẩu tạm này cho người được mời để họ đăng nhập lần đầu.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <Input
              readOnly
              value={tempPassword}
              aria-label="Mật khẩu tạm"
              onFocus={(e) => e.currentTarget.select()}
              className="font-mono"
            />
            <Button
              type="button"
              variant="secondary"
              size="icon"
              onClick={() => void copyPassword()}
              aria-label="Sao chép mật khẩu tạm"
              title="Sao chép"
            >
              {copied ? (
                <Check className={cn('h-4 w-4', 'text-success')} aria-hidden="true" />
              ) : (
                <Copy className="h-4 w-4" aria-hidden="true" />
              )}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
