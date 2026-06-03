import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import * as infra from '../src/infra/index.js';
import { AgentOrchestrator } from '../src/orchestration/agent.js';
import { contentService, inboxService, issueRankingService, llmService, memoryService, proofOfWorkService, workspaceService } from '../src/services/index.js';
import type { AppConfig, ContributionAgentResult, RankedIssue } from '../src/types/index.js';
import { createInboxItem, createMemory, createPatchDraft, createProofRecord, createPullRequestDraft, createRankedIssue, createWorkspace } from './helpers/factories.js';

interface AgentRunInternals {
  run(options?: {
    headless?: boolean;
    force?: boolean;
    schedulerRun?: boolean;
    runChecks?: boolean;
    draftOnly?: boolean;
    refresh?: boolean;
    dryRun?: boolean;
  }): Promise<void>;
  confirmManualHeadlessRun(config: AppConfig): Promise<void>;
  initializeClients(config: AppConfig, options?: { validateLlm?: boolean }): Promise<void>;
  promptForIssue(issues: RankedIssue[]): Promise<RankedIssue>;
  generateConcretePatch(
    issue: RankedIssue,
    workspace: ReturnType<typeof createWorkspace>,
    patchDraft: ReturnType<typeof createPatchDraft>,
    runChecks: boolean,
    draftOnly?: boolean,
  ): Promise<{
    changedFiles: string[];
    validationResults: ReturnType<typeof createWorkspace>['testResults'];
    reviewRequired: boolean;
  }>;
  submitContributionPullRequestIfPossible(input: unknown): Promise<{
    branchName?: string;
    url?: string;
    number?: number;
    changedFiles: string[];
    validationResults: ReturnType<typeof createWorkspace>['testResults'];
  }>;
  publishArtifactsIfNeeded(input: unknown): Promise<{ published: boolean }>;
  prepareLocalArtifactPaths(issue: RankedIssue): ContributionAgentResult['artifacts'];
  writeLocalArtifacts(input: unknown): void;
  showResult(result: ContributionAgentResult): void;
  showStructuredReviewNotice(input: { title: string; subtitle: string; lines?: string[] }): void;
}

function createConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    userProfile: {
      techStack: ['typescript', 'react'],
      proficiency: 'intermediate',
      focusAreas: ['frontend'],
    },
    github: {
      pat: 'ghp_test_token',
      username: 'octocat',
    },
    llm: {
      provider: 'custom',
      apiBaseUrl: 'https://example.com/v1',
      apiKey: 'sk-test',
      modelName: 'test-model',
      apiHeaders: {},
    },
    automation: {
      enabled: true,
      scheduleTime: '09:00',
      timezone: 'UTC',
      contentType: 'issue-report',
      scheduler: 'manual',
      minMatchScore: 75,
      skipIfAlreadyGeneratedToday: false,
    },
    commitTemplate: 'feat: {{title}}',
    ...overrides,
  };
}

function createArtifacts(): ContributionAgentResult['artifacts'] {
  return {
    artifactDir: '/tmp/openmeta/artifacts',
    dossierPath: '/tmp/openmeta/artifacts/dossier.md',
    patchDraftPath: '/tmp/openmeta/artifacts/patch-draft.md',
    prDraftPath: '/tmp/openmeta/artifacts/pr-draft.md',
    memoryPath: '/tmp/openmeta/artifacts/repo-memory.md',
    inboxPath: '/tmp/openmeta/artifacts/inbox.md',
    proofOfWorkPath: '/tmp/openmeta/artifacts/proof-of-work.md',
  };
}

function muteUi(): void {
  spyOn(infra.ui, 'hero').mockImplementation(() => {});
  spyOn(infra.ui, 'stepper').mockImplementation(() => {});
  spyOn(infra.ui, 'section').mockImplementation(() => {});
  spyOn(infra.ui, 'recordList').mockImplementation(() => {});
  spyOn(infra.ui, 'card').mockImplementation(() => {});
  spyOn(infra.ui, 'stats').mockImplementation(() => {});
  spyOn(infra.ui, 'keyValues').mockImplementation(() => {});
  spyOn(infra.ui, 'callout').mockImplementation(() => {});
  spyOn(infra.ui, 'emptyState').mockImplementation(() => {});
  spyOn(infra.ui, 'banner').mockImplementation(() => {});
  spyOn(infra.ui, 'timeline').mockImplementation(() => {});
  spyOn(infra.ui, 'task').mockImplementation(async (_options, task) => task({
    setMessage() {},
  } as never));
}

beforeEach(() => {
  muteUi();
});

afterEach(() => {
  mock.restore();
});

describe('AgentOrchestrator run flow', () => {
  test('confirms manual headless runs before returning when no ranked issues are found', async () => {
    const orchestrator = new AgentOrchestrator() as unknown as AgentRunInternals;
    const config = createConfig();
    const emptyStateSpy = spyOn(infra.ui, 'emptyState').mockImplementation(() => {});
    const confirmSpy = spyOn(orchestrator as object as { confirmManualHeadlessRun: AgentRunInternals['confirmManualHeadlessRun'] }, 'confirmManualHeadlessRun')
      .mockResolvedValue(undefined);
    spyOn(infra.configService, 'get').mockResolvedValue(config);
    spyOn(orchestrator as object as { initializeClients: AgentRunInternals['initializeClients'] }, 'initializeClients').mockResolvedValue(undefined);
    spyOn(issueRankingService, 'loadRankedIssues').mockResolvedValue([]);

    await orchestrator.run({ headless: true });

    expect(confirmSpy).toHaveBeenCalledWith(config);
    expect(emptyStateSpy).toHaveBeenCalledWith(
      'OpenMeta Agent',
      'No viable issues found',
      'No issues met the current technical match threshold. Broaden your profile or try again later.',
    );
  });

  test('returns early when automation cannot select an issue above the threshold', async () => {
    const orchestrator = new AgentOrchestrator() as unknown as AgentRunInternals;
    const issue = createRankedIssue();
    const emptyStateSpy = spyOn(infra.ui, 'emptyState').mockImplementation(() => {});
    spyOn(infra.configService, 'get').mockResolvedValue(createConfig());
    spyOn(orchestrator as object as { initializeClients: AgentRunInternals['initializeClients'] }, 'initializeClients').mockResolvedValue(undefined);
    spyOn(issueRankingService, 'loadRankedIssues').mockResolvedValue([issue]);
    spyOn(issueRankingService, 'selectIssueForAutomation').mockReturnValue(undefined);

    await orchestrator.run({ headless: true, schedulerRun: true });

    expect(emptyStateSpy).toHaveBeenCalledWith(
      'OpenMeta Agent',
      'No issue met the automation threshold',
      'Top opportunities were below 75/100. Lower the threshold or widen your profile.',
    );
  });

  test('runs the full interactive flow and records a published outcome', async () => {
    const orchestrator = new AgentOrchestrator() as unknown as AgentRunInternals;
    const config = createConfig();
    const issue = createRankedIssue({ repoFullName: 'acme/demo', number: 42 });
    const memory = createMemory();
    const workspace = createWorkspace({
      workspacePath: '/tmp/openmeta-demo',
      branchName: 'openmeta/42-accessibility',
    });
    const patchDraft = createPatchDraft();
    const prDraft = createPullRequestDraft();
    const validationResults = [{ command: 'bun test', exitCode: 0, passed: true, output: '1 passed' }];
    const artifacts = createArtifacts();
    const showResultSpy = spyOn(orchestrator as object as { showResult: AgentRunInternals['showResult'] }, 'showResult').mockImplementation(() => {});

    spyOn(infra.configService, 'get').mockResolvedValue(config);
    spyOn(orchestrator as object as { initializeClients: AgentRunInternals['initializeClients'] }, 'initializeClients').mockResolvedValue(undefined);
    spyOn(orchestrator as object as { promptForIssue: AgentRunInternals['promptForIssue'] }, 'promptForIssue').mockResolvedValue(issue);
    spyOn(issueRankingService, 'loadRankedIssues').mockResolvedValue([issue]);
    spyOn(memoryService, 'load').mockReturnValue(memory);
    spyOn(workspaceService, 'prepareWorkspace').mockResolvedValue(workspace);
    spyOn(memoryService, 'update').mockReturnValue(memory);
    spyOn(llmService, 'generatePatchDraft').mockResolvedValue({
      version: '1',
      kind: 'patch_draft',
      status: 'success',
      data: patchDraft,
    });
    spyOn(orchestrator as object as { generateConcretePatch: AgentRunInternals['generateConcretePatch'] }, 'generateConcretePatch').mockResolvedValue({
      changedFiles: ['src/app.ts'],
      validationResults,
      reviewRequired: false,
    });
    spyOn(llmService, 'generatePrDraft').mockResolvedValue({
      version: '1',
      kind: 'pull_request_draft',
      status: 'success',
      data: prDraft,
    });
    spyOn(contentService, 'formatPatchDraftMarkdown').mockReturnValue('# Patch');
    spyOn(contentService, 'formatPullRequestDraftMarkdown').mockReturnValue('# PR');
    spyOn(contentService, 'formatContributionDossier').mockReturnValue('# Dossier');
    spyOn(orchestrator as object as { submitContributionPullRequestIfPossible: AgentRunInternals['submitContributionPullRequestIfPossible'] }, 'submitContributionPullRequestIfPossible')
      .mockResolvedValue({
        branchName: 'openmeta/agent-42',
        url: 'https://github.com/acme/demo/pull/42',
        number: 42,
        changedFiles: ['src/app.ts'],
        validationResults,
      });
    spyOn(orchestrator as object as { prepareLocalArtifactPaths: AgentRunInternals['prepareLocalArtifactPaths'] }, 'prepareLocalArtifactPaths').mockReturnValue(artifacts);
    spyOn(orchestrator as object as { writeLocalArtifacts: AgentRunInternals['writeLocalArtifacts'] }, 'writeLocalArtifacts').mockImplementation(() => {});
    spyOn(orchestrator as object as { publishArtifactsIfNeeded: AgentRunInternals['publishArtifactsIfNeeded'] }, 'publishArtifactsIfNeeded').mockResolvedValue({
      published: true,
    });
    spyOn(inboxService, 'saveItem').mockReturnValue([createInboxItem()]);
    spyOn(inboxService, 'renderMarkdown').mockReturnValue('# Inbox');
    spyOn(proofOfWorkService, 'load').mockReturnValue({ records: [] });
    spyOn(proofOfWorkService, 'renderMarkdown').mockReturnValue('# Proof');
    spyOn(proofOfWorkService, 'record').mockReturnValue([createProofRecord()]);
    spyOn(memoryService, 'renderMarkdown').mockReturnValue('# Memory');
    spyOn(memoryService, 'recordOutcome').mockReturnValue(memory);

    await orchestrator.run();

    expect(showResultSpy).toHaveBeenCalledWith(expect.objectContaining({
      issue,
      workspace: expect.objectContaining({ workspacePath: workspace.workspacePath }),
      patchDraft,
      prDraft,
      pullRequestUrl: 'https://github.com/acme/demo/pull/42',
      changedFiles: ['src/app.ts'],
    }));
  });

  test('keeps the run in review mode when patch and PR drafts require review', async () => {
    const orchestrator = new AgentOrchestrator() as unknown as AgentRunInternals;
    const issue = createRankedIssue();
    const memory = createMemory();
    const workspace = createWorkspace({
      testResults: [],
    });
    const patchDraft = createPatchDraft({ goal: 'Needs review goal' });
    const prDraft = createPullRequestDraft({ title: 'Needs review title' });
    const reviewNoticeSpy = spyOn(orchestrator as object as { showStructuredReviewNotice: AgentRunInternals['showStructuredReviewNotice'] }, 'showStructuredReviewNotice')
      .mockImplementation(() => {});
    const generateConcretePatchSpy = spyOn(orchestrator as object as { generateConcretePatch: AgentRunInternals['generateConcretePatch'] }, 'generateConcretePatch')
      .mockResolvedValue({
        changedFiles: [],
        validationResults: [],
        reviewRequired: false,
      });

    spyOn(infra.configService, 'get').mockResolvedValue(createConfig());
    spyOn(orchestrator as object as { initializeClients: AgentRunInternals['initializeClients'] }, 'initializeClients').mockResolvedValue(undefined);
    spyOn(orchestrator as object as { promptForIssue: AgentRunInternals['promptForIssue'] }, 'promptForIssue').mockResolvedValue(issue);
    spyOn(issueRankingService, 'loadRankedIssues').mockResolvedValue([issue]);
    spyOn(memoryService, 'load').mockReturnValue(memory);
    spyOn(workspaceService, 'prepareWorkspace').mockResolvedValue(workspace);
    spyOn(memoryService, 'update').mockReturnValue(memory);
    spyOn(llmService, 'generatePatchDraft').mockResolvedValue({
      version: '1',
      kind: 'patch_draft',
      status: 'needs_review',
      data: patchDraft,
    });
    spyOn(llmService, 'generatePrDraft').mockResolvedValue({
      version: '1',
      kind: 'pull_request_draft',
      status: 'needs_review',
      data: prDraft,
    });
    spyOn(contentService, 'formatPatchDraftMarkdown').mockReturnValue('# Patch');
    spyOn(contentService, 'formatPullRequestDraftMarkdown').mockReturnValue('# PR');
    spyOn(contentService, 'formatContributionDossier').mockReturnValue('# Dossier');
    spyOn(orchestrator as object as { submitContributionPullRequestIfPossible: AgentRunInternals['submitContributionPullRequestIfPossible'] }, 'submitContributionPullRequestIfPossible')
      .mockResolvedValue({
        changedFiles: [],
        validationResults: [],
      });
    spyOn(orchestrator as object as { prepareLocalArtifactPaths: AgentRunInternals['prepareLocalArtifactPaths'] }, 'prepareLocalArtifactPaths').mockReturnValue(createArtifacts());
    spyOn(orchestrator as object as { writeLocalArtifacts: AgentRunInternals['writeLocalArtifacts'] }, 'writeLocalArtifacts').mockImplementation(() => {});
    spyOn(orchestrator as object as { publishArtifactsIfNeeded: AgentRunInternals['publishArtifactsIfNeeded'] }, 'publishArtifactsIfNeeded').mockResolvedValue({
      published: false,
    });
    spyOn(inboxService, 'saveItem').mockReturnValue([createInboxItem()]);
    spyOn(inboxService, 'renderMarkdown').mockReturnValue('# Inbox');
    spyOn(proofOfWorkService, 'load').mockReturnValue({ records: [] });
    spyOn(proofOfWorkService, 'renderMarkdown').mockReturnValue('# Proof');
    spyOn(proofOfWorkService, 'record').mockReturnValue([createProofRecord()]);
    spyOn(memoryService, 'renderMarkdown').mockReturnValue('# Memory');
    const recordOutcomeSpy = spyOn(memoryService, 'recordOutcome').mockReturnValue(memory);
    const showResultSpy = spyOn(orchestrator as object as { showResult: AgentRunInternals['showResult'] }, 'showResult').mockImplementation(() => {});

    await orchestrator.run();

    expect(generateConcretePatchSpy).not.toHaveBeenCalled();
    expect(reviewNoticeSpy).toHaveBeenCalledTimes(2);
    expect(recordOutcomeSpy).toHaveBeenCalledWith(expect.objectContaining({
      published: false,
      reviewRequired: true,
    }));
    expect(showResultSpy).toHaveBeenCalled();
  });
});
