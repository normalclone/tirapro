import { describe, expect, it } from 'vitest';
import { DOC_GROUPS, DOC_TOPICS } from '@/features/docs/docsIndex';
import { KNOWLEDGE, POPULAR_QUESTIONS, searchKnowledge, tokenize } from './knowledge';
import { SCREENS } from './screens';
import { detectIntent } from './intents';

const top = (q: string) => searchKnowledge(q, 3).map((h) => h.entry.id);

describe('tokenize', () => {
  it('bỏ dấu, hạ chữ thường, bỏ từ dừng, gộp đồng nghĩa', () => {
    expect(tokenize('Làm sao TẠO công việc?')).toEqual(['tao', 'task']);
    expect(tokenize('tạo việc')).toEqual(tokenize('thêm issue'));
    expect(tokenize('Phân quyền')).toEqual(tokenize('vai trò'));
  });
});

describe('searchKnowledge — chấm điểm', () => {
  it('"làm sao tạo sprint" → mục lập & chạy sprint đứng đầu', () => {
    expect(top('Làm sao tạo sprint?')[0]).toBe('lap-chay-sprint');
    expect(top('lam sao tao sprint')[0]).toBe('lap-chay-sprint');
  });
  it('"phân quyền thế nào" → thêm người & phân quyền / hiểu về vai trò', () => {
    const t = top('phân quyền thế nào');
    expect(t[0]).toBe('them-nguoi-phan-quyen');
    expect(t).toContain('vai-tro');
  });
  it('"nhập excel ở đâu" → mục Nhập Excel (có nút mở dự án)', () => {
    const t = searchKnowledge('nhập excel ở đâu');
    expect(t[0]!.entry.id).toBe('nhap-excel');
    expect(t[0]!.entry.open?.to).toContain('/config/data');
  });
  it('"phím tắt" / "shortcut" → mục Phím tắt', () => {
    expect(top('phím tắt')[0]).toBe('phim-tat');
    expect(top('keyboard shortcut')[0]).toBe('phim-tat');
  });
  it('đồng nghĩa: task = việc = công việc = issue', () => {
    const base = top('tạo task nhanh');
    for (const w of ['tạo việc nhanh', 'tạo công việc nhanh', 'tạo issue nhanh'])
      expect(top(w)).toEqual(base);
  });
  it('không dấu = có dấu, hoa = thường', () => {
    expect(top('NHẬP EXCEL')).toEqual(top('nhap excel'));
    expect(top('BÁO LỖI')).toEqual(top('bao loi'));
  });
  it('báo lỗi → mục báo bug', () => {
    expect(top('báo lỗi thế nào')[0]).toBe('bao-mot-bug');
  });
  it('JQL → cú pháp JQL', () => {
    expect(top('cú pháp jql')[0]).toBe('cu-phap-jql');
  });
  it('câu vô nghĩa / chỉ toàn từ dừng → không khớp (trợ lý nói không hiểu)', () => {
    expect(searchKnowledge('asdf qwer zxcv')).toEqual([]);
    expect(searchKnowledge('làm sao ở đâu thế nào')).toEqual([]);
    expect(searchKnowledge('')).toEqual([]);
  });
  it('tối đa `limit` kết quả, điểm giảm dần', () => {
    const r = searchKnowledge('tạo task sprint dự án', 2);
    expect(r.length).toBeLessThanOrEqual(2);
    for (let i = 1; i < r.length; i++) expect(r[i - 1]!.score).toBeGreaterThanOrEqual(r[i]!.score);
  });
});

describe('kho tri thức', () => {
  const docIds = new Set([...DOC_GROUPS.flatMap((g) => g.items), ...DOC_TOPICS].map((e) => e.id));
  it('mọi mục có anchor trỏ vào Docs thật (kể cả mục bổ sung)', () => {
    for (const k of KNOWLEDGE) expect(docIds.has(k.anchor), `${k.id} → #${k.anchor}`).toBe(true);
  });
  it('id không trùng', () => {
    expect(new Set(KNOWLEDGE.map((k) => k.id)).size).toBe(KNOWLEDGE.length);
  });
  it('mọi chip câu hỏi phổ biến đều có câu trả lời trong kho', () => {
    for (const q of POPULAR_QUESTIONS) expect(searchKnowledge(q).length, q).toBeGreaterThan(0);
  });
  it('mọi chip gợi ý theo màn đều được trợ lý hiểu (ý định cụ thể hoặc có mục trong kho)', () => {
    for (const s of SCREENS)
      for (const chip of s.chips) {
        const intent = detectIntent(chip);
        const ok = intent.kind !== 'help' || searchKnowledge(chip).length > 0;
        expect(ok, `${s.pattern}: "${chip}" → ${intent.kind}`).toBe(true);
      }
  });
});
