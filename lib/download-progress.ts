/**
 * Downloads a URL to bytes, rendering a simple progress bar to stderr while it
 * streams. Falls back to a silent buffered read when stderr isn't a TTY (piped
 * output) or the server sends no Content-Length. stderr is used so piped stdout
 * stays clean.
 */
export async function downloadToBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download binary (HTTP ${res.status})`);
  }

  const total = Number(res.headers.get("content-length")) || 0;
  const reader = res.body?.getReader();
  if (!reader) {
    return new Uint8Array(await res.arrayBuffer());
  }

  const showBar = Boolean(process.stderr.isTTY) && total > 0;
  const chunks: Uint8Array[] = [];
  let received = 0;
  let lastPct = -1;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (showBar) {
      const pct = Math.floor((received / total) * 100);
      if (pct !== lastPct) {
        lastPct = pct;
        renderBar(received, total, pct);
      }
    }
  }
  if (showBar) process.stderr.write("\n");

  const out = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function renderBar(received: number, total: number, pct: number): void {
  const width = 24;
  const filled = Math.round((pct / 100) * width);
  const bar = "#".repeat(filled) + "-".repeat(width - filled);
  const mb = (n: number) => (n / 1024 / 1024).toFixed(1);
  process.stderr.write(`\r[${bar}] ${pct}% (${mb(received)}/${mb(total)} MB)`);
}
