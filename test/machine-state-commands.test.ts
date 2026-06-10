import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { AgentOrchestrator } from '../src/orchestration/agent.js';
import { RunsOrchestrator } from '../src/orchestration/runs.js';
import { inboxService, proofOfWorkService, runHistoryService } from '../src/services/index.js';
import { createInboxItem, createProofRecord } from './helpers/factories.js';

let tempRoot = '';

describe('machine state result builders', () => {
  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'openmeta-machine-state-'));
    process.env['OPENMETA_CONFIG_DIR'] = join(tempRoot, '.config', 'openmeta');
    process.env['OPENMETA_HOME'] = join(tempRoot, '.openmeta');
  });

  afterEach(() => {
    mock.restore();
    delete process.env['OPENMETA_CONFIG_DIR'];
    delete process.env['OPENMETA_HOME'];

    if (tempRoot) {
      rmSync(tempRoot, { recursive: true, force: true });
      tempRoot = '';
    }
  });

  test('returns run history list data with totals', async () => {
    runHistoryService.start({
      commandName: 'OpenMeta Doctor',
      args: ['doctor'],
    });

    const result = await new RunsOrchestrator().listMachine({ limit: 10 });

    expect(result.records).toBeArray();
    expect(result.records.length).toBe(1);
    expect(result.totals.running).toBe(1);
    expect(result.ledgerPath).toContain('runs.json');
  });

  test('returns inbox items ordered by score', async () => {
    inboxService.saveItem(createInboxItem({ id: 'low', overallScore: 55 }));
    inboxService.saveItem(createInboxItem({ id: 'high', overallScore: 88 }));

    const result = await new AgentOrchestrator().getInboxMachineResult();

    expect(result.items).toBeArray();
    expect(result.items[0]?.id).toBe('high');
    expect(result.inboxPath).toContain('inbox.json');
  });

  test('returns proof-of-work records with publication metadata', async () => {
    proofOfWorkService.record(createProofRecord({ id: 'proof-1', published: true }));

    const result = await new AgentOrchestrator().getProofOfWorkMachineResult();

    expect(result.records).toBeArray();
    expect(result.records[0]?.id).toBe('proof-1');
    expect(result.records[0]?.published).toBe(true);
    expect(result.proofOfWorkPath).toContain('proof-of-work.json');
  });
});
