import { describe, expect, it } from 'vitest';
import { onboardingActionLabel, onboardingTarget } from './onboarding';

describe('onboardingTarget', () => {
  it('create_project mở hộp tạo dự án ngay tại Tổng quan', () => {
    expect(onboardingTarget({ key: 'create_project' }, { firstProjectKey: null })).toEqual({
      kind: 'modal-create-project',
    });
  });
  it('add_members mở hộp thêm thành viên (AddMemberPanel)', () => {
    expect(onboardingTarget({ key: 'add_members' }, { firstProjectKey: null })).toEqual({
      kind: 'modal-add-member',
    });
  });
  it('start_sprint dẫn tới Việc chờ của dự án đầu tiên; chưa có dự án thì vô hiệu kèm chú thích', () => {
    expect(onboardingTarget({ key: 'start_sprint' }, { firstProjectKey: 'WM' })).toEqual({
      kind: 'link',
      to: '/p/WM/backlog',
    });
    expect(onboardingTarget({ key: 'start_sprint' }, { firstProjectKey: null })).toEqual({
      kind: 'disabled',
      reason: 'Tạo dự án trước',
    });
  });
  it('connect_telegram mở wizard Telegram (TELEGRAM_WIZARD_HREF)', () => {
    expect(onboardingTarget({ key: 'connect_telegram' }, { firstProjectKey: 'WM' })).toEqual({
      kind: 'link',
      to: '/connect/integrations?wizard=telegram',
    });
  });
  it('khoá lạ: dùng href của Guide nếu có, nếu không thì vô hiệu', () => {
    expect(onboardingTarget({ key: 'x', href: '/abc' }, { firstProjectKey: null })).toEqual({
      kind: 'link',
      to: '/abc',
    });
    expect(onboardingTarget({ key: 'x', href: null }, { firstProjectKey: null }).kind).toBe(
      'disabled',
    );
  });
});

describe('onboardingActionLabel', () => {
  it('nhãn nút theo hành động', () => {
    expect(onboardingActionLabel('create_project')).toBe('Tạo dự án');
    expect(onboardingActionLabel('add_members')).toBe('Thêm thành viên');
    expect(onboardingActionLabel('start_sprint')).toBe('Mở Việc chờ');
    expect(onboardingActionLabel('connect_telegram')).toBe('Kết nối');
  });
});
