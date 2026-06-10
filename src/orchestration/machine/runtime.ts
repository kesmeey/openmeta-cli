import type { MachineEnvelope, MachineErrorCode, MachineErrorEnvelope } from './types.js';

function now(): string {
  return new Date().toISOString();
}

export function buildMachineEnvelope<T>(command: string, data: T): MachineEnvelope<T> {
  return {
    version: 1,
    command,
    timestamp: now(),
    data,
  };
}

export function buildMachineErrorEnvelope(
  command: string,
  code: MachineErrorCode,
  message: string,
  details?: unknown,
): MachineErrorEnvelope {
  return {
    version: 1,
    command,
    timestamp: now(),
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
    },
  };
}

export function writeMachinePayload(payload: MachineEnvelope<unknown> | MachineErrorEnvelope): void {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

export function writeMachinePlan(command: string, steps: string[]): void {
  if (steps.length === 0) {
    return;
  }

  const lines = [`Machine execution plan for ${command}:`, ...steps.map((step, index) => `${index + 1}. ${step}`)];

  for (const line of lines) {
    process.stderr.write(`${line}\n`);
  }
}
