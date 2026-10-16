import { describe, expect, it } from 'vitest';
import {
  BLANK,
  UNMAPPED,
  autoMapUsers,
  buildPendingEmails,
  buildUserMapping,
  seedPendingEmails,
} from './jiraUsers';

const members = [
  { id: 'u1', displayName: 'Nguyễn An', email: 'an@x.com' },
  { id: 'u2', displayName: 'Bình', email: 'b@x.com' },
];

describe('autoMapUsers', () => {
  it('khớp email rồi tên; người không khớp BỊ BỎ KHOÁ (chưa ghép), không phải "Để trống"', () => {
    const m = autoMapUsers(
      [{ name: 'an@x.com', email: 'an@x.com' }, { name: 'bình' }, { name: 'Cường' }],
      members,
    );
    expect(m).toEqual({ 'an@x.com': 'u1', bình: 'u2' });
    expect('Cường' in m).toBe(false);
  });
});

describe('buildUserMapping — chưa ghép ≠ chủ động để trống', () => {
  it('UNMAPPED → bỏ khoá; BLANK → null; id → giữ nguyên', () => {
    expect(buildUserMapping({ A: 'u1', B: BLANK, C: UNMAPPED })).toEqual({ A: 'u1', B: null });
  });
  it('người chưa đụng tới (không có khoá) không xuất hiện trong mapping gửi API', () => {
    expect(buildUserMapping(autoMapUsers([{ name: 'Cường' }], members))).toEqual({});
  });
});

describe('buildPendingEmails (L28)', () => {
  it('chỉ trả hàng CHƯA ghép có email hợp lệ; người đã ghép / để trống bị bỏ qua', () => {
    const out = buildPendingEmails(
      {
        Cường: ' Cuong@X.com ',
        A: '',
        Bình: 'binh@x.com', // đã ghép → bỏ
        Dũng: 'dung@x.com', // để trống có chủ đích → bỏ
        Hỏng: 'khong-phai-email',
        Đào: 'dao@x.com', // UNMAPPED tường minh → giữ
      },
      { Bình: 'u2', Dũng: BLANK, Đào: UNMAPPED },
    );
    expect(out).toEqual({ Cường: 'cuong@x.com', Đào: 'dao@x.com' });
  });
  it('không có email nào → rỗng', () => {
    expect(buildPendingEmails({}, {})).toEqual({});
  });
});

describe('seedPendingEmails (L28)', () => {
  it('điền sẵn email từ CSV cho người chưa ghép được; người đã ghép thì không', () => {
    const sel = autoMapUsers(
      [
        { name: 'an@x.com', email: 'an@x.com' },
        { name: 'Cường', email: 'cuong@x.com' },
        { name: 'Dũng' },
      ],
      members,
    );
    expect(
      seedPendingEmails(
        [
          { name: 'an@x.com', email: 'an@x.com' },
          { name: 'Cường', email: 'cuong@x.com' },
          { name: 'Dũng' },
        ],
        sel,
      ),
    ).toEqual({ Cường: 'cuong@x.com' });
  });
});
