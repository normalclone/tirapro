import { describe, expect, it } from 'vitest';
import { SYSTEM_ROLES, roleLabel } from '@tirapro/types';
import { roleHint } from './roleLabels';

describe('roleLabel', () => {
  it('hai vai trò dev có nhãn khác nhau', () => {
    expect(roleLabel(SYSTEM_ROLES.PROJECT_DEVELOPER)).toBe('Lập trình viên (cơ bản)');
    expect(roleLabel(SYSTEM_ROLES.DEVELOPER)).toBe('Lập trình viên');
    expect(roleLabel('Project Developer')).not.toBe(roleLabel('Developer'));
  });
  it('nhãn của mọi vai trò hệ thống không trùng nhau', () => {
    const roles = Object.values(SYSTEM_ROLES);
    expect(new Set(roles.map(roleLabel)).size).toBe(roles.length);
  });
  it('gợi ý của vai trò cơ bản nói rõ đây là bản cũ', () => {
    expect(roleHint(SYSTEM_ROLES.PROJECT_DEVELOPER)).toContain('bản cũ');
  });
});
