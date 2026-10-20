import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RuleCondition } from '@tirapro/shared';
import { keys } from '@/lib/queryKeys';
import { RulePreviewLine } from './RulePreviewLine';
import { isCondDraftComplete, previewView, type PreviewMatch } from './rulePreview';

const src = (f: string) => readFileSync(join(__dirname, f), 'utf8');
const field = (over: Partial<{ field: string; op: string; value: string; values: string[] }>) =>
  ({ kind: 'field', field: 'priorityId', op: 'eq', value: '', values: [], ...over }) as never;
const jql = (j: string) => ({ kind: 'jql', jql: j }) as never;

describe('isCondDraftComplete — tắt xem trước khi còn điều kiện dở', () => {
  it('eq/neq/contains cần giá trị không rỗng', () => {
    expect(isCondDraftComplete(field({ value: '' }))).toBe(false);
    expect(isCondDraftComplete(field({ value: '  ' }))).toBe(false);
    expect(isCondDraftComplete(field({ value: 'p1' }))).toBe(true);
    expect(isCondDraftComplete(field({ field: 'summary', op: 'contains', value: 'lỗi' }))).toBe(
      true,
    );
  });
  it('empty/notEmpty luôn đủ', () => {
    expect(isCondDraftComplete(field({ op: 'empty' }))).toBe(true);
    expect(isCondDraftComplete(field({ op: 'notEmpty' }))).toBe(true);
  });
  it('in/nin cần ít nhất một giá trị, không có giá trị rỗng', () => {
    expect(isCondDraftComplete(field({ op: 'in', values: [] }))).toBe(false);
    expect(isCondDraftComplete(field({ op: 'in', values: ['p1', ''] }))).toBe(false);
    expect(isCondDraftComplete(field({ op: 'nin', values: ['p1'] }))).toBe(true);
  });
  it('điểm ước lượng phải là số; hạn phải là ngày YYYY-MM-DD', () => {
    expect(isCondDraftComplete(field({ field: 'storyPoints', value: '' }))).toBe(false);
    expect(isCondDraftComplete(field({ field: 'storyPoints', value: 'abc' }))).toBe(false);
    expect(isCondDraftComplete(field({ field: 'storyPoints', value: '5' }))).toBe(true);
    expect(isCondDraftComplete(field({ field: 'dueDate', value: '2026-10' }))).toBe(false);
    expect(isCondDraftComplete(field({ field: 'dueDate', value: '2026-10-20' }))).toBe(true);
  });
  it('JQL: không rỗng và đúng cú pháp', () => {
    expect(isCondDraftComplete(jql(''))).toBe(false);
    expect(isCondDraftComplete(jql('status = '))).toBe(false);
    expect(isCondDraftComplete(jql('priority = High'))).toBe(true);
  });
});

const m = (over: Partial<PreviewMatch> = {}): PreviewMatch => ({
  count: 12,
  reason: null,
  timedOut: false,
  currentUserInJql: false,
  ...over,
});
const base = { hasConditions: true, pending: false, isError: false, scoped: true };

describe('previewView', () => {
  it('có số: "Khớp N việc hiện có"; quy tắc cấp workspace thêm "(trong các dự án bạn xem được)"', () => {
    expect(previewView({ ...base, data: m() })).toEqual({
      text: 'Khớp 12 việc hiện có',
      warning: null,
    });
    expect(previewView({ ...base, scoped: false, data: m() })?.text).toBe(
      'Khớp 12 việc hiện có (trong các dự án bạn xem được)',
    );
    expect(previewView({ ...base, data: m({ count: 0 }) })?.text).toBe('Khớp 0 việc hiện có');
    expect(previewView({ ...base, data: m({ count: 12345 }) })?.text).toBe(
      'Khớp 12.345 việc hiện có',
    );
  });
  it('quá hạn → "không đếm kịp"', () => {
    expect(previewView({ ...base, data: m({ count: null, timedOut: true }) })?.text).toBe(
      'không đếm kịp',
    );
  });
  it('không xem trước được → hiện lý do của máy chủ, không có số', () => {
    const v = previewView({
      ...base,
      data: m({ count: null, reason: 'không xem trước được điều kiện này' }),
    });
    expect(v?.text).toBe('không xem trước được điều kiện này');
  });
  it('currentUser() trong JQL → cảnh báo kèm theo (số vẫn hiện)', () => {
    const v = previewView({ ...base, data: m({ currentUserInJql: true }) });
    expect(v).toEqual({
      text: 'Khớp 12 việc hiện có',
      warning: 'currentUser() không có nghĩa trong tự động hoá',
    });
  });
  it('đang đếm (kể cả đang chờ debounce) → "Đang đếm…", không giữ số cũ', () => {
    expect(previewView({ ...base, pending: true })?.text).toBe('Đang đếm…');
    expect(previewView({ ...base, pending: true, data: m() })?.text).toBe('Đang đếm…');
  });
  it('lỗi (API cũ 404, mạng) → không hiện gì; không có điều kiện → không hiện gì', () => {
    expect(previewView({ ...base, isError: true })).toBeNull();
    expect(previewView({ ...base, hasConditions: false, data: m() })).toBeNull();
  });
});

const conds: RuleCondition[] = [{ field: 'priorityId', op: 'eq', value: 'p1' }];
const render = (
  data: PreviewMatch | undefined,
  projectId = 'p1',
  conditions: RuleCondition[] | null = conds,
) => {
  const qc = new QueryClient();
  if (data) qc.setQueryData(keys.automation.preview(projectId, JSON.stringify(conditions)), data);
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <RulePreviewLine conditions={conditions} projectId={projectId} />
    </QueryClientProvider>,
  );
};

describe('RulePreviewLine', () => {
  it('một dòng nhỏ, yên lặng: KHÔNG phải vùng thông báo (không role=status/alert, không aria-live)', () => {
    const html = render(m());
    expect(html).toContain('Khớp 12 việc hiện có');
    expect(html).not.toMatch(/role=|aria-live/);
    expect(src('RulePreviewLine.tsx')).not.toMatch(/aria-live|role=/);
  });
  it('workspace → ghi rõ phạm vi theo quyền xem', () => {
    expect(render(m(), '')).toContain('(trong các dự án bạn xem được)');
  });
  it('cảnh báo currentUser() hiện thành một dòng riêng', () => {
    expect(render(m({ currentUserInJql: true }))).toContain(
      'currentUser() không có nghĩa trong tự động hoá',
    );
  });
  it('điều kiện dở (null) hoặc rỗng → không vẽ gì', () => {
    expect(render(undefined, 'p1', null)).toBe('');
    expect(render(undefined, 'p1', [])).toBe('');
  });
});

describe('nối dây', () => {
  it('khoá truy vấn qua queryKeys.automation.preview; POST /automation/rules/preview-match; debounce 500ms', () => {
    expect(keys.automation.preview('p1', 'x')).toEqual(['automation', 'preview', 'p1', 'x']);
    const api = src('rules-api.ts');
    expect(api).toMatch(/keys\.automation\.preview\(/);
    expect(api).toContain('/automation/rules/preview-match');
    expect(api).toMatch(/useDebouncedValue\([^)]*,\s*500\)/);
  });
  it('RuleEditor: dòng xem trước đứng ngay dưới ConditionSentence, chỉ với điều kiện đủ', () => {
    const s = src('RuleEditor.tsx');
    const i = s.indexOf('<ConditionSentence');
    expect(s.indexOf('<RulePreviewLine', i)).toBeGreaterThan(i);
    expect(s.indexOf('<RulePreviewLine', i) - i).toBeLessThan(400);
    expect(s).toMatch(/every\(isCondDraftComplete\)/);
  });
  it('không dựng lại câu điều kiện: ConditionSentence/describeConditions giữ nguyên', () => {
    expect(src('ConditionSentence.tsx')).not.toMatch(/preview|Khớp/i);
  });
});
