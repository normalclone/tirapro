import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { timeZoneChoices } from '@/features/digests/schedule';
import { initialProfileTimeZone } from './profileTimeZone';

describe('initialProfileTimeZone — giá trị ban đầu của ô Múi giờ ở hồ sơ', () => {
  it('rỗng/không có → múi giờ trình duyệt (luôn khớp một lựa chọn, API không nhận chuỗi rỗng)', () => {
    expect(initialProfileTimeZone('', 'Asia/Tokyo')).toBe('Asia/Tokyo');
    expect(initialProfileTimeZone(undefined, 'Asia/Tokyo')).toBe('Asia/Tokyo');
    expect(initialProfileTimeZone('   ', 'Asia/Tokyo')).toBe('Asia/Tokyo');
  });
  it('tên cũ (alias) → tên chuẩn để không "dirty giả" và khớp danh sách', () => {
    expect(initialProfileTimeZone('Asia/Saigon', 'UTC')).toBe('Asia/Ho_Chi_Minh');
    expect(initialProfileTimeZone('Asia/Calcutta', 'UTC')).toBe('Asia/Kolkata');
  });
  it('tên chuẩn giữ nguyên; tên lạ giữ nguyên (không đổi dữ liệu người dùng)', () => {
    expect(initialProfileTimeZone('America/New_York', 'UTC')).toBe('America/New_York');
    expect(initialProfileTimeZone('Mars/Olympus', 'UTC')).toBe('Mars/Olympus');
  });
});

describe('lựa chọn múi giờ khi giá trị hiện tại là tên cũ/lạ (ô chọn của hồ sơ)', () => {
  it('tên cũ: danh sách có đúng một dòng chuẩn, không có dòng tên cũ', () => {
    const cs = timeZoneChoices(initialProfileTimeZone('Asia/Saigon', 'UTC'));
    expect(cs.filter((c) => c.value === 'Asia/Ho_Chi_Minh')).toHaveLength(1);
    expect(cs.some((c) => c.value === 'Asia/Saigon')).toBe(false);
    expect(cs.find((c) => c.value === 'Asia/Ho_Chi_Minh')?.label).toBe('Giờ Việt Nam (UTC+7)');
  });
  it('tên lạ: vẫn hiện (đưa lên đầu) để người dùng thấy giá trị đang lưu', () => {
    const cs = timeZoneChoices(initialProfileTimeZone('Mars/Olympus', 'UTC'));
    expect(cs[0]?.value).toBe('Mars/Olympus');
    expect(new Set(cs.map((c) => c.value)).size).toBe(cs.length);
  });
  it('tìm "Hà Nội"/"Việt Nam" ra Giờ Việt Nam (gợi ý + nhãn)', () => {
    const vn = timeZoneChoices().find((c) => c.value === 'Asia/Ho_Chi_Minh')!;
    expect(`${vn.label} ${vn.hint ?? ''}`).toMatch(/Việt Nam/);
    expect(vn.hint).toMatch(/Hà Nội/);
  });
});

describe('ProfilePanel dùng ô chọn, không còn ô gõ tên IANA', () => {
  const src = readFileSync(join(__dirname, 'ProfilePanel.tsx'), 'utf8');
  it('SearchSelect + timeZoneChoices; không còn datalist / list="profile-timezones"', () => {
    expect(src).toMatch(/<SearchSelect[\s\S]*?id="profile-timezone"/);
    expect(src).toMatch(/timeZoneChoices\(timezone\)/);
    expect(src).toMatch(/initialProfileTimeZone\(/);
    expect(src).not.toMatch(/datalist|list="profile-timezones"/);
  });
  it('giữ hành vi Task 3: settleField cho múi giờ + useUnsavedChanges', () => {
    expect(src).toMatch(/settleField\(cur, next\.timezone\)/);
    expect(src).toMatch(/useUnsavedChanges\(/);
  });
});
