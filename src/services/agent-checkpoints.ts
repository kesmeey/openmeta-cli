import { getCurrentRunId } from '../infra/execution-context.js';
import { logger } from '../infra/logger.js';
import type { AgentCheckpointStage, AgentResumePlan, AgentRunRecord } from '../types/index.js';
import { agentEventLogService } from './agent-event-log.js';

const CHECKPOINT_ORDER: AgentCheckpointStage[] = [
  'target_selected',
  'workspace_prepared',
  'patch_drafted',
  'changes_applied',
  'validation_completed',
  'pr_drafted',
  'pr_created',
  'artifacts_written',
  'artifacts_published',
];

function isCheckpointStage(value: unknown): value is AgentCheckpointStage {
  return typeof value === 'string' && CHECKPOINT_ORDER.includes(value as AgentCheckpointStage);
}

export class AgentCheckpointService {
  record(stage: AgentCheckpointStage, data: Record<string, unknown> = {}): void {
    const runId = getCurrentRunId();
    if (!runId) {
      return;
    }

    try {
      agentEventLogService.record(runId, 'agent_checkpoint', { stage, ...data });
    } catch (error) {
      logger.debug(`Unable to append agent checkpoint ${stage} for ${runId}`, error);
    }
  }

  buildResumePlan(runId: string, record?: AgentRunRecord): AgentResumePlan {
    const completedStages = agentEventLogService
      .load(runId)
      .filter((event) => event.type === 'agent_checkpoint')
      .map((event) => event.data['stage'])
      .filter(isCheckpointStage)
      .filter((stage, index, stages) => stages.indexOf(stage) === index)
      .sort((left, right) => CHECKPOINT_ORDER.indexOf(left) - CHECKPOINT_ORDER.indexOf(right));
    const lastStage = completedStages.at(-1);

    if (record?.status === 'success') {
      return {
        runId,
        resumable: false,
        completedStages,
        ...(lastStage ? { lastStage } : {}),
        reason: 'The run completed successfully and does not need to be resumed.',
        nextActions: [],
      };
    }

    if (!lastStage) {
      return {
        runId,
        resumable: false,
        completedStages,
        reason: 'No agent checkpoint was recorded before the run stopped.',
        nextActions: record ? [`Re-run: openmeta ${record.args.join(' ')}`.trim()] : [],
      };
    }

    const lastIndex = CHECKPOINT_ORDER.indexOf(lastStage);
    const nextStage = CHECKPOINT_ORDER[lastIndex + 1];
    if (!nextStage) {
      return {
        runId,
        resumable: false,
        completedStages,
        lastStage,
        reason: 'The run reached the final persisted checkpoint.',
        nextActions: [],
      };
    }

    return {
      runId,
      resumable: true,
      completedStages,
      lastStage,
      nextStage,
      reason: `The run can continue from the step after ${lastStage}.`,
      nextActions: [
        `Resume from ${nextStage}.`,
        ...(record ? [`Original command: openmeta ${record.args.join(' ')}`.trim()] : []),
        `Inspect events: openmeta machine runs ${runId}`,
      ],
    };
  }
}

export const agentCheckpointService = new AgentCheckpointService();
