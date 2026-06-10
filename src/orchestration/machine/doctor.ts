import { doctorOrchestrator } from '../index.js';
import { mapMachineError } from './errors.js';
import { buildMachineEnvelope, writeMachinePayload } from './runtime.js';

export class MachineDoctorOrchestrator {
  async execute(): Promise<void> {
    try {
      const report = await doctorOrchestrator.inspect();
      writeMachinePayload(
        buildMachineEnvelope('machine doctor', {
          ...report,
          nextActions: report.ready ? [] : ['run_machine_config_set'],
        }),
      );
    } catch (error) {
      const mapped = mapMachineError('machine doctor', error);
      writeMachinePayload(mapped.payload);
      process.exitCode = mapped.exitCode;
    }
  }
}

export const machineDoctorOrchestrator = new MachineDoctorOrchestrator();
