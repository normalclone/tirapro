import { describe, expect, it } from 'vitest';
import {
  dupDescribedBy,
  dupDecision,
  foldVi,
  isExactTitle,
  submitLabel,
  type DupMatch,
} from './dupDecision';

describe('foldVi / isExactTitle', () => {
  it('bỏ dấu, hạ chữ, gộp khoảng trắng', () => {
    expect(foldVi('  Giỏ  hàng Đã MẤT ')).toBe('gio hang da mat');
    expect(isExactTitle('GIO HANG bi mat', 'Giỏ hàng bị mất')).toBe(true);
    expect(isExactTitle('Giỏ hàng', 'Giỏ hàng bị mất')).toBe(false);
  });
});

describe('submitLabel', () => {
  const top = { key: 'DEMO-BUG-2', exact: false };
  it('mặc định "Gửi"; gộp có chọn nêu mã; giống hệt mà chưa chọn nêu rõ sẽ thêm vào bug đó; vẫn tạo mới => "Gửi (tạo mới)"', () => {
    expect(submitLabel({ mode: 'none' }, null)).toBe('Gửi');
    expect(submitLabel({ mode: 'none' }, top)).toBe('Gửi');
    expect(submitLabel({ mode: 'none' }, { key: 'DEMO-BUG-2', exact: true })).toBe(
      'Gửi (thêm vào DEMO-BUG-2)',
    );
    expect(submitLabel({ mode: 'merge', key: 'DEMO-BUG-2' }, top)).toBe('Thêm vào DEMO-BUG-2');
    expect(submitLabel({ mode: 'new' }, { key: 'DEMO-BUG-2', exact: true })).toBe('Gửi (tạo mới)');
  });
});

const m = (o: Partial<DupMatch> & { id: string; key: string; summary: string }): DupMatch => ({
  triageState: null,
  status: { category: 'TODO' },
  ...o,
});

describe('dupDecision', () => {
  const live = m({ id: 'a', key: 'D-1', summary: 'Giỏ hàng bị mất sản phẩm' });
  const done = m({
    id: 'b',
    key: 'D-2',
    summary: 'Giỏ hàng bị mất sản phẩm',
    status: { category: 'DONE' },
  });

  it('không chọn gì + có bug sống giống hệt => nhãn nêu mã và gộp rõ vào bug đó (để tệp tải đúng chỗ)', () => {
    const d = dupDecision({ mode: 'none' }, [live], 'GIO HANG bi mat san pham');
    expect(d.label).toBe('Gửi (thêm vào D-1)');
    expect(d.mergeInto).toEqual({ id: 'a', key: 'D-1' });
    expect(d.forceNew).toBe(false);
    expect(d.exact?.key).toBe('D-1');
  });

  it('bug giống hệt đã Done (không chờ triage) thì server không gộp tự động => coi như không trùng', () => {
    const d = dupDecision({ mode: 'none' }, [done], 'Giỏ hàng bị mất sản phẩm');
    expect(d.exact).toBeUndefined();
    expect(d.label).toBe('Gửi');
    expect(d.mergeInto).toBeNull();
  });

  it('bug Done nhưng đang chờ triage (tái diễn) vẫn tính là sống', () => {
    const d = dupDecision(
      { mode: 'none' },
      [{ ...done, triageState: 'PENDING' }],
      'Giỏ hàng bị mất sản phẩm',
    );
    expect(d.exact?.key).toBe('D-2');
  });

  it('tiêu đề chỉ gần giống => không gộp ngầm', () => {
    const d = dupDecision({ mode: 'none' }, [live], 'Giỏ hàng');
    expect(d.mergeInto).toBeNull();
    expect(d.label).toBe('Gửi');
  });

  it('chọn gộp => mergeInto là bug đã chọn kể cả bug đã đóng; vẫn tạo mới => forceNew', () => {
    const merged = dupDecision({ mode: 'merge', key: 'D-2', id: 'b' }, [live], 'Khác hẳn');
    expect(merged.mergeInto).toEqual({ id: 'b', key: 'D-2' });
    expect(merged.label).toBe('Thêm vào D-2');
    const fresh = dupDecision({ mode: 'new' }, [live], 'Giỏ hàng bị mất sản phẩm');
    expect(fresh.mergeInto).toBeNull();
    expect(fresh.forceNew).toBe(true);
    expect(fresh.label).toBe('Gửi (tạo mới)');
  });

  it('thiếu comment:create: không gộp ngầm, không gộp có chọn, nhãn "Gửi" (luôn tạo mới)', () => {
    const noPerm = { canComment: false };
    const auto = dupDecision({ mode: 'none' }, [live], 'Giỏ hàng bị mất sản phẩm', noPerm);
    expect(auto).toEqual({ exact: undefined, label: 'Gửi', mergeInto: null, forceNew: false });
    const chosen = dupDecision({ mode: 'merge', key: 'D-1', id: 'a' }, [live], 'x', noPerm);
    expect(chosen.mergeInto).toBeNull();
    expect(chosen.label).toBe('Gửi');
  });

  it('chỉ Bug mới tự gộp theo tiêu đề giống hệt', () => {
    const f = dupDecision({ mode: 'none' }, [live], 'Giỏ hàng bị mất sản phẩm', {
      kind: 'FEATURE',
    });
    expect(f.exact).toBeUndefined();
    expect(f.mergeInto).toBeNull();
    expect(f.label).toBe('Gửi');
    const b = dupDecision({ mode: 'none' }, [live], 'Giỏ hàng bị mất sản phẩm', { kind: 'BUG' });
    expect(b.mergeInto).toEqual({ id: 'a', key: 'D-1' });
  });
});

describe('dupDescribedBy', () => {
  it('trỏ đúng id có trong DOM: danh sách gợi ý hoặc dòng "Sẽ thêm ghi chú vào…" khi đã chọn gộp; không có panel thì undefined', () => {
    expect(dupDescribedBy(true, 'none')).toBe('ri-dup');
    expect(dupDescribedBy(true, 'new')).toBe('ri-dup');
    expect(dupDescribedBy(true, 'merge')).toBe('ri-dup-merged');
    expect(dupDescribedBy(false, 'merge')).toBeUndefined();
    expect(dupDescribedBy(false, 'none')).toBeUndefined();
  });
});
