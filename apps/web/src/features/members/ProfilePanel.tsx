import { useState, type FormEvent } from 'react';
import { UserCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { AvatarUploader } from '@/components/ui/AvatarUploader';
import { apiErrorMessage } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { useUpdateProfile, useUploadUserAvatar, useRemoveUserAvatar } from './api';

const LOCALES: { value: string; label: string }[] = [
  { value: 'vi', label: 'Tiếng Việt' },
  { value: 'en', label: 'English' },
];

export function ProfilePanel() {
  const user = useAuth((s) => s.user);
  const update = useUpdateProfile();
  const uploadAvatar = useUploadUserAvatar();
  const removeAvatar = useRemoveUserAvatar();

  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [timezone, setTimezone] = useState(user?.timezone ?? '');
  const [locale, setLocale] = useState(user?.locale ?? 'vi');

  if (!user) return null;

  const dirty =
    displayName.trim() !== user.displayName ||
    timezone.trim() !== user.timezone ||
    locale !== user.locale;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!user || update.isPending) return;
    const trimmed = displayName.trim();
    if (!trimmed) {
      toast.error('Tên hiển thị không được để trống.');
      return;
    }
    update.mutate(
      { displayName: trimmed, timezone: timezone.trim(), locale },
      {
        onSuccess: () => toast.success('Đã lưu hồ sơ'),
        onError: (err) => toast.error(apiErrorMessage(err)),
      },
    );
  }

  return (
    <section className="rounded-lg border border-border bg-surface">
      <div className="flex items-start gap-3 border-b border-border px-5 py-4">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary-subtle text-primary">
          <UserCircle className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-base font-semibold text-ink-strong">Hồ sơ của tôi</h2>
          <p className="mt-0.5 text-sm text-muted">
            Thông tin cá nhân hiển thị với các thành viên khác.
          </p>
        </div>
      </div>

      <form onSubmit={onSubmit} className="space-y-5 p-5">
        <AvatarUploader
          name={user.displayName}
          src={user.avatarUrl}
          size={64}
          uploadFn={(f) => uploadAvatar.mutateAsync(f)}
          onRemove={user.avatarUrl ? () => removeAvatar.mutateAsync() : undefined}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-ink">Tên hiển thị</span>
            <Input
              value={displayName}
              required
              placeholder="Nguyễn Văn A"
              autoComplete="name"
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={update.isPending}
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-ink">Múi giờ</span>
            <Input
              value={timezone}
              placeholder="Asia/Ho_Chi_Minh"
              autoComplete="off"
              onChange={(e) => setTimezone(e.target.value)}
              disabled={update.isPending}
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-ink">Ngôn ngữ</span>
            <select
              value={locale}
              onChange={(e) => setLocale(e.target.value)}
              disabled={update.isPending}
              className="h-9 w-full rounded-md border border-border bg-bg px-3 text-base text-ink transition-colors duration-150 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:opacity-50"
            >
              {LOCALES.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex justify-end">
          <Button type="submit" loading={update.isPending} disabled={!dirty}>
            Lưu
          </Button>
        </div>
      </form>
    </section>
  );
}
