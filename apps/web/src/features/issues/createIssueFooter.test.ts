import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const s = readFileSync(join(__dirname, 'CreateIssueModal.tsx'), 'utf8');
const footer = s.slice(s.indexOf('footer={'), s.indexOf('<form\n        id="create-issue-form"'));

describe('footer Tạo công việc — hai nút ngang hàng', () => {
  it('footer có Huỷ + "Tạo & nhập tiếp" + "Tạo" ngang hàng (không còn nút tách/menu)', () => {
    expect(footer).toContain('Huỷ');
    expect(footer).not.toContain('<SplitButton');
    expect(footer.match(/<Button\b/g)).toHaveLength(3);
    const iAnother = footer.indexOf('Tạo &amp; nhập tiếp');
    const iCreate = footer.search(/>\s*Tạo\s*<\/Button>/);
    expect(iAnother).toBeGreaterThan(footer.indexOf('Huỷ'));
    expect(iCreate).toBeGreaterThan(iAnother); // nút chính ở cuối
  });
  it('"Tạo" gửi form như cũ; "Tạo & nhập tiếp" gọi createAnother', () => {
    expect(footer).toMatch(/type="submit"\s+form="create-issue-form"/);
    expect(footer).toContain('onClick={() => void createAnother()}');
  });
  it('mọi đường đi qua submitCreate/createAnother → doCreate (lỗi, chặn gửi đúp, ngày sai)', () => {
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
  it('cả hai nút bị chặn khi đang gửi / chờ loại việc; spinner chỉ ở nút vừa bấm', () => {
    expect(footer.match(/disabled=\{metaLoading \|\| create\.isPending \|\| busy\}/g)).toHaveLength(
      2,
    );
    expect(footer).toContain("loading={(create.isPending || busy) && via === 'another'}");
    expect(footer).toContain("loading={(create.isPending || busy) && via === 'create'}");
  });
  it('phím tắt hiển thị + aria-keyshortcuts: Tạo = Cmd/Ctrl+Enter, Tạo & nhập tiếp = thêm Shift', () => {
    expect(footer).toContain('aria-keyshortcuts={SUBMIT_ALT_SHORTCUT.keys}');
    expect(footer).toContain('aria-keyshortcuts={SUBMIT_SHORTCUT.keys}');
    const lib = readFileSync(join(__dirname, '../../lib/submitShortcut.ts'), 'utf8');
    expect(lib).toContain("keys: 'Meta+Shift+Enter Control+Shift+Enter'");
    expect(lib).toContain("keys: 'Meta+Enter Control+Enter'");
  });
  it('gợi ý ở footer nêu cả hai phím tắt', () => {
    expect(footer).toMatch(/⌘\/Ctrl \+ Enter[^<]*tạo[^<]*Shift[^<]*nhập tiếp/);
  });
});

describe('Cmd/Ctrl+Shift+Enter = Tạo & nhập tiếp (không rơi về Tạo & mở)', () => {
  const dialog = readFileSync(join(__dirname, '../../components/ui/Dialog.tsx'), 'utf8');
  const md = readFileSync(join(__dirname, '../issue-edit/MarkdownEditor.tsx'), 'utf8');
  it('Dialog và MarkdownEditor chọn hành động bằng pickSubmit (Shift → onSubmitAlt)', () => {
    expect(dialog).toContain('onSubmitAlt');
    expect(dialog).toContain('pickSubmit(');
    expect(md).toContain('onSubmitAlt');
    expect(md).toContain('pickSubmit(');
  });
  it('CreateIssue truyền onSubmitAlt = createAnother cho Dialog và mọi MarkdownEditor (mô tả + tiêu chí)', () => {
    expect(s).toMatch(/onSubmitAlt=\{\(\) => void createAnother\(\)\}/);
    expect(s.match(/onSubmitAlt=\{\(\) => void createAnother\(\)\}/g)!.length).toBe(3);
    expect(s.match(/onSubmit=\{\(\) => void submitCreate\(\)\}/g)!.length).toBe(3);
  });
  it('createAnother đi qua doCreate (guard, flow.fail, ngày sai)', () => {
    const another = s.slice(
      s.indexOf('async function createAnother'),
      s.indexOf('return (\n    <Dialog'),
    );
    expect(another).toContain('await doCreate()');
  });
});
