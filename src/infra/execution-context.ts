import { AsyncLocalStorage } from 'async_hooks';

interface ExecutionContextState {
  machine: boolean;
  runId?: string;
}

const executionContext = new AsyncLocalStorage<ExecutionContextState>();

export function isMachineContext(): boolean {
  return executionContext.getStore()?.machine ?? false;
}

export function getCurrentRunId(): string | undefined {
  return executionContext.getStore()?.runId;
}

export async function runWithRunContext<T>(runId: string, task: () => Promise<T>): Promise<T> {
  const current = executionContext.getStore();
  return executionContext.run(
    {
      machine: current?.machine ?? false,
      runId,
    },
    task,
  );
}

export async function runInMachineContext<T>(task: () => Promise<T>): Promise<T> {
  const current = executionContext.getStore();
  return executionContext.run(
    {
      machine: true,
      ...(current?.runId ? { runId: current.runId } : {}),
    },
    task,
  );
}
