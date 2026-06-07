let machineContextDepth = 0;

export function isMachineContext(): boolean {
  return machineContextDepth > 0;
}

export async function runInMachineContext<T>(task: () => Promise<T>): Promise<T> {
  machineContextDepth += 1;
  try {
    return await task();
  } finally {
    machineContextDepth = Math.max(0, machineContextDepth - 1);
  }
}
