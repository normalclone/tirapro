import { describe, expect, it } from 'vitest';
import {
  buildNotificationTitle as t,
  notificationBody,
  notificationFilterSchema,
} from './notification-title';

const a = (...names: string[]) => names.map((name, i) => ({ id: `u${i}`, name }));
describe('buildNotificationTitle', () => {
  it('ISSUE_ASSIGNED gộp từ nhập Jira: một câu "Bạn được giao N việc từ nhập Jira"', () => {
    expect(
      t('ISSUE_ASSIGNED', { bulk: 'jira-import', count: 13, key: 'PROJ-2', actorName: 'Admin' }),
    ).toBe('Bạn được giao 13 việc từ nhập Jira');
    expect(t('ISSUE_ASSIGNED', { actorName: 'Admin', key: 'PROJ-2' })).toBe(
      'Admin giao PROJ-2 cho bạn',
    );
  });
  it('đổi trạng thái: người + mã + từ → đến', () => {
    expect(
      t('STATUS_CHANGED', {
        actorName: 'Trang',
        key: 'DEMO-3',
        fromStatusName: 'In Review',
        statusName: 'Done',
      }),
    ).toBe('Trang chuyển DEMO-3: In Review → Done');
    expect(t('STATUS_CHANGED', { actorName: 'Trang', key: 'DEMO-3', statusName: 'Done' })).toBe(
      'Trang chuyển DEMO-3 sang Done',
    );
    expect(
      t('STATUS_CHANGED', {
        actorName: 'Trang',
        key: 'DEMO-3',
        fromStatusName: 'Done',
        statusName: 'Done',
        count: 3,
      }),
    ).toBe('Trang đổi trạng thái DEMO-3 3 lần');
  });
  it('bình luận: một / nhiều lần / nhiều người', () => {
    expect(t('COMMENT_ADDED', { actorName: 'Trang', key: 'DEMO-3' })).toBe(
      'Trang bình luận trong DEMO-3',
    );
    expect(t('COMMENT_ADDED', { actors: a('Trang'), key: 'DEMO-3', count: 3 })).toBe(
      'Trang bình luận 3 lần trong DEMO-3',
    );
    expect(t('COMMENT_ADDED', { actors: a('Trang', 'Dũng'), key: 'DEMO-3', count: 2 })).toBe(
      'Trang và Dũng bình luận trong DEMO-3',
    );
    expect(
      t('COMMENT_ADDED', { actors: a('Trang', 'Dũng', 'Bình', 'Chi'), key: 'DEMO-3', count: 4 }),
    ).toBe('Trang, Dũng và 2 người khác bình luận trong DEMO-3');
  });
  it('nhắc đến / giao việc / cập nhật / theo dõi', () => {
    expect(t('MENTIONED', { actorName: 'Trang', key: 'DEMO-3', where: 'comment' })).toBe(
      'Trang nhắc đến bạn trong DEMO-3',
    );
    expect(t('MENTIONED', { actorName: 'Trang', key: 'DEMO-3', where: 'description' })).toBe(
      'Trang nhắc đến bạn trong mô tả của DEMO-3',
    );
    expect(t('ISSUE_ASSIGNED', { actorName: 'Trang', key: 'DEMO-3' })).toBe(
      'Trang giao DEMO-3 cho bạn',
    );
    expect(t('ISSUE_UPDATED', { actorName: 'Trang', key: 'DEMO-3' })).toBe('Trang cập nhật DEMO-3');
    expect(t('WATCHING_UPDATE', { actorName: 'Trang', key: 'DEMO-3' })).toBe(
      'Trang cập nhật DEMO-3 (bạn đang theo dõi)',
    );
  });
  it('gộp nhiều lần cập nhật: ghi số lần', () => {
    expect(t('WATCHING_UPDATE', { actorName: 'Trang', key: 'DEMO-3', count: 10 })).toBe(
      'Trang cập nhật DEMO-3 10 lần (bạn đang theo dõi)',
    );
    expect(t('ISSUE_UPDATED', { actorName: 'Trang', key: 'DEMO-3', count: 2 })).toBe(
      'Trang cập nhật DEMO-3 2 lần',
    );
  });
  it('payload cũ thiếu trường: không văng, dùng "Ai đó" / "một công việc"', () => {
    expect(t('COMMENT_ADDED', {})).toBe('Ai đó bình luận trong một công việc');
    expect(t('STATUS_CHANGED', { key: 'DEMO-3', statusName: 'Done' })).toBe(
      'Ai đó chuyển DEMO-3 sang Done',
    );
  });
  it('notificationBody ưu tiên trích đoạn rồi tiêu đề việc', () => {
    expect(notificationBody('COMMENT_ADDED', { excerpt: 'Đã sửa xong', summary: 'Sửa lỗi' })).toBe(
      'Đã sửa xong',
    );
    expect(notificationBody('ISSUE_ASSIGNED', { summary: 'Sửa lỗi' })).toBe('Sửa lỗi');
  });
});

describe('notificationFilterSchema', () => {
  it('nhận 4 giá trị hợp lệ; giá trị lạ hoặc thiếu → all (không 400)', () => {
    for (const f of ['all', 'unread', 'mentioned', 'assigned'])
      expect(notificationFilterSchema.parse(f)).toBe(f);
    expect(notificationFilterSchema.parse('rac')).toBe('all');
    expect(notificationFilterSchema.parse(undefined)).toBe('all');
  });
});
