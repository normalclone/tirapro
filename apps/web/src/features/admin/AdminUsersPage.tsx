import { useEffect, useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { Check, Copy, Plus, ShieldCheck, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/stores/auth';
import { Avatar, Badge, EmptyState, Skeleton } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { QueryError } from '@/components/ui/QueryError';
import { pageContainer } from '@/components/layout/page';
import { apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  useAdminUsers,
  useCreateAdminUser,
  useUpdateAdminUser,
  type AdminUser,
} from './api';

/** Màn Admin hệ thống: quản trị tài khoản toàn hệ thống + cấp quyền tạo workspace. */
export function AdminUsersPage() {
  const me = useAuth((s) => s.user);
  const { data: users, isLoading, isError, error, refetch } = useAdminUsers();
  const update = useUpdateAdminUser();
  const [createOpen, setCreateOpen] = useState(false);

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
            Tạo tài khoản người dùng và cấp quyền tạo workspace, quản trị toàn hệ thống.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" /> Tạo tài khoản
        </Button>
      </header>

      {isError ? (
        <QueryError error={error} onRetry={() => void refetch()} />
      ) : isLoading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : !users || users.length === 0 ? (
        <EmptyState title="Chưa có tài khoản" description="Tạo tài khoản đầu tiên cho hệ thống." />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
          {users.map((u) => (
            <li key={u.id} className="flex items-center gap-3 px-4 py-3">
              <Avatar name={u.displayName} src={u.avatarUrl} size={36} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 truncate text-sm font-medium text-ink">
                  {u.displayName}
                  {u.isSystemAdmin && <Badge className="bg-primary-subtle text-primary">Admin hệ thống</Badge>}
                </p>
                <p className="truncate text-xs text-faint">{u.email} · {u.workspaceCount} workspace</p>
              </div>
              <div className="flex shrink-0 items-center gap-4">
                <Toggle
                  label="Tạo workspace"
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
            </li>
          ))}
        </ul>
      )}

      {createOpen && <CreateUserModal onClose={() => setCreateOpen(false)} />}
    </div>
  );
}

/** Switch nhỏ có nhãn — bật/tắt một quyền của user. */
function Toggle({ label, on, disabled, onChange }: { label: string; on: boolean; disabled?: boolean; onChange: () => void }) {
  return (
    <label className={cn('flex items-center gap-2 text-xs', disabled && 'opacity-50')}>
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
          on ? 'bg-primary' : 'bg-surface-3',
        )}
      >
        <span className={cn('inline-block h-4 w-4 rounded-full bg-white shadow transition-transform', on ? 'translate-x-4' : 'translate-x-0.5')} />
      </button>
    </label>
  );
}

function CreateUserModal({ onClose }: { onClose: () => void }) {
  const create = useCreateAdminUser();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [canCreateWorkspace, setCanCreate] = useState(false);
  const [isSystemAdmin, setIsAdmin] = useState(false);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim() || !displayName.trim() || create.isPending) return;
    create.mutate(
      { email: email.trim(), displayName: displayName.trim(), password: password.trim() || undefined, canCreateWorkspace, isSystemAdmin },
      {
        onSuccess: (u) => {
          toast.success(`Đã tạo tài khoản ${u.email}`);
          if (u.tempPassword) setTempPassword(u.tempPassword);
          else onClose();
        },
        onError: (err) => toast.error(apiErrorMessage(err)),
      },
    );
  }

  async function copyTemp() {
    if (!tempPassword) return;
    try { await navigator.clipboard.writeText(tempPassword); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ }
  }

  return (
    <div className="fixed inset-0 z-modal grid place-items-center p-4">
      <button type="button" aria-label="Đóng" onClick={onClose} className="absolute inset-0 bg-ink/40 backdrop-blur-[1px]" />
      <div className="relative w-full max-w-md overflow-hidden rounded-xl border border-border bg-surface shadow-lg animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <h2 className="text-base font-semibold text-ink-strong">Tạo tài khoản</h2>
          <button type="button" onClick={onClose} aria-label="Đóng" className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink"><X className="h-4 w-4" /></button>
        </div>

        {tempPassword ? (
          <div className="space-y-3 p-5">
            <p className="text-sm text-ink">Đã tạo tài khoản. Gửi mật khẩu tạm này cho người dùng:</p>
            <div className="flex items-center gap-2">
              <Input readOnly value={tempPassword} className="font-mono" onFocus={(e) => e.currentTarget.select()} />
              <Button type="button" variant="secondary" size="icon" onClick={() => void copyTemp()} aria-label="Sao chép">
                {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <div className="flex justify-end"><Button size="sm" onClick={onClose}>Xong</Button></div>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4 p-5">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-ink">Email</span>
              <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ten@congty.com" />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-ink">Tên hiển thị</span>
              <Input required value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Nguyễn Văn A" />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-ink">Mật khẩu <span className="font-normal text-faint">(bỏ trống = sinh tạm)</span></span>
              <Input type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Tối thiểu 6 ký tự" />
            </label>
            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" checked={canCreateWorkspace} onChange={(e) => setCanCreate(e.target.checked)} className="h-4 w-4 rounded border-border" />
                Quyền tạo workspace
              </label>
              <label className="flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" checked={isSystemAdmin} onChange={(e) => setIsAdmin(e.target.checked)} className="h-4 w-4 rounded border-border" />
                Admin hệ thống
              </label>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" size="sm" onClick={onClose}>Huỷ</Button>
              <Button type="submit" size="sm" loading={create.isPending} disabled={!email.trim() || !displayName.trim()}>Tạo tài khoản</Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
