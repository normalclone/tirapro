import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ErrorSummary } from './ErrorSummary';
import { FormField } from './FormField';
import { Input } from './Input';
import { SearchSelect } from './SearchSelect';
import { SegmentedControl } from './SegmentedControl';

const SRC = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

const errs = [
  { id: 'a', label: 'Tên báo cáo', message: 'Vui lòng nhập tên báo cáo.' },
  { id: 'b', label: 'Nội dung báo cáo', message: 'Chọn ít nhất một khối nội dung.' },
  { id: 'c', label: 'Người nhận email', message: 'Chọn ít nhất một người nhận email.' },
];

describe('ErrorSummary', () => {
  const html = renderToStaticMarkup(<ErrorSummary errors={errs} onNavigate={() => undefined} />);
  it('role="alert", tiêu đề đếm lỗi', () => {
    expect(html).toContain('role="alert"');
    expect(html).toContain('3 trường cần sửa');
  });
  it('mỗi lỗi là một nút (type=button) với tên trường + lời lỗi; không đổi hash URL', () => {
    expect(html.match(/<button[^>]*type="button"/g)?.length).toBe(3);
    expect(html).toContain('Tên báo cáo');
    expect(html).toContain('Vui lòng nhập tên báo cáo.');
    expect(html).not.toContain('href=');
  });
  it('1 lỗi → "1 trường cần sửa"; không lỗi → không vẽ gì', () => {
    expect(renderToStaticMarkup(<ErrorSummary errors={errs.slice(0, 1)} />)).toContain(
      '1 trường cần sửa',
    );
    expect(renderToStaticMarkup(<ErrorSummary errors={[]} />)).toBe('');
  });
  it('dùng token danger, không rung, không (s)', () => {
    const s = read('components/ui/ErrorSummary.tsx');
    expect(s).toMatch(/danger/);
    expect(s).not.toMatch(/shake|animate-\[|keyframes|\(s\)/);
  });
});

describe('Input invalid', () => {
  it('invalid=true → aria-invalid + viền danger, không vẽ lời lỗi', () => {
    const html = renderToStaticMarkup(<Input id="f" invalid />);
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('border-danger');
    expect(html).not.toContain('f-error');
  });
  it('invalid là chuỗi → vẽ lời lỗi có id ổn định; aria-describedby giữ gợi ý cũ + id lỗi', () => {
    const html = renderToStaticMarkup(
      <Input id="f" aria-describedby="f-hint" invalid="Vui lòng nhập tên." />,
    );
    expect(html).toContain('aria-describedby="f-hint f-error"');
    expect(html).toMatch(/<p[^>]*id="f-error"[^>]*>Vui lòng nhập tên\.<\/p>/);
  });
  it('không invalid → không aria-invalid', () => {
    expect(renderToStaticMarkup(<Input id="f" />)).not.toContain('aria-invalid');
  });
  it('không id → vẫn có id lỗi ổn định, và aria-describedby trỏ đúng id đó', () => {
    const html = renderToStaticMarkup(<Input invalid="Sai" />);
    const did = /aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(did).toBeTruthy();
    expect(html).toContain(`id="${did}"`);
  });
});

describe('SearchSelect / SegmentedControl invalid', () => {
  it('SearchSelect: trigger có aria-invalid + describedby tới lời lỗi', () => {
    const html = renderToStaticMarkup(
      <SearchSelect
        id="s"
        value=""
        onChange={() => undefined}
        options={[]}
        invalid="Chọn một mục."
      />,
    );
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="s-error"');
    expect(html).toMatch(/<p[^>]*id="s-error"/);
  });
  it('SegmentedControl: radiogroup có aria-invalid + describedby tới lời lỗi', () => {
    const html = renderToStaticMarkup(
      <SegmentedControl
        id="g"
        ariaLabel="Chế độ"
        value="a"
        onChange={() => undefined}
        options={[{ value: 'a', label: 'A' }]}
        invalid="Chọn chế độ."
      />,
    );
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="g-error"');
    expect(html).toMatch(/<p[^>]*id="g-error"/);
  });
});

describe('FormField', () => {
  it('nhãn gắn id, gợi ý và lỗi có id; truyền invalid/describedby xuống ô', () => {
    const html = renderToStaticMarkup(
      <FormField id="f" label="Tên" hint="Gợi ý" error="Thiếu tên.">
        {(p) => <Input {...p} />}
      </FormField>,
    );
    expect(html).toMatch(/<label[^>]*for="f"/);
    expect(html).toMatch(/<input[^>]*id="f"/);
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="f-hint f-error"');
    expect(html.match(/Thiếu tên\./g)?.length).toBe(1);
    expect(html).toMatch(/<p[^>]*id="f-hint"[^>]*>Gợi ý<\/p>/);
  });
  it('không lỗi → không aria-invalid, chỉ describedby gợi ý', () => {
    const html = renderToStaticMarkup(
      <FormField id="f" label="Tên" hint="Gợi ý">
        {(p) => <Input {...p} />}
      </FormField>,
    );
    expect(html).not.toContain('aria-invalid');
    expect(html).toContain('aria-describedby="f-hint"');
  });
});

describe('Digest (biểu mẫu mẫu): lỗi theo trường thay cho toast', () => {
  const dlg = () => read('features/digests/DigestEditorDialog.tsx');
  it('dùng ErrorSummary + focusFirstError, không toast.error cho lỗi nhập liệu', () => {
    const s = dlg();
    expect(s).toContain('<ErrorSummary');
    expect(s).toContain('focusFirstError(');
    expect(s).not.toMatch(/toast\.error\(error\)/);
  });
  it('lỗi tính lại theo form (sửa tới đâu hết lỗi tới đó) sau lần Lưu lỗi đầu tiên', () => {
    expect(dlg()).toMatch(/showErrors/);
  });
  it('tên báo cáo dùng FormField + Input invalid; khối/người nhận có id để đưa focus tới', () => {
    const s = dlg();
    expect(s).toContain('<FormField');
    expect(read('features/digests/DigestFormFields.tsx')).toContain('id="digest-blocks"');
    expect(read('features/digests/DigestFormFields.tsx')).toContain('id="digest-recipients"');
  });
});
