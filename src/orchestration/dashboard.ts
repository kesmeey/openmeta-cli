import { spawn } from 'child_process';
import { existsSync, readFile, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs';
import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from 'http';
import { dirname, extname, isAbsolute, join, normalize, relative, resolve } from 'path';
import { fileURLToPath } from 'url';
import { buildDashboardData } from '../dashboard/data-adapter.ts';
import { ensureDirectory, getOpenMetaStateDir, UserCancelledError, ui } from '../infra/index.js';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 4326;
const MAX_PORT_SCAN = 20;

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

export interface DashboardServeOptions {
  host?: string;
  port?: number;
  open?: boolean;
}

interface DashboardServerOptions {
  rootDir: string;
  getDashboardData: () => Promise<unknown> | unknown;
  refreshDashboardData?: () => Promise<unknown> | unknown;
}

export function createDashboardServer(options: DashboardServerOptions): HttpServer {
  const rootDir = normalize(resolve(options.rootDir));

  const writeJson = (res: ServerResponse, statusCode: number, payload: unknown) => {
    res.writeHead(statusCode, {
      'Content-Type': MIME_TYPES['.json'],
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(payload));
  };

  const handleDashboardPayload = (
    res: ServerResponse,
    loader: () => Promise<unknown> | unknown,
    errorCode: 'dashboard_data_failed' | 'dashboard_refresh_failed',
  ) => {
    Promise.resolve()
      .then(() => loader())
      .then((payload) => {
        writeJson(res, 200, payload);
      })
      .catch((error) => {
        writeJson(res, 500, {
          error: errorCode,
          message: error instanceof Error ? error.message : String(error),
        });
      });
  };

  return createServer((req: IncomingMessage, res: ServerResponse) => {
    const rawPath = req.url === '/' ? '/index.html' : (req.url || '/').split('?')[0] || '/';
    let requestPath = rawPath;

    try {
      requestPath = decodeURIComponent(rawPath);
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Bad request');
      return;
    }

    if (requestPath === '/api/dashboard') {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Method not allowed');
        return;
      }

      handleDashboardPayload(res, options.getDashboardData, 'dashboard_data_failed');
      return;
    }

    if (requestPath === '/api/dashboard/refresh') {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Method not allowed');
        return;
      }

      handleDashboardPayload(res, options.refreshDashboardData || options.getDashboardData, 'dashboard_refresh_failed');
      return;
    }

    const resolvedPath = normalize(
      resolve(rootDir, `.${requestPath.startsWith('/') ? requestPath : `/${requestPath}`}`),
    );
    const relativePath = relative(rootDir, resolvedPath);
    if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }

    readFile(resolvedPath, (error, contents) => {
      if (error) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }

      res.writeHead(200, {
        'Content-Type': MIME_TYPES[extname(resolvedPath)] || 'text/plain; charset=utf-8',
      });
      res.end(contents);
    });
  });
}

export async function listenOnAvailablePort(
  server: HttpServer,
  host: string,
  preferredPort: number,
  maxAttempts: number = MAX_PORT_SCAN,
): Promise<number> {
  if (preferredPort === 0) {
    return new Promise<number>((resolvePromise, reject) => {
      const handleError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const handleListening = () => {
        cleanup();
        const address = server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('Dashboard server did not expose a numeric port.'));
          return;
        }
        resolvePromise(address.port);
      };
      const cleanup = () => {
        server.off('error', handleError);
        server.off('listening', handleListening);
      };

      server.once('error', handleError);
      server.once('listening', handleListening);
      server.listen(0, host);
    });
  }

  for (let offset = 0; offset < maxAttempts; offset += 1) {
    const candidatePort = preferredPort + offset;
    const result = await new Promise<{ port?: number; inUse?: boolean }>((resolvePromise, reject) => {
      const handleError = (error: NodeJS.ErrnoException) => {
        cleanup();
        if (error.code === 'EADDRINUSE') {
          resolvePromise({ inUse: true });
          return;
        }
        reject(error);
      };
      const handleListening = () => {
        cleanup();
        resolvePromise({ port: candidatePort });
      };
      const cleanup = () => {
        server.off('error', handleError);
        server.off('listening', handleListening);
      };

      server.once('error', handleError);
      server.once('listening', handleListening);
      server.listen(candidatePort, host);
    });

    if (result.port) {
      return result.port;
    }
  }

  throw new Error(`OpenMeta could not find a free dashboard port starting from ${preferredPort}.`);
}

function resolveDashboardPrototypeRoot(): string {
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = dirname(currentFile);
  const candidates = [
    resolve(currentDir, '..', '..', 'dashboard'),
    resolve(currentDir, '..', 'dashboard'),
    resolve(process.cwd(), 'dashboard'),
    resolve(currentDir, '..', '..', 'dashboard-prototype'),
    resolve(currentDir, '..', 'dashboard-prototype'),
    resolve(process.cwd(), 'dashboard-prototype'),
  ];

  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'index.html'))) {
      return candidate;
    }
  }

  throw new Error('OpenMeta dashboard assets are missing. Expected dashboard with fixed template files.');
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function writeJsonFileAtomically(filePath: string, payload: unknown): void {
  ensureDirectory(dirname(filePath));
  const tmpPath = `${filePath}.tmp.${process.pid}`;

  try {
    writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf-8');
    renameSync(tmpPath, filePath);
  } catch (error) {
    try {
      unlinkSync(tmpPath);
    } catch {
      /* ignore cleanup failure */
    }
    throw error;
  }
}

function withDashboardSnapshotMeta(payload: unknown, snapshotPath: string): unknown {
  if (!isObjectRecord(payload)) {
    return payload;
  }

  const payloadMeta = payload['meta'];
  const payloadSync = payload['sync'];
  const meta = isObjectRecord(payloadMeta) ? payloadMeta : {};
  const sync = isObjectRecord(payloadSync) ? payloadSync : {};

  return {
    ...payload,
    meta: {
      ...meta,
      snapshotPath,
    },
    sync: {
      ...sync,
      snapshotPath,
    },
  };
}

interface DashboardDataStore {
  snapshotPath: string;
  getDashboardData: () => Promise<unknown>;
  refreshDashboardData: () => Promise<unknown>;
}

interface DashboardDataStoreOptions {
  buildDashboardData?: () => unknown;
}

export function createDashboardDataStore(options: DashboardDataStoreOptions = {}): DashboardDataStore {
  const buildDashboardPayload = options.buildDashboardData || buildDashboardData;
  const snapshotPath = join(ensureDirectory(getOpenMetaStateDir()), 'dashboard-data.json');
  let cachedPayload: unknown | undefined;
  let pendingRefresh: Promise<unknown> | null = null;

  const loadSnapshotFromDisk = (): unknown | undefined => {
    if (!existsSync(snapshotPath)) {
      return undefined;
    }

    try {
      const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf-8')) as unknown;
      const payload = withDashboardSnapshotMeta(snapshot, snapshotPath);
      cachedPayload = payload;
      return payload;
    } catch {
      return undefined;
    }
  };

  const materialize = (_forceReloadAdapter: boolean): unknown => {
    const rawPayload = buildDashboardPayload();
    const payload = withDashboardSnapshotMeta(rawPayload, snapshotPath);
    writeJsonFileAtomically(snapshotPath, payload);
    cachedPayload = payload;
    return payload;
  };

  const refreshDashboardData = (): Promise<unknown> => {
    if (!pendingRefresh) {
      pendingRefresh = Promise.resolve()
        .then(() => materialize(true))
        .finally(() => {
          pendingRefresh = null;
        });
    }

    return pendingRefresh;
  };

  const getDashboardData = (): Promise<unknown> => {
    if (cachedPayload !== undefined) {
      return Promise.resolve(cachedPayload);
    }

    const snapshot = loadSnapshotFromDisk();
    if (snapshot !== undefined) {
      return Promise.resolve(snapshot);
    }

    return refreshDashboardData();
  };

  return {
    snapshotPath,
    getDashboardData,
    refreshDashboardData,
  };
}

function openBrowser(url: string): void {
  const warnOpenFailed = () => {
    ui.callout({
      title: 'OpenMeta could not open your browser automatically. Use the dashboard URL shown above.',
      tone: 'warning',
    });
  };
  const launch = (command: string, args: string[], windowsHide: boolean = false) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide,
    });
    child.once('error', warnOpenFailed);
    child.unref();
  };

  if (process.platform === 'win32') {
    launch('cmd', ['/c', 'start', '', url], true);
    return;
  }

  if (process.platform === 'darwin') {
    launch('open', [url]);
    return;
  }

  launch('xdg-open', [url]);
}

export class DashboardOrchestrator {
  async serve(options: DashboardServeOptions = {}): Promise<void> {
    const rootDir = resolveDashboardPrototypeRoot();
    const host = options.host || DEFAULT_HOST;
    const preferredPort = Math.max(0, options.port ?? DEFAULT_PORT);
    const dashboardDataStore = createDashboardDataStore();
    const server = createDashboardServer({
      rootDir,
      getDashboardData: dashboardDataStore.getDashboardData,
      refreshDashboardData: dashboardDataStore.refreshDashboardData,
    });
    const actualPort = await listenOnAvailablePort(server, host, preferredPort);
    const baseUrl = `http://${host}:${actualPort}/`;
    const dashboardApi = `${baseUrl}api/dashboard`;
    const dashboardRefreshApi = `${baseUrl}api/dashboard/refresh`;

    ui.hero({
      label: 'OpenMeta Dashboard',
      title: 'Contribution dashboard is live',
      subtitle: 'The fixed dashboard template is now serving live local OpenMeta contribution state.',
      lines: [
        `Dashboard: ${baseUrl}`,
        `API: ${dashboardApi}`,
        `Refresh API: ${dashboardRefreshApi}`,
        'Press Ctrl+C to stop the local dashboard server.',
      ],
      tone: 'accent',
    });

    ui.keyValues('Server', [
      { label: 'Host', value: host, tone: 'info' },
      { label: 'Port', value: String(actualPort), tone: 'info' },
      { label: 'Assets', value: rootDir, tone: 'muted' },
      { label: 'Snapshot', value: dashboardDataStore.snapshotPath, tone: 'muted' },
    ]);

    if (preferredPort > 0 && actualPort !== preferredPort) {
      ui.callout({
        title: `Port ${preferredPort} was busy, so OpenMeta moved the dashboard to ${actualPort}.`,
        tone: 'warning',
      });
    }

    if (options.open) {
      openBrowser(baseUrl);
    }

    await new Promise<void>((resolvePromise, reject) => {
      let settled = false;
      let stopRequested = false;

      const cleanup = () => {
        process.off('SIGINT', handleSigint);
        process.off('SIGTERM', handleSigterm);
        server.off('close', handleClose);
        server.off('error', handleError);
      };
      const handleError = (error: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(error);
      };
      const handleClose = () => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        if (stopRequested) {
          reject(new UserCancelledError('Dashboard server stopped.'));
          return;
        }
        resolvePromise();
      };
      const shutdown = () => {
        stopRequested = true;
        if (!server.listening) {
          handleClose();
          return;
        }
        server.close((error?: Error) => {
          if (error) {
            handleError(error);
          }
        });
      };
      const handleSigint = () => shutdown();
      const handleSigterm = () => shutdown();

      process.once('SIGINT', handleSigint);
      process.once('SIGTERM', handleSigterm);
      server.once('close', handleClose);
      server.once('error', handleError);
    });
  }
}

export const dashboardOrchestrator = new DashboardOrchestrator();
