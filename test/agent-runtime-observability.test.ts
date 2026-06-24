import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { getCurrentRunId, isMachineContext, runInMachineContext, runWithRunContext } from '../src/infra/index.js';
import { agentEventLogService, agentHookService, permissionPolicyService } from '../src/services/index.js';

let tempRoot = '';

describe('agent runtime observability', () => {
  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'openmeta-runtime-observability-'));
    process.env['OPENMETA_CONFIG_DIR'] = join(tempRoot, '.config', 'openmeta');
    process.env['OPENMETA_HOME'] = join(tempRoot, '.openmeta');
  });

  afterEach(() => {
    agentHookService.clear();
    delete process.env['OPENMETA_CONFIG_DIR'];
    delete process.env['OPENMETA_HOME'];
    rmSync(tempRoot, { recursive: true, force: true });
  });

  test('isolates machine and run context through nested async execution', async () => {
    expect(isMachineContext()).toBe(false);
    expect(getCurrentRunId()).toBeUndefined();

    await runWithRunContext('run_test', async () => {
      expect(getCurrentRunId()).toBe('run_test');
      expect(isMachineContext()).toBe(false);

      await runInMachineContext(async () => {
        expect(getCurrentRunId()).toBe('run_test');
        expect(isMachineContext()).toBe(true);
      });

      expect(isMachineContext()).toBe(false);
    });
  });

  test('emits hooks and appends permission decisions to the current run timeline', async () => {
    const observed: string[] = [];
    agentHookService.register('permission_decision', (payload) => {
      const decision = payload.data['decision'];
      if (typeof decision === 'object' && decision !== null && 'action' in decision) {
        observed.push(String(decision.action));
      }
    });

    await runWithRunContext('run_permission', async () => {
      permissionPolicyService.evaluateArtifactPublish({ headless: false });
    });

    expect(observed).toEqual(['artifact.publish']);
    expect(agentEventLogService.load('run_permission')[0]?.type).toBe('permission_decision');
  });
});
