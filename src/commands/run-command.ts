import { getErrorMessage, isUserCancelledError, logger, ui } from '../infra/index.js';
import { agentEventLogService, runHistoryService } from '../services/index.js';
import type { AgentEventType } from '../types/index.js';

function recordRunEvent(runId: string, type: AgentEventType, data: Record<string, unknown>): void {
  try {
    agentEventLogService.record(runId, type, data);
  } catch (error) {
    logger.debug(`Unable to append run event ${type} for ${runId}`, error);
  }
}

export async function runCommand(
  commandName: string,
  task: () => Promise<void>,
  options: { silentSuccess?: boolean; recordRun?: boolean } = {},
): Promise<void> {
  const shouldRecordRun = options.recordRun ?? true;
  const run = shouldRecordRun
    ? runHistoryService.start({
        commandName,
        args: process.argv.slice(2),
      })
    : null;
  if (run) {
    recordRunEvent(run.id, 'run_started', {
      commandName,
      args: process.argv.slice(2),
    });
  }

  try {
    await task();
    if (run) {
      runHistoryService.finish(run.id, 'success');
      recordRunEvent(run.id, 'run_finished', { status: 'success' });
    }
    if (!options.silentSuccess) {
      ui.commandCompleted(commandName);
    }
  } catch (error) {
    if (isUserCancelledError(error)) {
      if (run) {
        runHistoryService.finish(run.id, 'cancelled');
        recordRunEvent(run.id, 'run_cancelled', { status: 'cancelled' });
      }
      ui.commandCancelled(commandName);
      return;
    }

    const message = getErrorMessage(error);
    if (run) {
      runHistoryService.finish(run.id, 'failed', message);
      recordRunEvent(run.id, 'run_failed', { status: 'failed', error: message });
    }
    ui.commandFailed(commandName, message);
    process.exitCode = 1;
  }
}
