import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  createDashboardDataStore,
  createDashboardServer,
  listenOnAvailablePort,
} from '../src/orchestration/dashboard.js';

const tempRoots: string[] = [];
const servers: Array<{ close: (callback?: (error?: Error) => void) => void }> = [];

function createFixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'openmeta-dashboard-'));
  tempRoots.push(root);
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>dashboard</title><main>Dashboard Home</main>');
  return root;
}

async function stopServer(server: { close: (callback?: (error?: Error) => void) => void }): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error?: Error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

describe('dashboard server', () => {
  afterEach(async () => {
    delete process.env['OPENMETA_CONFIG_DIR'];

    while (servers.length > 0) {
      const server = servers.pop();
      if (server) {
        await stopServer(server);
      }
    }

    while (tempRoots.length > 0) {
      const root = tempRoots.pop();
      if (root) {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  test('serves dashboard api and static template assets', async () => {
    const rootDir = createFixtureRoot();
    const server = createDashboardServer({
      rootDir,
      getDashboardData: () => ({
        meta: { mode: 'real' },
        projects: [{ repoFullName: 'acme/demo' }],
      }),
    });
    servers.push(server);

    const port = await listenOnAvailablePort(server, '127.0.0.1', 0);

    const apiResponse = await fetch(`http://127.0.0.1:${port}/api/dashboard`);
    expect(apiResponse.status).toBe(200);
    expect(await apiResponse.json()).toEqual({
      meta: { mode: 'real' },
      projects: [{ repoFullName: 'acme/demo' }],
    });

    const pageResponse = await fetch(`http://127.0.0.1:${port}/`);
    expect(pageResponse.status).toBe(200);
    expect(await pageResponse.text()).toContain('Dashboard Home');
  });

  test('refresh endpoint materializes and returns a fresh dashboard snapshot', async () => {
    const rootDir = createFixtureRoot();
    let counter = 0;
    const snapshotDir = join(rootDir, '.config', 'openmeta');
    process.env['OPENMETA_CONFIG_DIR'] = snapshotDir;
    const dataStore = createDashboardDataStore({
      buildDashboardData: () => {
        counter += 1;
        return { meta: { mode: 'real', counter }, sync: { status: 'ok' } };
      },
    });
    const server = createDashboardServer({
      rootDir,
      getDashboardData: dataStore.getDashboardData,
      refreshDashboardData: dataStore.refreshDashboardData,
    });
    servers.push(server);

    const port = await listenOnAvailablePort(server, '127.0.0.1', 0);
    const response = await fetch(`http://127.0.0.1:${port}/api/dashboard/refresh`, {
      method: 'POST',
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { meta: { counter: number; snapshotPath?: string } };
    expect(payload.meta.counter).toBe(1);
    expect(payload.meta.snapshotPath).toContain('dashboard-data.json');
    expect(payload.meta.snapshotPath && existsSync(payload.meta.snapshotPath)).toBe(true);
    expect(readFileSync(payload.meta.snapshotPath!, 'utf-8')).toContain('"counter": 1');
  });

  test('data store reuses an existing snapshot before forcing a refresh', async () => {
    const rootDir = createFixtureRoot();
    let counter = 99;
    const snapshotDir = join(rootDir, '.config', 'openmeta');
    const snapshotPath = join(snapshotDir, 'dashboard-data.json');
    process.env['OPENMETA_CONFIG_DIR'] = snapshotDir;
    mkdirSync(snapshotDir, { recursive: true });
    writeFileSync(
      snapshotPath,
      JSON.stringify(
        {
          meta: { mode: 'real', counter: 7 },
          sync: { status: 'from-disk' },
        },
        null,
        2,
      ),
      'utf-8',
    );

    const dataStore = createDashboardDataStore({
      buildDashboardData: () => {
        counter += 1;
        return { meta: { mode: 'real', counter }, sync: { status: 'adapter' } };
      },
    });
    const initialPayload = (await dataStore.getDashboardData()) as {
      meta: { counter: number };
      sync: { status: string };
    };
    const refreshedPayload = (await dataStore.refreshDashboardData()) as {
      meta: { counter: number };
      sync: { status: string };
    };

    expect(initialPayload.meta.counter).toBe(7);
    expect(initialPayload.sync.status).toBe('from-disk');
    expect(refreshedPayload.meta.counter).toBe(100);
    expect(refreshedPayload.sync.status).toBe('adapter');
  });

  test('data store coalesces concurrent refresh requests into one materialization', async () => {
    const rootDir = createFixtureRoot();
    let counter = 0;
    process.env['OPENMETA_CONFIG_DIR'] = join(rootDir, '.config', 'openmeta');
    const dataStore = createDashboardDataStore({
      buildDashboardData: () => {
        counter += 1;
        return { meta: { mode: 'real', counter }, sync: { status: 'ok' } };
      },
    });

    const concurrentPayloads = (await Promise.all([
      dataStore.refreshDashboardData(),
      dataStore.refreshDashboardData(),
    ])) as Array<{ meta: { counter: number } }>;
    const first = concurrentPayloads[0];
    const second = concurrentPayloads[1];

    expect(first?.meta.counter).toBe(1);
    expect(second?.meta.counter).toBe(1);
  });

  test('blocks path traversal outside the fixed dashboard root', async () => {
    const rootDir = createFixtureRoot();
    const secretPath = join(tempRoots[0]!, 'secret.txt');
    writeFileSync(secretPath, 'secret');

    const server = createDashboardServer({
      rootDir,
      getDashboardData: () => ({}),
    });
    servers.push(server);

    const port = await listenOnAvailablePort(server, '127.0.0.1', 0);
    const response = await fetch(`http://127.0.0.1:${port}/..%2Fsecret.txt`);

    expect(response.status).toBe(403);
    expect(await response.text()).toBe('Forbidden');
  });

  test('falls forward to the next available port when the preferred port is busy', async () => {
    const occupied = Bun.listen({
      hostname: '127.0.0.1',
      port: 0,
      socket: {
        data() {},
      },
    });

    const rootDir = createFixtureRoot();
    const server = createDashboardServer({
      rootDir,
      getDashboardData: () => ({}),
    });
    servers.push(server);

    try {
      const port = await listenOnAvailablePort(server, '127.0.0.1', occupied.port);
      expect(port).toBeGreaterThan(occupied.port);
    } finally {
      occupied.stop(true);
    }
  });
});
