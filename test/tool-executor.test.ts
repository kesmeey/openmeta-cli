import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { z } from 'zod';
import { runWithRunContext } from '../src/infra/index.js';
import { agentEventLogService, agentHookService, ToolExecutorService } from '../src/services/index.js';
import type { AgentTool } from '../src/types/index.js';

let tempRoot = '';

function createTool(
  execute: (input: { value: number }) => Promise<{ doubled: number }> | { doubled: number },
  isConcurrencySafe = true,
): AgentTool<{ value: number }, { doubled: number }> {
  return {
    name: 'test.double',
    description: 'Double one numeric value.',
    isReadOnly: true,
    isConcurrencySafe,
    riskLevel: 'low',
    inputSchemaName: 'DoubleInput',
    outputSchemaName: 'DoubleOutput',
    requiredPermissions: [],
    inputSchema: z.object({ value: z.number() }),
    outputSchema: z.object({ doubled: z.number() }),
    checkPermission: () => ({
      outcome: 'allow',
      action: 'test.double',
      riskLevel: 'low',
      reason: 'Allowed by test policy.',
    }),
    execute,
  };
}

describe('ToolExecutorService', () => {
  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'openmeta-tool-executor-'));
    process.env['OPENMETA_CONFIG_DIR'] = join(tempRoot, '.config', 'openmeta');
    process.env['OPENMETA_HOME'] = join(tempRoot, '.openmeta');
  });

  afterEach(() => {
    agentHookService.clear();
    delete process.env['OPENMETA_CONFIG_DIR'];
    delete process.env['OPENMETA_HOME'];
    rmSync(tempRoot, { recursive: true, force: true });
  });

  test('validates input and output around tool execution', async () => {
    const executor = new ToolExecutorService();
    executor.register(createTool((input) => ({ doubled: input.value * 2 })));

    const invalid = await executor.execute('test.double', { value: '2' });
    const valid = await executor.execute<{ doubled: number }>('test.double', { value: 2 });

    expect(invalid.status).toBe('failed');
    expect(invalid.error).toContain('input failed schema validation');
    expect(valid.status).toBe('success');
    expect(valid.output).toEqual({ doubled: 4 });
  });

  test('allows hooks to update input or block execution', async () => {
    const executor = new ToolExecutorService();
    executor.register(createTool((input) => ({ doubled: input.value * 2 })));
    const unregisterUpdate = agentHookService.register('before_tool_execute', () => ({
      updatedInput: { value: 3 },
    }));

    const updated = await executor.execute<{ doubled: number }>('test.double', { value: 1 });
    unregisterUpdate();
    agentHookService.register('before_tool_execute', () => ({ continue: false, reason: 'Blocked by test hook.' }));
    const blocked = await executor.execute('test.double', { value: 1 });

    expect(updated.output).toEqual({ doubled: 6 });
    expect(blocked.status).toBe('blocked');
    expect(blocked.error).toBe('Blocked by test hook.');
  });

  test('does not let a hook weaken a tool permission denial', async () => {
    const executor = new ToolExecutorService();
    const tool = createTool((input) => ({ doubled: input.value * 2 }));
    tool.checkPermission = () => ({
      outcome: 'deny',
      action: tool.name,
      riskLevel: 'high',
      reason: 'Denied by tool policy.',
    });
    executor.register(tool);
    agentHookService.register('before_tool_execute', () => ({
      permissionDecision: {
        outcome: 'review',
        action: tool.name,
        riskLevel: 'medium',
        reason: 'Review requested by hook.',
      },
    }));

    const result = await executor.execute('test.double', { value: 2 }, { allowReview: true });

    expect(result.status).toBe('blocked');
    expect(result.permissionDecision?.outcome).toBe('deny');
    expect(result.error).toBe('Denied by tool policy.');
  });

  test('serializes tools that are not concurrency safe', async () => {
    const executor = new ToolExecutorService();
    let active = 0;
    let maxActive = 0;
    let signalFirstStarted: () => void = () => {};
    let releaseFirst: () => void = () => {};
    const firstStarted = new Promise<void>((resolve) => {
      signalFirstStarted = resolve;
    });
    const firstRelease = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    executor.register(
      createTool(async (input) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        if (input.value === 1) {
          signalFirstStarted();
          await firstRelease;
        }
        active -= 1;
        return { doubled: input.value * 2 };
      }, false),
    );

    const first = executor.execute('test.double', { value: 1 });
    await firstStarted;
    const second = executor.execute('test.double', { value: 2 });
    await Promise.resolve();

    expect(active).toBe(1);
    releaseFirst();
    await Promise.all([first, second]);

    expect(maxActive).toBe(1);
  });

  test('writes bounded execution events into the current run timeline', async () => {
    const executor = new ToolExecutorService();
    executor.register(createTool((input) => ({ doubled: input.value * 2 })));

    await runWithRunContext('run_tool', () => executor.execute('test.double', { value: 2 }));

    expect(agentEventLogService.load('run_tool').map((event) => event.type)).toEqual([
      'tool_execution_started',
      'tool_execution_completed',
    ]);
  });
});
