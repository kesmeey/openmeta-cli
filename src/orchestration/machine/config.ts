import { configOrchestrator } from '../index.js';
import { mapMachineError } from './errors.js';
import { buildMachineEnvelope, writeMachinePayload } from './runtime.js';

export class MachineConfigOrchestrator {
  async get(): Promise<void> {
    try {
      const snapshot = await configOrchestrator.getMachineSnapshot();
      writeMachinePayload(buildMachineEnvelope('machine config get', snapshot));
    } catch (error) {
      const mapped = mapMachineError('machine config get', error);
      writeMachinePayload(mapped.payload);
      process.exitCode = mapped.exitCode;
    }
  }

  async set(key: string, value: string): Promise<void> {
    try {
      const result = await configOrchestrator.setMachineValue(key, value);
      writeMachinePayload(buildMachineEnvelope('machine config set', result));
    } catch (error) {
      const mapped = mapMachineError('machine config set', error);
      writeMachinePayload(mapped.payload);
      process.exitCode = mapped.exitCode;
    }
  }
}

export const machineConfigOrchestrator = new MachineConfigOrchestrator();
