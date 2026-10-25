import { describe, expect, it } from 'vitest';
import { getPeekSource, registerPeekSource } from './peekRegistry';

describe('peekRegistry — nguồn thứ tự của trang đang mở (cho phím j/k ở ngoài cây React của trang)', () => {
  const src = (id: string) => ({ getRoot: () => null, getOrder: () => ({ keys: [id] }) });
  it('chưa đăng ký → null; đăng ký → đọc được; gỡ → null', () => {
    expect(getPeekSource()).toBeNull();
    const off = registerPeekSource(src('a'));
    expect(getPeekSource()!.getOrder()!.keys).toEqual(['a']);
    off();
    expect(getPeekSource()).toBeNull();
  });
  it('trang mới đăng ký trước khi trang cũ gỡ: gỡ của trang cũ KHÔNG xoá nguồn của trang mới', () => {
    const offOld = registerPeekSource(src('old'));
    const offNew = registerPeekSource(src('new'));
    offOld();
    expect(getPeekSource()!.getOrder()!.keys).toEqual(['new']);
    offNew();
    expect(getPeekSource()).toBeNull();
  });
});
