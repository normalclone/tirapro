import { useDeferredValue, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { Check, Copy, Plus, Search, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/stores/auth';
import { Avatar, Badge, EmptyState, Skeleton } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { QueryError } from '@/components/ui/QueryError';
import { pageContainer } from '@/components/layout/page';
import { apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useCopyToClipboard } from '@/lib/useCopyToClipboard';
import { fmtRelative } from '@/lib/dateFormat';
import { passwordPolicyError } from '@/features/members/passwordPolicy';
import { AccountActionsMenu } from './AccountActionsMenu';
import { filterAccounts, type AccountStatusFilter } from './accountFilter';
import { useAdminUsers, useCreateAdminUser, useUpdateAdminUser, type AdminUser } from './api';
import { SWITCH_TOUCH_HIT } from '@/lib/touchHit';

const STATUS_FILTERS: { label: string; value: AccountStatusFilter | undefined }[] = [
  { label: 'Tất cả', value: undefined },
  { label: 'Đang hoạt động', value: 'ACTIVE' },
  { label: 'Đã vô hiệu hoá', value: 'DEACTIVATED' },
];

/** Màn Admin hệ thống: quản trị tài khoản toàn hệ thống + cấp quyền lập không gian làm việc. */
export function AdminUsersPage() {
  const me = useAuth((s) => s.user);
  const { data: users, isLoading, isError, error, refetch } = useAdminUsers();
  const update = useUpdateAdminUser();
  const [createOpen, setCreateOpen] = useState(false);
  // Hộp thoại luôn mount để có hiệu ứng đóng; mỗi lần mở là một `session` mới → form + mật khẩu tạm khởi tạo lại.
  const [session, setSession] = useState(0);
  // Ô tìm: gõ tới đâu lọc tới đó nhưng trễ 250 ms để danh sách dài không giật; lọc client vì danh sách không phân trang.
  const [searchInput, setSearchInput] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(searchInput), 250);
    return () => clearTimeout(t);
  }, [searchInput]);
  const search = useDeferredValue(debounced);
  const [status, setStatus] = useState<AccountStatusFilter | undefined>(undefined);
  const visible = useMemo(
    () => filterAccounts(users ?? [], { search, status }),
    [users, search, status],
  );

  if (me && !me.isSystemAdmin) return <Navigate to="/" replace />;

  function toggle(u: AdminUser, field: 'canCreateWorkspace' | 'isSystemAdmin') {
    update.mutate(
      { id: u.id, patch: { [field]: !u[field] } },
      { onError: (e) => toast.error(apiErrorMessage(e)) },
    );
  }

  return (
    <div className={pageContainer('md')}>
      <header className="mb-6 flex items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-ink-strong">
            <ShieldCheck className="h-6 w-6 text-primary" /> Tài khoản
          </h1>
          <p className="mt-1 text-sm text-muted">
            Tạo tài khoản và cấp quyền: được lập không gian làm việc mới, hoặc quản trị toàn hệ
            thống.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setSession((n) => n + 1);
            setCreateOpen(true);
          }}
        >
          <Plus className="h-4 w-4" /> Tạo tài khoản
        </Button>
      </header>

      {isError ? (
        <QueryError error={error} onRetry={() => void refetch()} />
      ) : isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : !users || users.length === 0 ? (
        <EmptyState title="Chưa có tài khoản" description="Tạo tài khoản đầu tiên cho hệ thống." />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <div className="relative min-w-52 flex-1">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint"
                aria-hidden
              />
              <Input
                type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Tìm theo tên hoặc email…"
                aria-label="Tìm tài khoản"
                className="pl-8"
              />
            </div>
            <div role="group" aria-label="Lọc theo trạng thái" className="flex gap-1">
              {STATUS_FILTERS.map((f) => (
                <Button
                  key={f.label}
                  size="sm"
                  variant={status === f.value ? 'secondary' : 'ghost'}
                  aria-pressed={status === f.value}
                  onClick={() => setStatus(f.value)}
                >
                  {f.label}
                </Button>
              ))}
            </div>
          </div>
          {visible.length === 0 ? (
            <EmptyState
              title="Không có tài khoản phù hợp"
              description="Thử gõ ít chữ hơn hoặc chọn “Tất cả”."
            />
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
              {visible.map((u) => (
                <li key={u.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                  <Avatar name={u.displayName} src={u.avatarUrl} size={36} />
                  <div className={cn('min-w-0 flex-1', u.status === 'DEACTIVATED' && 'opacity-60')}>
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-ink">
                      {u.displayName}
                      {u.isSystemAdmin && (
                        <Badge className="bg-primary-subtle text-primary">Admin hệ thống</Badge>
                      )}
                      {u.isAutomation && (
                        <Badge className="bg-surface-2 text-muted">Tài khoản hệ thống</Badge>
                      )}
                      {u.status === 'DEACTIVATED' && (
                        <Badge className="bg-surface-2 text-muted">Đã vô hiệu hoá</Badge>
                      )}
                    </p>
                    <p className="truncate text-xs text-faint">
                      {u.email} · {u.workspaceCount} không gian làm việc
                    </p>
                    <p className="truncate text-xs text-faint">
                      {u.lastSeenAt
                        ? `Hoạt động gần nhất: ${fmtRelative(u.lastSeenAt)}`
                        : 'Chưa từng đăng nhập'}
                    </p>
                  </div>
                  {/* < sm: công tắc xuống hàng riêng, xếp dọc (nhãn trái, công tắc phải); menu thao tác lên cạnh tên. */}
                  <div className="flex shrink-0 items-center gap-4 max-sm:order-3 max-sm:w-full max-sm:flex-col max-sm:items-stretch max-sm:gap-0">
                    <Toggle
                      label="Được lập không gian làm việc"
                      on={u.canCreateWorkspace}
                      disabled={update.isPending}
                      onChange={() => toggle(u, 'canCreateWorkspace')}
                    />
                    <Toggle
                      label="Admin HT"
                      on={u.isSystemAdmin}
                      disabled={update.isPending || u.id === me?.id}
                      onChange={() => toggle(u, 'isSystemAdmin')}
                    />
                  </div>
                  {u.id !== me?.id && !u.isAutomation && (
                    <span className="max-sm:order-2">
                      <AccountActionsMenu user={u} />
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <CreateUserModal key={session} open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}

/** Switch nhỏ có nhãn — bật/tắt một quyền của user. */
function Toggle({
  label,
  on,
  disabled,
  onChange,
}: {
  label: string;
  on: boolean;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <label
      className={cn(
        'flex items-center gap-2 text-xs max-sm:justify-between [@media(pointer:coarse)]:max-sm:min-h-11',
        disabled && 'opacity-50',
      )}
    >
      <span className="text-muted">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        disabled={disabled}
        onClick={onChange}
        className={cn(
          'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
          SWITCH_TOUCH_HIT,
          on ? 'bg-primary' : 'bg-surface-3',
        )}
      >
        <span
          className={cn(
            'inline-block h-4 w-4 rounded-full bg-white shadow transition-transform',
            on ? 'translate-x-4' : 'translate-x-0.5',
          )}
        />
      </button>
    </label>
  );
}

function CreateUserModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateAdminUser();
  // Mật khẩu tạm không được nằm lại trong MutationCache sau khi đóng modal ("chỉ hiện một lần").
  const resetCreate = create.reset;
  useEffect(() => resetCreate, [resetCreate]);
  function close() {
    resetCreate();
    onClose();
  }
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [canCreateWorkspace, setCanCreate] = useState(false);
  const [isSystemAdmin, setIsAdmin] = useState(false);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const { copied, copy } = useCopyToClipboard();

  const passwordError = passwordPolicyError(password);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim() || !displayName.trim() || create.isPending || passwordError) return;
    create.mutate(
      {
        email: email.trim(),
        displayName: displayName.trim(),
        password: password.trim() || undefined,
        canCreateWorkspace,
        isSystemAdmin,
      },
      {
        onSuccess: (u) => {
          toast.success(`Đã tạo tài khoản ${u.email}`);
          if (u.tempPassword) setTempPassword(u.tempPassword);
          else close();
        },
        onError: (err) => toast.error(apiErrorMessage(err)),
      },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) close();
      }}
      title="Tạo tài khoản"
      size="md"
    >
      {tempPassword ? (
        <div className="space-y-3">
          <p className="text-sm text-ink">Đã tạo tài khoản. Gửi mật khẩu tạm này cho người dùng:</p>
          <div className="flex items-center gap-2">
            <Input
              readOnly
              value={tempPassword}
              className="font-mono"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button
              type="button"
              variant="secondary"
              size="icon"
              onClick={() => void copy(tempPassword ?? '')}
              aria-label="Sao chép"
            >
              {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <div className="flex justify-end">
            <Button size="sm" onClick={close}>
              Xong
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-ink">Email</span>
            <Input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ten@congty.com"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-ink">Tên hiển thị</span>
            <Input
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Nguyễn Văn A"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-ink">
              Mật khẩu <span className="font-normal text-faint">(bỏ trống = sinh tạm)</span>
            </span>
            <Input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Tối thiểu 8 ký tự, gồm chữ hoa, chữ thường và số"
              aria-invalid={passwordError ? true : undefined}
            />
            {passwordError && <p className="text-xs text-danger">{passwordError}</p>}
          </label>
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={canCreateWorkspace}
                onChange={(e) => setCanCreate(e.target.checked)}
                className="h-4 w-4 rounded border-border"
              />
              Được lập không gian làm việc mới
            </label>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={isSystemAdmin}
                onChange={(e) => setIsAdmin(e.target.checked)}
                className="h-4 w-4 rounded border-border"
              />
              Admin hệ thống
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" size="sm" onClick={close}>
              Huỷ
            </Button>
            <Button
              type="submit"
              size="sm"
              loading={create.isPending}
              disabled={!email.trim() || !displayName.trim() || !!passwordError}
            >
              Tạo tài khoản
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
