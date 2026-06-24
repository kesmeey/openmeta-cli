import { getCurrentRunId } from '../infra/execution-context.js';
import { logger } from '../infra/logger.js';
import type {
  ContextBudgetResult,
  ContextSection,
  RepoFileSnippet,
  RepoMemory,
  RepoWorkspaceContext,
  TestResult,
} from '../types/index.js';
import { agentEventLogService } from './agent-event-log.js';
import { agentHookService } from './agent-hooks.js';
import { contextBudgetService } from './context-budget.js';

export interface RepositoryContextOptions {
  repoFullName?: string;
  includeTopLevelFiles?: boolean;
  includeBaselineResults?: boolean;
  includeSnippets?: boolean;
  maxEstimatedTokens?: number;
}

export class ContextAssemblerService {
  buildRepositoryContext(workspace: RepoWorkspaceContext, options: RepositoryContextOptions = {}): string {
    return this.buildRepositoryContextResult(workspace, options).content;
  }

  buildRepositoryContextResult(
    workspace: RepoWorkspaceContext,
    options: RepositoryContextOptions = {},
  ): ContextBudgetResult {
    const sections: ContextSection[] = [
      ...(options.repoFullName
        ? [{ id: 'repository', content: `Repository: ${options.repoFullName}`, priority: 100, required: true }]
        : []),
      { id: 'workspace_path', content: `Workspace Path: ${workspace.workspacePath}`, priority: 100, required: true },
      { id: 'default_branch', content: `Default Branch: ${workspace.defaultBranch}`, priority: 95, required: true },
      { id: 'workspace_dirty', content: `Workspace Dirty: ${workspace.workspaceDirty}`, priority: 100, required: true },
      ...(options.includeTopLevelFiles
        ? [
            {
              id: 'top_level_files',
              content: `Top-Level Files: ${workspace.topLevelFiles.join(', ') || 'none'}`,
              priority: 60,
            },
          ]
        : []),
      {
        id: 'candidate_files',
        content: `Candidate Files: ${workspace.candidateFiles.join(', ') || 'none'}`,
        priority: 90,
        required: true,
      },
      {
        id: 'detected_test_commands',
        content: `Detected Test Commands: ${workspace.testCommands.map((item) => item.command).join(', ') || 'none'}`,
        priority: 80,
      },
      {
        id: 'validation_commands',
        content: `Runnable Validation Commands: ${workspace.validationCommands.map((item) => item.command).join(', ') || 'none'}`,
        priority: 90,
      },
      {
        id: 'validation_warnings',
        content: `Validation Safety Notes: ${workspace.validationWarnings.join(' | ') || 'none'}`,
        priority: 95,
      },
      ...(options.includeBaselineResults
        ? [
            {
              id: 'baseline_results',
              content: `Baseline Results: ${this.formatValidationResults(workspace.testResults)}`,
              priority: 95,
            },
          ]
        : []),
      ...((options.includeSnippets ?? true)
        ? [
            { id: 'snippet_header', content: 'Snippets:', priority: 70 },
            ...workspace.snippets.map((snippet, index) => ({
              id: `snippet:${snippet.path || index}`,
              content: this.formatFileSnippet(snippet),
              priority: 70,
            })),
          ]
        : []),
    ];

    return this.recordAssembly('repository', contextBudgetService.assemble(sections, options.maxEstimatedTokens));
  }

  buildEditableFilesContext(snippets: RepoFileSnippet[], emptyFallback = 'No editable files were detected.'): string {
    return snippets.length > 0
      ? snippets.map((snippet) => this.formatFileSnippet(snippet)).join('\n\n')
      : emptyFallback;
  }

  buildValidationContext(workspace: RepoWorkspaceContext): string {
    return [
      `Detected Commands: ${workspace.testCommands.map((item) => item.command).join(', ') || 'none'}`,
      `Runnable Commands: ${workspace.validationCommands.map((item) => item.command).join(', ') || 'none'}`,
      `Baseline Results: ${this.formatValidationResults(workspace.testResults)}`,
    ].join('\n');
  }

  buildValidationFailureContext(results: TestResult[]): string {
    const failures = results.filter((result) => !result.passed);
    if (failures.length === 0) {
      return 'No validation failures were provided.';
    }

    return failures
      .map((result) => `${result.command} | exit=${result.exitCode ?? 'n/a'}\n${result.output}`.trim())
      .join('\n\n---\n\n');
  }

  buildRepoMemoryContext(memory: RepoMemory): string {
    const topPathSignals =
      memory.pathSignals.length > 0
        ? memory.pathSignals
            .slice(0, 5)
            .map(
              (signal) =>
                `- ${signal.path} | candidate ${signal.candidateCount} | changed ${signal.changedCount} | validation ${signal.successfulValidationCount} | published ${signal.publishedCount}`,
            )
        : ['- none'];
    const validationSignals =
      memory.validationSignals.length > 0
        ? memory.validationSignals
            .slice(0, 5)
            .map(
              (signal) =>
                `- ${signal.command} | failures ${signal.failureCount} | last exit ${signal.lastExitCode ?? 'n/a'}${signal.sampleOutput ? ` | sample ${signal.sampleOutput}` : ''}`,
            )
        : ['- none'];
    const recentOutcomes =
      memory.recentIssues.length > 0
        ? memory.recentIssues
            .slice(0, 5)
            .map(
              (issue) =>
                `- ${issue.reference} | status ${issue.status} | changed ${issue.changedFiles.join(', ') || 'none'} | validation ${issue.validationSummary}`,
            )
        : ['- none'];

    return [
      `Last Selected Issue: ${memory.lastSelectedIssue || 'n/a'}`,
      `Generated Dossiers: ${memory.generatedDossiers}`,
      `Preferred Paths: ${memory.preferredPaths.join(', ') || 'none'}`,
      `Known Test Commands: ${memory.detectedTestCommands.join(', ') || 'none'}`,
      `Run Stats: total=${memory.runStats.totalRuns}, published=${memory.runStats.publishedRuns}, real_pr=${memory.runStats.realPrRuns}, review_required=${memory.runStats.reviewRequiredRuns}, validation_ok=${memory.runStats.successfulValidationRuns}, validation_failed=${memory.runStats.failedValidationRuns}`,
      'Top Path Signals:',
      ...topPathSignals,
      'Recent Validation Failure Signals:',
      ...validationSignals,
      'Recent Issue Outcomes:',
      ...recentOutcomes,
    ].join('\n');
  }

  private formatFileSnippet(snippet: RepoFileSnippet): string {
    return `FILE: ${snippet.path}\n${snippet.content}`;
  }

  private formatValidationResults(results: TestResult[]): string {
    return results.length > 0
      ? results
          .map((result) => `${result.command} => ${result.passed ? 'passed' : `failed (${result.exitCode ?? 'n/a'})`}`)
          .join('; ')
      : 'not executed';
  }

  private recordAssembly(kind: string, result: ContextBudgetResult): ContextBudgetResult {
    const data = {
      kind,
      estimatedTokens: result.estimatedTokens,
      originalEstimatedTokens: result.originalEstimatedTokens,
      truncatedSections: result.truncatedSections,
    };
    const runId = getCurrentRunId();
    agentHookService.emit('context_assembled', data);

    if (runId) {
      try {
        agentEventLogService.record(runId, 'context_assembled', data);
      } catch (error) {
        logger.debug(`Unable to append context assembly event for ${runId}`, error);
      }
    }

    return result;
  }
}

export const contextAssemblerService = new ContextAssemblerService();
