import { resolve, sep } from 'path';
import { getCurrentRunId } from '../infra/execution-context.js';
import { logger } from '../infra/logger.js';
import type { GeneratedFileChange, PermissionDecision, TestCommand } from '../types/index.js';
import { agentEventLogService } from './agent-event-log.js';
import { agentHookService } from './agent-hooks.js';

type ExecutionMode = 'interactive' | 'headless';

function normalizeRepoRelativePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '').trim();
}

function traceDecision(decision: PermissionDecision): PermissionDecision {
  const runId = getCurrentRunId();
  agentHookService.emit('permission_decision', { decision });

  if (runId) {
    try {
      agentEventLogService.record(runId, 'permission_decision', { decision });
    } catch (error) {
      logger.debug(`Unable to append permission decision for ${runId}`, error);
    }
  }

  return decision;
}

function allow(action: string, reason: string, details?: Record<string, unknown>): PermissionDecision {
  return traceDecision({ outcome: 'allow', action, riskLevel: 'low', reason, details });
}

function review(action: string, reason: string, details?: Record<string, unknown>): PermissionDecision {
  return traceDecision({ outcome: 'review', action, riskLevel: 'medium', reason, details });
}

function deny(action: string, reason: string, details?: Record<string, unknown>): PermissionDecision {
  return traceDecision({ outcome: 'deny', action, riskLevel: 'high', reason, details });
}

export class PermissionPolicyService {
  evaluateGeneratedFileChanges(input: {
    workspacePath: string;
    fileChanges: GeneratedFileChange[];
    allowedPaths?: string[];
    maxFiles: number;
    maxFileChars: number;
  }): PermissionDecision {
    if (input.fileChanges.length > input.maxFiles) {
      return review(
        'workspace.file_write',
        `Generated patch touches ${input.fileChanges.length} files; automatic apply limit is ${input.maxFiles}.`,
        { fileCount: input.fileChanges.length, maxFiles: input.maxFiles },
      );
    }

    const rootPath = resolve(input.workspacePath);
    const allowedPaths = new Set((input.allowedPaths ?? []).map(normalizeRepoRelativePath).filter(Boolean));
    const deniedPaths: string[] = [];
    const reviewPaths: string[] = [];

    for (const change of input.fileChanges) {
      const relativePath = normalizeRepoRelativePath(change.path);
      if (!relativePath) {
        reviewPaths.push(change.path);
        continue;
      }

      const targetPath = resolve(rootPath, relativePath);
      if (targetPath !== rootPath && !targetPath.startsWith(`${rootPath}${sep}`)) {
        deniedPaths.push(change.path);
        continue;
      }

      if (allowedPaths.size > 0 && !allowedPaths.has(relativePath)) {
        reviewPaths.push(relativePath);
      }

      if (change.content.length > input.maxFileChars) {
        reviewPaths.push(relativePath);
      }
    }

    if (deniedPaths.length > 0) {
      return deny('workspace.file_write', 'Generated patch contains paths outside the workspace.', { deniedPaths });
    }

    if (reviewPaths.length > 0) {
      return review('workspace.file_write', 'Generated patch requires review before automatic file writes.', {
        reviewPaths: [...new Set(reviewPaths)],
      });
    }

    return allow('workspace.file_write', 'Generated file changes stay inside the selected implementation context.', {
      fileCount: input.fileChanges.length,
    });
  }

  selectValidationCommands(
    commands: TestCommand[],
    executionMode: ExecutionMode,
  ): { commands: TestCommand[]; warnings: string[]; decisions: PermissionDecision[] } {
    if (executionMode !== 'headless') {
      return {
        commands: commands.slice(0, 3),
        warnings: [],
        decisions: commands.slice(0, 3).map((command) =>
          allow('validation.command', 'Interactive validation allows detected repository commands.', {
            command: command.command,
            source: command.source,
          }),
        ),
      };
    }

    const selected = commands.filter((command) => command.source === 'tool-default').slice(0, 3);
    const skipped = commands.filter((command) => command.source === 'repo-script');

    return {
      commands: selected,
      warnings: skipped.map(
        (command) =>
          `Skipped ${command.command} during headless validation because it comes from repository-defined scripts.`,
      ),
      decisions: [
        ...selected.map((command) =>
          allow('validation.command', 'Headless validation allows tool-default commands only.', {
            command: command.command,
            source: command.source,
          }),
        ),
        ...skipped.map((command) =>
          deny('validation.command', 'Headless validation rejects repository-defined scripts.', {
            command: command.command,
            source: command.source,
          }),
        ),
      ],
    };
  }

  evaluateValidationExecution(commands: TestCommand[], executionMode: ExecutionMode): PermissionDecision {
    const repositoryCommands = commands.filter((command) => command.source === 'repo-script');
    if (executionMode === 'headless' && repositoryCommands.length > 0) {
      return deny('validation.command', 'Headless validation rejects repository-defined scripts.', {
        commands: repositoryCommands.map((command) => command.command),
      });
    }

    return allow('validation.command', 'Validation commands are allowed by the current execution mode.', {
      commands: commands.map((command) => command.command),
      executionMode,
    });
  }

  evaluatePullRequest(input: {
    allowRealPr: boolean;
    headless: boolean;
    hasBlockingValidationFailures: boolean;
    confirmed?: boolean;
  }): PermissionDecision {
    if (!input.allowRealPr) {
      return review('github.create_draft_pr', 'Structured drafts require review before creating a real PR.');
    }

    if (input.headless && input.hasBlockingValidationFailures) {
      return deny('github.create_draft_pr', 'Headless mode refuses to create PRs with blocking validation failures.');
    }

    if (!input.headless && !input.confirmed) {
      return review('github.create_draft_pr', 'Interactive draft PR creation requires user confirmation.', {
        requiresConfirmation: true,
      });
    }

    return allow('github.create_draft_pr', 'Draft PR creation is allowed by the current execution policy.');
  }

  evaluateArtifactPublish(input: { dryRun?: boolean; headless: boolean; confirmed?: boolean }): PermissionDecision {
    if (input.dryRun) {
      return review('artifact.publish', 'Dry-run mode previews artifact publication without writing git changes.');
    }

    if (input.confirmed) {
      return allow('artifact.publish', 'Artifact publication was explicitly confirmed.');
    }

    return input.headless
      ? allow('artifact.publish', 'Headless artifact publication uses saved automation defaults.')
      : review('artifact.publish', 'Interactive artifact publication requires user confirmation.');
  }
}

export const permissionPolicyService = new PermissionPolicyService();
