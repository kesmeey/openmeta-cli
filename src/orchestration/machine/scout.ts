import { runInMachineContext } from '../../infra/index.js';
import { agentOrchestrator } from '../index.js';
import { mapMachineError } from './errors.js';
import { buildMachineEnvelope, writeMachinePayload, writeMachinePlan } from './runtime.js';

export class MachineScoutOrchestrator {
  async execute(options: { limit?: string; refresh?: boolean; repo?: string; local?: boolean } = {}): Promise<void> {
    try {
      writeMachinePlan('machine scout', [
        'Validate GitHub access when remote scouting is enabled',
        'Validate LLM provider when model scoring is enabled',
        'Fetch and score contribution opportunities',
        'Return ranked opportunities with mode metadata',
      ]);
      const result = await runInMachineContext(() =>
        agentOrchestrator.scoutMachine({
          limit: Number.parseInt(options.limit || '10', 10) || 10,
          refresh: options.refresh,
          repo: options.repo,
          localOnly: options.local,
        }),
      );
      writeMachinePayload(buildMachineEnvelope('machine scout', result));
    } catch (error) {
      const mapped = mapMachineError('machine scout', error);
      writeMachinePayload(mapped.payload);
      process.exitCode = mapped.exitCode;
    }
  }
}

export const machineScoutOrchestrator = new MachineScoutOrchestrator();
