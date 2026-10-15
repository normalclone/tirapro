/** Client mỏng gọi REST API của Tirapro bằng API key. Tự bóc envelope {success,data}. */
export class Tira {
  constructor(
    private readonly base: string,
    private readonly key: string,
  ) {}

  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.key}`,
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
    const raw = await res.text();
    let json: unknown = null;
    try {
      json = raw ? JSON.parse(raw) : null;
    } catch {
      json = raw;
    }
    if (!res.ok) {
      const errBody =
        typeof json === 'object' && json !== null
          ? (json as { error?: { message?: string }; message?: string })
          : null;
      const msg = errBody?.error?.message ?? errBody?.message ?? `HTTP ${res.status}`;
      const err = new Error(msg) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    if (json && typeof json === 'object' && 'success' in json && 'data' in json)
      return (json as { data: T }).data;
    return json as T;
  }

  get<T>(path: string) {
    return this.req<T>(path);
  }
  post<T>(path: string, body: unknown) {
    return this.req<T>(path, { method: 'POST', body: JSON.stringify(body) });
  }
  patch<T>(path: string, body: unknown) {
    return this.req<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
  }
}
