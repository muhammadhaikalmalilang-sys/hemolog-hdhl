import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApiApp } from '../server/apiApp.js';

const app = createApiApp();

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

  return app(req as Parameters<typeof app>[0], res as Parameters<typeof app>[1]);
}
