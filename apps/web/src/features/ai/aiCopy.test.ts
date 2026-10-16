import { describe, expect, it } from 'vitest';
import { aiMode, generateCopy, goalLabel } from './aiCopy';

describe('aiMode', () => {
  it('chưa biết (đang tải/lỗi) → unknown', () => expect(aiMode(undefined)).toBe('unknown'));
  it('available → ai / basic', () => {
    expect(aiMode(true)).toBe('ai');
    expect(aiMode(false)).toBe('basic');
  });
});

describe('chữ giới thiệu', () => {
  it('chỉ chế độ ai mới nói "AI"; basic/unknown không nhận mình là AI', () => {
    expect(generateCopy('ai').description).toMatch(/AI/);
    for (const mode of ['basic', 'unknown'] as const) {
      const c = generateCopy(mode);
      expect(c.title).not.toMatch(/bằng AI/);
      expect(c.placeholder).not.toMatch(/AI/);
    }
    expect(generateCopy('unknown').description).not.toMatch(/AI/);
    expect(goalLabel('unknown')).not.toMatch(/AI/);
    expect(goalLabel('basic')).not.toMatch(/AI/);
    expect(goalLabel('ai')).toMatch(/AI/);
  });
});
