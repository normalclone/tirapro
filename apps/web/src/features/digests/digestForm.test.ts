import { describe, expect, it } from 'vitest';
import type { Digest } from './api';
import {
  effectiveAllowPrivate,
  initialForm,
  toCreatePayload,
  toUpdatePayload,
  validateForm,
} from './digestForm';

const digest = (over: Partial<Digest> = {}): Digest => ({
  id: 'd1',
  name: 'Tuần',
  schedule: 'DAILY',
  projectId: null,
  channelId: null,
  metrics: [],
  recipients: [],
  deliverEmail: false,
  allowPrivateToChannel: false,
  weekday: 2,
  hour: 9,
  timezone: 'Asia/Tokyo',
  isEnabled: true,
  lastRunAt: null,
  createdAt: '2026-10-16T00:00:00Z',
  ...over,
});

describe('initialForm', () => {
  it('tạo mới: 4 khối mặc định, thứ Hai 08:00, không kênh, không email, cờ riêng tư tắt', () => {
    const f = initialForm(null);
    expect(f).toMatchObject({
      schedule: 'WEEKLY',
      weekday: 1,
      hour: 8,
      channelId: '',
      deliverEmail: false,
      allowPrivateToChannel: false,
    });
    expect(f.blocks).toEqual(['summary', 'overdue', 'sprint', 'risks']);
  });

  it('sửa digest cũ (metrics rỗng): hiện đúng 2 khối nó đang gửi; giữ nguyên lịch', () => {
    const f = initialForm(digest());
    expect(f.blocks).toEqual(['summary', 'sprint']);
    expect(f).toMatchObject({ schedule: 'DAILY', weekday: 2, hour: 9, timezone: 'Asia/Tokyo' });
  });
});

describe('initialForm — múi giờ đã lưu', () => {
  it('tên cũ (Asia/Saigon, Asia/Calcutta) được chuẩn hoá khi nạp form; tên chuẩn giữ nguyên', () => {
    expect(initialForm(digest({ timezone: 'Asia/Saigon' })).timezone).toBe('Asia/Ho_Chi_Minh');
    expect(initialForm(digest({ timezone: 'Asia/Calcutta' })).timezone).toBe('Asia/Kolkata');
    expect(initialForm(digest({ timezone: 'Europe/Paris' })).timezone).toBe('Europe/Paris');
  });
  it('không động tới máy chủ: giá trị cũ chỉ đổi trong form, payload sửa mang tên chuẩn khi người dùng bấm Lưu', () => {
    const d = digest({ timezone: 'Asia/Saigon' });
    expect(d.timezone).toBe('Asia/Saigon');
    expect(toUpdatePayload('d1', initialForm(d), false).timezone).toBe('Asia/Ho_Chi_Minh');
  });
});

describe('validateForm', () => {
  const ok = { ...initialForm(null), name: 'A' };
  it('hợp lệ → mảng rỗng', () => {
    expect(validateForm(ok)).toEqual([]);
    expect(validateForm({ ...ok, deliverEmail: true, recipients: ['u1'] })).toEqual([]);
  });
  it('tên bắt buộc (tên toàn khoảng trắng cũng thiếu)', () => {
    expect(validateForm(initialForm(null))).toEqual([
      { field: 'name', message: 'Vui lòng nhập tên báo cáo.' },
    ]);
    expect(validateForm({ ...ok, name: '   ' }).map((e) => e.field)).toEqual(['name']);
  });
  it('≥1 khối nội dung', () => {
    expect(validateForm({ ...ok, blocks: [] })).toEqual([
      { field: 'blocks', message: 'Chọn ít nhất một khối nội dung.' },
    ]);
  });
  it('bật email phải có người nhận', () => {
    expect(validateForm({ ...ok, deliverEmail: true })).toEqual([
      { field: 'recipients', message: 'Chọn ít nhất một người nhận email.' },
    ]);
  });
  it('báo ĐỦ mọi lỗi cùng lúc, theo thứ tự trường trong form', () => {
    const bad = { ...initialForm(null), name: '', blocks: [], deliverEmail: true };
    expect(validateForm(bad).map((e) => e.field)).toEqual(['name', 'blocks', 'recipients']);
  });
});

describe('cờ allowPrivateToChannel (I3, N1)', () => {
  const f = { ...initialForm(null), name: 'A', allowPrivateToChannel: true };
  it('chỉ gửi đi khi có dự án RIÊNG TƯ và kênh Telegram; dự án công khai/bỏ dự án/bỏ kênh thì tự tắt', () => {
    expect(effectiveAllowPrivate({ ...f, projectId: 'p1', channelId: 'c1' }, true)).toBe(true);
    expect(effectiveAllowPrivate({ ...f, projectId: 'p1', channelId: 'c1' }, false)).toBe(false);
    expect(effectiveAllowPrivate({ ...f, projectId: '', channelId: 'c1' }, true)).toBe(false);
    expect(effectiveAllowPrivate({ ...f, projectId: 'p1', channelId: '' }, true)).toBe(false);
    expect(
      toCreatePayload({ ...f, projectId: 'p1', channelId: 'c1' }, false).allowPrivateToChannel,
    ).toBe(false);
    expect(
      toUpdatePayload('d1', { ...f, projectId: 'p1', channelId: 'c1' }, true).allowPrivateToChannel,
    ).toBe(true);
  });
});

describe('payload', () => {
  const f = { ...initialForm(null), name: '  Tuần  ', projectId: 'p1', channelId: 'c1' };
  it('create: trim tên, chuỗi rỗng → undefined', () => {
    expect(toCreatePayload(f, false)).toMatchObject({
      name: 'Tuần',
      projectId: 'p1',
      channelId: 'c1',
    });
    const bare = toCreatePayload({ ...f, projectId: '', channelId: '' }, false);
    expect(bare.projectId).toBeUndefined();
    expect(bare.channelId).toBeUndefined();
  });
  it('update: gỡ kênh = null, không gửi projectId (không đổi phạm vi)', () => {
    const u = toUpdatePayload('d1', { ...f, channelId: '' }, false);
    expect(u.channelId).toBeNull();
    expect(u).not.toHaveProperty('projectId');
    expect(u.id).toBe('d1');
  });
});
