import { z } from 'zod';

/** Giới hạn dashboard tuỳ biến (kiểm cả ở zod lẫn service). */
export const DASHBOARD_LIMITS = {
  widgetsPerDashboard: 12,
  dashboardsPerOwner: 30,
} as const;

/** Bốn mức chia sẻ: riêng tư / cả workspace / thành viên một dự án / thành viên một nhóm. */
export const DASHBOARD_SCOPES = ['PRIVATE', 'GLOBAL', 'PROJECT', 'TEAM'] as const;
export type DashboardScopeValue = (typeof DASHBOARD_SCOPES)[number];

/** Loại ô đã hỗ trợ. CFD / SPRINT_REPORT / CONTROL_CHART / AI_INSIGHT có trong enum DB nhưng bị từ chối ("Chưa hỗ trợ"). */
export const DASHBOARD_WIDGET_TYPES = [
  'STAT_NUMBER',
  'PIE_BY_FIELD',
  'ISSUE_LIST',
  'BURNDOWN',
  'VELOCITY',
  'CREATED_VS_RESOLVED',
  'TOP_RISKS',
  'SLOW_GOALS',
  'OVERLOAD',
] as const;
export type DashboardWidgetType = (typeof DASHBOARD_WIDGET_TYPES)[number];

const UNSUPPORTED_WIDGET_TYPES = ['CFD', 'SPRINT_REPORT', 'CONTROL_CHART', 'AI_INSIGHT'] as const;

export const STAT_METRICS = ['open', 'overdue', 'bugs', 'done14', 'projects'] as const;
export const PIE_FIELDS = ['status', 'type', 'priority'] as const;

const projectIdOptional = z.string().min(1).optional();
const projectIdRequired = z.string().min(1, 'Chọn dự án');

/** Cấu hình theo loại ô; khoá lạ bị bỏ (zod object mặc định strip) để config lưu vào DB luôn sạch. */
const WIDGET_CONFIG = {
  STAT_NUMBER: z.object({ metric: z.enum(STAT_METRICS), projectId: projectIdOptional }),
  PIE_BY_FIELD: z.object({ field: z.enum(PIE_FIELDS), projectId: projectIdOptional }),
  ISSUE_LIST: z.object({
    jql: z.string().trim().min(1, 'Nhập câu lọc JQL').max(500),
    limit: z.number().int().min(5).max(20).default(10),
  }),
  BURNDOWN: z.object({ projectId: projectIdRequired }),
  VELOCITY: z.object({ projectId: projectIdRequired }),
  CREATED_VS_RESOLVED: z.object({ projectId: projectIdOptional }),
  TOP_RISKS: z.object({}),
  SLOW_GOALS: z.object({}),
  OVERLOAD: z.object({}),
} as const satisfies Record<DashboardWidgetType, z.ZodTypeAny>;

const WIDGET_TYPE_VALUES = [...DASHBOARD_WIDGET_TYPES, ...UNSUPPORTED_WIDGET_TYPES] as const;

export const widgetPositionSchema = z.object({
  order: z.number().int().min(0),
  w: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});

export const widgetInputSchema = z
  .object({
    id: z.string().min(1).optional(),
    type: z.enum(WIDGET_TYPE_VALUES),
    title: z.string().trim().min(1, 'Tiêu đề ô bắt buộc').max(80),
    config: z.record(z.unknown()).default({}),
    position: widgetPositionSchema,
  })
  .transform((w, ctx) => {
    if (!(DASHBOARD_WIDGET_TYPES as readonly string[]).includes(w.type)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['type'],
        message: 'Chưa hỗ trợ loại ô này',
      });
      return z.NEVER;
    }
    const parsed = WIDGET_CONFIG[w.type as DashboardWidgetType].safeParse(w.config);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({ ...issue, path: ['config', ...issue.path] });
      }
      return z.NEVER;
    }
    return {
      ...w,
      type: w.type as DashboardWidgetType,
      config: parsed.data,
    };
  });

export type WidgetInput = z.output<typeof widgetInputSchema>;

const dashboardShape = {
  name: z.string().trim().min(1, 'Tên dashboard bắt buộc').max(120),
  description: z.string().trim().max(500).nullable().optional(),
  scope: z.enum(DASHBOARD_SCOPES),
  projectId: z.string().min(1).optional(),
  teamId: z.string().min(1).optional(),
  widgets: z
    .array(widgetInputSchema)
    .max(DASHBOARD_LIMITS.widgetsPerDashboard)
    .refine(
      (ws) => {
        const ids = ws.map((w) => w.id).filter((v): v is string => !!v);
        return new Set(ids).size === ids.length;
      },
      { message: 'Có ô bị lặp id' },
    )
    .default([]),
};

type ScopeFields = { scope: DashboardScopeValue; projectId?: string; teamId?: string };

/** PROJECT ⇒ cần projectId & cấm teamId; TEAM ⇒ cần teamId & cấm projectId; PRIVATE/GLOBAL ⇒ cấm cả hai. */
function scopeRules(v: ScopeFields, ctx: z.RefinementCtx): void {
  const need = (field: 'projectId' | 'teamId', message: string) => {
    if (!v[field]) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message });
  };
  const forbid = (field: 'projectId' | 'teamId', message: string) => {
    if (v[field]) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message });
  };
  if (v.scope === 'PROJECT') {
    need('projectId', 'Chọn dự án để chia sẻ');
    forbid('teamId', 'Mức "theo dự án" không đi kèm nhóm');
  } else if (v.scope === 'TEAM') {
    need('teamId', 'Chọn nhóm để chia sẻ');
    forbid('projectId', 'Mức "theo nhóm" không đi kèm dự án');
  } else {
    forbid('projectId', 'Chỉ mức "theo dự án" mới gắn dự án');
    forbid('teamId', 'Chỉ mức "theo nhóm" mới gắn nhóm');
  }
}

export const dashboardInputSchema = z.object(dashboardShape).superRefine(scopeRules);

/** Cập nhật = thay toàn bộ + `updatedAt` đã đọc (lệch → 409 "vừa được người khác sửa"). */
export const dashboardUpdateSchema = z
  .object({ ...dashboardShape, updatedAt: z.string().datetime() })
  .superRefine(scopeRules);

export type DashboardInput = z.output<typeof dashboardInputSchema>;
export type DashboardUpdateInput = z.output<typeof dashboardUpdateSchema>;

/* ------------------------------------------------------------------ */
/* DTO trả về cho FE                                                   */
/* ------------------------------------------------------------------ */

export interface CustomWidgetDto {
  id: string;
  type: string;
  title: string;
  config: Record<string, unknown>;
  position: { order: number; w: 1 | 2 | 3 };
}

export interface CustomDashboardSummaryDto {
  id: string;
  name: string;
  description: string | null;
  scope: DashboardScopeValue;
  widgetCount: number;
  /** Của chính người xem. */
  isMine: boolean;
  /** Sửa nội dung/đổi mức chia sẻ: CHỈ chủ. Người khác dùng "Nhân bản". */
  canEdit: boolean;
  /** Xoá: chủ, hoặc admin workspace với dashboard đã chia sẻ (kiểm duyệt). */
  canDelete: boolean;
  owner: { id: string; displayName: string; avatarUrl: string | null };
  project: { id: string; key: string; name: string } | null;
  team: { id: string; name: string } | null;
  updatedAt: string;
}

export interface CustomDashboardDto extends CustomDashboardSummaryDto {
  widgets: CustomWidgetDto[];
}
