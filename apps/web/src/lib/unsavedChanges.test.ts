import { describe, expect, it } from 'vitest';
import { shouldBlockNavigation } from './unsavedChanges';

const loc = (pathname: string, search = '') => ({ pathname, search });

describe('shouldBlockNavigation', () => {
  it('đổi đường dẫn thì chặn', () => {
    expect(
      shouldBlockNavigation({ currentLocation: loc('/p/A/config'), nextLocation: loc('/') }),
    ).toBe(true);
  });
  it('cùng đường dẫn (chỉ đổi query/hash) thì không chặn', () => {
    expect(
      shouldBlockNavigation({
        currentLocation: loc('/p/A/config'),
        nextLocation: loc('/p/A/config', '?x=1'),
      }),
    ).toBe(false);
  });
});
