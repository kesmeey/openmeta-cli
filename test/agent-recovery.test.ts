import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runWithRunContext } from '../src/infra/index.js';
import { agentCheckpointService, agentEventLogService, agentRolePipelineService } from '../src/services/index.js';
import type { AgentRunRecord } from '../src/types/index.js';

let tempRoot = '';

describe('agent recovery and role pipeline', () => {
  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'openmeta-agent-recovery-'));
    process.env['OPENMETA_CONFIG_DIR'] = join(tempRoot, '.config', 'openmeta');
    process.env['OPENMETA_HOME'] = join(tempRoot, '.openmeta');
  });

  afterEach(() => {
    delete process.env['OPENMETA_CONFIG_DIR'];
    delete process.env['OPENMETA_HOME'];
    rmSync(tempRoot, { recursive: true, force: true });
  });

  test('builds a resume plan from the latest persisted checkpoint', async () => {
    await runWithRunContext('run_recovery', async () => {
      agentCheckpointService.record('target_selected', { issue: 'acme/demo#42' });
      agentCheckpointService.record('workspace_prepared', { workspacePath: '/tmp/demo' });
    });
    const record: AgentRunRecord = {
      id: 'run_recovery',
      commandName: 'OpenMeta Agent',
      args: ['agent', '--repo', 'acme/demo'],
      status: 'failed',
      startedAt: '2026-06-24T00:00:00.000Z',
      error: 'provider unavailable',
    };

    const plan = agentCheckpointService.buildResumePlan('run_recovery', record);

    expect(plan.resumable).toBe(true);
    expect(plan.completedStages).toEqual(['target_selected', 'workspace_prepared']);
    expect(plan.nextStage).toBe('patch_drafted');
    expect(plan.nextActions).toContain('Inspect events: openmeta machine runs run_recovery');
  });

  test('keeps remote artifact publication resumable after local artifacts are written', async () => {
    await runWithRunContext('run_publish', async () => {
      agentCheckpointService.record('artifacts_written', { artifactDir: '/tmp/artifacts' });
    });

    const plan = agentCheckpointService.buildResumePlan('run_publish');

    expect(plan.resumable).toBe(true);
    expect(plan.nextStage).toBe('artifacts_published');
  });

  test('uses the furthest checkpoint when repair events repeat earlier stages', async () => {
    await runWithRunContext('run_repair', async () => {
      agentCheckpointService.record('changes_applied');
      agentCheckpointService.record('validation_completed');
      agentCheckpointService.record('changes_applied', { repair: true });
    });

    const plan = agentCheckpointService.buildResumePlan('run_repair');

    expect(plan.lastStage).toBe('validation_completed');
    expect(plan.nextStage).toBe('pr_drafted');
  });

  test('runs research, patch, and verification with isolated handoffs', async () => {
    const order: string[] = [];
    const researchInput = { issue: 'acme/demo#42', files: ['src/a.ts'] };

    const result = await runWithRunContext('run_roles', () =>
      agentRolePipelineService.execute(researchInput, {
        research: async (input) => {
          order.push('research');
          input.files.push('src/research.ts');
          return { findings: [...input.files] };
        },
        patch: async (handoff) => {
          order.push(`${handoff.from}->${handoff.to}`);
          handoff.payload.findings.push('src/patch.ts');
          return { changedFiles: [...handoff.payload.findings] };
        },
        verify: async (handoff) => {
          order.push(`${handoff.from}->${handoff.to}`);
          return { passed: handoff.payload.changedFiles.includes('src/patch.ts') };
        },
      }),
    );

    expect(order).toEqual(['research', 'research->patch', 'patch->verify']);
    expect(researchInput.files).toEqual(['src/a.ts']);
    expect(result.research.findings).toEqual(['src/a.ts', 'src/research.ts']);
    expect(result.patch.changedFiles).toContain('src/patch.ts');
    expect(result.verification.passed).toBe(true);
    expect(
      agentEventLogService
        .load('run_roles')
        .filter((event) => event.type === 'agent_role_completed')
        .map((event) => event.data['role']),
    ).toEqual(['research', 'patch', 'verify']);
  });
});
