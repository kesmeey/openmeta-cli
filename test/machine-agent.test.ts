import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import * as infra from '../src/infra/index.js';
import { AgentOrchestrator } from '../src/orchestration/agent.js';
import { AnalyzeOrchestrator } from '../src/orchestration/analyze.js';
import { contentService, issueRankingService, llmService, memoryService, workspaceService } from '../src/services/index.js';
import { createMemory, createPatchDraft, createPullRequestDraft, createRankedIssue, createRepositorySuggestion, createWorkspace } from './helpers/factories.js';

function createConfig() {
  return {
    userProfile: {
      techStack: ['typescript', 'react'],
      proficiency: 'intermediate' as const,
      focusAreas: ['frontend'],
    },
    github: {
      pat: 'ghp_test_token',
      username: 'octocat',
    },
    llm: {
      provider: 'custom' as const,
      apiBaseUrl: 'https://example.com/v1',
      apiKey: 'sk-test',
      modelName: 'test-model',
      apiHeaders: {},
    },
    automation: {
      enabled: true,
      scheduleTime: '09:00',
      timezone: 'UTC',
      contentType: 'research_note' as const,
      scheduler: 'manual' as const,
      minMatchScore: 75,
      skipIfAlreadyGeneratedToday: false,
    },
    commitTemplate: 'feat: {{title}}',
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

describe('machine flow result builders', () => {
  test('machine scout returns ranked opportunities with mode metadata', async () => {
    const config = createConfig();
    const issue = createRankedIssue();
    const orchestrator = new AgentOrchestrator();

    spyOn(infra.configService, 'get').mockResolvedValue(config);
    spyOn(orchestrator as AgentOrchestrator, 'validateConfig' as never).mockResolvedValue(undefined);
    spyOn(orchestrator as AgentOrchestrator, 'initializeClients' as never).mockResolvedValue(undefined);
    spyOn(issueRankingService, 'loadRankedIssues').mockResolvedValue([issue]);

    const result = await orchestrator.scoutMachine({ limit: 5, refresh: true, localOnly: true });

    expect(result.mode.localOnly).toBe(true);
    expect(result.mode.refresh).toBe(true);
    expect(result.opportunities).toEqual([issue]);
  });

  test('machine analyze returns selected suggestion and artifact paths', async () => {
    const config = createConfig();
    const workspace = createWorkspace({
      workspacePath: '/tmp/openmeta-demo',
      branchName: 'openmeta/analyze-acme-demo',
      candidateFiles: ['README.md', 'src/index.ts'],
    });
    const memory = createMemory({ repoFullName: 'acme/demo' });
    const suggestion = createRepositorySuggestion({
      id: 'config-validation',
      title: 'Add config validation tests',
      summary: 'Cover malformed provider config normalization.',
      targetFiles: [{ path: 'src/infra/config.ts', reason: 'Normalization logic' }],
      prPotentialScore: 93,
    });
    const patchDraft = createPatchDraft();
    const prDraft = createPullRequestDraft();
    const orchestrator = new AnalyzeOrchestrator();

    spyOn(infra.configService, 'get').mockResolvedValue(config);
    spyOn(orchestrator as AnalyzeOrchestrator, 'validateConfig' as never).mockResolvedValue(undefined);
    spyOn(orchestrator as AnalyzeOrchestrator, 'initializeClients' as never).mockResolvedValue(undefined);
    spyOn(memoryService, 'load').mockReturnValue(memory);
    spyOn(workspaceService, 'prepareRepositoryWorkspace').mockResolvedValue(workspace);
    spyOn(llmService, 'analyzeRepository').mockResolvedValue({
      version: '1',
      kind: 'repository_suggestion_list',
      status: 'success',
      data: [suggestion],
    });
    spyOn(llmService, 'generatePatchDraft').mockResolvedValue({
      version: '1',
      kind: 'patch_draft',
      status: 'success',
      data: patchDraft,
    });
    spyOn(llmService, 'generatePrDraft').mockResolvedValue({
      version: '1',
      kind: 'pull_request_draft',
      status: 'success',
      data: prDraft,
    });
    spyOn(contentService, 'formatRepositoryAnalysisMarkdown').mockReturnValue('# Repository Analysis');
    spyOn(contentService, 'formatPatchDraftMarkdown').mockReturnValue('# Patch');
    spyOn(contentService, 'formatPullRequestDraftMarkdown').mockReturnValue('# PR');

    const result = await orchestrator.runMachine({ repo: 'acme/demo', dryRun: true, headless: true });

    expect(result.repoFullName).toBe('acme/demo');
    expect(result.selectedSuggestion).toEqual(suggestion);
    expect(result.artifacts.analysisPath).toContain('analysis');
    expect(result.mode.dryRun).toBe(true);
  });
});
