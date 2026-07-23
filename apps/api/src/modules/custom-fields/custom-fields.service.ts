import { HttpStatus, Injectable } from '@nestjs/common';
import { CustomFieldType, Prisma } from '@prisma/client';
import { ERROR_CODES } from '@tirapro/types';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AppException, NotFoundAppException } from '../../common/exceptions/app.exception';

/** Field định nghĩa kèm options (cho dropdown / hiển thị). */
const fieldInclude = {
  options: { orderBy: { order: 'asc' } },
} satisfies Prisma.CustomFieldInclude;
type FieldRow = Prisma.CustomFieldGetPayload<{ include: typeof fieldInclude }>;

export interface CreateCustomFieldInput {
  name: string;
  type: CustomFieldType;
  projectId?: string;
  isRequired?: boolean;
  order?: number;
  options?: { value: string }[];
}

export interface UpdateCustomFieldInput {
  name?: string;
  isRequired?: boolean;
  order?: number;
}

/** Giá trị đã chuẩn hoá trả về FE (kiểu phụ thuộc loại field). */
export type NormalizedFieldValue = string | number | boolean | string[] | null;

export interface FieldOptionView {
  id: string;
  value: string;
  color: string | null;
  order: number;
}

export interface FieldDefinitionView {
  id: string;
  name: string;
  type: CustomFieldType;
  isRequired: boolean;
  options: FieldOptionView[];
}

export interface IssueFieldValueView {
  field: FieldDefinitionView;
  value: NormalizedFieldValue;
}

const SELECT_TYPES = new Set<CustomFieldType>([
  CustomFieldType.SELECT,
  CustomFieldType.MULTI_SELECT,
]);

@Injectable()
export class CustomFieldsService {
  constructor(private readonly prisma: PrismaService) {}

  // ============================ DEFINITIONS ============================

  /** Liệt kê field áp dụng cho workspace; nếu có projectId → field của project đó + field global (projectId null). */
  async listDefinitions(workspaceId: string, projectId?: string): Promise<FieldDefinitionView[]> {
    if (projectId) await this.requireProject(workspaceId, projectId);
    const where: Prisma.CustomFieldWhereInput = {
      workspaceId,
      deletedAt: null,
      ...(projectId ? { OR: [{ projectId }, { projectId: null }] } : {}),
    };
    const rows = await this.prisma.customField.findMany({
      where,
      include: fieldInclude,
      orderBy: { order: 'asc' },
    });
    return rows.map((r) => this.toDefinitionView(r));
  }

  async createDefinition(workspaceId: string, input: CreateCustomFieldInput): Promise<FieldDefinitionView> {
    if (input.projectId) await this.requireProject(workspaceId, input.projectId);

    const isSelect = SELECT_TYPES.has(input.type);
    const rawOptions = isSelect ? input.options ?? [] : [];
    // Khử trùng lặp value (option unique [customFieldId, value]).
    const seen = new Set<string>();
    const options = rawOptions
      .map((o) => o.value.trim())
      .filter((v) => v.length > 0 && !seen.has(v) && (seen.add(v), true))
      .map((value, idx) => ({ value, order: idx }));

    const created = await this.prisma.customField.create({
      data: {
        workspaceId,
        projectId: input.projectId ?? null,
        name: input.name.trim(),
        type: input.type,
        isRequired: input.isRequired ?? false,
        order: input.order ?? 0,
        ...(options.length ? { options: { create: options } } : {}),
      },
      include: fieldInclude,
    });
    return this.toDefinitionView(created);
  }

  async updateDefinition(
    workspaceId: string,
    id: string,
    input: UpdateCustomFieldInput,
  ): Promise<FieldDefinitionView> {
    await this.requireField(workspaceId, id);
    const data: Prisma.CustomFieldUpdateInput = {};
    if (input.name !== undefined) data.name = input.name.trim();
    if (input.isRequired !== undefined) data.isRequired = input.isRequired;
    if (input.order !== undefined) data.order = input.order;
    const updated = await this.prisma.customField.update({
      where: { id },
      data,
      include: fieldInclude,
    });
    return this.toDefinitionView(updated);
  }

  async softDeleteDefinition(workspaceId: string, id: string): Promise<{ success: true }> {
    await this.requireField(workspaceId, id);
    await this.prisma.customField.update({ where: { id }, data: { deletedAt: new Date() } });
    return { success: true };
  }

  // ============================ VALUES (per issue) ============================

  /** Field áp dụng cho issue + giá trị hiện tại đã merge & chuẩn hoá. */
  async listIssueValues(workspaceId: string, issueId: string): Promise<IssueFieldValueView[]> {
    const issue = await this.requireIssue(workspaceId, issueId);
    const fields = await this.prisma.customField.findMany({
      where: {
        workspaceId,
        deletedAt: null,
        OR: [{ projectId: issue.projectId }, { projectId: null }],
      },
      include: fieldInclude,
      orderBy: { order: 'asc' },
    });
    const values = await this.prisma.customFieldValue.findMany({ where: { issueId } });
    const byField = new Map(values.map((v) => [v.customFieldId, v]));
    return fields.map((field) => ({
      field: this.toDefinitionView(field),
      value: this.normalizeValue(field.type, byField.get(field.id) ?? null),
    }));
  }

  /** Ghi giá trị field cho issue (upsert theo unique [issueId, customFieldId]). */
  async setIssueValue(
    workspaceId: string,
    issueId: string,
    fieldId: string,
    value: unknown,
  ): Promise<IssueFieldValueView> {
    await this.requireIssue(workspaceId, issueId);
    const field = await this.requireField(workspaceId, fieldId);

    const columns = this.toColumns(field, value);
    const empty: Prisma.CustomFieldValueUncheckedCreateInput = {
      issueId,
      customFieldId: fieldId,
      valueText: null,
      valueNumber: null,
      valueDate: null,
      valueBool: null,
      valueUserId: null,
      valueOptionIds: [],
    };
    const saved = await this.prisma.customFieldValue.upsert({
      where: { issueId_customFieldId: { issueId, customFieldId: fieldId } },
      create: { ...empty, ...columns },
      update: columns,
    });
    return {
      field: this.toDefinitionView(field),
      value: this.normalizeValue(field.type, saved),
    };
  }

  // ============================ HELPERS ============================

  private toDefinitionView(f: FieldRow): FieldDefinitionView {
    return {
      id: f.id,
      name: f.name,
      type: f.type,
      isRequired: f.isRequired,
      options: f.options.map((o) => ({ id: o.id, value: o.value, color: o.color, order: o.order })),
    };
  }

  /** Chọn cột lưu theo loại field. Reset các cột còn lại về null/[] (qua `empty`). */
  private toColumns(
    field: FieldRow,
    value: unknown,
  ): Partial<Prisma.CustomFieldValueUncheckedCreateInput> {
    switch (field.type) {
      case CustomFieldType.TEXT:
      case CustomFieldType.TEXTAREA:
      case CustomFieldType.URL:
        return { valueText: value == null ? null : this.asString(field, value) };
      case CustomFieldType.NUMBER:
        return { valueNumber: value == null ? null : this.asNumber(value) };
      case CustomFieldType.DATE:
      case CustomFieldType.DATETIME:
        return { valueDate: value == null ? null : this.asDate(value) };
      case CustomFieldType.CHECKBOX:
        return { valueBool: value == null ? null : this.asBool(value) };
      case CustomFieldType.USER:
        return { valueUserId: value == null ? null : this.asString(field, value) };
      case CustomFieldType.SELECT:
        return { valueOptionIds: value == null ? [] : [this.asOptionId(field, value)] };
      case CustomFieldType.MULTI_SELECT:
        return { valueOptionIds: value == null ? [] : this.asOptionIds(field, value) };
      default:
        return {};
    }
  }

  /** Chuẩn hoá giá trị ra FE theo loại field. */
  private normalizeValue(
    type: CustomFieldType,
    row: {
      valueText: string | null;
      valueNumber: number | null;
      valueDate: Date | null;
      valueBool: boolean | null;
      valueUserId: string | null;
      valueOptionIds: string[];
    } | null,
  ): NormalizedFieldValue {
    if (!row) return type === CustomFieldType.MULTI_SELECT ? [] : null;
    switch (type) {
      case CustomFieldType.TEXT:
      case CustomFieldType.TEXTAREA:
      case CustomFieldType.URL:
        return row.valueText;
      case CustomFieldType.NUMBER:
        return row.valueNumber;
      case CustomFieldType.DATE:
      case CustomFieldType.DATETIME:
        return row.valueDate ? row.valueDate.toISOString() : null;
      case CustomFieldType.CHECKBOX:
        return row.valueBool;
      case CustomFieldType.USER:
        return row.valueUserId;
      case CustomFieldType.SELECT:
        return row.valueOptionIds[0] ?? null;
      case CustomFieldType.MULTI_SELECT:
        return row.valueOptionIds;
      default:
        return null;
    }
  }

  // ---- narrowing & validation (no `any`) ----

  private invalid(message: string): AppException {
    return new AppException(ERROR_CODES.VALIDATION_ERROR, message, HttpStatus.BAD_REQUEST);
  }

  private asString(field: FieldRow, value: unknown): string {
    if (typeof value !== 'string') throw this.invalid(`Field "${field.name}" cần giá trị dạng chuỗi`);
    if (field.type === CustomFieldType.URL && value.length > 0) {
      try {
        new URL(value);
      } catch {
        throw this.invalid(`Field "${field.name}" cần một URL hợp lệ`);
      }
    }
    return value;
  }

  private asNumber(value: unknown): number {
    const n = typeof value === 'string' ? Number(value) : value;
    if (typeof n !== 'number' || Number.isNaN(n)) throw this.invalid('Giá trị phải là một số hợp lệ');
    return n;
  }

  private asDate(value: unknown): Date {
    if (typeof value !== 'string' && typeof value !== 'number' && !(value instanceof Date)) {
      throw this.invalid('Giá trị phải là một ngày hợp lệ');
    }
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) throw this.invalid('Giá trị phải là một ngày hợp lệ');
    return d;
  }

  private asBool(value: unknown): boolean {
    if (typeof value === 'boolean') return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    throw this.invalid('Giá trị phải là true/false');
  }

  private optionIds(field: FieldRow): Set<string> {
    return new Set(field.options.map((o) => o.id));
  }

  private asOptionId(field: FieldRow, value: unknown): string {
    if (typeof value !== 'string') throw this.invalid(`Field "${field.name}" cần một lựa chọn`);
    if (!this.optionIds(field).has(value)) {
      throw this.invalid(`Lựa chọn không hợp lệ cho field "${field.name}"`);
    }
    return value;
  }

  private asOptionIds(field: FieldRow, value: unknown): string[] {
    if (!Array.isArray(value) || !value.every((v): v is string => typeof v === 'string')) {
      throw this.invalid(`Field "${field.name}" cần danh sách lựa chọn`);
    }
    const allowed = this.optionIds(field);
    const unique = [...new Set(value)];
    for (const id of unique) {
      if (!allowed.has(id)) throw this.invalid(`Lựa chọn không hợp lệ cho field "${field.name}"`);
    }
    return unique;
  }

  private async requireProject(workspaceId: string, projectId: string) {
    const p = await this.prisma.project.findFirst({
      where: { id: projectId, workspaceId, deletedAt: null },
      select: { id: true },
    });
    if (!p) throw new NotFoundAppException('Project');
    return p;
  }

  private async requireField(workspaceId: string, id: string): Promise<FieldRow> {
    const f = await this.prisma.customField.findFirst({
      where: { id, workspaceId, deletedAt: null },
      include: fieldInclude,
    });
    if (!f) throw new NotFoundAppException('Custom field');
    return f;
  }

  private async requireIssue(workspaceId: string, issueId: string) {
    const issue = await this.prisma.issue.findFirst({
      where: { id: issueId, workspaceId, deletedAt: null },
      select: { id: true, projectId: true },
    });
    if (!issue) throw new NotFoundAppException('Issue');
    return issue;
  }
}
