import { providerOrchestrator } from '../index.js';
import { mapMachineError } from './errors.js';
import { buildMachineEnvelope, writeMachinePayload } from './runtime.js';

export class MachineProviderOrchestrator {
  async add(
    name: string,
    options: {
      provider?: string;
      baseUrl?: string;
      model?: string;
      apiKey?: string;
      reasoningEffort?: string;
      stream?: string;
      header?: string[];
    },
  ): Promise<void> {
    try {
      const result = await providerOrchestrator.addProfile(name, options);
      writeMachinePayload(buildMachineEnvelope('machine provider add', result));
    } catch (error) {
      const mapped = mapMachineError('machine provider add', error);
      writeMachinePayload(mapped.payload);
      process.exitCode = mapped.exitCode;
    }
  }

  async use(name: string): Promise<void> {
    try {
      const result = await providerOrchestrator.useProfile(name);
      writeMachinePayload(buildMachineEnvelope('machine provider use', result));
    } catch (error) {
      const mapped = mapMachineError('machine provider use', error);
      writeMachinePayload(mapped.payload);
      process.exitCode = mapped.exitCode;
    }
  }
}

export const machineProviderOrchestrator = new MachineProviderOrchestrator();
