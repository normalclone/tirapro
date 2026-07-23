import { useMemo, useState, type FormEvent } from 'react';
import { Eye, EyeOff, KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useChangePassword } from './api';

/** Quy tắc mật khẩu — khớp với passwordSchema ở backend. */
const RULES: { test: (v: string) => boolean; label: string }[] = [
  { test: (v) => v.length >= 8, label: 'Tối thiểu 8 ký tự' },
  { test: (v) => /[a-z]/.test(v), label: '1 chữ thường' },
  { test: (v) => /[A-Z]/.test(v), label: '1 chữ hoa' },
  { test: (v) => /[0-9]/.test(v), label: '1 chữ số' },
];

export function ChangePasswordPanel() {
  const change = useChangePassword();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);

  const rulesPass = useMemo(() => RULES.map((r) => r.test(next)), [next]);
  const allRulesPass = rulesPass.every(Boolean);
  const confirmMismatch = confirm.length > 0 && confirm !== next;

  const canSubmit =
    current.length > 0 && allRulesPass && next === confirm && !change.isPending;

  function reset() {
    setCurrent('');
    setNext('');
    setConfirm('');
    setShow(false);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    change.mutate(
      { currentPassword: current, newPassword: next },
      {
        onSuccess: () => {
          toast.success('Đã đổi mật khẩu');
          reset();
        },
        onError: (err) => toast.error(apiErrorMessage(err)),
      },
    );
  }

  return (
    <section className="rounded-lg border border-border bg-surface">
      <div className="flex items-start gap-3 border-b border-border px-5 py-4">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary-subtle text-primary">
          <KeyRound className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-base font-semibold text-ink-strong">Đổi mật khẩu</h2>
          <p className="mt-0.5 text-sm text-muted">
            Cần nhập mật khẩu hiện tại để xác minh.
          </p>
        </div>
      </div>

      <form onSubmit={onSubmit} className="space-y-5 p-5">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-ink">Mật khẩu hiện tại</span>
          <Input
            type={show ? 'text' : 'password'}
            value={current}
            required
            autoComplete="current-password"
            placeholder="••••••••"
            onChange={(e) => setCurrent(e.target.value)}
            disabled={change.isPending}
          />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-ink">Mật khẩu mới</span>
            <Input
              type={show ? 'text' : 'password'}
              value={next}
              required
              autoComplete="new-password"
              placeholder="••••••••"
              onChange={(e) => setNext(e.target.value)}
              disabled={change.isPending}
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-ink">Xác nhận mật khẩu mới</span>
            <Input
              type={show ? 'text' : 'password'}
              value={confirm}
              required
              autoComplete="new-password"
              placeholder="••••••••"
              onChange={(e) => setConfirm(e.target.value)}
              disabled={change.isPending}
              aria-invalid={confirmMismatch}
            />
          </label>
        </div>

        {/* Checklist quy tắc — hiện khi đã bắt đầu nhập mật khẩu mới */}
        {next.length > 0 && (
          <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
            {RULES.map((r, i) => (
              <li
                key={r.label}
                className={cn(
                  'flex items-center gap-1.5 text-xs',
                  rulesPass[i] ? 'text-success' : 'text-faint',
                )}
              >
                <span
                  className={cn(
                    'inline-block h-1.5 w-1.5 rounded-full',
                    rulesPass[i] ? 'bg-success' : 'bg-border',
                  )}
                />
                {r.label}
              </li>
            ))}
          </ul>
        )}

        {confirmMismatch && (
          <p className="text-xs text-danger">Mật khẩu xác nhận chưa khớp.</p>
        )}

        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted transition-colors hover:text-ink"
          >
            {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
          </button>
          <Button type="submit" loading={change.isPending} disabled={!canSubmit}>
            Đổi mật khẩu
          </Button>
        </div>
      </form>
    </section>
  );
}
