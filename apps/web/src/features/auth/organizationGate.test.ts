import { describe, expect, it } from 'vitest';
import { needsOrganizationScreen } from './organizationGate';

describe('needsOrganizationScreen', () => {
  it('có organization -> không chặn', () =>
    expect(needsOrganizationScreen({ organizationId: 'w1', isSystemAdmin: false }, '/')).toBe(
      false,
    ));

  it('không organization, người thường -> chặn mọi đường dẫn', () => {
    expect(needsOrganizationScreen({ organizationId: null, isSystemAdmin: false }, '/')).toBe(true);
    expect(needsOrganizationScreen({ organizationId: null, isSystemAdmin: false }, '/admin')).toBe(
      true,
    );
  });

  it('không organization, admin hệ thống -> chỉ cho /admin*', () => {
    expect(
      needsOrganizationScreen({ organizationId: null, isSystemAdmin: true }, '/admin/accounts'),
    ).toBe(false);
    expect(needsOrganizationScreen({ organizationId: null, isSystemAdmin: true }, '/admin')).toBe(
      false,
    );
    expect(needsOrganizationScreen({ organizationId: null, isSystemAdmin: true }, '/')).toBe(true);
  });

  it('"/administrator" không phải /admin (so khớp theo đoạn đường dẫn)', () => {
    expect(
      needsOrganizationScreen({ organizationId: null, isSystemAdmin: true }, '/administrator'),
    ).toBe(true);
  });
});
