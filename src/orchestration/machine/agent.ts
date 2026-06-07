import { agentOrchestrator } from '../index.js';
import { mapMachineError } from './errors.js';
import { buildMachineEnvelope, writeMachinePayload } from './runtime.js';

export class MachineAgentFlowOrchestrator {
  async execute(options: {
    headless?: boolean;
    runChecks?: boolean;
    draftOnly?: boolean;
    refresh?: boolean;
    repo?: string;
    issue?: string;
    dryRun?: boolean;
  } = {}): Promise<void> {
    try {
      const result = await agentOrchestrator.runMachine({
        headless: options.headless,
        runChecks: options.runChecks,
        draftOnly: options.draftOnly,
        refresh: options.refresh,
        repo: options.repo,
        issue: options.issue,
        dryRun: options.dryRun,
      });
      writeMachinePayload(buildMachineEnvelope('machine agent', result));
    } catch (error) {
      const mapped = mapMachineError('machine agent', error);
      writeMachinePayload(mapped.payload);
      process.exitCode = mapped.exitCode;
    }
  }
}

export const machineAgentFlowOrchestrator = new MachineAgentFlowOrchestrator();
