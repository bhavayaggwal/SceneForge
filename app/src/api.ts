export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? 'GET',
    headers: opts.body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new ApiError(res.status, j.error ?? `Request failed (${res.status})`);
  }
  return res.json();
}

/** Uploads a file as a raw stream with progress (fetch has no upload progress). */
export function upload<T>(path: string, file: File, onProgress: (f: number) => void): Promise<T> {
  return new Promise((ok, fail) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', path);
    xhr.setRequestHeader('x-filename', file.name);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      const j = (() => { try { return JSON.parse(xhr.responseText); } catch { return {}; } })();
      xhr.status < 300 ? ok(j) : fail(new ApiError(xhr.status, j.error ?? `Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => fail(new ApiError(0, 'Upload failed: the server did not respond'));
    xhr.send(file);
  });
}

/** POSTs and reads an NDJSON stream line by line. */
export async function stream(path: string, body: unknown, onLine: (o: any) => void, signal?: AbortSignal) {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
  if (!res.ok || !res.body) {
    const j = await res.json().catch(() => ({}));
    throw new ApiError(res.status, j.error ?? `Request failed (${res.status})`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) onLine(JSON.parse(line));
    }
  }
}
