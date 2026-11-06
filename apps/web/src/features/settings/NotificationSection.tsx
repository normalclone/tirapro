import { useRef, useState, type ReactNode } from 'react';
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
import { useTelegramLink } from './telegramApi';
import { telegramToggleHint } from './telegramLink';
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
  {
    key: 'FILTER_SHARED',
    label: 'Được chia sẻ bộ lọc',
    hint: 'Khi ai đó chia sẻ một bộ lọc đã lưu cho riêng bạn',
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
 * Vùng mở rộng chứa các tuỳ chọn kênh gửi thêm (email, Telegram) của một sự kiện (nhóm có tên = tên sự kiện): mở bằng
 * grid-rows 0fr→1fr (180ms ease-out-quart), tắt khi reduced-motion; đóng thì ẩn khỏi Tab.
 */
function OptionsRegion({
  id,
  eventLabelId,
  open,
  children,
}: {
  id: string;
  /** Id span nhãn của Switch sự kiện (để nhóm có tên sự kiện). */
  eventLabelId: string;
  open: boolean;
  children: ReactNode;
}) {
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
      <div className="overflow-hidden">{children}</div>
    </div>
  );
}

/**
 * Một ô "Gửi qua <kênh>" (email / Telegram). Tên ô = nhãn + tên sự kiện; gợi ý nằm NGOÀI nhãn, nối qua `aria-describedby`.
 * `disabled` (vd Telegram chưa liên kết): ô mờ, gợi ý nói rõ cần làm gì.
 */
function ChannelOption({
  id,
  eventLabelId,
  label,
  checked,
  hint,
  disabled = false,
  onChange,
}: {
  id: string;
  eventLabelId: string;
  label: string;
  checked: boolean;
  hint: string;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  const inputId = `${id}-input`;
  const labelId = `${id}-label`;
  const hintId = `${id}-hint`;
  return (
    <div
      className={cn(
        'mt-2 flex items-start gap-2.5 text-sm text-ink [@media(pointer:coarse)]:min-h-11',
        disabled && 'opacity-60',
      )}
    >
      <input
        id={inputId}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-labelledby={`${labelId} ${eventLabelId}`}
        aria-describedby={hintId}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed [@media(pointer:coarse)]:mt-3"
      />
      <div className="min-w-0">
        <label
          id={labelId}
          htmlFor={inputId}
          className={cn(
            'block font-medium [@media(pointer:coarse)]:py-2.5',
            disabled ? 'cursor-not-allowed' : 'cursor-pointer',
          )}
        >
          {label}
        </label>
        <p id={hintId} className="text-xs text-faint">
          {hint}
        </p>
      </div>
    </div>
  );
}

export function NotificationSection() {
  const prefsQuery = useNotificationPrefs();
  // Công tắc Telegram chỉ dùng được khi đã liên kết (chưa biết / chưa liên kết → mờ kèm gợi ý).
  const telegramLinked = useTelegramLink().data?.linked != null;
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
      data-tour="notif-settings-card"
      icon={<Bell className="h-4 w-4" />}
      title="Thông báo"
      description="Bấm là lưu ngay. Các thông báo email trong vòng 5 phút được gộp thành một email để hộp thư không bị ngập. Telegram gửi từng tin riêng khi bạn đã liên kết."
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
          <ul className="divide-y divide-border" data-tour="notif-settings-list">
            {NOTIFICATION_TYPES.map(({ key, label, hint }) => {
              const inApp = prefs.preferences[key] ?? false;
              const emailKey = EMAIL_KEY_OF_TYPE[key];
              const emailOn = emailKey ? prefs.email[emailKey] : false;
              const telegramOn = prefs.telegram[key] ?? false;
              // Email/Telegram độc lập in-app: dòng con mở khi in-app bật HOẶC một kênh gửi thêm đã bật.
              const open = isOptionsOpen(manual[key], inApp, emailOn || telegramOn);
              const regionId = `notif-${key}-channels`;
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
                      {emailKey ? 'Tuỳ chọn email & Telegram' : 'Tuỳ chọn Telegram'}
                      {emailOn || (telegramLinked && telegramOn) ? ' · đang bật' : ''}
                    </span>
                  </button>
                  <OptionsRegion id={regionId} eventLabelId={eventLabelId} open={open}>
                    {emailKey && (
                      <ChannelOption
                        id={`${regionId}-email`}
                        eventLabelId={eventLabelId}
                        label="Gửi qua email"
                        checked={emailOn}
                        hint={emailHint(emailKey)}
                        onChange={(next) => {
                          update.mutate({ email: { [emailKey]: next } });
                          // Ghim dòng con mở: email-only bỏ tick sẽ làm `isOptionsOpen` thành false và dòng con đóng ngay dưới con trỏ.
                          setManual((m) => ({ ...m, [key]: true }));
                        }}
                      />
                    )}
                    <ChannelOption
                      id={`${regionId}-telegram`}
                      eventLabelId={eventLabelId}
                      label="Gửi qua Telegram"
                      checked={telegramOn}
                      hint={telegramToggleHint(telegramLinked)}
                      disabled={!telegramLinked}
                      onChange={(next) => {
                        update.mutate({ telegram: { [key]: next } });
                        setManual((m) => ({ ...m, [key]: true }));
                      }}
                    />
                  </OptionsRegion>
                </li>
              );
            })}
          </ul>
        )}
      </QueryBoundary>
    </SectionCard>
  );
}
