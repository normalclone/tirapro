import { describe, expect, it } from 'vitest';
import { jiraMappingSchema } from './import';

const base = { issueTypes: {}, statuses: {}, priorities: {} };

describe('jiraMappingSchema.pendingEmails (L28)', () => {
  it('mặc định rỗng khi client cũ không gửi', () => {
    expect(jiraMappingSchema.parse(base).pendingEmails).toEqual({});
  });
  it('nhận email hợp lệ theo tên Jira', () => {
    const r = jiraMappingSchema.parse({ ...base, pendingEmails: { Cường: 'cuong@x.com' } });
    expect(r.pendingEmails).toEqual({ Cường: 'cuong@x.com' });
  });
  it('email sai dạng bị từ chối (không lưu rác vào bảng chờ)', () => {
    expect(
      jiraMappingSchema.safeParse({ ...base, pendingEmails: { Cường: 'khong-phai-email' } })
        .success,
    ).toBe(false);
    expect(jiraMappingSchema.safeParse({ ...base, pendingEmails: { Cường: '' } }).success).toBe(
      false,
    );
  });
});
