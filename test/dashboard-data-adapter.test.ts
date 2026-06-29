import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { DashboardData } from '../src/dashboard/data-adapter.ts';

const tempRoots: string[] = [];

function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'openmeta-dashboard-data-'));
  tempRoots.push(root);
  return root;
}

async function loadAdapter() {
  const modulePath = `../src/dashboard/data-adapter.ts?ts=${Date.now()}-${Math.random()}`;
  const mod = await import(modulePath);
  return mod as { buildDashboardData: () => DashboardData };
}

describe('dashboard data adapter', () => {
  afterEach(() => {
    delete process.env['OPENMETA_CONFIG_DIR'];
    delete process.env['OPENMETA_HOME'];

    while (tempRoots.length > 0) {
      const root = tempRoots.pop();
      if (root) {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  test('does not promote placeholder artifact markdown into proof or inbox state', async () => {
    const root = createTempRoot();
    const configDir = join(root, '.config', 'openmeta');
    const artifactDir = join(root, '.openmeta', 'artifacts', '2026-06-09', 'acme__demo__44');

    mkdirSync(configDir, { recursive: true });
    mkdirSync(artifactDir, { recursive: true });

    writeFileSync(join(configDir, 'runs.json'), JSON.stringify({ records: [] }, null, 2), 'utf-8');
    writeFileSync(join(artifactDir, 'dossier.md'), '# Dossier', 'utf-8');
    writeFileSync(join(artifactDir, 'patch-draft.md'), '# Patch', 'utf-8');
    writeFileSync(join(artifactDir, 'pr-draft.md'), '# PR', 'utf-8');
    writeFileSync(join(artifactDir, 'proof-of-work.md'), '# Proof', 'utf-8');
    writeFileSync(join(artifactDir, 'inbox.md'), '# Inbox', 'utf-8');
    writeFileSync(join(artifactDir, 'repo-memory.md'), '# Memory', 'utf-8');

    process.env['OPENMETA_CONFIG_DIR'] = configDir;
    process.env['OPENMETA_HOME'] = join(root, '.openmeta');

    const { buildDashboardData } = await loadAdapter();
    const data = buildDashboardData();

    expect(data.summary.sourceBreakdown.proof).toBe(0);
    expect(data.summary.sourceBreakdown.memory).toBe(0);
    expect(data.summary.sourceBreakdown.inbox).toBe(0);
    expect(data.summary.sourceBreakdown.artifact).toBe(1);
    expect(data.topMeta.find((item: { label: string }) => item.label === 'State Sources')?.value).toBe('artifacts');
  });

  test('surfaces attempt detail, project conversion, and archive quality fields from real state', async () => {
    const root = createTempRoot();
    const configDir = join(root, '.config', 'openmeta');
    const homeDir = join(root, '.openmeta');
    const memoryDir = join(configDir, 'repo-memory');
    const artifactDir = join(homeDir, 'artifacts', '2026-06-09', 'acme__demo__42');

    mkdirSync(configDir, { recursive: true });
    mkdirSync(memoryDir, { recursive: true });
    mkdirSync(artifactDir, { recursive: true });

    writeFileSync(
      join(configDir, 'proof-of-work.json'),
      JSON.stringify(
        {
          records: [
            {
              id: 'proof-1',
              repoFullName: 'acme/demo',
              issueNumber: 42,
              issueTitle: 'Add accessible labels to icon buttons',
              overallScore: 84,
              opportunityScore: 84,
              branchName: 'openmeta/42-accessibility',
              artifactDir,
              generatedAt: '2026-06-09T08:00:00.000Z',
              published: true,
              pullRequestUrl: 'https://github.com/acme/demo/pull/123',
              pullRequestNumber: 123,
            },
          ],
        },
        null,
        2,
      ),
      'utf-8',
    );
    writeFileSync(join(configDir, 'runs.json'), JSON.stringify({ records: [] }, null, 2), 'utf-8');
    writeFileSync(
      join(memoryDir, 'acme__demo.json'),
      JSON.stringify(
        {
          repoFullName: 'acme/demo',
          firstSeenAt: '2026-06-01T00:00:00.000Z',
          lastUpdatedAt: '2026-06-09T08:00:00.000Z',
          lastSelectedIssue: 'acme/demo#42',
          workspacePath: '/tmp/openmeta-demo',
          lastBranchName: 'openmeta/42-accessibility',
          detectedTestCommands: ['bun test'],
          preferredPaths: ['src/components/IconButton.tsx'],
          generatedDossiers: 2,
          runStats: {
            totalRuns: 2,
            publishedRuns: 1,
            realPrRuns: 1,
            reviewRequiredRuns: 0,
            successfulValidationRuns: 1,
            failedValidationRuns: 0,
          },
          pathSignals: [],
          validationSignals: [],
          recentIssues: [
            {
              reference: 'acme/demo#42',
              title: 'Add accessible labels to icon buttons',
              overallScore: 84,
              generatedAt: '2026-06-09T08:00:00.000Z',
              status: 'published',
              changedFiles: ['src/components/IconButton.tsx', 'src/components/IconButton.test.tsx'],
              published: true,
              reviewRequired: false,
              validationSummary: 'bun test=passed',
              pullRequestUrl: 'https://github.com/acme/demo/pull/123',
            },
          ],
        },
        null,
        2,
      ),
      'utf-8',
    );

    writeFileSync(join(artifactDir, 'dossier.md'), '# Dossier\n- Summary: accessibility trail', 'utf-8');
    writeFileSync(join(artifactDir, 'patch-draft.md'), '# Patch', 'utf-8');
    writeFileSync(join(artifactDir, 'pr-draft.md'), '# PR', 'utf-8');
    writeFileSync(join(artifactDir, 'repo-memory.md'), '# Memory', 'utf-8');

    process.env['OPENMETA_CONFIG_DIR'] = configDir;
    process.env['OPENMETA_HOME'] = homeDir;

    const { buildDashboardData } = await loadAdapter();
    const data = buildDashboardData();

    expect(data.attempts[0]?.reference).toBe('acme/demo#42');
    expect(data.attempts[0]?.branchName).toBe('openmeta/42-accessibility');
    expect(data.attempts[0]?.changedFilesCount).toBe(2);
    expect(data.attempts[0]?.changedFilePreview).toEqual([
      'src/components/IconButton.tsx',
      'src/components/IconButton.test.tsx',
    ]);
    expect(data.attempts[0]?.workType).toBe('tests');
    expect(data.attempts[0]?.validationState).toBe('passed');
    expect(data.attempts[0]?.assetCompletenessLabel).toBe('4/4 assets');
    expect(data.attempts[0]?.highLeverage).toBe(true);

    expect(data.projects[0]?.attemptToPublishedRate).toBe(100);
    expect(data.projects[0]?.attemptToPrRate).toBe(100);
    expect(data.projects[0]?.attemptToMergedRate).toBe(0);
    expect(data.projects[0]?.lastSuccessfulLandingAt).toBe('2026-06-09');
    expect(data.projects[0]?.reopenableAttemptCount).toBe(0);
    expect(data.projects[0]?.stalePublishedWithoutPrCount).toBe(0);
    expect(data.projects[0]?.returnSessions).toBe(1);
    expect(data.projects[0]?.dominantWorkType).toBe('tests');
    expect(data.projects[0]?.topAreas).toEqual(['src/components']);
    expect(data.projects[0]?.highLeverageAttemptCount).toBe(1);
    expect(data.projects[0]?.blockageNote).toContain('0 published waiting PR');

    expect(data.summary.highLeverageAttemptTotal).toBe(1);
    expect(data.summary.dominantWorkType).toBe('tests');
    expect(data.summary.topAreas).toEqual(['src/components']);

    expect(data.archive[0]?.assetCompletenessLabel).toBe('4/4 assets');
    expect(data.archive[0]?.reuseLabel).toBe('context compounding');
    expect(data.archive[0]?.followThroughLabel).toBe('converted into PR');
  });

  test('keeps artifact and proof derived issue numbers available to the dashboard surface', async () => {
    const root = createTempRoot();
    const configDir = join(root, '.config', 'openmeta');
    const homeDir = join(root, '.openmeta');
    const artifactDir = join(homeDir, 'artifacts', '2026-06-10', 'expo__expo__42885');

    mkdirSync(configDir, { recursive: true });
    mkdirSync(artifactDir, { recursive: true });

    writeFileSync(
      join(configDir, 'proof-of-work.json'),
      JSON.stringify(
        {
          records: [
            {
              id: 'proof-42885',
              repoFullName: 'expo/expo',
              issueNumber: 42885,
              issueTitle: 'Update deprecated ExoPlayer changelog URL to AndroidX Media',
              overallScore: 83,
              opportunityScore: 83,
              artifactDir,
              generatedAt: '2026-06-10T11:02:54.926Z',
              published: false,
            },
          ],
        },
        null,
        2,
      ),
      'utf-8',
    );
    writeFileSync(join(configDir, 'runs.json'), JSON.stringify({ records: [] }, null, 2), 'utf-8');
    writeFileSync(join(artifactDir, 'dossier.md'), '# Dossier', 'utf-8');
    writeFileSync(join(artifactDir, 'patch-draft.md'), '# Patch', 'utf-8');
    writeFileSync(join(artifactDir, 'pr-draft.md'), '# PR', 'utf-8');
    writeFileSync(join(artifactDir, 'repo-memory.md'), '# Memory', 'utf-8');

    process.env['OPENMETA_CONFIG_DIR'] = configDir;
    process.env['OPENMETA_HOME'] = homeDir;

    const { buildDashboardData } = await loadAdapter();
    const data = buildDashboardData();

    expect(data.attempts[0]?.repoFullName).toBe('expo/expo');
    expect(data.attempts[0]?.issueNumber).toBe(42885);
    expect(data.attempts[0]?.reference).toBe('expo/expo#42885');
    expect(data.projects[0]?.representativeIssueNumber).toBe(42885);
    expect(data.projects[0]?.representativeTitle).toBe('Update deprecated ExoPlayer changelog URL to AndroidX Media');
    expect(data.projects[0]?.note).toContain('1 reopenable');
  });

  test('falls back to repo issue label when proof-backed attempts are missing a title', async () => {
    const root = createTempRoot();
    const configDir = join(root, '.config', 'openmeta');
    const homeDir = join(root, '.openmeta');
    const artifactDir = join(homeDir, 'artifacts', '2026-06-10', 'expo__expo__42885');

    mkdirSync(configDir, { recursive: true });
    mkdirSync(artifactDir, { recursive: true });

    writeFileSync(
      join(configDir, 'proof-of-work.json'),
      JSON.stringify(
        {
          records: [
            {
              id: 'proof-42885',
              repoFullName: 'expo/expo',
              issueNumber: 42885,
              overallScore: 83,
              opportunityScore: 83,
              artifactDir,
              generatedAt: '2026-06-10T11:02:54.926Z',
              published: false,
            },
          ],
        },
        null,
        2,
      ),
      'utf-8',
    );
    writeFileSync(join(configDir, 'runs.json'), JSON.stringify({ records: [] }, null, 2), 'utf-8');
    writeFileSync(join(artifactDir, 'dossier.md'), '# Dossier', 'utf-8');
    writeFileSync(join(artifactDir, 'patch-draft.md'), '# Patch', 'utf-8');
    writeFileSync(join(artifactDir, 'pr-draft.md'), '# PR', 'utf-8');
    writeFileSync(join(artifactDir, 'repo-memory.md'), '# Memory', 'utf-8');

    process.env['OPENMETA_CONFIG_DIR'] = configDir;
    process.env['OPENMETA_HOME'] = homeDir;

    const { buildDashboardData } = await loadAdapter();
    const data = buildDashboardData();

    expect(data.projects[0]?.representativeIssueNumber).toBe(42885);
    expect(data.projects[0]?.representativeTitle).toBe('expo/expo#42885');
  });
});
