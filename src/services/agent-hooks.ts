import { getCurrentRunId } from '../infra/execution-context.js';
import { logger } from '../infra/logger.js';
import type { AgentHookEvent, AgentHookHandler, AgentHookPayload, AgentHookResult } from '../types/index.js';

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
    const payload = this.buildPayload(event, data);

    for (const handler of this.handlers.get(event) ?? []) {
      try {
        const result = handler(payload);
        if (result instanceof Promise) {
          void result.catch((error) => logger.debug(`Agent hook failed for ${event}`, error));
        }
      } catch (error) {
        logger.debug(`Agent hook failed for ${event}`, error);
      }
    }

    return payload;
  }

  async run(event: AgentHookEvent, data: Record<string, unknown>): Promise<AgentHookResult[]> {
    const payload = this.buildPayload(event, data);
    const results: AgentHookResult[] = [];

    for (const handler of this.handlers.get(event) ?? []) {
      try {
        const result = await handler(payload);
        if (result) {
          results.push(result);
        }
      } catch (error) {
        logger.debug(`Agent hook failed for ${event}`, error);
      }
    }

    return results;
  }

  private buildPayload(event: AgentHookEvent, data: Record<string, unknown>): AgentHookPayload {
    const runId = getCurrentRunId();
    return {
      event,
      timestamp: new Date().toISOString(),
      ...(runId ? { runId } : {}),
      data,
    };
  }

  clear(): void {
    this.handlers.clear();
  }
}

export const agentHookService = new AgentHookService();
