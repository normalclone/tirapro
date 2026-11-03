import { describe, expect, it } from 'vitest';
import type { PersonOption } from '@/components/ui/PeoplePicker';
import { addOwner } from './OwnersPicker';

const opts: PersonOption[] = [
  { id: 'a', name: 'An', search: 'an' },
  { id: 'b', name: 'Bình', avatarUrl: 'x.png', search: 'binh' },
];

describe('OwnersPicker.addOwner (logbug #27)', () => {
  it('thêm theo thứ tự, người đầu là chính', () => {
    const l1 = addOwner([], 'a', opts);
    const l2 = addOwner(l1, 'b', opts);
    expect(l2.map((o) => o.id)).toEqual(['a', 'b']);
    expect(l2[1]).toMatchObject({ name: 'Bình', avatarUrl: 'x.png' });
  });
  it('không thêm trùng hay id rỗng', () => {
    const l = addOwner([], 'a', opts);
    expect(addOwner(l, 'a', opts)).toBe(l);
    expect(addOwner(l, '', opts)).toBe(l);
  });
});
