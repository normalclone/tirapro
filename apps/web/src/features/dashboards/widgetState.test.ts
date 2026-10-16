import { AxiosError } from 'axios';
import { describe, expect, it } from 'vitest';
import { isForbiddenError, queryWidgetState } from './widgetState';

const httpError = (status: number) =>
  new AxiosError('x', 'ERR', undefined, undefined, {
    status,
    data: {},
    statusText: '',
    headers: {},
    config: {} as never,
  });

describe('queryWidgetState', () => {
  it('chưa có dữ liệu: đang tải → loading; 403/404 → forbidden; lỗi khác → error', () => {
    expect(queryWidgetState({ data: undefined, isError: false, error: null })).toBe('loading');
    expect(queryWidgetState({ data: undefined, isError: true, error: httpError(403) })).toBe(
      'forbidden',
    );
    expect(queryWidgetState({ data: undefined, isError: true, error: httpError(404) })).toBe(
      'forbidden',
    );
    expect(queryWidgetState({ data: undefined, isError: true, error: httpError(500) })).toBe(
      'error',
    );
    expect(queryWidgetState({ data: undefined, isError: true, error: new Error('mạng') })).toBe(
      'error',
    );
  });

  it('có dữ liệu: rỗng theo isEmpty → empty, ngược lại ready; làm mới nền lỗi vẫn giữ ready', () => {
    expect(queryWidgetState({ data: [], isError: false, error: null }, (d) => d.length === 0)).toBe(
      'empty',
    );
    expect(
      queryWidgetState({ data: [1], isError: false, error: null }, (d) => d.length === 0),
    ).toBe('ready');
    expect(queryWidgetState({ data: [1], isError: true, error: httpError(500) })).toBe('ready');
  });
});

describe('isForbiddenError', () => {
  it('chỉ 403 và 404', () => {
    expect(isForbiddenError(httpError(403))).toBe(true);
    expect(isForbiddenError(httpError(401))).toBe(false);
    expect(isForbiddenError(undefined)).toBe(false);
  });
});
