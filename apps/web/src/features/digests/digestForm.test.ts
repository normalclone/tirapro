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

describe('validateForm', () => {
  const ok = { ...initialForm(null), name: 'A' };
  it('tên bắt buộc, ≥1 khối, bật email phải có người nhận', () => {
    expect(validateForm(initialForm(null))).toMatch(/tên/);
    expect(validateForm({ ...ok, blocks: [] })).toMatch(/khối/);
    expect(validateForm({ ...ok, deliverEmail: true })).toMatch(/người nhận/);
    expect(validateForm({ ...ok, deliverEmail: true, recipients: ['u1'] })).toBeNull();
    expect(validateForm(ok)).toBeNull();
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
