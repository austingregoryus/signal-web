import type { FastifyInstance } from 'fastify'

interface QrCapableClient {
  getLinkingQr(deviceName: string): Promise<{ contentType: string; bytes: Buffer }>
}

export interface LinkRouteDeps {
  client: QrCapableClient
  deviceName: string
  /** Live connection state of the signal-cli receiver, so the page can show "connected". */
  status: () => boolean
  /** When false, the linking page is disabled (return 404). Disable in production once linked. */
  enabled: boolean
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>Link this device — Signal Web</title>
<style>
  :root { color-scheme: light dark; }
  body {
    font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    background: #f6f7f9; color: #14171a;
  }
  @media (prefers-color-scheme: dark) {
    body { background: #0f1115; color: #e7e9ea; }
    .card { background: #181b21 !important; box-shadow: none !important; border: 1px solid #2a2f3a; }
    ol { color: #b9bfc7; }
  }
  .card {
    background: #fff; border-radius: 16px; padding: 28px 32px; max-width: 420px;
    box-shadow: 0 8px 30px rgba(0,0,0,.08); text-align: center;
  }
  h1 { font-size: 1.25rem; margin: 0 0 4px; }
  p.sub { margin: 0 0 20px; opacity: .7; font-size: .9rem; }
  .qr { width: 260px; height: 260px; border-radius: 12px; background: #fff;
        display: grid; place-items: center; margin: 0 auto 18px; padding: 10px; box-sizing: border-box; }
  .qr img { width: 100%; height: 100%; object-fit: contain; image-rendering: pixelated; }
  ol { text-align: left; font-size: .9rem; line-height: 1.5; padding-left: 20px; color: #444; }
  .status { margin-top: 18px; font-weight: 600; font-size: .95rem; }
  .status.on { color: #16a34a; }
  .status.off { color: #d97706; }
  button {
    margin-top: 14px; border: 0; border-radius: 10px; padding: 9px 16px; cursor: pointer;
    background: #2563eb; color: #fff; font-size: .9rem; font-weight: 600;
  }
  button:hover { background: #1d4ed8; }
</style>
</head>
<body>
  <div class="card">
    <h1>Link this device</h1>
    <p class="sub">Connect the server to your Signal account</p>
    <div class="qr"><img id="qr" alt="Signal linking QR code" src="/link/qr" /></div>
    <ol>
      <li>Open <strong>Signal</strong> on your phone.</li>
      <li>Go to <strong>Settings → Linked Devices</strong>.</li>
      <li>Tap <strong>Link New Device</strong> and scan this code.</li>
    </ol>
    <div id="status" class="status off">Waiting for the server to connect…</div>
    <button id="refresh" type="button">Regenerate QR</button>
  </div>
<script>
  var qr = document.getElementById('qr');
  var statusEl = document.getElementById('status');
  document.getElementById('refresh').addEventListener('click', function () {
    qr.src = '/link/qr?ts=' + Date.now();
  });
  function poll() {
    fetch('/link/status').then(function (r) { return r.json(); }).then(function (s) {
      if (s.connected) {
        statusEl.textContent = '\\u2705 Connected \\u2014 linking worked. You can close this page.';
        statusEl.className = 'status on';
      } else {
        statusEl.textContent = 'Waiting for the server to connect\\u2026';
        statusEl.className = 'status off';
      }
    }).catch(function () {}).finally(function () { setTimeout(poll, 2000); });
  }
  poll();
</script>
</body>
</html>`

export function registerLinkRoute(app: FastifyInstance, deps: LinkRouteDeps): void {
  if (!deps.enabled) return

  app.get('/link', async (_req, reply) => {
    return reply.header('content-type', 'text/html; charset=utf-8').send(PAGE)
  })

  app.get('/link/qr', async (_req, reply) => {
    try {
      const qr = await deps.client.getLinkingQr(deps.deviceName)
      return reply
        .header('content-type', qr.contentType)
        .header('cache-control', 'no-store')
        .send(qr.bytes)
    } catch {
      // signal-cli not reachable yet, or already linked — surface a clear status.
      return reply.code(503).send({ error: 'qr_unavailable' })
    }
  })

  app.get('/link/status', async () => ({ connected: deps.status() }))
}
