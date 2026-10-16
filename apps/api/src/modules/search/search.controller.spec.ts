import { describe, expect, it, vi } from 'vitest';
import { SearchController } from './search.controller';

function make() {
  const search = {
    search: vi.fn(() => Promise.resolve({ data: [] })),
    validate: vi.fn(() => Promise.resolve({ valid: true })),
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
    await ctrl.validate('w1', { jql: 'status = Done' });
    expect(search.validate).toHaveBeenCalledWith('w1', 'status = Done');
    await ctrl.validate('w1', {});
    expect(search.validate).toHaveBeenLastCalledWith('w1', '');
  });
});
