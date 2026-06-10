# OpenMeta Machine Interface And Skill Bundle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a stable `openmeta machine` automation surface and a package-shipped skill bundle system that lets Claude Code and OpenClaw drive OpenMeta through structured JSON instead of scraping human UI.

**Architecture:** Keep existing human commands intact and introduce a thin machine runtime plus machine-specific orchestrators that call shared result-building methods extracted from existing orchestrators. Add a separate skill bundle pipeline that renders host bundles from one canonical OpenMeta skill definition, then verify the published package includes both runtime and skill assets.

**Tech Stack:** Bun, Commander, TypeScript, existing OpenMeta orchestrators/services, JSON serialization, local filesystem packaging.

---

### Task 1: Machine Type Contracts And Runtime

**Files:**
- Create: `src/orchestration/machine/types.ts`
- Create: `src/orchestration/machine/errors.ts`
- Create: `src/orchestration/machine/runtime.ts`
- Create: `src/orchestration/machine/index.ts`
- Modify: `src/orchestration/index.ts`
- Test: `test/machine-runtime.test.ts`

- [ ] **Step 1: Write the failing runtime contract tests**

```ts
import { describe, expect, test } from 'bun:test';
import { buildMachineEnvelope, buildMachineErrorEnvelope, mapMachineError } from '../src/orchestration/machine/index.js';

describe('machine runtime', () => {
  test('builds a success envelope with command, version, timestamp, and data', () => {
    const envelope = buildMachineEnvelope('machine doctor', { ready: true });

    expect(envelope.version).toBe(1);
    expect(envelope.command).toBe('machine doctor');
    expect(envelope.timestamp).toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(envelope.data).toEqual({ ready: true });
  });

  test('maps invalid argument failures to exit code 2 and INVALID_ARGUMENT', () => {
    const mapped = mapMachineError('machine config set', new Error('llm.stream must be a boolean value.'));

    expect(mapped.exitCode).toBe(2);
    expect(mapped.payload.error.code).toBe('INVALID_ARGUMENT');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/machine-runtime.test.ts`
Expected: FAIL because `src/orchestration/machine/index.ts` does not exist yet

- [ ] **Step 3: Write minimal machine runtime implementation**

```ts
// src/orchestration/machine/types.ts
export type MachineErrorCode =
  | 'INVALID_ARGUMENT'
  | 'CONFIG_MISSING'
  | 'CONFIG_INVALID'
  | 'GITHUB_AUTH_FAILED'
  | 'LLM_AUTH_FAILED'
  | 'REPO_PREP_FAILED'
  | 'VALIDATION_FAILED'
  | 'DIRTY_WORKSPACE'
  | 'PR_CREATION_SKIPPED'
  | 'PR_CREATION_FAILED'
  | 'SKILL_HOST_UNSUPPORTED'
  | 'SKILL_INSTALL_FAILED'
  | 'INTERNAL_ERROR';

export interface MachineEnvelope<T> {
  version: 1;
  command: string;
  timestamp: string;
  data: T;
}

export interface MachineErrorEnvelope {
  version: 1;
  command: string;
  timestamp: string;
  error: {
    code: MachineErrorCode;
    message: string;
    details?: unknown;
  };
}
```

```ts
// src/orchestration/machine/runtime.ts
import { getErrorMessage } from '../../infra/index.js';
import type { MachineEnvelope, MachineErrorCode, MachineErrorEnvelope } from './types.js';

function now(): string {
  return new Date().toISOString();
}

export function buildMachineEnvelope<T>(command: string, data: T): MachineEnvelope<T> {
  return {
    version: 1,
    command,
    timestamp: now(),
    data,
  };
}

export function buildMachineErrorEnvelope(
  command: string,
  code: MachineErrorCode,
  message: string,
  details?: unknown,
): MachineErrorEnvelope {
  return {
    version: 1,
    command,
    timestamp: now(),
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
    },
  };
}

export function mapMachineError(command: string, error: unknown): { exitCode: number; payload: MachineErrorEnvelope } {
  const message = getErrorMessage(error);

  if (/must be|is required|does not exist|unknown configuration key|requires --repo|not found/i.test(message)) {
    return {
      exitCode: 2,
      payload: buildMachineErrorEnvelope(command, 'INVALID_ARGUMENT', message),
    };
  }

  if (/configuration is incomplete|run "openmeta init"|missing github|missing llm/i.test(message)) {
    return {
      exitCode: 3,
      payload: buildMachineErrorEnvelope(command, 'CONFIG_MISSING', message),
    };
  }

  if (/validation failed|access failed|connection failed/i.test(message)) {
    return {
      exitCode: 4,
      payload: buildMachineErrorEnvelope(command, 'VALIDATION_FAILED', message),
    };
  }

  return {
    exitCode: 5,
    payload: buildMachineErrorEnvelope(command, 'INTERNAL_ERROR', message),
  };
}
```

```ts
// src/orchestration/machine/index.ts
export * from './types.js';
export * from './runtime.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/machine-runtime.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add test/machine-runtime.test.ts src/orchestration/machine/types.ts src/orchestration/machine/errors.ts src/orchestration/machine/runtime.ts src/orchestration/machine/index.ts src/orchestration/index.ts
git commit -m "feat: add machine runtime primitives"
```

### Task 2: Shared Config Snapshot And Provider Result Builders

**Files:**
- Modify: `src/orchestration/config.ts`
- Modify: `src/orchestration/provider.ts`
- Modify: `src/infra/index.ts`
- Test: `test/config-orchestrator.test.ts`
- Test: `test/provider-orchestrator.test.ts`

- [ ] **Step 1: Write failing tests for machine-safe config and provider results**

```ts
test('returns a masked machine config snapshot', async () => {
  const snapshot = await new ConfigOrchestrator().getMachineSnapshot();

  expect(snapshot.github.pat).toBe('***oken');
  expect(snapshot.llm.apiKey).toBe('***-key');
  expect(snapshot.llm.modelName).toBeDefined();
});

test('returns provider result data when switching profiles', async () => {
  const orchestrator = new ProviderOrchestrator();
  await orchestrator.add('machine-profile', {
    provider: 'custom',
    baseUrl: 'https://example.com/v1',
    model: 'example-model',
    apiKey: 'sk-machine-secret',
  });

  const result = await orchestrator.useProfile('machine-profile');

  expect(result.profileName).toBe('machine-profile');
  expect(result.activeProfile).toBe('machine-profile');
  expect(result.apiKey).toBe('***cret');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/config-orchestrator.test.ts test/provider-orchestrator.test.ts`
Expected: FAIL because `getMachineSnapshot()` and `useProfile()` do not exist yet

- [ ] **Step 3: Implement extracted result builders**

```ts
// src/orchestration/config.ts
async getMachineSnapshot(): Promise<{
  userProfile: AppConfig['userProfile'];
  github: { username: string; pat: string; targetRepoPath?: string };
  llm: {
    provider: AppConfig['llm']['provider'];
    apiBaseUrl: string;
    apiKey: string;
    modelName: string;
    apiHeaders: Record<string, string>;
    reasoningEffort?: AppConfig['llm']['reasoningEffort'];
    stream?: boolean;
    activeProfile?: string;
    savedProfiles: string[];
  };
  automation: AppConfig['automation'];
  commitTemplate: string;
}> {
  const config = await configService.get();
  return {
    userProfile: config.userProfile,
    github: {
      username: config.github.username,
      pat: ui.maskSecret(config.github.pat),
      targetRepoPath: config.github.targetRepoPath,
    },
    llm: {
      provider: config.llm.provider,
      apiBaseUrl: config.llm.apiBaseUrl,
      apiKey: ui.maskSecret(config.llm.apiKey),
      modelName: config.llm.modelName,
      apiHeaders: config.llm.apiHeaders ?? {},
      reasoningEffort: config.llm.reasoningEffort,
      stream: config.llm.stream,
      activeProfile: config.llm.activeProfile,
      savedProfiles: Object.keys(config.llm.profiles ?? {}).sort(),
    },
    automation: config.automation,
    commitTemplate: config.commitTemplate,
  };
}
```

```ts
// src/orchestration/provider.ts
async useProfile(nameInput: string, options: ProviderUseOptions = {}): Promise<{
  profileName: string;
  activeProfile: string;
  provider: LLMProvider;
  modelName: string;
  apiBaseUrl: string;
  apiKey: string;
  apiHeaders: Record<string, string>;
  reasoningEffort?: LLMReasoningEffort;
  stream?: boolean;
  validation: 'skipped' | 'passed' | 'failed';
  validationMessage: string;
}> {
  const name = this.normalizeProfileName(nameInput);
  const config = await configService.get();
  const profile = config.llm.profiles?.[name];
  if (!profile) {
    throw new Error(`Provider profile "${name}" does not exist. Run "openmeta provider list" to see saved profiles.`);
  }

  const updated = await configService.update({
    llm: {
      ...config.llm,
      ...profile,
      apiHeaders: profile.apiHeaders ?? config.llm.apiHeaders ?? {},
      reasoningEffort: profile.reasoningEffort ?? DEFAULT_LLM_REASONING_EFFORT,
      stream: profile.stream === true,
      activeProfile: name,
      profiles: config.llm.profiles ?? {},
    },
  });

  let validation: 'skipped' | 'passed' | 'failed' = 'skipped';
  let validationMessage = 'Validation skipped.';
  if (options.validate) {
    const valid = await this.validateProfile(profile);
    validation = valid ? 'passed' : 'failed';
    validationMessage = valid
      ? 'Provider validation succeeded.'
      : `Provider validation failed: ${llmService.getLastValidationError() || 'unknown reason'}`;
  }

  return {
    profileName: name,
    activeProfile: updated.llm.activeProfile || '',
    provider: updated.llm.provider,
    modelName: updated.llm.modelName,
    apiBaseUrl: updated.llm.apiBaseUrl,
    apiKey: ui.maskSecret(updated.llm.apiKey),
    apiHeaders: updated.llm.apiHeaders ?? {},
    reasoningEffort: updated.llm.reasoningEffort,
    stream: updated.llm.stream,
    validation,
    validationMessage,
  };
}
```

- [ ] **Step 4: Update existing UI methods to call the extracted helpers**

Run the existing `set()` / `use()` methods through the new helpers so human and machine paths share behavior.

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test test/config-orchestrator.test.ts test/provider-orchestrator.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/orchestration/config.ts src/orchestration/provider.ts src/infra/index.ts test/config-orchestrator.test.ts test/provider-orchestrator.test.ts
git commit -m "feat: extract machine-safe config and provider results"
```

### Task 3: Machine Doctor, Config, Provider, And Runs Commands

**Files:**
- Create: `src/commands/machine.ts`
- Create: `src/orchestration/machine/doctor.ts`
- Create: `src/orchestration/machine/config.ts`
- Create: `src/orchestration/machine/provider.ts`
- Create: `src/orchestration/machine/runs.ts`
- Modify: `src/commands/index.ts`
- Modify: `src/cli.ts`
- Test: `test/machine-commands.test.ts`

- [ ] **Step 1: Write failing command tests for the first machine surface**

```ts
import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { Command } from 'commander';
import { registerMachineCommand } from '../src/commands/machine.js';
import * as infra from '../src/infra/index.js';

function captureWrites() {
  const writes: string[] = [];
  const spy = spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    writes.push(String(chunk));
    return true;
  });
  return { writes, spy };
}

describe('machine commands', () => {
  afterEach(() => {
    mock.restore();
    process.exitCode = 0;
  });

  test('registers machine doctor and config commands', () => {
    const program = new Command();
    registerMachineCommand(program);

    const machine = program.commands.find((command) => command.name() === 'machine');
    const help = machine?.helpInformation() ?? '';

    expect(help).toContain('doctor');
    expect(help).toContain('config');
    expect(help).toContain('provider');
    expect(help).toContain('runs');
  });

  test('machine doctor writes only JSON to stdout', async () => {
    const { writes } = captureWrites();
    const program = new Command();
    registerMachineCommand(program);
    spyOn(infra.configService, 'get').mockResolvedValue({
      userProfile: { techStack: [], proficiency: 'beginner', focusAreas: [] },
      github: { pat: '', username: '', targetRepoPath: '' },
      llm: { provider: 'openai', apiBaseUrl: 'https://api.openai.com/v1', apiKey: '', modelName: 'gpt-4o-mini', apiHeaders: {}, profiles: {}, activeProfile: '' },
      automation: { enabled: false, scheduleTime: '09:00', timezone: 'UTC', contentType: 'research_note', scheduler: 'manual', minMatchScore: 70, skipIfAlreadyGeneratedToday: true },
      commitTemplate: 'feat: {{title}}',
    });

    await program.parseAsync(['node', 'openmeta', 'machine', 'doctor'], { from: 'user' });

    const output = writes.join('');
    expect(() => JSON.parse(output)).not.toThrow();
    expect(output).not.toContain('OpenMeta Doctor');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/machine-commands.test.ts`
Expected: FAIL because `registerMachineCommand` and machine orchestrators do not exist yet

- [ ] **Step 3: Implement the first machine command family**

```ts
// src/commands/machine.ts
import { Command } from 'commander';
import {
  machineConfigOrchestrator,
  machineDoctorOrchestrator,
  machineProviderOrchestrator,
  machineRunsOrchestrator,
} from '../orchestration/machine/index.js';

export function registerMachineCommand(program: Command): void {
  const machine = program.command('machine').description('Stable JSON-first automation surface');

  machine
    .command('doctor')
    .description('Inspect local prerequisites and return machine-readable diagnostics')
    .action(() => machineDoctorOrchestrator.execute());

  const config = machine.command('config').description('Machine-safe configuration access');
  config.command('get').action(() => machineConfigOrchestrator.get());
  config.command('set <key> <value>').action((key: string, value: string) => machineConfigOrchestrator.set(key, value));

  const provider = machine.command('provider').description('Machine-safe provider profile management');
  provider
    .command('add <name>')
    .requiredOption('--base-url <url>')
    .requiredOption('--model <model>')
    .requiredOption('--api-key <key>')
    .option('--provider <provider>')
    .option('--reasoning-effort <effort>')
    .option('--stream <enabled>')
    .option('--header <key=value>', '', (value, previous: string[] = []) => [...previous, value], [])
    .action((name, options) => machineProviderOrchestrator.add(name, options));
  provider.command('use <name>').action((name: string) => machineProviderOrchestrator.use(name));

  machine
    .command('runs [id]')
    .option('--limit <count>', 'Number of runs to show', '10')
    .action((id: string | undefined, options: { limit?: string }) => machineRunsOrchestrator.show(id, options));
}
```

- [ ] **Step 4: Wire the runtime through JSON-only stdout**

Each machine orchestrator should:

```ts
const payload = buildMachineEnvelope('machine config get', await configOrchestrator.getMachineSnapshot());
process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
```

and on errors:

```ts
const mapped = mapMachineError('machine config get', error);
process.stdout.write(`${JSON.stringify(mapped.payload, null, 2)}\n`);
process.exitCode = mapped.exitCode;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test test/machine-runtime.test.ts test/machine-commands.test.ts test/config-orchestrator.test.ts test/provider-orchestrator.test.ts test/doctor.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/commands/machine.ts src/commands/index.ts src/cli.ts src/orchestration/machine/doctor.ts src/orchestration/machine/config.ts src/orchestration/machine/provider.ts src/orchestration/machine/runs.ts test/machine-runtime.test.ts test/machine-commands.test.ts test/config-orchestrator.test.ts test/provider-orchestrator.test.ts test/doctor.test.ts
git commit -m "feat: add machine doctor config provider and runs commands"
```

### Task 4: Machine Runs, Inbox, And Proof-Of-Work Result Surfaces

**Files:**
- Modify: `src/orchestration/runs.ts`
- Modify: `src/orchestration/agent.ts`
- Create: `src/orchestration/machine/inbox.ts`
- Create: `src/orchestration/machine/pow.ts`
- Modify: `src/commands/machine.ts`
- Test: `test/machine-state-commands.test.ts`

- [ ] **Step 1: Write failing tests for machine runs, inbox, and pow payloads**

```ts
import { describe, expect, test } from 'bun:test';
import { AgentOrchestrator } from '../src/orchestration/agent.js';
import { RunsOrchestrator } from '../src/orchestration/runs.js';

describe('machine state result builders', () => {
  test('returns run history list data with totals', async () => {
    const result = await new RunsOrchestrator().listMachine({ limit: 10 });
    expect(result.records).toBeArray();
    expect(result.totals).toBeDefined();
  });

  test('returns inbox items ordered by score', async () => {
    const result = await new AgentOrchestrator().getInboxMachineResult();
    expect(result.items).toBeArray();
  });

  test('returns proof-of-work records with publication metadata', async () => {
    const result = await new AgentOrchestrator().getProofOfWorkMachineResult();
    expect(result.records).toBeArray();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/machine-state-commands.test.ts`
Expected: FAIL because machine result methods do not exist yet

- [ ] **Step 3: Implement extracted result builders**

```ts
// src/orchestration/runs.ts
async listMachine(options: RunsListOptions = {}) {
  const limit = Math.max(1, options.limit ?? 10);
  const state = runHistoryService.load();
  const records = state.records.slice(0, limit);
  const totals = state.records.reduce<Record<AgentRunStatus, number>>((acc, record) => {
    acc[record.status] += 1;
    return acc;
  }, { running: 0, success: 0, failed: 0, cancelled: 0 });
  return { records, totals, ledgerPath: runHistoryService.getPath() };
}
```

```ts
// src/orchestration/agent.ts
async getInboxMachineResult() {
  const items = [...inboxService.load().items].sort((left, right) => right.overallScore - left.overallScore);
  return {
    items,
    inboxPath: inboxService.getPath(),
    nextActions: items.length === 0 ? ['run_machine_scout'] : ['inspect_artifact_paths'],
  };
}

async getProofOfWorkMachineResult() {
  const records = [...proofOfWorkService.load().records];
  return {
    records,
    proofOfWorkPath: proofOfWorkService.getPath(),
    nextActions: records.length === 0 ? ['run_machine_agent'] : ['inspect_recent_publications'],
  };
}
```

- [ ] **Step 4: Expose the machine commands**

Add `machine inbox` and `machine pow` commands that wrap the new result builders in `MachineEnvelope`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test test/machine-state-commands.test.ts test/agent-run.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/orchestration/runs.ts src/orchestration/agent.ts src/orchestration/machine/inbox.ts src/orchestration/machine/pow.ts src/commands/machine.ts test/machine-state-commands.test.ts test/agent-run.test.ts
git commit -m "feat: add machine inbox pow and run state surfaces"
```

### Task 5: Machine Scout, Analyze, And Agent Result Builders

**Files:**
- Modify: `src/orchestration/agent.ts`
- Modify: `src/orchestration/analyze.ts`
- Create: `src/orchestration/machine/scout.ts`
- Create: `src/orchestration/machine/analyze.ts`
- Create: `src/orchestration/machine/agent.ts`
- Modify: `src/commands/machine.ts`
- Test: `test/machine-agent.test.ts`
- Test: `test/agent-run.test.ts`
- Test: `test/analyze-command.test.ts`

- [ ] **Step 1: Write failing machine flow tests**

```ts
test('machine scout returns ranked opportunities with mode metadata', async () => {
  const result = await new AgentOrchestrator().scoutMachine({ limit: 5, refresh: true });
  expect(result.mode.refresh).toBe(true);
  expect(result.opportunities).toBeArray();
});

test('machine analyze returns selected suggestion and artifact paths', async () => {
  const result = await new AnalyzeOrchestrator().runMachine({ repo: 'acme/demo', dryRun: true, headless: true });
  expect(result.repoFullName).toBe('acme/demo');
  expect(result.artifacts.analysisPath).toContain('analysis');
});

test('machine agent draft-only flow returns explicit execution flags', async () => {
  const result = await new AgentOrchestrator().runMachine({ issue: 'https://github.com/acme/demo/issues/42', draftOnly: true, dryRun: true });
  expect(result.executionOutcome).toBe('draft_only');
  expect(result.repoMutated).toBe(false);
  expect(result.prCreated).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/machine-agent.test.ts test/agent-run.test.ts test/analyze-command.test.ts`
Expected: FAIL because `scoutMachine()`, `runMachine()`, and machine flow wrappers do not exist yet

- [ ] **Step 3: Extract reusable scout result building**

Implement `AgentOrchestrator.scoutMachine(options)` so it reuses `issueRankingService.loadRankedIssues(...)` and returns:

```ts
{
  opportunities: RankedIssue[];
  mode: {
    limit: number;
    refresh: boolean;
    repo?: string;
  };
  nextActions: string[];
}
```

- [ ] **Step 4: Extract reusable analyze result building**

Implement `AnalyzeOrchestrator.runMachine(options)` so it reuses the same workspace preparation, LLM generation, suggestion selection, and artifact path logic as the human path, but returns a typed result object instead of rendering cards.

- [ ] **Step 5: Extract reusable agent result building**

Implement `AgentOrchestrator.runMachine(options)` by reusing the current run path and returning:

```ts
{
  issue: RankedIssue;
  workspace: RepoWorkspaceContext;
  artifacts: ContributionAgentResult['artifacts'];
  changedFiles: string[];
  validationResults: TestResult[];
  reviewRequired: boolean;
  published: boolean;
  prCreated: boolean;
  repoMutated: boolean;
  executionOutcome: 'draft_only' | 'local_artifacts_written' | 'changes_applied' | 'pr_opened' | 'blocked';
  executionPolicy: {
    headless: boolean;
    draftOnly: boolean;
    runChecks: boolean;
    dryRun: boolean;
    refresh: boolean;
  };
  skipReasons: string[];
  nextActions: string[];
}
```

- [ ] **Step 6: Register the machine flow commands**

Add `machine scout`, `machine analyze`, and `machine agent` to `src/commands/machine.ts` and serialize their results through `MachineEnvelope`.

- [ ] **Step 7: Run tests to verify they pass**

Run: `bun test test/machine-agent.test.ts test/agent-run.test.ts test/analyze-command.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/orchestration/agent.ts src/orchestration/analyze.ts src/orchestration/machine/scout.ts src/orchestration/machine/analyze.ts src/orchestration/machine/agent.ts src/commands/machine.ts test/machine-agent.test.ts test/agent-run.test.ts test/analyze-command.test.ts
git commit -m "feat: add machine scout analyze and agent flows"
```

### Task 6: Skill Bundle Assets, Export, Install, And Doctor

**Files:**
- Create: `skills/core/openmeta.md`
- Create: `skills/schema/capability-catalog.json`
- Create: `skills/templates/claude-code/`
- Create: `skills/templates/openclaw/`
- Create: `skills/examples/`
- Create: `src/commands/skill.ts`
- Create: `src/orchestration/skill/index.ts`
- Create: `src/orchestration/skill/catalog.ts`
- Create: `src/orchestration/skill/renderer.ts`
- Create: `src/orchestration/skill/installer.ts`
- Create: `src/orchestration/skill/doctor.ts`
- Modify: `src/commands/index.ts`
- Modify: `src/cli.ts`
- Modify: `src/orchestration/index.ts`
- Test: `test/skill-bundle.test.ts`

- [ ] **Step 1: Write failing skill bundle tests**

```ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { renderSkillBundle, getSupportedSkillHosts } from '../src/orchestration/skill/index.js';

let tempRoot = '';

describe('skill bundle rendering', () => {
  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'openmeta-skill-bundle-'));
  });

  afterEach(() => {
    if (tempRoot) {
      rmSync(tempRoot, { recursive: true, force: true });
      tempRoot = '';
    }
  });

  test('renders claude-code and openclaw bundles from one canonical spec', async () => {
    expect(getSupportedSkillHosts()).toEqual(['claude-code', 'openclaw']);

    const claude = await renderSkillBundle('claude-code', tempRoot);
    const openclaw = await renderSkillBundle('openclaw', tempRoot);

    expect(readFileSync(claude.files[0]!, 'utf-8')).toContain('openmeta machine doctor');
    expect(readFileSync(openclaw.files[0]!, 'utf-8')).toContain('openmeta machine doctor');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/skill-bundle.test.ts`
Expected: FAIL because `src/orchestration/skill/index.ts` and `skills/**` do not exist yet

- [ ] **Step 3: Add the canonical skill asset tree**

Create:

```text
skills/core/openmeta.md
skills/schema/capability-catalog.json
skills/templates/claude-code/skill.md
skills/templates/openclaw/skill.md
skills/examples/claude-code.md
skills/examples/openclaw.md
```

The canonical skill must instruct agents to use:

```text
openmeta machine doctor
openmeta machine config set
openmeta machine provider add
openmeta machine provider use
openmeta machine scout
openmeta machine analyze
openmeta machine agent
```

- [ ] **Step 4: Implement skill rendering and install/doctor logic**

Implement:

```ts
export function getSupportedSkillHosts(): Array<'claude-code' | 'openclaw'> {
  return ['claude-code', 'openclaw'];
}
```

```ts
export async function renderSkillBundle(host: 'claude-code' | 'openclaw', outputDir: string): Promise<{ host: string; files: string[] }> {
  // read canonical skill + capability catalog + host template
  // write rendered files into outputDir/host
}
```

Implement `skill list`, `skill export`, `skill install`, and `skill doctor` on top of these functions.

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test test/skill-bundle.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add skills src/commands/skill.ts src/orchestration/skill src/commands/index.ts src/cli.ts src/orchestration/index.ts test/skill-bundle.test.ts
git commit -m "feat: add host-generated skill bundle commands"
```

### Task 7: Package Publishing Surface And Final Verification

**Files:**
- Modify: `package.json`
- Test: `test/skill-bundle.test.ts`

- [ ] **Step 1: Write a failing package file assertion test**

```ts
import { describe, expect, test } from 'bun:test';
import packageJson from '../package.json';

describe('package files', () => {
  test('publishes skill assets with the CLI binary', () => {
    expect(packageJson.files).toContain('bin/openmeta.js');
    expect(packageJson.files).toContain('skills');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/skill-bundle.test.ts`
Expected: FAIL because `package.json` does not yet include `skills`

- [ ] **Step 3: Update package publishing files**

```json
{
  "files": [
    "bin/openmeta.js",
    "README.md",
    "package.json",
    "skills"
  ]
}
```

- [ ] **Step 4: Run targeted verification**

Run: `bun test test/machine-runtime.test.ts test/machine-commands.test.ts test/machine-state-commands.test.ts test/machine-agent.test.ts test/skill-bundle.test.ts`
Expected: PASS

- [ ] **Step 5: Run full verification**

Run: `bun test`
Expected: PASS

Run: `bun run typecheck`
Expected: PASS

Run: `bun run build`
Expected: PASS

Run: `npm pack --dry-run --json`
Expected: PASS and output includes `bin/openmeta.js` plus the `skills/` asset tree

- [ ] **Step 6: Commit**

```bash
git add package.json test/skill-bundle.test.ts
git commit -m "chore: publish machine and skill bundle assets"
```
