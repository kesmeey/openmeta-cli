import { getCurrentRunId } from '../infra/execution-context.js';
import { logger } from '../infra/logger.js';
import type { AgentTool, AgentToolContext, PermissionDecision, ToolExecutionResult } from '../types/index.js';
import { agentEventLogService } from './agent-event-log.js';
import { agentHookService } from './agent-hooks.js';

function formatSchemaError(issues: Array<{ path: PropertyKey[]; message: string }>): string {
  return issues
    .slice(0, 3)
    .map((issue) => `${issue.path.map(String).join('.') || 'root'}: ${issue.message}`)
    .join('; ');
}

const PERMISSION_PRIORITY: Record<PermissionDecision['outcome'], number> = {
  allow: 0,
  review: 1,
  ask: 2,
  deny: 3,
};

function stricterDecision(current: PermissionDecision, candidate: PermissionDecision | undefined): PermissionDecision {
  if (!candidate) {
    return current;
  }
  return PERMISSION_PRIORITY[candidate.outcome] > PERMISSION_PRIORITY[current.outcome] ? candidate : current;
}

export class ToolExecutorService {
  private readonly tools = new Map<string, AgentTool<unknown, unknown>>();
  private readonly serialTails = new Map<string, Promise<void>>();

  register<Input, Output>(tool: AgentTool<Input, Output>): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Agent tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool as unknown as AgentTool<unknown, unknown>);
  }

  list(): AgentTool<unknown, unknown>[] {
    return [...this.tools.values()];
  }

  async execute<Output = unknown>(
    toolName: string,
    rawInput: unknown,
    context: AgentToolContext = {},
  ): Promise<ToolExecutionResult<Output>> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      const now = new Date().toISOString();
      return {
        toolName,
        status: 'failed',
        error: `Unknown agent tool: ${toolName}`,
        startedAt: now,
        finishedAt: now,
        durationMs: 0,
      };
    }

    const execute = () => this.executeTool<Output>(tool, rawInput, context);
    return tool.isConcurrencySafe ? execute() : this.runSerially(tool.name, execute);
  }

  private async executeTool<Output>(
    tool: AgentTool<unknown, unknown>,
    rawInput: unknown,
    context: AgentToolContext,
  ): Promise<ToolExecutionResult<Output>> {
    const startedAt = new Date().toISOString();
    const startedMs = Date.now();
    this.recordEvent('tool_execution_started', { toolName: tool.name });

    try {
      const initialInput = tool.inputSchema.safeParse(rawInput);
      if (!initialInput.success) {
        return this.failedResult(
          tool.name,
          startedAt,
          startedMs,
          `Tool input failed schema validation. ${formatSchemaError(initialInput.error.issues)}`,
        );
      }

      let input = initialInput.data;
      const hookResults = await agentHookService.run('before_tool_execute', {
        toolName: tool.name,
        input,
      });
      for (const hookResult of hookResults) {
        if (hookResult.updatedInput !== undefined) {
          const updatedInput = tool.inputSchema.safeParse(hookResult.updatedInput);
          if (!updatedInput.success) {
            return this.failedResult(
              tool.name,
              startedAt,
              startedMs,
              `Hook-updated input failed schema validation. ${formatSchemaError(updatedInput.error.issues)}`,
            );
          }
          input = updatedInput.data;
        }

        if (hookResult.continue === false) {
          return this.blockedResult(tool.name, startedAt, startedMs, {
            outcome: 'deny',
            action: tool.name,
            riskLevel: tool.riskLevel,
            reason: hookResult.reason || 'A before_tool_execute hook blocked this action.',
          });
        }
      }

      const permissionDecision = hookResults.reduce(
        (decision, result) => stricterDecision(decision, result.permissionDecision),
        tool.checkPermission(input, context),
      );

      if (permissionDecision.outcome !== 'allow' && !(permissionDecision.outcome === 'review' && context.allowReview)) {
        return this.blockedResult(tool.name, startedAt, startedMs, permissionDecision);
      }

      const rawOutput = await tool.execute(input, { ...context, permissionDecision });
      const output = tool.outputSchema.safeParse(rawOutput);
      if (!output.success) {
        return this.failedResult(
          tool.name,
          startedAt,
          startedMs,
          `Tool output failed schema validation. ${formatSchemaError(output.error.issues)}`,
          permissionDecision,
        );
      }

      const finishedAt = new Date().toISOString();
      const result: ToolExecutionResult<Output> = {
        toolName: tool.name,
        status: 'success',
        permissionDecision,
        output: output.data as Output,
        startedAt,
        finishedAt,
        durationMs: Math.max(0, Date.now() - startedMs),
      };
      this.recordEvent('tool_execution_completed', {
        toolName: tool.name,
        durationMs: result.durationMs,
      });
      await agentHookService.run('after_tool_execute', {
        toolName: tool.name,
        status: result.status,
        durationMs: result.durationMs,
      });
      return result;
    } catch (error) {
      return this.failedResult(tool.name, startedAt, startedMs, error instanceof Error ? error.message : String(error));
    }
  }

  private blockedResult<Output>(
    toolName: string,
    startedAt: string,
    startedMs: number,
    permissionDecision: PermissionDecision,
  ): ToolExecutionResult<Output> {
    const result: ToolExecutionResult<Output> = {
      toolName,
      status: 'blocked',
      permissionDecision,
      error: permissionDecision.reason,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Math.max(0, Date.now() - startedMs),
    };
    this.recordEvent('tool_execution_blocked', {
      toolName,
      outcome: permissionDecision.outcome,
      reason: permissionDecision.reason,
    });
    return result;
  }

  private failedResult<Output>(
    toolName: string,
    startedAt: string,
    startedMs: number,
    error: string,
    permissionDecision?: PermissionDecision,
  ): ToolExecutionResult<Output> {
    const result: ToolExecutionResult<Output> = {
      toolName,
      status: 'failed',
      ...(permissionDecision ? { permissionDecision } : {}),
      error,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Math.max(0, Date.now() - startedMs),
    };
    this.recordEvent('tool_execution_failed', { toolName, error });
    agentHookService.emit('tool_execute_failed', { toolName, error });
    return result;
  }

  private async runSerially<Output>(
    toolName: string,
    operation: () => Promise<ToolExecutionResult<Output>>,
  ): Promise<ToolExecutionResult<Output>> {
    const previous = this.serialTails.get(toolName) ?? Promise.resolve();
    let release: () => void = () => {};
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.serialTails.set(toolName, tail);

    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.serialTails.get(toolName) === tail) {
        this.serialTails.delete(toolName);
      }
    }
  }

  private recordEvent(
    type: 'tool_execution_started' | 'tool_execution_completed' | 'tool_execution_blocked' | 'tool_execution_failed',
    data: Record<string, unknown>,
  ): void {
    const runId = getCurrentRunId();
    if (!runId) {
      return;
    }

    try {
      agentEventLogService.record(runId, type, data);
    } catch (error) {
      logger.debug(`Unable to append ${type} for ${runId}`, error);
    }
  }
}

export const toolExecutorService = new ToolExecutorService();
