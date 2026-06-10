import { getErrorMessage } from '../../infra/index.js';
import { buildMachineErrorEnvelope } from './runtime.js';
import type { MachineErrorEnvelope } from './types.js';

export function mapMachineError(
  command: string,
  error: unknown,
): {
  exitCode: number;
  payload: MachineErrorEnvelope;
} {
  const message = getErrorMessage(error);

  if (/must be|is required|does not exist|unknown configuration key|requires --repo|run not found/i.test(message)) {
    return {
      exitCode: 2,
      payload: buildMachineErrorEnvelope(command, 'INVALID_ARGUMENT', message),
    };
  }

  if (/configuration is incomplete|run "openmeta init"|missing github|missing llm/i.test(message)) {
    return {
      exitCode: 3,
      payload: buildMachineErrorEnvelope(command, 'CONFIG_MISSING', message),
    };
  }

  if (/validation failed|access failed|connection failed/i.test(message)) {
    return {
      exitCode: 4,
      payload: buildMachineErrorEnvelope(command, 'VALIDATION_FAILED', message),
    };
  }

  return {
    exitCode: 5,
    payload: buildMachineErrorEnvelope(command, 'INTERNAL_ERROR', message),
  };
}
