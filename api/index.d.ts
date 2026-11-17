import type { Express } from 'express';
import type { IncomingMessage, ServerResponse } from 'node:http';

export function createApiApp(): Express;
export default function handler(req: IncomingMessage, res: ServerResponse): void;
