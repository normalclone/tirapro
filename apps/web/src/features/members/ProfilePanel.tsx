import { useRef, useState, type FormEvent } from 'react';
import { UserCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/Input';
import { AvatarUploader } from '@/components/ui/AvatarUploader';
import { apiErrorMessage } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { useUnsavedChanges } from '@/lib/useUnsavedChanges';
import { useUpdateProfile, useUploadUserAvatar, useRemoveUserAvatar } from './api';
import { browserTimeZone, timeZoneOptions } from '@/features/digests/schedule';
import { SegmentedControl } from '@/components/ui/SegmentedControl';

const LOCALES: { value: string; label: string }[] = [
  { value: 'vi', label: 'Tiếng Việt' },
  { value: 'en', label: 'English' },
];

export function ProfilePanel() {
  const user = useAuth((s) => s.user);
  const update = useUpdateProfile();
  const uploadAvatar = useUploadUserAvatar();
  const removeAvatar = useRemoveUserAvatar();

  // Mốc "đã lưu gần nhất": lưu xong cập nhật ngay, không chờ `bootstrap()` làm mới user → dirty về false tức thì.
  const [saved, setSaved] = useState({
    displayName: user?.displayName ?? '',
    timezone: user?.timezone ?? '',
    locale: user?.locale ?? 'vi',
  });
  const [displayName, setDisplayName] = useState(saved.displayName);
  const [timezone, setTimezone] = useState(saved.timezone);
  const [locale, setLocale] = useState(saved.locale);
  const formRef = useRef<HTMLFormElement>(null);

  const dirty =
    displayName.trim() !== saved.displayName ||
    timezone.trim() !== saved.timezone ||
    locale !== saved.locale;

  useUnsavedChanges({
    dirty,
    saving: update.isPending,
    canSave: !update.isPending,
    // requestSubmit: chạy kiểm tra `required` + onSubmit y như bấm Enter.
    onSave: () => formRef.current?.requestSubmit(),
    onReset: () => {
      setDisplayName(saved.displayName);
      setTimezone(saved.timezone);
      setLocale(saved.locale);
    },
    description: 'Tên hiển thị, múi giờ hoặc ngôn ngữ bạn vừa sửa chưa được lưu.',
  });

  if (!user) return null;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!user || update.isPending) return;
    const trimmed = displayName.trim();
    if (!trimmed) {
      toast.error('Hãy nhập tên hiển thị — đây là tên đồng nghiệp nhìn thấy');
      return;
    }
    const next = { displayName: trimmed, timezone: timezone.trim(), locale };
    update.mutate(next, {
      onSuccess: () => {
        setSaved(next);
        setDisplayName(next.displayName);
        setTimezone(next.timezone);
        toast.success('Đã lưu hồ sơ của bạn');
      },
      onError: (err) => toast.error(apiErrorMessage(err)),
    });
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
            Những thông tin này hiện với mọi thành viên khác, ở mọi không gian làm việc bạn tham
            gia.
          </p>
        </div>
      </div>

      <form ref={formRef} onSubmit={onSubmit} className="space-y-5 p-5">
        <AvatarUploader
          name={user.displayName}
          src={user.avatarUrl}
          size={64}
          uploadFn={(f) => uploadAvatar.mutateAsync(f)}
          onRemove={user.avatarUrl ? () => removeAvatar.mutateAsync() : undefined}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1.5">
            <span
              className="text-sm font-medium text-ink"
              title="Tên đồng nghiệp nhìn thấy khi bạn được giao việc hoặc bình luận"
            >
              Tên hiển thị
            </span>
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
            <span
              className="text-sm font-medium text-ink"
              title="Dùng để hiện đúng giờ hạn chót và lịch theo nơi bạn ngồi"
            >
              Múi giờ
            </span>
            <Input
              value={timezone}
              placeholder={`VD: ${browserTimeZone()}`}
              list="profile-timezones"
              autoComplete="off"
              onChange={(e) => setTimezone(e.target.value)}
              disabled={update.isPending}
            />
            <datalist id="profile-timezones">
              {timeZoneOptions().map((tz) => (
                <option key={tz} value={tz} />
              ))}
            </datalist>
          </label>

          <div className="block space-y-1.5">
            <span id="profile-locale-label" className="block text-sm font-medium text-ink">
              Ngôn ngữ
            </span>
            <SegmentedControl
              ariaLabelledby="profile-locale-label"
              value={locale}
              onChange={setLocale}
              disabled={update.isPending}
              fullWidth
              options={LOCALES}
            />
          </div>
        </div>

        {/* Enter trong ô nhập vẫn lưu: nút gửi mặc định ẩn (nút Lưu thật nằm ở thanh "thay đổi chưa lưu"). */}
        <button type="submit" className="sr-only" tabIndex={-1} aria-hidden />
      </form>
    </section>
  );
}
