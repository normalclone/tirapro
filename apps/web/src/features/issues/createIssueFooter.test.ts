import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const s = readFileSync(join(__dirname, 'CreateIssueModal.tsx'), 'utf8');
const footer = s.slice(s.indexOf('footer={'), s.indexOf('<form\n        id="create-issue-form"'));

describe('footer Tạo công việc — nút tách', () => {
  it('footer chỉ còn Huỷ + một nút tách (không còn nút "Tạo & nhập tiếp" riêng)', () => {
    expect(footer).toContain('Huỷ');
    expect(footer.match(/<SplitButton/g)).toHaveLength(1);
    expect(footer.match(/<Button\b/g)).toHaveLength(1); // chỉ Huỷ
    expect(footer).not.toMatch(/variant="secondary"/);
  });
  it('nút chính "Tạo" gửi form như cũ; menu có đúng hai mục với đúng chữ; tên nút ▾', () => {
    expect(footer).toMatch(/type="submit"\s+form="create-issue-form"/);
    expect(footer).toMatch(/>\s*Tạo\s*<\/SplitButton>/);
    expect(footer).toContain("label: 'Tạo & nhập tiếp'");
    expect(footer).toContain("label: 'Tạo & mở'");
    expect(footer).toContain('menuLabel="Tuỳ chọn tạo khác"');
  });
  it('mọi đường đi qua submitCreate/createAnother → doCreate (lỗi, chặn gửi đúp, ngày sai)', () => {
    expect(footer).toContain('onSelect: () => void createAnother()');
    expect(footer).toContain('onSelect: () => void submitCreate()');
    const doCreate = s.slice(
      s.indexOf('async function doCreate'),
      s.indexOf('function switchToReport'),
    );
    expect(doCreate).toContain('create.isPending || busy || metaLoading');
    expect(doCreate).toContain('flow.fail()');
    expect(doCreate).toContain('blockOnInvalidDate()');
    const another = s.slice(
      s.indexOf('async function createAnother'),
      s.indexOf('return (\n    <Dialog'),
    );
    expect(another).toContain('await doCreate()');
    const submit = s.slice(
      s.indexOf('async function submitCreate'),
      s.indexOf('async function createAnother'),
    );
    expect(submit).toContain('await doCreate()');
    expect(submit).toContain('navigate(`/issue/${created.key}`)');
  });
  it('Cmd/Ctrl+Enter và Enter của form giữ hành vi cũ: submitCreate (tạo, đóng, mở việc)', () => {
    expect(s).toMatch(/onSubmit=\{\(\) => void submitCreate\(\)\}/);
    expect(s).toMatch(/onSubmit=\{\(e\) => \{\s*e\.preventDefault\(\);\s*void submitCreate\(\);/);
  });
  it('nút tách bị chặn khi đang gửi / chờ loại việc (cả hai nửa)', () => {
    expect(footer).toContain('loading={create.isPending || busy}');
    expect(footer).toContain('disabled={metaLoading}');
  });
});
