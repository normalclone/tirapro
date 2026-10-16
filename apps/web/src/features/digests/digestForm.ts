import { DEFAULT_DIGEST_BLOCKS, resolveDigestBlocks, type DigestBlockId } from '@tirapro/shared';
import type { CreateDigestInput, Digest, DigestSchedule, UpdateDigestInput } from './api';
import { browserTimeZone } from './schedule';

/** Trạng thái form tạo/sửa báo cáo định kỳ. */
export interface DigestFormState {
  name: string;
  projectId: string;
  schedule: DigestSchedule;
  weekday: number;
  hour: number;
  timezone: string;
  /** '' = không gửi Telegram. */
  channelId: string;
  deliverEmail: boolean;
  recipients: string[];
  blocks: DigestBlockId[];
  /** Chỉ có nghĩa khi có dự án + kênh Telegram: cho đăng nội dung dự án RIÊNG TƯ vào nhóm. */
  allowPrivateToChannel: boolean;
}

export function initialForm(digest: Digest | null): DigestFormState {
  if (!digest) {
    return {
      name: '',
      projectId: '',
      schedule: 'WEEKLY',
      weekday: 1,
      hour: 8,
      // Đề xuất múi giờ trình duyệt; người dùng ở Việt Nam sẽ thấy sẵn Asia/Ho_Chi_Minh.
      timezone: browserTimeZone(),
      channelId: '',
      deliverEmail: false,
      recipients: [],
      blocks: [...DEFAULT_DIGEST_BLOCKS],
      allowPrivateToChannel: false,
    };
  }
  return {
    name: digest.name,
    projectId: digest.projectId ?? '',
    schedule: digest.schedule,
    weekday: digest.weekday,
    hour: digest.hour,
    timezone: digest.timezone,
    channelId: digest.channelId ?? '',
    deliverEmail: digest.deliverEmail,
    recipients: digest.recipients,
    // Digest cũ (metrics rỗng) hiện đúng 2 khối nó vẫn gửi từ trước tới nay.
    blocks: resolveDigestBlocks(digest.metrics),
    allowPrivateToChannel: digest.allowPrivateToChannel ?? false,
  };
}

/** Lỗi nhập liệu phía giao diện (server vẫn kiểm lại); null = hợp lệ. */
export function validateForm(f: DigestFormState): string | null {
  if (!f.name.trim()) return 'Vui lòng nhập tên báo cáo.';
  if (f.blocks.length === 0) return 'Chọn ít nhất một khối nội dung.';
  if (f.deliverEmail && f.recipients.length === 0) return 'Chọn ít nhất một người nhận email.';
  return null;
}

/** Cờ "đăng dự án riêng tư vào nhóm" chỉ gửi đi khi có dự án VÀ kênh Telegram (nếu không thì luôn tắt). */
export function effectiveAllowPrivate(f: DigestFormState): boolean {
  return f.allowPrivateToChannel && f.projectId !== '' && f.channelId !== '';
}

const common = (f: DigestFormState) => ({
  name: f.name.trim(),
  schedule: f.schedule,
  weekday: f.weekday,
  hour: f.hour,
  timezone: f.timezone,
  metrics: f.blocks,
  deliverEmail: f.deliverEmail,
  recipients: f.recipients,
  allowPrivateToChannel: effectiveAllowPrivate(f),
});

export function toCreatePayload(f: DigestFormState): CreateDigestInput {
  return {
    ...common(f),
    projectId: f.projectId || undefined,
    channelId: f.channelId || undefined,
  };
}

export function toUpdatePayload(id: string, f: DigestFormState): UpdateDigestInput {
  return { id, ...common(f), channelId: f.channelId || null };
}
