import { describe, expect, it } from 'vitest';
import { HEURISTIC_LABEL, aiFallbackNote, aiSourceLabel } from './fallbackNote';

describe('aiSourceLabel', () => {
  it('Claude', () => expect(aiSourceLabel('claude')).toBe('Claude'));
  it('chưa cấu hình → nhãn minh bạch', () => {
    expect(HEURISTIC_LABEL).toBe('Gợi ý cơ bản (chưa cấu hình AI)');
    expect(aiSourceLabel('heuristic', 'unconfigured')).toBe(HEURISTIC_LABEL);
  });
  it('AI bận → vẫn là gợi ý cơ bản nhưng không nói "chưa cấu hình"', () => {
    expect(aiSourceLabel('heuristic', 'timeout')).toBe('Gợi ý cơ bản');
    expect(aiSourceLabel('heuristic')).toBe('Gợi ý cơ bản');
  });
});
describe('aiFallbackNote', () => {
  it('có lời nhắc cấu hình khi chưa cấu hình', () =>
    expect(aiFallbackNote('unconfigured')).toMatch(/ANTHROPIC_API_KEY/));
  it('AI bận → nhắc thử lại', () => expect(aiFallbackNote('error')).toMatch(/thử lại/));
  it('không reason → null', () => expect(aiFallbackNote(undefined)).toBeNull());
});
