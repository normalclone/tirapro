import { useRef, useState } from 'react';
import { Bell, ChevronDown } from 'lucide-react';
import type { NotificationEmailPrefs } from '@tirapro/types';
import { Skeleton } from '@/components/ui/primitives';
import { SaveStatus } from '@/components/ui/SaveStatus';
import { SectionCard } from '@/components/ui/SectionCard';
import { Switch } from '@/components/ui/Switch';
import { QueryBoundary } from '@/components/ui/QueryBoundary';
import { useSaveTracker } from '@/lib/useSaveTracker';
import { cn } from '@/lib/utils';
import { useNotificationPrefs, useUpdateNotificationPrefs } from './api';
import { EMAIL_KEY_OF_TYPE, isOptionsOpen, type PrefsPatch } from './notificationPrefs';

/** Thứ tự + nhãn tiếng Việt cho từng loại thông báo. */
const NOTIFICATION_TYPES: { key: string; label: string; hint: string }[] = [
  { key: 'ISSUE_ASSIGNED', label: 'Được giao việc', hint: 'Khi bạn được gán vào một công việc' },
  {
    key: 'MENTIONED',
    label: 'Được nhắc đến (@)',
    hint: 'Khi ai đó @ bạn trong bình luận hoặc mô tả công việc',
  },
  { key: 'COMMENT_ADDED', label: 'Bình luận mới', hint: 'Bình luận mới trên công việc liên quan' },
  { key: 'STATUS_CHANGED', label: 'Đổi trạng thái', hint: 'Công việc chuyển sang trạng thái khác' },
  {
    key: 'ISSUE_UPDATED',
    label: 'Công việc được cập nhật',
    hint: 'Thông tin công việc được chỉnh sửa',
  },
  { key: 'SPRINT_STARTED', label: 'Sprint bắt đầu', hint: 'Khi một sprint được khởi động' },
  { key: 'SPRINT_COMPLETED', label: 'Sprint hoàn thành', hint: 'Khi một sprint kết thúc' },
  {
    key: 'WATCHING_UPDATE',
    label: 'Theo dõi cập nhật',
    hint: 'Cập nhật trên công việc bạn đang theo dõi',
  },
];

/** Các loại thông báo có thể gửi qua email (khoá trùng `NotificationEmailPrefs`). */
const EMAIL_TYPES: { key: keyof NotificationEmailPrefs; label: string; hint: string }[] = [
  { key: 'mention', label: 'Được nhắc đến (@)', hint: 'Gửi email khi ai đó @ bạn' },
  { key: 'assigned', label: 'Được giao việc', hint: 'Gửi email khi bạn được gán vào công việc' },
  {
    key: 'comment',
    label: 'Bình luận mới',
    hint: 'Gửi email khi công việc của bạn có bình luận mới',
  },
  {
    key: 'transition',
    label: 'Đổi trạng thái',
    hint: 'Gửi email khi công việc của bạn chuyển trạng thái',
  },
];

/**
 * Dòng con "Gửi qua email" (nhóm có tên = tên sự kiện): mở bằng grid-rows 0fr→1fr (180ms ease-out-quart), tắt khi
 * reduced-motion; đóng thì ẩn khỏi Tab. Tên ô = nhãn + tên sự kiện; gợi ý nằm NGOÀI nhãn, nối qua `aria-describedby`.
 */
function EmailOption({
  id,
  eventLabelId,
  open,
  checked,
  hint,
  onChange,
}: {
  id: string;
  /** Id span nhãn của Switch sự kiện (để tên ô có tên sự kiện). */
  eventLabelId: string;
  open: boolean;
  checked: boolean;
  hint: string;
  onChange: (next: boolean) => void;
}) {
  const inputId = `${id}-input`;
  const labelId = `${id}-label`;
  const hintId = `${id}-hint`;
  return (
    <div
      id={id}
      role="group"
      aria-labelledby={eventLabelId}
      className={cn(
        'grid transition-[grid-template-rows,visibility] duration-base ease-out-quart motion-reduce:transition-none',
        open ? 'grid-rows-[1fr]' : 'invisible grid-rows-[0fr]',
      )}
    >
      <div className="overflow-hidden">
        <div className="mt-2 flex items-start gap-2.5 text-sm text-ink [@media(pointer:coarse)]:min-h-11">
          <input
            id={inputId}
            type="checkbox"
            checked={checked}
            aria-labelledby={`${labelId} ${eventLabelId}`}
            aria-describedby={hintId}
            onChange={(e) => onChange(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] [@media(pointer:coarse)]:mt-3"
          />
          <div className="min-w-0">
            <label
              id={labelId}
              htmlFor={inputId}
              className="block cursor-pointer font-medium [@media(pointer:coarse)]:py-2.5"
            >
              Gửi qua email
            </label>
            <p id={hintId} className="text-xs text-faint">
              {hint}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function NotificationSection() {
  const prefsQuery = useNotificationPrefs();
  const { status, start, ok, fail } = useSaveTracker();
  const lastFailed = useRef<PrefsPatch | null>(null);
  const update = useUpdateNotificationPrefs({
    onStart: start,
    onSaved: ok,
    onFailed: (patch) => {
      lastFailed.current = patch;
      fail();
    },
  });
  /** Người dùng tự mở/đóng dòng con (chưa chạm thì theo `isOptionsOpen`). */
  const [manual, setManual] = useState<Record<string, boolean>>({});

  const emailHint = (key: keyof NotificationEmailPrefs) =>
    `${EMAIL_TYPES.find((e) => e.key === key)?.hint ?? ''}, kể cả khi tắt thông báo trong ứng dụng`;

  function toggle(key: string, next: boolean) {
    update.mutate({ preferences: { [key]: next } });
    if (key in EMAIL_KEY_OF_TYPE)
      setManual((m) => {
        const { [key]: _drop, ...rest } = m;
        return next ? { ...m, [key]: true } : rest; // bật → mở dòng con ngay; tắt → theo suy diễn
      });
  }

  return (
    <SectionCard
      icon={<Bell className="h-4 w-4" />}
      title="Thông báo"
      description="Bấm là lưu ngay. Các thông báo email trong vòng 5 phút được gộp thành một email để hộp thư không bị ngập."
    >
      <div className="sticky top-0 z-10 -mx-5 -mt-5 mb-2 flex justify-end bg-surface px-5 py-1.5">
        <SaveStatus
          status={status}
          onRetry={() => {
            if (lastFailed.current) update.mutate(lastFailed.current);
          }}
        />
      </div>
      <QueryBoundary
        query={prefsQuery}
        skeleton={
          <div className="space-y-2.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        }
      >
        {(prefs) => (
          <ul className="divide-y divide-border">
            {NOTIFICATION_TYPES.map(({ key, label, hint }) => {
              const inApp = prefs.preferences[key] ?? false;
              const emailKey = EMAIL_KEY_OF_TYPE[key];
              const emailOn = emailKey ? prefs.email[emailKey] : false;
              const open = emailKey ? isOptionsOpen(manual[key], inApp, emailOn) : false;
              const regionId = `notif-${key}-email`;
              const eventLabelId = `notif-${key}-label`; // = id span nhãn do Switch dựng (`${id}-label`)
              return (
                <li key={key} className="py-3 first:pt-0 last:pb-0">
                  <Switch
                    id={`notif-${key}`}
                    checked={inApp}
                    onChange={(next) => toggle(key, next)}
                    label={label}
                    description={hint}
                  />
                  {emailKey && (
                    <>
                      <button
                        type="button"
                        aria-expanded={open}
                        aria-controls={regionId}
                        aria-labelledby={`${regionId}-toggle ${eventLabelId}`}
                        onClick={() => setManual((m) => ({ ...m, [key]: !open }))}
                        className="mt-1 inline-flex items-center gap-1 rounded text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] [@media(pointer:coarse)]:min-h-11"
                      >
                        <ChevronDown
                          aria-hidden="true"
                          className={cn(
                            'h-3.5 w-3.5 transition-transform duration-fast motion-reduce:transition-none',
                            open && 'rotate-180',
                          )}
                        />
                        <span id={`${regionId}-toggle`}>
                          Tuỳ chọn email{emailOn ? ' · đang bật' : ''}
                        </span>
                      </button>
                      <EmailOption
                        id={regionId}
                        eventLabelId={eventLabelId}
                        open={open}
                        checked={emailOn}
                        hint={emailHint(emailKey)}
                        onChange={(next) => {
                          update.mutate({ email: { [emailKey]: next } });
                          // Ghim dòng con mở: email-only bỏ tick sẽ làm `isOptionsOpen` thành false và dòng con đóng ngay dưới con trỏ.
                          setManual((m) => ({ ...m, [key]: true }));
                        }}
                      />
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </QueryBoundary>
    </SectionCard>
  );
}
