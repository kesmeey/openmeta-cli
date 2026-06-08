import { agentOrchestrator } from '../index.js';
import { runInMachineContext } from '../../infra/index.js';
import { mapMachineError } from './errors.js';
import { buildMachineEnvelope, writeMachinePayload, writeMachinePlan } from './runtime.js';

export class MachineAgentFlowOrchestrator {
  async execute(options: {
    headless?: boolean;
    runChecks?: boolean;
    draftOnly?: boolean;
    refresh?: boolean;
    repo?: string;
    repoPath?: string;
    issue?: string;
    dryRun?: boolean;
  } = {}): Promise<void> {
    try {
      writeMachinePlan('machine agent', [
        'Validate GitHub access',
        'Validate LLM provider',
        'Scout or load the target issue',
        'Prepare repository workspace',
        'Draft patch and PR artifacts without mutating the repository unless allowed',
        'Optionally apply changes or open a draft PR depending on execution flags',
        'Return execution outcome with artifact paths and next actions',
      ]);
      const result = await runInMachineContext(() => agentOrchestrator.runMachine({
        headless: options.headless ?? true,
        runChecks: options.runChecks,
        draftOnly: options.draftOnly,
        refresh: options.refresh,
        repo: options.repo,
        repoPath: options.repoPath,
        issue: options.issue,
        dryRun: options.dryRun,
      }));
      writeMachinePayload(buildMachineEnvelope('machine agent', result));
    } catch (error) {
      const mapped = mapMachineError('machine agent', error);
      writeMachinePayload(mapped.payload);
      process.exitCode = mapped.exitCode;
    }
  }
}

export const machineAgentFlowOrchestrator = new MachineAgentFlowOrchestrator();
