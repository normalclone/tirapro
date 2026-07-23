import { Bell } from 'lucide-react';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/primitives';
import { apiErrorMessage } from '@/lib/api';
import { SectionCard } from './SectionCard';
import { useNotificationPrefs, useUpdateNotificationPrefs } from './api';

/** Thứ tự + nhãn tiếng Việt cho từng loại thông báo. */
const NOTIFICATION_TYPES: { key: string; label: string; hint: string }[] = [
  { key: 'ISSUE_ASSIGNED', label: 'Được giao việc', hint: 'Khi bạn được gán vào một issue' },
  { key: 'MENTIONED', label: 'Được nhắc đến (@)', hint: 'Khi ai đó @ bạn trong bình luận' },
  { key: 'COMMENT_ADDED', label: 'Bình luận mới', hint: 'Bình luận mới trên issue liên quan' },
  { key: 'STATUS_CHANGED', label: 'Đổi trạng thái', hint: 'Issue chuyển sang trạng thái khác' },
  { key: 'ISSUE_UPDATED', label: 'Issue cập nhật', hint: 'Thông tin issue được chỉnh sửa' },
  { key: 'SPRINT_STARTED', label: 'Sprint bắt đầu', hint: 'Khi một sprint được khởi động' },
  { key: 'SPRINT_COMPLETED', label: 'Sprint hoàn thành', hint: 'Khi một sprint kết thúc' },
  { key: 'WATCHING_UPDATE', label: 'Theo dõi cập nhật', hint: 'Cập nhật trên issue bạn theo dõi' },
];

export function NotificationSection() {
  const { data, isLoading } = useNotificationPrefs();
  const update = useUpdateNotificationPrefs();

  const effective = data?.preferences ?? {};

  function toggle(key: string, next: boolean) {
    update.mutate({ [key]: next }, { onError: (e) => toast.error(apiErrorMessage(e)) });
  }

  return (
    <SectionCard
      icon={<Bell className="h-4 w-4" />}
      title="Thông báo"
      description="Mặc định yên tĩnh — chỉ bật thông báo quan trọng."
    >
      {isLoading ? (
        <div className="space-y-2.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {NOTIFICATION_TYPES.map(({ key, label, hint }) => {
            const checked = effective[key] ?? false;
            return (
              <li key={key} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <label htmlFor={`notif-${key}`} className="block text-sm font-medium text-ink">
                    {label}
                  </label>
                  <p className="mt-0.5 truncate text-xs text-faint">{hint}</p>
                </div>
                <input
                  id={`notif-${key}`}
                  type="checkbox"
                  checked={checked}
                  disabled={update.isPending}
                  onChange={(e) => toggle(key, e.target.checked)}
                  className="h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:opacity-50"
                />
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
