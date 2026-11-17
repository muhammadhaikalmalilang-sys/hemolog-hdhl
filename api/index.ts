import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Express } from 'express';
import { createApiApp } from '../server/apiApp.js';

let cachedApp: Express | null = null;

function getApp(): Express {
  if (!cachedApp) {
    cachedApp = createApiApp();
  }
  return cachedApp;
}

export default function handler(req: IncomingMessage, res: ServerResponse) {
  const rawUrl = req.url || '/';
  try {
    const parsed = new URL(rawUrl, 'http://localhost');
    const apiPath = parsed.searchParams.get('__api_path');
    if (apiPath !== null) {
      parsed.searchParams.delete('__api_path');
      const qs = parsed.searchParams.toString();
      const normalizedPath = apiPath.replace(/^\/+/, '');
      if (parsed.pathname === '/api/index' || parsed.pathname === '/api') {
        req.url = `/api/${normalizedPath}${qs ? `?${qs}` : ''}`;
      } else {
        req.url = `${parsed.pathname}${qs ? `?${qs}` : ''}`;
      }
    }
  } catch {
    // Keep original req.url if URL parsing fails
  }

  try {
    const app = getApp();
    return app(req as Parameters<typeof app>[0], res as Parameters<typeof app>[1]);
  } catch (err: unknown) {
    console.error('Unhandled API handler error:', err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          error: 'SERVER_HANDLER_ERROR',
          message: err instanceof Error ? err.message : 'Terjadi kesalahan internal server API.',
        })
      );
    }
  }
}
