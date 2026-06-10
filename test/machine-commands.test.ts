import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { Command } from 'commander';
import { registerMachineCommand } from '../src/commands/machine.js';
import * as infra from '../src/infra/index.js';
import {
  agentOrchestrator,
  analyzeOrchestrator,
  configOrchestrator,
  providerOrchestrator,
} from '../src/orchestration/index.js';
import {
  contentService,
  githubService,
  issueRankingService,
  llmService,
  memoryService,
  workspaceService,
} from '../src/services/index.js';
import {
  createMemory,
  createPatchDraft,
  createPullRequestDraft,
  createRankedIssue,
  createRepositorySuggestion,
  createWorkspace,
} from './helpers/factories.js';

function captureStdout(): string[] {
  const writes: string[] = [];
  spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    writes.push(String(chunk));
    return true;
  });
  return writes;
}

function captureStderr(): string[] {
  const writes: string[] = [];
  spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    writes.push(String(chunk));
    return true;
  });
  return writes;
}

const DEFAULT_SCORING = {
  weights: {
    freshness: 0.25,
    onboardingClarity: 0.25,
    mergePotential: 0.3,
    impact: 0.2,
    riskPenalty: 0.35,
  },
  overallWeights: {
    technicalMatch: 0.45,
    opportunityScore: 0.55,
  },
  preset: 'balanced',
} as const;

describe('machine commands', () => {
  afterEach(() => {
    mock.restore();
    process.exitCode = 0;
  });

  test('registers machine doctor and config commands', () => {
    const program = new Command();
    registerMachineCommand(program);

    const machineCommand = program.commands.find((command) => command.name() === 'machine');
    const help = machineCommand?.helpInformation() ?? '';
    const analyzeHelp =
      machineCommand?.commands.find((command) => command.name() === 'analyze')?.helpInformation() ?? '';
    const agentHelp = machineCommand?.commands.find((command) => command.name() === 'agent')?.helpInformation() ?? '';

    expect(help).toContain('doctor');
    expect(help).toContain('config');
    expect(help).toContain('provider');
    expect(help).toContain('runs');
    expect(help).toContain('scout');
    expect(help).toContain('analyze');
    expect(help).toContain('agent');
    expect(analyzeHelp).toContain('--repo-path <path>');
    expect(agentHelp).toContain('--repo-path <path>');
    expect(agentHelp).toContain('--local-artifacts-only');
  });

  test('machine doctor writes only JSON to stdout', async () => {
    const writes = captureStdout();
    const program = new Command();
    registerMachineCommand(program);

    spyOn(infra.configService, 'get').mockResolvedValue({
      userProfile: { techStack: [], proficiency: 'beginner', focusAreas: [] },
      github: { pat: '', username: '', targetRepoPath: '' },
      llm: {
        provider: 'openai',
        apiBaseUrl: 'https://api.openai.com/v1',
        apiKey: '',
        modelName: 'gpt-4o-mini',
        apiHeaders: {},
        activeProfile: '',
        profiles: {},
      },
      automation: {
        enabled: false,
        scheduleTime: '09:00',
        timezone: 'UTC',
        contentType: 'research_note',
        scheduler: 'manual',
        minMatchScore: 70,
        skipIfAlreadyGeneratedToday: true,
      },
      scoring: DEFAULT_SCORING,
      commitTemplate: 'feat: {{title}}',
    });

    await program.parseAsync(['machine', 'doctor'], { from: 'user' });

    const output = writes.join('');
    expect(() => JSON.parse(output)).not.toThrow();
    expect(output).not.toContain('OpenMeta Doctor');
  });

  test('machine config get writes a masked JSON snapshot', async () => {
    const writes = captureStdout();
    const program = new Command();
    registerMachineCommand(program);

    spyOn(configOrchestrator, 'getMachineSnapshot').mockResolvedValue({
      userProfile: { techStack: [], proficiency: 'beginner', focusAreas: [] },
      github: { username: 'octocat', pat: '***oken', targetRepoPath: '' },
      llm: {
        provider: 'openai',
        apiBaseUrl: 'https://api.openai.com/v1',
        apiKey: '***-key',
        modelName: 'gpt-4o-mini',
        apiHeaders: {},
        activeProfile: '',
        savedProfiles: [],
      },
      automation: {
        enabled: false,
        scheduleTime: '09:00',
        timezone: 'UTC',
        contentType: 'research_note',
        scheduler: 'manual',
        minMatchScore: 70,
        skipIfAlreadyGeneratedToday: true,
      },
      scoring: DEFAULT_SCORING,
      commitTemplate: 'feat: {{title}}',
    });

    await program.parseAsync(['machine', 'config', 'get'], { from: 'user' });

    const output = JSON.parse(writes.join(''));
    expect(output.command).toBe('machine config get');
    expect(output.data.github.pat).toBe('***oken');
  });

  test('machine config set writes the updated key and masked snapshot', async () => {
    const writes = captureStdout();
    const program = new Command();
    registerMachineCommand(program);

    spyOn(configOrchestrator, 'setMachineValue').mockResolvedValue({
      updatedKey: 'llm.apiKey',
      appliedValue: '***cret',
      snapshot: {
        userProfile: { techStack: [], proficiency: 'beginner', focusAreas: [] },
        github: { username: 'octocat', pat: '***oken', targetRepoPath: '' },
        llm: {
          provider: 'openai',
          apiBaseUrl: 'https://api.openai.com/v1',
          apiKey: '***cret',
          modelName: 'gpt-4o-mini',
          apiHeaders: {},
          activeProfile: '',
          savedProfiles: [],
        },
        automation: {
          enabled: false,
          scheduleTime: '09:00',
          timezone: 'UTC',
          contentType: 'research_note',
          scheduler: 'manual',
          minMatchScore: 70,
          skipIfAlreadyGeneratedToday: true,
        },
        scoring: DEFAULT_SCORING,
        commitTemplate: 'feat: {{title}}',
      },
      scheduler: {
        status: 'unchanged',
        detail: 'Scheduler state unchanged.',
      },
    });

    await program.parseAsync(['machine', 'config', 'set', 'llm.apiKey', 'sk-secret'], { from: 'user' });

    const output = JSON.parse(writes.join(''));
    expect(output.command).toBe('machine config set');
    expect(output.data.updatedKey).toBe('llm.apiKey');
    expect(output.data.appliedValue).toBe('***cret');
  });

  test('machine provider add writes the saved profile result', async () => {
    const writes = captureStdout();
    const program = new Command();
    registerMachineCommand(program);

    spyOn(providerOrchestrator, 'addProfile').mockResolvedValue({
      profileName: 'machine-add',
      activeProfile: '',
      provider: 'custom',
      modelName: 'example-model',
      apiBaseUrl: 'https://example.com/v1',
      apiKey: '***cret',
      apiHeaders: { 'X-Test': 'yes' },
      reasoningEffort: 'medium',
      stream: true,
      validation: 'skipped',
      validationMessage: 'Validation skipped.',
    });

    await program.parseAsync(
      [
        'machine',
        'provider',
        'add',
        'machine-add',
        '--base-url',
        'https://example.com/v1',
        '--model',
        'example-model',
        '--api-key',
        'sk-secret',
        '--header',
        'X-Test=yes',
      ],
      { from: 'user' },
    );

    const output = JSON.parse(writes.join(''));
    expect(output.command).toBe('machine provider add');
    expect(output.data.profileName).toBe('machine-add');
    expect(output.data.apiKey).toBe('***cret');
  });

  test('machine scout writes ranked opportunities as JSON only', async () => {
    const writes = captureStdout();
    const program = new Command();
    registerMachineCommand(program);
    const issue = createRankedIssue();

    spyOn(agentOrchestrator, 'scoutMachine').mockResolvedValue({
      opportunities: [issue],
      mode: {
        limit: 10,
        refresh: false,
        repo: undefined,
        localOnly: true,
      },
      nextActions: ['inspect_ranked_opportunities'],
    });

    await program.parseAsync(['machine', 'scout', '--local'], { from: 'user' });

    const output = JSON.parse(writes.join(''));
    expect(output.command).toBe('machine scout');
    expect(output.data.opportunities[0].repoFullName).toBe(issue.repoFullName);
  });

  test('machine analyze writes repository analysis output as JSON only', async () => {
    const writes = captureStdout();
    const stderrWrites = captureStderr();
    const program = new Command();
    registerMachineCommand(program);
    const suggestion = createRepositorySuggestion();
    const patchDraft = createPatchDraft();
    const prDraft = createPullRequestDraft();
    const workspace = createWorkspace({
      workspacePath: '/tmp/openmeta-demo',
      branchName: 'openmeta/analyze-acme-demo',
    });

    spyOn(infra.configService, 'get').mockResolvedValue({
      userProfile: { techStack: ['typescript'], proficiency: 'intermediate', focusAreas: ['tooling'] },
      github: { pat: 'ghp_test_token', username: 'octocat', targetRepoPath: '' },
      llm: {
        provider: 'custom',
        apiBaseUrl: 'https://example.com/v1',
        apiKey: 'sk-test',
        modelName: 'test-model',
        apiHeaders: {},
      },
      automation: {
        enabled: false,
        scheduleTime: '09:00',
        timezone: 'UTC',
        contentType: 'research_note',
        scheduler: 'manual',
        minMatchScore: 70,
        skipIfAlreadyGeneratedToday: true,
      },
      scoring: DEFAULT_SCORING,
      commitTemplate: 'feat: {{title}}',
    });
    spyOn(
      analyzeOrchestrator as unknown as { validateConfig(config: unknown): Promise<void> },
      'validateConfig',
    ).mockResolvedValue(undefined);
    spyOn(
      analyzeOrchestrator as unknown as { initializeClients(config: unknown): Promise<void> },
      'initializeClients',
    ).mockResolvedValue(undefined);
    spyOn(memoryService, 'load').mockReturnValue(createMemory({ repoFullName: 'acme/demo' }));
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

    await program.parseAsync(
      [
        'machine',
        'analyze',
        '--repo',
        'acme/demo',
        '--repo-path',
        '/Users/example/src/demo',
        '--headless',
        '--dry-run',
      ],
      { from: 'user' },
    );

    const output = JSON.parse(writes.join(''));
    expect(output.command).toBe('machine analyze');
    expect(output.data.repoFullName).toBe('acme/demo');
    expect(output.data.mode.dryRun).toBe(true);
    expect(stderrWrites.join('')).toContain('Machine execution plan for machine analyze');
    expect(stderrWrites.join('')).toContain('Prepare repository workspace');
    expect(stderrWrites.join('')).toContain('Inspecting repository for grounded contribution ideas');
  });

  test('machine agent writes execution outcome as JSON only', async () => {
    const writes = captureStdout();
    const stderrWrites = captureStderr();
    const program = new Command();
    registerMachineCommand(program);
    const issue = createRankedIssue({ repoFullName: 'acme/demo', number: 42 });
    const patchDraft = createPatchDraft();
    const prDraft = createPullRequestDraft();
    const workspace = createWorkspace({
      workspacePath: '/tmp/openmeta-demo',
      branchName: 'openmeta/42-accessibility',
      testResults: [],
    });

    spyOn(agentOrchestrator, 'runMachine').mockResolvedValue({
      issue,
      workspace,
      patchDraft,
      prDraft,
      artifacts: {
        artifactDir: '/tmp/openmeta/artifacts',
        dossierPath: '/tmp/openmeta/artifacts/dossier.md',
        patchDraftPath: '/tmp/openmeta/artifacts/patch-draft.md',
        prDraftPath: '/tmp/openmeta/artifacts/pr-draft.md',
        memoryPath: '/tmp/openmeta/artifacts/repo-memory.md',
        inboxPath: '/tmp/openmeta/artifacts/inbox.md',
        proofOfWorkPath: '/tmp/openmeta/artifacts/proof-of-work.md',
      },
      changedFiles: [],
      validationResults: [],
      reviewRequired: false,
      published: false,
      prCreated: false,
      repoMutated: false,
      artifactsWritten: false,
      executionOutcome: 'draft_only',
      executionPolicy: {
        headless: true,
        draftOnly: true,
        localArtifactsOnly: false,
        runChecks: false,
        dryRun: true,
        refresh: false,
      },
      skipReasons: ['draft_only'],
      nextActions: ['inspect_artifact_paths'],
      pullRequestUrl: undefined,
      pullRequestNumber: undefined,
    });

    await program.parseAsync(
      ['machine', 'agent', '--issue', 'https://github.com/acme/demo/issues/42', '--draft-only', '--dry-run'],
      { from: 'user' },
    );

    const output = JSON.parse(writes.join(''));
    expect(output.command).toBe('machine agent');
    expect(output.data.executionOutcome).toBe('draft_only');
    expect(output.data.repoMutated).toBe(false);
    expect(stderrWrites.join('')).toContain('Machine execution plan for machine agent');
    expect(stderrWrites.join('')).toContain('Draft patch and PR artifacts without mutating the repository');
  });

  test('machine agent forwards local-artifacts-only to the orchestrator', async () => {
    const program = new Command();
    registerMachineCommand(program);

    const runSpy = spyOn(agentOrchestrator, 'runMachine').mockResolvedValue({
      issue: createRankedIssue({ repoFullName: 'acme/demo', number: 42 }),
      workspace: createWorkspace({
        workspacePath: '/tmp/openmeta-demo',
        branchName: 'openmeta/42-accessibility',
        testResults: [],
      }),
      patchDraft: createPatchDraft(),
      prDraft: createPullRequestDraft(),
      artifacts: {
        artifactDir: '/tmp/openmeta/artifacts',
        dossierPath: '/tmp/openmeta/artifacts/dossier.md',
        patchDraftPath: '/tmp/openmeta/artifacts/patch-draft.md',
        prDraftPath: '/tmp/openmeta/artifacts/pr-draft.md',
        memoryPath: '/tmp/openmeta/artifacts/repo-memory.md',
        inboxPath: '/tmp/openmeta/artifacts/inbox.md',
        proofOfWorkPath: '/tmp/openmeta/artifacts/proof-of-work.md',
      },
      changedFiles: [],
      validationResults: [],
      reviewRequired: false,
      published: false,
      prCreated: false,
      repoMutated: false,
      artifactsWritten: true,
      executionOutcome: 'local_artifacts_written',
      executionPolicy: {
        headless: true,
        draftOnly: true,
        localArtifactsOnly: true,
        runChecks: false,
        dryRun: false,
        refresh: false,
      },
      skipReasons: ['draft_only', 'publish_skipped_local_artifacts_only'],
      nextActions: ['inspect_artifact_paths'],
      pullRequestUrl: undefined,
      pullRequestNumber: undefined,
    });

    await program.parseAsync(
      [
        'machine',
        'agent',
        '--issue',
        'https://github.com/acme/demo/issues/42',
        '--draft-only',
        '--local-artifacts-only',
      ],
      { from: 'user' },
    );

    expect(runSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        draftOnly: true,
        localArtifactsOnly: true,
      }),
    );
  });

  test('machine scout suppresses human task output during real machine execution', async () => {
    const writes = captureStdout();
    const program = new Command();
    registerMachineCommand(program);

    spyOn(infra.configService, 'get').mockResolvedValue({
      userProfile: { techStack: ['typescript'], proficiency: 'intermediate', focusAreas: ['cli'] },
      github: { pat: 'ghp_test_token', username: 'octocat', targetRepoPath: '' },
      llm: {
        provider: 'custom',
        apiBaseUrl: 'https://example.com/v1',
        apiKey: 'sk-test',
        modelName: 'test-model',
        apiHeaders: {},
        activeProfile: '',
        profiles: {},
      },
      automation: {
        enabled: false,
        scheduleTime: '09:00',
        timezone: 'UTC',
        contentType: 'research_note',
        scheduler: 'manual',
        minMatchScore: 70,
        skipIfAlreadyGeneratedToday: true,
      },
      scoring: DEFAULT_SCORING,
      commitTemplate: 'feat: {{title}}',
    });
    spyOn(githubService, 'validateCredentials').mockResolvedValue(true);
    spyOn(issueRankingService, 'loadRankedIssues').mockResolvedValue([]);

    await program.parseAsync(['machine', 'scout', '--local'], { from: 'user' });

    const output = writes.join('');
    expect(() => JSON.parse(output)).not.toThrow();
    expect(output).not.toContain('Validating GitHub access');
    expect(output).not.toContain('[success]');
  });
});
