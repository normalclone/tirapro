import { describe, expect, it } from 'vitest';
import { integrationSections, parseIntegrationSection, resolveSectionIntent } from './sections';

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

describe('resolveSectionIntent — ?section= phải qua guard khi khác mục đang mở', () => {
  it('không có ?section= hoặc trùng mục đang mở → none (không hỏi)', () => {
    expect(resolveSectionIntent({ fromUrl: null, active: 'telegram' })).toBe('none');
    expect(resolveSectionIntent({ fromUrl: 'digest', active: 'digest' })).toBe('none');
  });
  it('khác mục đang mở → ask (đi qua pick có guard)', () => {
    expect(resolveSectionIntent({ fromUrl: 'digest', active: 'telegram' })).toBe('ask');
  });
});
