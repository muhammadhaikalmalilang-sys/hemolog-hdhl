import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Request, type Response } from 'express';
import { createApiApp } from './api/index.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveServerPort(): number {
  const portArgIdx = process.argv.indexOf('--port');
  if (portArgIdx !== -1 && process.argv[portArgIdx + 1]) {
    const cliPort = Number(process.argv[portArgIdx + 1]);
    if (Number.isFinite(cliPort) && cliPort > 0) return cliPort;
  }
  const envPort = Number(process.env.PORT || 3000);
  return Number.isFinite(envPort) && envPort > 0 ? envPort : 3000;
}

async function createAppServer() {
  const app = createApiApp();

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false, ws: false, watch: null },
      appType: 'spa',
    });
    app.get('/@vite/client', async (_req: Request, res: Response, next) => {
      try {
        const result = await vite.transformRequest('/@vite/client');
        if (!result) {
          next();
          return;
        }
        const patched = result.code
          .replace(
            'transport.connect(createHMRHandler(handleMessage));',
            '/* HMR disabled: skip unreachable WebSocket connect */'
          )
          .replace(
            'else throw new SendBeforeConnectError("send was called before connect");',
            'else return;'
          )
          .replace(
            'else throw new SendBeforeConnectError("invoke was called before connect");',
            'else return;'
          );
        res.type('application/javascript').send(patched);
      } catch (err) {
        next(err);
      }
    });
    app.get('/@vite-plugin-pwa/pwa-entry-point-loaded', (_req: Request, res: Response) => {
      res.type('application/javascript').send(`
export default function registerDevSW() {
  if (typeof document !== 'undefined') {
    if (!document.querySelector('link[rel="manifest"]')) {
      const link = document.createElement('link');
      link.rel = 'manifest';
      link.href = '/manifest.webmanifest';
      document.head.appendChild(link);
    }
  }
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    navigator.serviceWorker
      .register('/dev-sw.js?dev-sw', { scope: '/', type: 'module' })
      .catch(() => {});
  }
}
`);
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = resolveServerPort();
  const httpServer = app.listen(port, '0.0.0.0', () => {
    console.log(`HemoLog server running on http://0.0.0.0:${port}`);
  });
  // Keep sockets open longer than upstream reverse-proxy/pre-warmer idle timeouts
  // to avoid Node's 5s default keepAliveTimeout causing ECONNRESET / connection reset by peer.
  httpServer.keepAliveTimeout = 65_000;
  httpServer.headersTimeout = 66_000;

  const shutdown = () => {
    httpServer.close(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

createAppServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
