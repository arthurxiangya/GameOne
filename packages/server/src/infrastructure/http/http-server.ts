import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import type { Logger } from '../../application/ports';

export interface HttpServerOptions {
  /** Directory with the built client, or null to serve only the API. */
  readonly clientDist: string | null;
  readonly logger: Logger;
  readonly health: () => Readonly<Record<string, unknown>>;
}

const MIME: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "connect-src 'self' ws: wss:",
    "img-src 'self' data: blob:",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join('; '),
};

/** Serves the built client as static files, plus a JSON health endpoint for probes. */
export function createHttpServer(options: HttpServerOptions): Server {
  const root = options.clientDist ? resolve(options.clientDist) : null;

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (url.pathname === '/healthz') {
      sendJson(res, 200, options.health());
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendText(res, 405, 'Method not allowed');
      return;
    }
    if (!root) {
      sendText(res, 404, 'No client build configured. Run `npm run build`, or use `npm run dev` for the Vite dev server.');
      return;
    }
    const file = await resolveStaticFile(root, url.pathname);
    if (!file) {
      sendText(res, 404, 'Not found');
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', MIME[extname(file.path)] ?? 'application/octet-stream');
    res.setHeader('Content-Length', file.size);
    res.setHeader('Cache-Control', url.pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(file.path)
      .on('error', (err) => {
        options.logger.warn('static file stream failed', { path: url.pathname, error: err.message });
        res.destroy(err);
      })
      .pipe(res);
  };

  return createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      options.logger.error('http handler failed', { url: req.url, error: err instanceof Error ? err.message : String(err) });
      if (!res.headersSent) sendText(res, 500, 'Internal server error');
      else res.destroy();
    });
  });
}

async function resolveStaticFile(root: string, pathname: string): Promise<{ path: string; size: number } | null> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const candidate = resolve(root, `.${decoded}`);
  // Never serve anything outside the client directory (path traversal guard).
  if (candidate !== root && !candidate.startsWith(root + sep)) return null;

  const direct = await statFile(candidate);
  if (direct) return direct;
  const index = await statFile(join(candidate, 'index.html'));
  if (index) return index;
  // Single-page app: unknown routes without a file extension get the app shell.
  return extname(decoded) === '' ? statFile(join(root, 'index.html')) : null;
}

async function statFile(path: string): Promise<{ path: string; size: number } | null> {
  try {
    const s = await stat(path);
    return s.isFile() ? { path, size: s.size } : null;
  } catch {
    return null;
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(text);
}

function sendText(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}
