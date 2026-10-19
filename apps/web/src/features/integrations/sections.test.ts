import { describe, expect, it } from 'vitest';
import {
  integrationPath,
  integrationRedirectTarget,
  integrationSections,
  integrationTabs,
  parseIntegrationSection,
} from './sections';

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

describe('integrationPath / integrationTabs — mỗi mục là một route con', () => {
  it('đường dẫn tuyệt đối dưới /connect/integrations', () => {
    expect(integrationPath('telegram')).toBe('/connect/integrations/telegram');
    expect(integrationPath('digest')).toBe('/connect/integrations/digest');
  });
  it('tab theo cờ: ẩn Kho mã khi tắt, giữ thứ tự', () => {
    expect(integrationTabs({ repos: false }).map((t) => t.to)).toEqual([
      '/connect/integrations/telegram',
      '/connect/integrations/digest',
    ]);
    expect(integrationTabs({ repos: true }).map((t) => t.label)).toEqual([
      'Telegram',
      'Kho mã',
      'Báo cáo định kỳ',
    ]);
  });
});

describe('integrationRedirectTarget — /connect/integrations và ?section= cũ', () => {
  const off = { repos: false };
  it('không có ?section= → Telegram', () => {
    expect(integrationRedirectTarget('', off)).toBe('/connect/integrations/telegram');
  });
  it('?section= cũ hợp lệ → route con tương ứng', () => {
    expect(integrationRedirectTarget('?section=digest', off)).toBe('/connect/integrations/digest');
    expect(integrationRedirectTarget('?section=telegram', off)).toBe(
      '/connect/integrations/telegram',
    );
    expect(integrationRedirectTarget('?section=repos', { repos: true })).toBe(
      '/connect/integrations/repos',
    );
  });
  it('mục bị cờ tắt hoặc giá trị lạ → Telegram', () => {
    expect(integrationRedirectTarget('?section=repos', off)).toBe('/connect/integrations/telegram');
    expect(integrationRedirectTarget('?section=abc', off)).toBe('/connect/integrations/telegram');
  });
  it('giữ query khác (?project=), bỏ section', () => {
    expect(integrationRedirectTarget('?project=p1&section=digest', off)).toBe(
      '/connect/integrations/digest?project=p1',
    );
  });
});
