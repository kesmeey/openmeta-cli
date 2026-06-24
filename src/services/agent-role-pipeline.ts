import { getCurrentRunId } from '../infra/execution-context.js';
import { logger } from '../infra/logger.js';
import type { AgentRole, AgentRoleHandoff, AgentRolePipelineResult } from '../types/index.js';
import { agentEventLogService } from './agent-event-log.js';

export interface AgentRolePipelineHandlers<Input, Research, Patch, Verification> {
  research: (input: Input) => Promise<Research>;
  patch: (handoff: AgentRoleHandoff<Research>) => Promise<Patch>;
  verify: (handoff: AgentRoleHandoff<Patch>) => Promise<Verification>;
}

export class AgentRolePipelineService {
  async execute<Input, Research, Patch, Verification>(
    input: Input,
    handlers: AgentRolePipelineHandlers<Input, Research, Patch, Verification>,
  ): Promise<AgentRolePipelineResult<Research, Patch, Verification>> {
    const research = await handlers.research(structuredClone(input));
    this.recordRoleCompletion('research');
    const researchHandoff = this.createHandoff('research', 'patch', research);

    const patch = await handlers.patch(researchHandoff);
    this.recordRoleCompletion('patch');
    const patchHandoff = this.createHandoff('patch', 'verify', patch);

    const verification = await handlers.verify(patchHandoff);
    this.recordRoleCompletion('verify');

    return {
      research,
      patch,
      verification,
      handoffs: [researchHandoff, patchHandoff],
    };
  }

  private createHandoff<T>(from: AgentRole, to: AgentRole, payload: T): AgentRoleHandoff<T> {
    const runId = getCurrentRunId();
    return Object.freeze({
      from,
      to,
      createdAt: new Date().toISOString(),
      ...(runId ? { runId } : {}),
      payload: structuredClone(payload),
    });
  }

  private recordRoleCompletion(role: AgentRole): void {
    const runId = getCurrentRunId();
    if (!runId) {
      return;
    }

    try {
      agentEventLogService.record(runId, 'agent_role_completed', { role });
    } catch (error) {
      logger.debug(`Unable to append role completion for ${role} in ${runId}`, error);
    }
  }
}

export const agentRolePipelineService = new AgentRolePipelineService();
