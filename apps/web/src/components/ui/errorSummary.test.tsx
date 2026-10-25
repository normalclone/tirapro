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
  const html = renderToStaticMarkup(
    <ErrorSummary errors={errs} attempt={1} onNavigate={() => undefined} />,
  );
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
    expect(renderToStaticMarkup(<ErrorSummary errors={errs.slice(0, 1)} attempt={1} />)).toContain(
      '1 trường cần sửa',
    );
    expect(renderToStaticMarkup(<ErrorSummary errors={[]} attempt={0} />)).toBe('');
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
    expect(s).toContain('useErrorFlow(');
    expect(s).not.toMatch(/toast\.error\(error\)/);
  });
  it('lỗi tính lại theo form (sửa tới đâu hết lỗi tới đó) sau lần Lưu lỗi đầu tiên', () => {
    expect(dlg()).toMatch(/flow\.fail\(\)/);
  });
  it('tên báo cáo dùng FormField + Input invalid; khối/người nhận có id để đưa focus tới', () => {
    const s = dlg();
    expect(s).toContain('<FormField');
    expect(read('features/digests/DigestFormFields.tsx')).toContain('id="digest-blocks"');
    expect(read('features/digests/DigestFormFields.tsx')).toContain('id="digest-recipients"');
  });
});

describe('P-C2 · hoàn thiện nền báo lỗi', () => {
  it('m1: SearchSelect nhận aria-describedby và nối qua invalidAttrs (gợi ý của FormField tới được trigger)', () => {
    const html = renderToStaticMarkup(
      <SearchSelect
        id="s"
        aria-describedby="s-hint"
        value=""
        onChange={() => undefined}
        options={[]}
        invalid="Chọn một mục."
      />,
    );
    expect(html).toContain('aria-describedby="s-hint s-error"');
    const noErr = renderToStaticMarkup(
      <SearchSelect
        id="s"
        aria-describedby="s-hint"
        value=""
        onChange={() => undefined}
        options={[]}
      />,
    );
    expect(noErr).toContain('aria-describedby="s-hint"');
  });
  it('m1: FormField + SearchSelect truyền {...a11y} tới trigger', () => {
    const html = renderToStaticMarkup(
      <FormField id="p" label="Phạm vi" hint="Gợi ý" error="Chọn phạm vi.">
        {(a) => <SearchSelect {...a} value="" onChange={() => undefined} options={[]} />}
      </FormField>,
    );
    expect(html).toMatch(/<button[^>]*aria-describedby="p-hint p-error"/);
    expect(html.match(/Chọn phạm vi\./g)?.length).toBe(1);
  });
  it('m2: SegmentedControl không có id vẫn có id lỗi ổn định (useId), không dùng chữ "segmented"', () => {
    const html = renderToStaticMarkup(
      <SegmentedControl
        ariaLabel="Chế độ"
        value="a"
        onChange={() => undefined}
        options={[{ value: 'a', label: 'A' }]}
        invalid="Chọn chế độ."
      />,
    );
    const did = /aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(did).toBeTruthy();
    expect(did).not.toContain('segmented');
    expect(html).toContain(`id="${did}"`);
    expect(read('components/ui/SegmentedControl.tsx')).not.toContain("'segmented'");
  });
  it('m3: mỗi lần gửi lỗi có đúng một thông báo (khối ẩn role="alert" gắn key theo lần thử); đổi số lỗi khi sửa báo polite', () => {
    const html = renderToStaticMarkup(<ErrorSummary errors={errs} attempt={2} />);
    expect(html).toMatch(
      /<p[^>]*class="[^"]*sr-only[^"]*"[^>]*role="alert"[^>]*>3 trường cần sửa<\/p>|<p[^>]*role="alert"[^>]*class="[^"]*sr-only[^"]*"[^>]*>3 trường cần sửa<\/p>/,
    );
    expect(html).toMatch(/<p[^>]*aria-live="polite"[^>]*>3 trường cần sửa<\/p>/);
    // khung hiển thị KHÔNG còn là vùng alert (không đọc lại mỗi lần gõ)
    expect(html.match(/role="alert"/g)?.length).toBe(1);
    const s = read('components/ui/ErrorSummary.tsx');
    expect(s).toContain('key={attempt}');
    expect(s).not.toMatch(/announced|setAnnounced/);
  });
  it('m4: doc của invalid nói rõ chuỗi vẽ <p> anh em → trong khung relative/nhãn dùng FormField với boolean', () => {
    for (const f of ['components/ui/Input.tsx', 'components/ui/SearchSelect.tsx']) {
      const s = read(f);
      expect(s, f).toMatch(/relative/);
      expect(s, f).toMatch(/FormField/);
    }
  });
});

describe('useErrorFlow (dòng báo lỗi dùng chung)', () => {
  const s = () => read('lib/useErrorFlow.ts');
  it('chỉ hiện lỗi sau lần thử gửi đầu tiên, rồi lấy theo danh sách lỗi hiện tại (sửa tới đâu hết lỗi tới đó)', () => {
    expect(s()).toMatch(/attempted \? all : \[\]/);
  });
  it('đưa focus tới lỗi đầu tiên theo thứ tự DOM SAU commit (effect theo tick), dùng ref để không đăng ký lại', () => {
    expect(s()).toContain('focusFirstError(');
    expect(s()).toMatch(/useEffect\(/);
    expect(s()).toContain('errorsRef');
  });
  it('trả errorOf(id) cho lời lỗi từng ô và reset() cho lúc mở lại hộp', () => {
    expect(s()).toContain('errorOf');
    expect(s()).toContain('reset');
  });
});
