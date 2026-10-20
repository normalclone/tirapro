import { describe, expect, it, vi } from 'vitest';
import { PERMISSIONS } from '@tirapro/types';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import { PROJECT_REF_KEY } from '../../common/decorators/project-ref.decorator';
import { SearchController } from './search.controller';

function make() {
  const search = {
    search: vi.fn(() => Promise.resolve({ data: [] })),
    validate: vi.fn(() => Promise.resolve({ valid: true })),
    relaxCounts: vi.fn(() => Promise.resolve({ total: 0, clauses: [], remaining: 0 })),
  };
  return { ctrl: new SearchController(search as never), search };
}
const user = { id: 'u1' } as never;

describe('SearchController.run — mode', () => {
  it('không có jql/q => 422, không gọi service (không im lặng trả mọi issue)', async () => {
    const { ctrl, search } = make();
    await expect(ctrl.run('w1', user)).rejects.toMatchObject({ status: 422 });
    await expect(ctrl.run('w1', user, '   ', '  ')).rejects.toMatchObject({ status: 422 });
    await expect(ctrl.run('w1', user, undefined, undefined, 'jql')).rejects.toMatchObject({
      status: 422,
    });
    expect(search.search).not.toHaveBeenCalled();
  });
  it('chỉ có q => tự hiểu mode=text; có jql => JQL; mode=text với q rỗng vẫn gọi (trả rỗng như cũ)', async () => {
    const { ctrl, search } = make();
    await ctrl.run('w1', user, undefined, 'thanh toan');
    expect(search.search).toHaveBeenLastCalledWith(
      'w1',
      'u1',
      expect.objectContaining({ mode: 'text', q: 'thanh toan' }),
    );
    await ctrl.run('w1', user, 'status = Done');
    expect(search.search).toHaveBeenLastCalledWith(
      'w1',
      'u1',
      expect.objectContaining({ mode: 'jql', jql: 'status = Done' }),
    );
    await ctrl.run('w1', user, undefined, '', 'text');
    expect(search.search).toHaveBeenCalledTimes(3);
  });
  it('mode lạ vẫn bị từ chối như cũ', async () => {
    await expect(make().ctrl.run('w1', user, 'x', undefined, 'zzz')).rejects.toMatchObject({
      status: 422,
    });
  });
});

describe('SearchController — U15', () => {
  it('GET /search truyền checkValues: true (truy vấn gõ tay báo giá trị sai)', async () => {
    const { ctrl, search } = make();
    await ctrl.run('w1', user, 'status = Done');
    expect(search.search).toHaveBeenLastCalledWith(
      'w1',
      'u1',
      expect.objectContaining({ checkValues: true }),
    );
  });
  it('POST /search/validate truyền workspaceId', async () => {
    const { ctrl, search } = make();
    await ctrl.validate('w1', user, { jql: 'status = Done' });
    expect(search.validate).toHaveBeenCalledWith('w1', 'u1', 'status = Done');
    await ctrl.validate('w1', user, {});
    expect(search.validate).toHaveBeenLastCalledWith('w1', 'u1', '');
  });
});

describe('SearchController.relaxCounts — POST /search/relax-counts (092)', () => {
  const handler = SearchController.prototype.relaxCounts as unknown as object;
  const meta = (key: string) => Reflect.getMetadata(key, handler) as unknown;

  it('truyền workspaceId, user.id và body (jql, projectId) cho service', async () => {
    const { ctrl, search } = make();
    await ctrl.relaxCounts('w1', user, { jql: 'status = A AND priority = B', projectId: 'p1' });
    expect(search.relaxCounts).toHaveBeenCalledWith('w1', 'u1', {
      jql: 'status = A AND priority = B',
      projectId: 'p1',
    });
  });
  it('quyền giống GET /search: project:view + @ProjectRef(body, projectId)', () => {
    expect(meta(PERMISSIONS_KEY)).toEqual([PERMISSIONS.PROJECT_VIEW]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, SearchController.prototype.run)).toEqual(
      meta(PERMISSIONS_KEY),
    );
    expect(meta(PROJECT_REF_KEY)).toEqual({ kind: 'body', param: 'projectId' });
  });
  it('là POST /search/relax-counts', () => {
    expect(meta('method')).toBe(1); // RequestMethod.POST
    expect(meta('path')).toBe('relax-counts');
  });
  it('giới hạn riêng 20 lần / 60 giây (mỗi lần gọi = tới 9 truy vấn)', () => {
    expect(meta('THROTTLER:LIMITdefault')).toBe(20);
    expect(meta('THROTTLER:TTLdefault')).toBe(60_000);
  });
});
