import { describe, expect, it, vi } from 'vitest';
import {
  AttachAfterCreateError,
  createAndAttachLabel,
  labelCreateErrorMessage,
  type CreateAttachDeps,
} from './createAndAttach';

type Label = { id: string; name: string; color: string | null };
const label = (id: string, name: string, color: string | null = '#3263c3'): Label => ({
  id,
  name,
  color,
});

/** Bộ gọi API giả: mặc định tạo/gắn thành công, danh sách rỗng. */
function setup(over: Partial<CreateAttachDeps> = {}) {
  const createLabel = vi.fn((v: { name: string; color: string }) =>
    Promise.resolve(label('new', v.name, v.color)),
  );
  const listLabels = vi.fn(() => Promise.resolve([] as Label[]));
  const attach = vi.fn((_id: string) => Promise.resolve(undefined as unknown));
  const deps: CreateAttachDeps = { createLabel, listLabels, attach, ...over };
  return { deps, createLabel, listLabels, attach };
}

describe('createAndAttachLabel', () => {
  it('(a) thành công: tạo rồi gắn đúng nhãn vừa tạo, trả về nhãn đó', async () => {
    const t = setup();
    const r = await createAndAttachLabel(t.deps, { name: 'mới', color: '#017b37' });
    expect(r).toEqual(label('new', 'mới', '#017b37'));
    expect(t.createLabel).toHaveBeenCalledWith({ name: 'mới', color: '#017b37' });
    expect(t.attach).toHaveBeenCalledWith('new');
    expect(t.listLabels).not.toHaveBeenCalled();
  });

  it('(b) tạo lỗi vì trùng tên → tra danh sách, gắn nhãn CÓ SẴN (khác hoa/thường/dấu) và trả về nó', async () => {
    const t = setup({
      createLabel: () => Promise.reject(new Error('Nhãn đã tồn tại trong dự án')),
      listLabels: () => Promise.resolve([label('x', 'Cần xem lại'), label('y', 'khác')]),
    });
    const r = await createAndAttachLabel(t.deps, { name: 'can xem lai', color: '#3263c3' });
    expect(r.id).toBe('x');
    expect(t.attach).toHaveBeenCalledTimes(1);
    expect(t.attach).toHaveBeenCalledWith('x');
  });

  it('(c) tạo lỗi, không có nhãn trùng trong danh sách → ném LẠI lỗi gốc, không gắn gì', async () => {
    const boom = new Error('500');
    const t = setup({
      createLabel: () => Promise.reject(boom),
      listLabels: () => Promise.resolve([label('y', 'khác')]),
    });
    await expect(createAndAttachLabel(t.deps, { name: 'mới', color: '#3263c3' })).rejects.toBe(
      boom,
    );
    expect(t.attach).not.toHaveBeenCalled();
  });

  it('(c2) tạo lỗi và tra danh sách cũng lỗi → vẫn ném lỗi gốc', async () => {
    const boom = new Error('mạng');
    const t = setup({
      createLabel: () => Promise.reject(boom),
      listLabels: () => Promise.reject(new Error('list')),
    });
    await expect(createAndAttachLabel(t.deps, { name: 'mới', color: '#3263c3' })).rejects.toBe(
      boom,
    );
  });

  it('(d) tạo được nhưng gắn lỗi → AttachAfterCreateError mang nhãn đã tạo + lỗi gốc', async () => {
    const boom = new Error('403');
    const t = setup({ attach: () => Promise.reject(boom) });
    const err: unknown = await createAndAttachLabel(t.deps, {
      name: 'mới',
      color: '#3263c3',
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AttachAfterCreateError);
    expect((err as AttachAfterCreateError).label.id).toBe('new');
    expect((err as AttachAfterCreateError).cause).toBe(boom);
  });

  it('(b2) nhãn trùng có sẵn mà gắn lỗi → cũng là AttachAfterCreateError', async () => {
    const t = setup({
      createLabel: () => Promise.reject(new Error('dup')),
      listLabels: () => Promise.resolve([label('x', 'mới')]),
      attach: () => Promise.reject(new Error('gắn lỗi')),
    });
    const err: unknown = await createAndAttachLabel(t.deps, {
      name: 'Mới',
      color: '#3263c3',
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AttachAfterCreateError);
  });

  it('chuẩn hoá tên trước khi gửi: NFC, cắt khoảng trắng, gộp khoảng trắng giữa chữ', async () => {
    const t = setup();
    await createAndAttachLabel(t.deps, { name: '  Ca\u0302n  xem\t lại ', color: '#3263c3' });
    expect(t.createLabel.mock.calls[0]![0].name).toBe('C\u00e2n xem lại');
  });
});

describe('labelCreateErrorMessage — câu báo theo giai đoạn', () => {
  const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
  it('tạo lỗi: "Chưa tạo được nhãn “X”: …"', () => {
    expect(labelCreateErrorMessage(new Error('Máy chủ lỗi'), 'mới', msg)).toBe(
      'Chưa tạo được nhãn “mới”: Máy chủ lỗi',
    );
  });
  it('tạo xong mà gắn lỗi: "Đã tạo nhãn “X” nhưng chưa gắn được: …" (lấy lỗi gốc)', () => {
    const e = new AttachAfterCreateError({ id: '1', name: 'mới', color: null }, new Error('403'));
    expect(labelCreateErrorMessage(e, 'mới', msg)).toBe(
      'Đã tạo nhãn “mới” nhưng chưa gắn được: 403',
    );
  });
});
