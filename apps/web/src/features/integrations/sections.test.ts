import { describe, expect, it } from 'vitest';
import { integrationSections, parseIntegrationSection } from './sections';

describe('integrationSections', () => {
  it('mặc định ẩn Kho mã', () => {
    expect(integrationSections({ repos: false }).map((s) => s.id)).toEqual(['telegram', 'digest']);
  });
  it('bật cờ thì có lại Kho mã, đúng thứ tự cũ', () => {
    expect(integrationSections({ repos: true }).map((s) => s.id)).toEqual([
      'telegram',
      'repos',
      'digest',
    ]);
  });
});

describe('parseIntegrationSection', () => {
  it('nhận mục hợp lệ (digest) để mở thẳng', () => {
    expect(parseIntegrationSection('digest', { repos: false })).toBe('digest');
    expect(parseIntegrationSection('telegram', { repos: false })).toBe('telegram');
  });
  it('mục bị ẩn bởi cờ, giá trị lạ hoặc rỗng → null', () => {
    expect(parseIntegrationSection('repos', { repos: false })).toBeNull();
    expect(parseIntegrationSection('repos', { repos: true })).toBe('repos');
    expect(parseIntegrationSection('abc', { repos: true })).toBeNull();
    expect(parseIntegrationSection(null, { repos: true })).toBeNull();
  });
  it('nhãn mục digest là "Báo cáo định kỳ"', () => {
    expect(integrationSections({ repos: false }).find((s) => s.id === 'digest')?.label).toBe(
      'Báo cáo định kỳ',
    );
  });
});
