import { analyzeOrchestrator } from '../index.js';
import { mapMachineError } from './errors.js';
import { buildMachineEnvelope, writeMachinePayload } from './runtime.js';

export class MachineAnalyzeOrchestrator {
  async execute(options: {
    repo?: string;
    headless?: boolean;
    runChecks?: boolean;
    dryRun?: boolean;
  } = {}): Promise<void> {
    try {
      const result = await analyzeOrchestrator.runMachine({
        repo: options.repo,
        headless: options.headless,
        runChecks: options.runChecks,
        dryRun: options.dryRun,
      });
      writeMachinePayload(buildMachineEnvelope('machine analyze', result));
    } catch (error) {
      const mapped = mapMachineError('machine analyze', error);
      writeMachinePayload(mapped.payload);
      process.exitCode = mapped.exitCode;
    }
  }
}

export const machineAnalyzeOrchestrator = new MachineAnalyzeOrchestrator();
