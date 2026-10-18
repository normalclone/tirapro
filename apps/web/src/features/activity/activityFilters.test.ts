import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_FILTERS,
  describeActivity,
  fieldsParam,
  projectFeedSentence,
} from './activityFilters';

const a = (o: Record<string, unknown>) =>
  ({
    id: '1',
    field: 'STATUS',
    oldValue: null,
    newValue: null,
    oldLabel: null,
    newLabel: null,
    oldCategory: null,
    newCategory: null,
    pointsDelta: null,
    hasDiff: false,
    actor: null,
    occurredAt: '2026-10-16T00:00:00Z',
    ...o,
  }) as never;

describe('fieldsParam', () => {
  it('Tất cả => undefined; còn lại => CSV', () => {
    expect(fieldsParam('all')).toBeUndefined();
    expect(fieldsParam('status')).toBe('STATUS');
    expect(fieldsParam('other')).toBe('TYPE,RESOLUTION,SCOPE,TIME_SPENT,COMPONENT,FIX_VERSION');
  });
  it('id lạ => undefined', () => expect(fieldsParam('zzz')).toBeUndefined());
  it('mỗi loại lịch sử hệ thống xuất hiện đúng một lần trong các chip (trừ Tất cả)', () => {
    const all = ACTIVITY_FILTERS.flatMap((f) => f.fields);
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual([
      'ASSIGNEE',
      'COMPONENT',
      'DESCRIPTION',
      'FIX_VERSION',
      'PRIORITY',
      'RESOLUTION',
      'SCOPE',
      'SPRINT',
      'STATUS',
      'STORY_POINTS',
      'TIME_SPENT',
      'TYPE',
    ]);
  });
});

describe('describeActivity', () => {
  it('người phụ trách có tên, Chưa gán khi null', () => {
    expect(describeActivity(a({ field: 'ASSIGNEE', oldLabel: null, newLabel: 'Dũng' }))).toBe(
      'đổi người phụ trách: Chưa gán → Dũng',
    );
  });
  it('sprint có tên, Việc chờ khi null', () => {
    expect(describeActivity(a({ field: 'SPRINT', oldLabel: 'Sprint 1', newLabel: null }))).toBe(
      'chuyển sprint: Sprint 1 → Việc chờ',
    );
  });
  it('mô tả, điểm, trạng thái', () => {
    expect(describeActivity(a({ field: 'DESCRIPTION', hasDiff: true }))).toBe('sửa mô tả');
    expect(describeActivity(a({ field: 'STORY_POINTS', oldValue: '5', newValue: '85' }))).toBe(
      'đổi điểm: 5 → 85',
    );
    expect(describeActivity(a({ field: 'STATUS', oldValue: 'To Do', newValue: 'Done' }))).toBe(
      'đổi trạng thái: To Do → Done',
    );
  });
});

describe('gắn/bỏ thành phần & phiên bản', () => {
  it('thành phần', () => {
    expect(describeActivity(a({ field: 'COMPONENT', newValue: 'API' }))).toBe(
      'gắn thành phần: API',
    );
    expect(describeActivity(a({ field: 'COMPONENT', oldValue: 'API' }))).toBe('bỏ thành phần: API');
  });
  it('phiên bản mang loại (FIX / AFFECTS)', () => {
    expect(describeActivity(a({ field: 'FIX_VERSION', newValue: 'FIX:v1.0' }))).toBe(
      'gắn phiên bản sửa: v1.0',
    );
    expect(describeActivity(a({ field: 'FIX_VERSION', oldValue: 'AFFECTS:v1.0' }))).toBe(
      'bỏ phiên bản bị ảnh hưởng: v1.0',
    );
    expect(describeActivity(a({ field: 'FIX_VERSION', newValue: 'a:b' }))).toBe(
      'gắn phiên bản sửa: a:b',
    );
  });
});

describe('projectFeedSentence (feed hoạt động dự án)', () => {
  it('mô tả: một câu thuần, KHÔNG lộ bản xem trước cũ/mới', () => {
    const s = projectFeedSentence(
      a({ field: 'DESCRIPTION', hasDiff: true, oldValue: 'bí mật cũ', newValue: 'bí mật mới' }),
    );
    expect(s).toBe('đã sửa mô tả');
    expect(s).not.toMatch(/bí mật/);
  });
  it('thành phần/phiên bản: câu thuần', () => {
    expect(projectFeedSentence(a({ field: 'COMPONENT', newValue: 'API' }))).toBe(
      'đã gắn thành phần: API',
    );
    expect(projectFeedSentence(a({ field: 'FIX_VERSION', oldValue: 'FIX:v1' }))).toBe(
      'đã bỏ phiên bản sửa: v1',
    );
  });
  it('loại khác: null (feed tự dựng chip)', () => {
    expect(projectFeedSentence(a({ field: 'STATUS' }))).toBeNull();
    expect(projectFeedSentence(a({ field: 'PRIORITY' }))).toBeNull();
  });
});

describe('ghi thời gian & không lộ tên enum', () => {
  it('TIME_SPENT: "ghi thời gian: cũ → mới" (giá trị API đã định dạng)', () => {
    expect(describeActivity(a({ field: 'TIME_SPENT', oldValue: '1h', newValue: '2h 30m' }))).toBe(
      'ghi thời gian: 1h → 2h 30m',
    );
  });
  it('TIME_SPENT lần đầu (chưa có giá trị cũ): chỉ giá trị mới', () => {
    expect(describeActivity(a({ field: 'TIME_SPENT', oldValue: null, newValue: '1h' }))).toBe(
      'ghi thời gian: 1h',
    );
    expect(describeActivity(a({ field: 'TIME_SPENT', oldValue: '', newValue: '1h' }))).toBe(
      'ghi thời gian: 1h',
    );
  });
  it('feed dự án: TIME_SPENT là một câu thuần', () => {
    expect(projectFeedSentence(a({ field: 'TIME_SPENT', oldValue: '1h', newValue: '2h' }))).toBe(
      'đã ghi thời gian: 1h → 2h',
    );
  });
  it('"resolution" viết tiếng Việt: kết quả xử lý', () => {
    expect(describeActivity(a({ field: 'RESOLUTION' }))).toBe('đổi kết quả xử lý');
  });
  it('trường lạ: nhãn chung, KHÔNG in tên enum/trường thô', () => {
    const s = describeActivity(a({ field: 'SOME_NEW_FIELD', oldValue: 'x', newValue: 'y' }));
    expect(s).toBe('cập nhật thông tin');
    expect(s).not.toMatch(/SOME_NEW_FIELD|[A-Z]{2,}_[A-Z]{2,}/);
  });
});
