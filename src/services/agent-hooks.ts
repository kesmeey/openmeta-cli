import { getCurrentRunId } from '../infra/execution-context.js';
import { logger } from '../infra/logger.js';
import type { AgentHookEvent, AgentHookHandler, AgentHookPayload } from '../types/index.js';

export class AgentHookService {
  private readonly handlers = new Map<AgentHookEvent, Set<AgentHookHandler>>();

  register(event: AgentHookEvent, handler: AgentHookHandler): () => void {
    const eventHandlers = this.handlers.get(event) ?? new Set<AgentHookHandler>();
    eventHandlers.add(handler);
    this.handlers.set(event, eventHandlers);

    return () => {
      eventHandlers.delete(handler);
      if (eventHandlers.size === 0) {
        this.handlers.delete(event);
      }
    };
  }

  emit(event: AgentHookEvent, data: Record<string, unknown>): AgentHookPayload {
    const runId = getCurrentRunId();
    const payload: AgentHookPayload = {
      event,
      timestamp: new Date().toISOString(),
      ...(runId ? { runId } : {}),
      data,
    };

    for (const handler of this.handlers.get(event) ?? []) {
      try {
        handler(payload);
      } catch (error) {
        logger.debug(`Agent hook failed for ${event}`, error);
      }
    }

    return payload;
  }

  clear(): void {
    this.handlers.clear();
  }
}

export const agentHookService = new AgentHookService();
