import { describe, expect, it } from 'vitest';
import { mouseActivation, TOUCH_ACTIVATION } from './dragSensors';

describe('cảm biến kéo-thả (WC-I4)', () => {
  it('cảm ứng phải nhấn giữ 250ms, dung sai 8px (vuốt tức thì = cuộn, không kéo)', () => {
    expect(TOUCH_ACTIVATION).toEqual({ delay: 250, tolerance: 8 });
  });
  it('chuột kéo sau khi rê quá khoảng cách', () => {
    expect(mouseActivation(5)).toEqual({ distance: 5 });
  });
});
