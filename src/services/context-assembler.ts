import type { RepoFileSnippet, RepoMemory, RepoWorkspaceContext, TestResult } from '../types/index.js';

export interface RepositoryContextOptions {
  repoFullName?: string;
  includeTopLevelFiles?: boolean;
  includeBaselineResults?: boolean;
  includeSnippets?: boolean;
}

export class ContextAssemblerService {
  buildRepositoryContext(workspace: RepoWorkspaceContext, options: RepositoryContextOptions = {}): string {
    return [
      ...(options.repoFullName ? [`Repository: ${options.repoFullName}`] : []),
      `Workspace Path: ${workspace.workspacePath}`,
      `Default Branch: ${workspace.defaultBranch}`,
      `Workspace Dirty: ${workspace.workspaceDirty}`,
      ...(options.includeTopLevelFiles ? [`Top-Level Files: ${workspace.topLevelFiles.join(', ') || 'none'}`] : []),
      `Candidate Files: ${workspace.candidateFiles.join(', ') || 'none'}`,
      `Detected Test Commands: ${workspace.testCommands.map((item) => item.command).join(', ') || 'none'}`,
      `Runnable Validation Commands: ${workspace.validationCommands.map((item) => item.command).join(', ') || 'none'}`,
      `Validation Safety Notes: ${workspace.validationWarnings.join(' | ') || 'none'}`,
      ...(options.includeBaselineResults
        ? [`Baseline Results: ${this.formatValidationResults(workspace.testResults)}`]
        : []),
      ...((options.includeSnippets ?? true)
        ? ['Snippets:', ...workspace.snippets.map((snippet) => this.formatFileSnippet(snippet))]
        : []),
    ].join('\n\n');
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
}

export const contextAssemblerService = new ContextAssemblerService();
