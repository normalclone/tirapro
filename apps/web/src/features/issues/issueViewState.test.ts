import { describe, expect, it } from 'vitest';
import { issueViewState } from './issueViewState';

const base = { isError: false, isLoading: false, hasData: false, notFound: false };

describe('issueViewState', () => {
  it('đang tải / chưa có dữ liệu → loading', () => {
    expect(issueViewState({ ...base, isLoading: true })).toBe('loading');
    expect(issueViewState(base)).toBe('loading');
  });
  it('có dữ liệu → ready', () => {
    expect(issueViewState({ ...base, hasData: true })).toBe('ready');
  });
  it('chưa có dữ liệu + 404 → not-found; lỗi khác → error', () => {
    expect(issueViewState({ ...base, isError: true, notFound: true })).toBe('not-found');
    expect(issueViewState({ ...base, isError: true })).toBe('error');
  });
  it('refetch nền lỗi tạm thời khi đã có dữ liệu → vẫn ready (không gỡ nội dung)', () => {
    expect(issueViewState({ ...base, isError: true, hasData: true })).toBe('ready');
  });
  it('refetch trả 404 khi đã có dữ liệu (việc bị xoá) → not-found', () => {
    expect(issueViewState({ ...base, isError: true, hasData: true, notFound: true })).toBe(
      'not-found',
    );
  });
});
