import { analyzeOrchestrator } from '../index.js';
import { runInMachineContext } from '../../infra/index.js';
import { mapMachineError } from './errors.js';
import { buildMachineEnvelope, writeMachinePayload, writeMachinePlan } from './runtime.js';

export class MachineAnalyzeOrchestrator {
  async execute(options: {
    repo?: string;
    repoPath?: string;
    headless?: boolean;
    runChecks?: boolean;
    dryRun?: boolean;
  } = {}): Promise<void> {
    try {
      writeMachinePlan('machine analyze', [
        'Validate GitHub access',
        'Validate LLM provider',
        'Prepare repository workspace',
        'Inspect repository for grounded contribution ideas',
        'Select the strongest repository suggestion',
        'Draft patch strategy for the selected suggestion',
        'Draft pull request narrative for the selected suggestion',
      ]);
      const result = await runInMachineContext(() => analyzeOrchestrator.runMachine({
        repo: options.repo,
        repoPath: options.repoPath,
        headless: options.headless ?? true,
        runChecks: options.runChecks,
        dryRun: options.dryRun,
      }));
      writeMachinePayload(buildMachineEnvelope('machine analyze', result));
    } catch (error) {
      const mapped = mapMachineError('machine analyze', error);
      writeMachinePayload(mapped.payload);
      process.exitCode = mapped.exitCode;
    }
  }
}

export const machineAnalyzeOrchestrator = new MachineAnalyzeOrchestrator();
