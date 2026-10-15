import { describe, expect, it } from 'vitest';
import { integrationSections } from './sections';

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
