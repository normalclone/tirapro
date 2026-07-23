/** Client mỏng gọi REST API của Tirapro bằng API key. Tự bóc envelope {success,data}. */
export class Tira {
  constructor(
    private readonly base: string,
    private readonly key: string,
  ) {}

  private async req(path: string, init?: RequestInit): Promise<any> {
    const res = await fetch(`${this.base}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.key}`,
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
    const raw = await res.text();
    let json: any = null;
    try {
      json = raw ? JSON.parse(raw) : null;
    } catch {
      json = raw;
    }
    if (!res.ok) {
      const msg = json?.error?.message ?? json?.message ?? `HTTP ${res.status}`;
      const err = new Error(msg) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    if (json && typeof json === 'object' && 'success' in json && 'data' in json) return json.data;
    return json;
  }

  get(path: string) {
    return this.req(path);
  }
  post(path: string, body: unknown) {
    return this.req(path, { method: 'POST', body: JSON.stringify(body) });
  }
  patch(path: string, body: unknown) {
    return this.req(path, { method: 'PATCH', body: JSON.stringify(body) });
  }
}
