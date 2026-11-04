import { describe, expect, it } from 'vitest';
import {
  DASHBOARD_TEMPLATES,
  buildTemplateWidgets,
  findDashboardTemplate,
  scopeJql,
  templateWidgetsFor,
} from './dashboard-templates';
import {
  DASHBOARD_DATA_SCOPES,
  DASHBOARD_LIMITS,
  dashboardFromTemplateSchema,
  dashboardInputSchema,
  widgetInputSchema,
} from './schemas/dashboard';
import { parseJql } from './jql-parser';

describe('DASHBOARD_TEMPLATES', () => {
  it('có đủ 5 mẫu theo đặc tả, khoá duy nhất', () => {
    const keys = DASHBOARD_TEMPLATES.map((t) => t.key);
    expect(keys).toEqual(['project-overview', 'qa', 'developer', 'org-manager', 'blank']);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('mỗi mẫu có tên + mô tả một câu, phạm vi hợp lệ và defaultScope nằm trong scopes', () => {
    for (const t of DASHBOARD_TEMPLATES) {
      expect(t.name.length, t.key).toBeGreaterThan(0);
      expect(t.description.length, t.key).toBeGreaterThan(0);
      expect(t.description.split('. ').length, `${t.key} mô tả một câu`).toBe(1);
      expect(t.scopes.length).toBeGreaterThan(0);
      for (const s of t.scopes) expect(DASHBOARD_DATA_SCOPES).toContain(s);
      expect(t.scopes).toContain(t.defaultScope);
    }
  });

  it.each(DASHBOARD_TEMPLATES.flatMap((t) => t.scopes.map((s) => [t.key, s] as const)))(
    'mẫu %s / phạm vi %s: mọi ô qua widgetInputSchema, không quá giới hạn ô, không lặp thứ tự',
    (key, scope) => {
      const t = findDashboardTemplate(key)!;
      const widgets = buildTemplateWidgets(t, scope, scope === 'PROJECT' ? 'proj_1' : undefined);
      expect(widgets.length).toBeLessThanOrEqual(DASHBOARD_LIMITS.widgetsPerDashboard);
      expect(widgets.map((w) => w.position.order)).toEqual(widgets.map((_, i) => i));
      for (const w of widgets) {
        const r = widgetInputSchema.safeParse(w);
        expect(
          r.success,
          `${key}/${scope}/${w.title}: ${JSON.stringify(!r.success && r.error.issues)}`,
        ).toBe(true);
      }
    },
  );

  it('cả mẫu dựng ra qua dashboardInputSchema (đúng đường tạo dashboard)', () => {
    for (const t of DASHBOARD_TEMPLATES) {
      for (const scope of t.scopes) {
        const r = dashboardInputSchema.safeParse({
          name: t.name,
          scope: 'PRIVATE',
          dataScope: scope,
          ...(scope === 'PROJECT' ? { scopeProjectId: 'p1' } : {}),
          ...(scope === 'GROUP' ? { scopeProgramId: 'g1' } : {}),
          widgets: buildTemplateWidgets(t, scope, scope === 'PROJECT' ? 'p1' : undefined),
        });
        expect(r.success, `${t.key}/${scope}`).toBe(true);
      }
    }
  });

  it('câu JQL của mọi ô danh sách parse được', () => {
    for (const t of DASHBOARD_TEMPLATES) {
      for (const w of t.widgets.filter((x) => x.type === 'ISSUE_LIST')) {
        expect(() => parseJql(String(w.config.jql)), `${t.key}/${w.title}`).not.toThrow();
      }
    }
  });

  it('BURNDOWN/VELOCITY chỉ ở phạm vi một dự án và được gắn dự án; phạm vi khác bị loại', () => {
    const t = findDashboardTemplate('project-overview')!;
    const types = (s: 'PROJECT' | 'GROUP' | 'ORG') => templateWidgetsFor(t, s).map((w) => w.type);
    expect(types('PROJECT')).toEqual(expect.arrayContaining(['BURNDOWN', 'VELOCITY']));
    expect(types('GROUP')).not.toContain('BURNDOWN');
    expect(types('ORG')).not.toContain('VELOCITY');
    const built = buildTemplateWidgets(t, 'PROJECT', 'proj_1');
    for (const w of built.filter((x) => x.type === 'BURNDOWN' || x.type === 'VELOCITY')) {
      expect(w.config).toMatchObject({ projectId: 'proj_1' });
    }
    // Các ô kế thừa KHÔNG mang projectId (đổi phạm vi dashboard thì chúng đi theo).
    for (const w of built.filter((x) => x.type === 'STAT_NUMBER' || x.type === 'PIE_BY_FIELD')) {
      expect(w.config).not.toHaveProperty('projectId');
    }
  });

  it('OVERLOAD (đo toàn tổ chức, không thu hẹp theo nhóm được) chỉ có ở phạm vi ORG', () => {
    const t = findDashboardTemplate('org-manager')!;
    expect(templateWidgetsFor(t, 'ORG').map((w) => w.type)).toContain('OVERLOAD');
    expect(templateWidgetsFor(t, 'GROUP').map((w) => w.type)).not.toContain('OVERLOAD');
  });

  it('mẫu Trống không có ô; Quản lý tổ chức không có phạm vi một dự án', () => {
    expect(findDashboardTemplate('blank')!.widgets).toHaveLength(0);
    expect(findDashboardTemplate('org-manager')!.scopes).not.toContain('PROJECT');
  });

  it('chữ hiển thị không dùng từ cũ của "tổ chức"', () => {
    const banned = ['work', 'space'].join('');
    expect(JSON.stringify(DASHBOARD_TEMPLATES).toLowerCase()).not.toContain(banned);
  });
});

describe('dashboardFromTemplateSchema', () => {
  it('bắt buộc dataScope; PROJECT cần scopeProjectId, GROUP cần scopeProgramId, ORG cấm cả hai', () => {
    expect(dashboardFromTemplateSchema.safeParse({ templateKey: 'qa' }).success).toBe(false);
    expect(
      dashboardFromTemplateSchema.safeParse({ templateKey: 'qa', dataScope: 'PROJECT' }).success,
    ).toBe(false);
    expect(
      dashboardFromTemplateSchema.safeParse({ templateKey: 'qa', dataScope: 'GROUP' }).success,
    ).toBe(false);
    expect(
      dashboardFromTemplateSchema.safeParse({
        templateKey: 'qa',
        dataScope: 'PROJECT',
        scopeProjectId: 'p',
      }).success,
    ).toBe(true);
    expect(
      dashboardFromTemplateSchema.safeParse({
        templateKey: 'qa',
        dataScope: 'GROUP',
        scopeProgramId: 'g',
      }).success,
    ).toBe(true);
    expect(
      dashboardFromTemplateSchema.safeParse({ templateKey: 'qa', dataScope: 'ORG' }).success,
    ).toBe(true);
    expect(
      dashboardFromTemplateSchema.safeParse({
        templateKey: 'qa',
        dataScope: 'ORG',
        scopeProjectId: 'p',
      }).success,
    ).toBe(false);
  });
});

describe('scopeJql', () => {
  it('gắn project IN (...) và giữ ORDER BY ở cuối', () => {
    expect(scopeJql('assignee = currentUser() ORDER BY updated DESC', ['A', 'B'])).toBe(
      'project IN ("A", "B") AND (assignee = currentUser()) ORDER BY updated DESC',
    );
  });
  it('JQL chỉ có ORDER BY / rỗng; kết quả vẫn parse được', () => {
    const out = scopeJql('ORDER BY updated DESC', ['A'])!;
    expect(out).toBe('project IN ("A") ORDER BY updated DESC');
    expect(() => parseJql(out)).not.toThrow();
    expect(scopeJql('status = Done OR status = Open', ['A'])).toBe(
      'project IN ("A") AND (status = Done OR status = Open)',
    );
  });
  it('mọi JQL của mẫu sau khi gắn dự án vẫn parse được', () => {
    for (const t of DASHBOARD_TEMPLATES) {
      for (const w of t.widgets.filter((x) => x.type === 'ISSUE_LIST')) {
        expect(
          () => parseJql(scopeJql(String(w.config.jql), ['KEY1', 'KEY2'])!),
          w.title,
        ).not.toThrow();
      }
    }
  });
  it('không còn dự án nào → null (ô hiện trống, không chạy JQL không giới hạn)', () => {
    expect(scopeJql('assignee = currentUser()', [])).toBeNull();
  });
});
