import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { runInMachineContext } from '../src/infra/execution-context.js';
import { runTask } from '../src/infra/ui/live.js';
import type { UiCapabilities } from '../src/infra/ui/types.js';

const capabilities: UiCapabilities = {
  width: 100,
  isInteractive: false,
  supportsColor: false,
  supportsUnicode: true,
  mode: 'plain',
};

describe('ui task progress', () => {
  afterEach(() => {
    mock.restore();
  });

  test('machine task prefixes step progress and emits heartbeat updates after quiet periods', async () => {
    const stderrWrites: string[] = [];

    spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stderrWrites.push(String(chunk));
      return true;
    });

    await runInMachineContext(() => runTask(
      capabilities,
      {
        title: 'Waiting for repository analysis',
        doneMessage: 'Repository analysis finished',
        step: { index: 2, total: 4 },
        heartbeat: {
          intervalMs: 5,
          message: ({ elapsedMs }) => `Still working after ${elapsedMs}ms`,
        },
      },
      async (task) => {
        task.setMessage('Captured repository context');
        await new Promise((resolve) => setTimeout(resolve, 20));
        return true;
      },
    ));

    const combined = stderrWrites.join('');
    expect(combined).toContain('Step 2/4 Waiting for repository analysis');
    expect(combined).toContain('Step 2/4 Captured repository context');
    expect(combined).toContain('Step 2/4 Still working after');
    expect(combined).toContain('[success] Step 2/4 Repository analysis finished');
  });
});
