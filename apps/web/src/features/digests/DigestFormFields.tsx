import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { DIGEST_BLOCKS, type DigestBlockId } from '@tirapro/shared';
import { Input } from '@/components/ui/Input';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { Avatar } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { useUserSelect } from '@/features/members/useUserSelect';
import { useDigestChannels, type DigestSchedule } from './api';
import type { DigestFormState } from './digestForm';
import {
  HOUR_OPTIONS,
  timeZoneHint,
  timeZoneLabel,
  timeZoneOptions,
  WEEKDAY_OPTIONS,
} from './schedule';

export type SetDigestForm = <K extends keyof DigestFormState>(
  key: K,
  value: DigestFormState[K],
) => void;

const SELECT_CLASS =
  'h-9 w-full rounded-md border border-border bg-bg px-3 text-base text-ink focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-[var(--ring)]';
const CHECKBOX_CLASS =
  'mt-0.5 h-4 w-4 shrink-0 rounded border-border accent-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]';

const SCHEDULE_CHOICES: { value: DigestSchedule; label: string }[] = [
  { value: 'WEEKLY', label: 'Hằng tuần' },
  { value: 'DAILY', label: 'Hằng ngày' },
  { value: 'SPRINT_END', label: 'Khi kết thúc sprint' },
  { value: 'MANUAL', label: 'Chỉ gửi thủ công' },
];

export function Field({
  id,
  label,
  hint,
  children,
  className,
}: {
  id?: string;
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-muted">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-faint">{hint}</p>}
    </div>
  );
}

/** Lịch gửi: kiểu + thứ (chỉ Hằng tuần) + giờ + múi giờ (trừ "khi kết thúc sprint"/thủ công). */
export function ScheduleFields({ form, set }: { form: DigestFormState; set: SetDigestForm }) {
  const timed = form.schedule === 'WEEKLY' || form.schedule === 'DAILY';
  const zones = useMemo(() => {
    const all = timeZoneOptions();
    return all.includes(form.timezone) ? all : [form.timezone, ...all];
  }, [form.timezone]);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field id="digest-schedule" label="Lịch gửi">
        <select
          id="digest-schedule"
          value={form.schedule}
          onChange={(e) => set('schedule', e.target.value as DigestSchedule)}
          className={SELECT_CLASS}
        >
          {SCHEDULE_CHOICES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </Field>
      {form.schedule === 'WEEKLY' && (
        <Field id="digest-weekday" label="Vào thứ">
          <select
            id="digest-weekday"
            value={form.weekday}
            onChange={(e) => set('weekday', Number(e.target.value))}
            className={SELECT_CLASS}
          >
            {WEEKDAY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
      )}
      {timed && (
        <>
          <Field id="digest-hour" label="Lúc">
            <select
              id="digest-hour"
              value={form.hour}
              onChange={(e) => set('hour', Number(e.target.value))}
              className={SELECT_CLASS}
            >
              {HOUR_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field id="digest-timezone" label="Múi giờ">
            <SearchSelect
              id="digest-timezone"
              value={form.timezone}
              onChange={(v) => set('timezone', v)}
              options={zones.map((z) => ({
                value: z,
                label: timeZoneLabel(z),
                hint: timeZoneHint(z),
              }))}
              searchPlaceholder="Tìm múi giờ…"
              className="w-full"
            />
          </Field>
        </>
      )}
      {!timed && (
        <p className="self-end pb-2 text-xs text-faint">
          {form.schedule === 'SPRINT_END'
            ? 'Gửi một lần mỗi khi có sprint được kết thúc.'
            : 'Chỉ gửi khi bạn bấm "Chạy ngay".'}
        </p>
      )}
    </div>
  );
}

/** Nơi gửi: Telegram (chọn kênh đã liên kết) và Email (chọn người nhận trong workspace) — độc lập nhau. */
export function ChannelFields({
  form,
  set,
  projectIsPrivate,
}: {
  form: DigestFormState;
  set: SetDigestForm;
  /** Dự án đang gắn (nếu có) là dự án RIÊNG TƯ. */
  projectIsPrivate: boolean;
}) {
  const { options, loading } = useDigestChannels();
  return (
    <div className="space-y-3">
      <Field
        id="digest-channel"
        label="Telegram"
        hint={
          !loading && options.length === 0 ? (
            <>
              Chưa có kênh Telegram —{' '}
              <Link
                to="/connect/integrations?wizard=telegram"
                className="font-medium text-primary underline-offset-2 hover:underline"
              >
                Kết nối Telegram
              </Link>
            </>
          ) : undefined
        }
      >
        <SearchSelect
          id="digest-channel"
          value={form.channelId}
          onChange={(v) => set('channelId', v)}
          options={[
            { value: '', label: 'Không gửi Telegram' },
            ...options.map((o) => ({ value: o.id, label: o.label })),
          ]}
          className="w-full"
          disabled={options.length === 0 && form.channelId === ''}
        />
      </Field>
      {projectIsPrivate && form.channelId !== '' && (
        <PrivateChannelNotice
          checked={form.allowPrivateToChannel}
          onChange={(v) => set('allowPrivateToChannel', v)}
        />
      )}
      <div>
        <label className="flex cursor-pointer items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            checked={form.deliverEmail}
            onChange={(e) => set('deliverEmail', e.target.checked)}
            className={CHECKBOX_CLASS}
          />
          <span>
            <span className="font-medium text-ink">Gửi email</span>
            <span className="block text-xs text-faint">
              Mỗi người một thư, nội dung theo quyền xem của họ. Người nhận sẽ nhận email này kể cả
              khi đã tắt email thông báo.
            </span>
          </span>
        </label>
        {form.deliverEmail && projectIsPrivate && (
          <p className="mt-2 text-xs text-warning">
            Dự án này riêng tư: người nhận không thấy dự án sẽ KHÔNG nhận thư (bị bỏ qua khi gửi).
          </p>
        )}
        {form.deliverEmail && (
          <RecipientsPicker value={form.recipients} onChange={(v) => set('recipients', v)} />
        )}
      </div>
    </div>
  );
}

/**
 * Dự án RIÊNG TƯ + kênh Telegram: mặc định KHÔNG đăng vào nhóm (nhóm có thể có người không thuộc dự án). Chỉ khi người
 * tạo bật tường minh ô này mới đăng — nên cảnh báo nói thẳng nhóm sẽ thấy gì.
 */
function PrivateChannelNotice({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Dự án riêng tư và nhóm Telegram"
      className="rounded-md border border-warning/40 bg-warning/5 p-3"
    >
      <label className="flex cursor-pointer items-start gap-2.5 text-sm">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className={CHECKBOX_CLASS}
        />
        <span>
          <span className="font-medium text-ink">Cho phép đăng vào nhóm Telegram</span>
          <span className="block text-xs text-warning">
            Mọi người trong nhóm Telegram sẽ thấy tiêu đề công việc, sprint, rủi ro của dự án riêng
            tư này.
          </span>
          <span className="mt-1 block text-xs text-faint">
            {checked
              ? 'Đã bật: báo cáo đăng vào nhóm theo quyền xem của bạn.'
              : 'Đang tắt: dự án riêng tư KHÔNG được đăng vào nhóm — chỉ gửi email theo quyền từng người nhận.'}
          </span>
        </span>
      </label>
    </div>
  );
}

function RecipientsPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  // Người nhận: tìm phía máy chủ (loại tài khoản khoá, không giới hạn 50 người); người đã chọn không nằm trong kết quả
  // hiện thành dòng riêng ở đầu danh sách để vẫn bỏ chọn được.
  const picker = useUserSelect();
  const [q, setQ] = useState('');
  const found = picker.users;
  const pinned = value.flatMap((id) =>
    found.some((u) => u.id === id) ? [] : [picker.resolveRole(id)],
  );
  const list = [
    ...pinned.flatMap((p) =>
      p ? [{ id: p.id, displayName: p.name, avatarUrl: null, email: '' }] : [],
    ),
    ...found,
  ];
  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  return (
    <div className="mt-2 rounded-md border border-border">
      <div className="relative border-b border-border">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint"
          aria-hidden
        />
        <Input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            picker.onSearchChange(e.target.value);
          }}
          placeholder="Tìm người nhận…"
          aria-label="Tìm người nhận"
          className="h-9 border-0 pl-8 focus-visible:ring-0"
        />
      </div>
      <ul className="max-h-44 overflow-y-auto p-1" aria-label="Người nhận email">
        {list.map((u) => (
          <li key={u.id}>
            <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface-2">
              <input
                type="checkbox"
                checked={value.includes(u.id)}
                onChange={() => toggle(u.id)}
                className={cn(CHECKBOX_CLASS, 'mt-0')}
              />
              <Avatar name={u.displayName} src={u.avatarUrl} size={20} />
              <span className="min-w-0 flex-1 truncate text-ink">{u.displayName}</span>
              <span className="hidden truncate text-xs text-faint sm:inline">{u.email}</span>
            </label>
          </li>
        ))}
        {list.length === 0 && (
          <li className="px-2 py-3 text-center text-sm text-muted">
            {picker.loading ? 'Đang tải…' : 'Không có thành viên phù hợp'}
          </li>
        )}
        {picker.moreHint && q.trim() === '' && (
          <li className="px-2 py-2 text-center text-xs text-faint">Gõ để tìm thêm</li>
        )}
      </ul>
      <p className="border-t border-border px-3 py-1.5 text-xs text-faint">
        Đã chọn {value.length} người · chỉ chọn được thành viên của workspace
      </p>
    </div>
  );
}

/** Các khối nội dung (tick chọn; thứ tự hiển thị luôn theo bảng chuẩn). */
export function BlocksField({
  value,
  onChange,
}: {
  value: DigestBlockId[];
  onChange: (v: DigestBlockId[]) => void;
}) {
  const toggle = (id: DigestBlockId) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  return (
    <fieldset>
      <legend className="mb-1 text-xs font-medium text-muted">Nội dung báo cáo</legend>
      <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
        {DIGEST_BLOCKS.map((b) => (
          <label key={b.id} className="flex cursor-pointer items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={value.includes(b.id)}
              onChange={() => toggle(b.id)}
              className={CHECKBOX_CLASS}
            />
            <span>
              <span className="font-medium text-ink">{b.label}</span>
              <span className="block text-xs text-faint">{b.hint}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
