import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('244 · áp dụng báo lỗi theo trường (Báo cáo định kỳ, SLA, Tạo việc, Báo lỗi)', () => {
  describe('SLA (SlaPage)', () => {
    const s = () => read('features/sla/SlaPage.tsx');
    it('nút Tạo luôn bật (bỏ disabled mù); lỗi hiện tại ô + tóm tắt, không toast cho lỗi nhập liệu', () => {
      expect(s()).not.toContain('disabled={!name.trim()}');
      expect(s()).not.toContain("toast.error('Hãy nhập tên cam kết");
      expect(s()).toContain('<ErrorSummary');
      expect(s()).toContain('validateSlaForm(');
      expect(s()).toContain('useErrorFlow(');
    });
    it('các ô có nhãn gắn id (FormField)', () => {
      expect(s()).toContain('<FormField');
      for (const id of ['sla-name', 'sla-project', 'sla-response', 'sla-resolve'])
        expect(s(), id).toContain(`"${id}"`);
    });
    it('Cmd/Ctrl+Enter vẫn gửi qua cùng đường submit', () => {
      expect(s()).toMatch(/onSubmit=\{submit\}/);
    });
  });

  describe('Tạo công việc (CreateIssueModal)', () => {
    const s = () => read('features/issues/CreateIssueModal.tsx');
    it('nút Tạo / Tạo & nhập tiếp không bị khoá vì thiếu trường; lỗi → tóm tắt + focus ô lỗi đầu', () => {
      expect(s()).not.toContain('disabled={!canSubmit}');
      expect(s()).not.toContain("toast.error('Hãy nhập tiêu đề mô tả việc cần làm')");
      expect(s()).toContain('<ErrorSummary');
      expect(s()).toContain('validateCreateIssue(');
      expect(s()).toContain('useErrorFlow(');
    });
    it('giữ Cmd/Ctrl+Enter (Dialog + MarkdownEditor) và chặn ô ngày sai như cũ', () => {
      expect(s()).toMatch(/onSubmit=\{\(\) => void submitCreate\(\)\}/);
      expect(s()).toContain('blockOnInvalidDate()');
    });
    it('dự án, loại việc, tiêu đề có id để đưa focus tới', () => {
      for (const id of ['ci-project', 'ci-type', 'ci-summary'])
        expect(s(), id).toContain(`'${id}'`);
    });
  });

  describe('Báo lỗi (ReportIssueModal)', () => {
    const s = () => read('features/intake/ReportIssueModal.tsx');
    it('nút Gửi không bị khoá vì thiếu trường; lỗi → tóm tắt + focus ô lỗi đầu', () => {
      expect(s()).not.toContain('disabled={!canSubmit}');
      expect(s()).toContain('<ErrorSummary');
      expect(s()).toContain('validateReport(');
      expect(s()).toContain('useErrorFlow(');
    });
    it('Cmd/Ctrl+Enter, Enter của form và ô mô tả đều đi qua cùng hàm kiểm lỗi', () => {
      expect(s()).toMatch(/onSubmit=\{\(\) => attempt\(\)\}/);
      expect(s()).toMatch(/onSubmit=\{\(e\) => attempt\(e\)\}/);
      expect(s()).not.toMatch(/onSubmit=\{\(\) => trySubmit\(\)\}/);
    });
  });

  describe('Báo cáo định kỳ (Digest)', () => {
    it('phạm vi dùng FormField (gợi ý/lỗi tới được trigger SearchSelect)', () => {
      const s = read('features/digests/DigestEditorDialog.tsx');
      const at = s.indexOf('function ProjectField');
      expect(s.slice(at)).toContain('<FormField');
    });
  });
});
