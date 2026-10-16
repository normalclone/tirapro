import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DIGEST_BLOCKS,
  DIGEST_BLOCKS,
  LEGACY_DIGEST_BLOCKS,
  resolveDigestBlocks,
} from './digest';

describe('resolveDigestBlocks', () => {
  it('rỗng/null → khối của digest cũ (summary + sprint)', () => {
    expect(resolveDigestBlocks([])).toEqual(['summary', 'sprint']);
    expect(resolveDigestBlocks(null)).toEqual([...LEGACY_DIGEST_BLOCKS]);
    expect(resolveDigestBlocks(undefined)).toEqual([...LEGACY_DIGEST_BLOCKS]);
  });

  it('toàn id lạ cũng coi như rỗng', () => {
    expect(resolveDigestBlocks(['abc'])).toEqual(['summary', 'sprint']);
  });

  it('bỏ id lạ/trùng và sắp theo thứ tự chuẩn', () => {
    expect(resolveDigestBlocks(['health', 'abc', 'summary', 'health'])).toEqual([
      'summary',
      'health',
    ]);
  });

  it('mặc định cho digest mới là 4 khối đầu', () => {
    expect(DEFAULT_DIGEST_BLOCKS).toEqual(DIGEST_BLOCKS.slice(0, 4).map((b) => b.id));
  });

  it('id khối không trùng nhau', () => {
    const ids = DIGEST_BLOCKS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
