# OpenMeta Machine Interface And Universal Skill Bundle Design

## Goal

Make OpenMeta usable as a real execution substrate for external coding agents by adding:

1. a stable JSON-first `openmeta machine ...` command surface
2. a package-included, host-agnostic skill bundle system
3. generated host bundles for Claude Code and OpenClaw
4. packaging and verification that prove the machine surface and skill assets ship together

The product goal for v1 is not "some JSON flags exist." The goal is that an agent can install `openmeta-cli`, bootstrap configuration through machine commands, inspect structured results without scraping prose, and drive real OpenMeta workflows from discovery through draft or execution.

## Non-Goals

- Do not turn the existing human-first commands into the stable automation API.
- Do not add `openmeta machine init` in v1.
- Do not embed host-specific business logic into core contribution services.
- Do not require MCP for first-class agent integration.
- Do not rewrite the whole orchestration layer around a new application framework.

## Chosen Approach

Use a thin machine layer plus an independent skill bundle system.

- Existing human commands stay human-first and keep their current UI behavior.
- New `machine` commands become the only stability-promised automation surface.
- Machine commands call result-building methods that reuse existing orchestration and service logic, then serialize through a shared JSON runtime.
- Skill bundles are generated from one canonical OpenMeta skill spec plus a capability catalog, with thin host renderers for Claude Code and OpenClaw.

This approach is preferred over:

- retrofitting current human commands with ad hoc `--json` flags, which would leak unstable UI-era semantics into the external API
- large orchestrator rewrites, which would increase risk across already-working flows

## Command Surface

### Machine Commands

Add:

```bash
openmeta machine doctor
openmeta machine config get
openmeta machine config set <key> <value>
openmeta machine provider add <name> --base-url <url> --model <model> --api-key <key>
openmeta machine provider use <name>
openmeta machine scout [--limit <count>] [--refresh] [--repo <repository>]
openmeta machine analyze --repo <repository> [--headless] [--run-checks] [--dry-run]
openmeta machine agent [--headless] [--run-checks] [--draft-only] [--refresh] [--repo <repository>] [--issue <issue>] [--dry-run]
openmeta machine runs [id]
openmeta machine inbox
openmeta machine pow
```

### Skill Commands

Add:

```bash
openmeta skill list
openmeta skill export --host <claude-code|openclaw> --output <dir>
openmeta skill install --host <claude-code|openclaw>
openmeta skill doctor --host <claude-code|openclaw>
```

Behavior:

- `skill list` shows supported hosts, whether a local install target can be discovered, and the canonical asset source path in the package
- `skill export` writes generated host files into the requested directory and reports the created paths
- `skill install` writes into a discovered host path when that path can be resolved safely; otherwise it returns explicit manual placement instructions plus an exported bundle path
- `skill doctor` verifies that the generated host bundle exists, points to `openmeta machine` commands, and that the `openmeta` binary is available on PATH

## Machine Runtime Contract

Every successful machine command writes JSON only to stdout:

```ts
type MachineEnvelope<T> = {
  version: 1;
  command: string;
  timestamp: string;
  data: T;
};
```

Every failed machine command writes JSON only to stdout and uses stderr only for optional human diagnostics:

```ts
type MachineErrorEnvelope = {
  version: 1;
  command: string;
  timestamp: string;
  error: {
    code: MachineErrorCode;
    message: string;
    details?: unknown;
  };
};
```

### Exit Codes

- `0`: success
- `2`: invalid input or schema error
- `3`: missing prerequisites or incomplete configuration
- `4`: external dependency failure
- `5`: execution failure after work started

### Machine Error Codes

At minimum:

- `INVALID_ARGUMENT`
- `CONFIG_MISSING`
- `CONFIG_INVALID`
- `GITHUB_AUTH_FAILED`
- `LLM_AUTH_FAILED`
- `REPO_PREP_FAILED`
- `VALIDATION_FAILED`
- `DIRTY_WORKSPACE`
- `PR_CREATION_SKIPPED`
- `PR_CREATION_FAILED`
- `SKILL_HOST_UNSUPPORTED`
- `SKILL_INSTALL_FAILED`
- `INTERNAL_ERROR`

## Machine Payload Families

Add versioned outward-facing machine types that are separate from current LLM contracts:

- `MachineDoctorReport`
- `MachineConfigSnapshot`
- `MachineProviderResult`
- `MachineScoutResult`
- `MachineAnalyzeResult`
- `MachineAgentResult`
- `MachineRunsResult`
- `MachineRunRecordResult`
- `MachineInboxResult`
- `MachineProofOfWorkResult`

These types should wrap current domain data in stable external names rather than exposing raw internal types unchanged.

### Shared Payload Rules

Where relevant, payloads must include:

- stable identifiers
- normalized repository and issue references
- artifact paths
- workspace paths
- validation commands and results
- changed files
- PR URLs and numbers
- `reviewRequired`
- `published`
- `nextActions: string[]`

### `machine doctor`

Return the existing doctor report plus:

- `ready`
- `configPath`
- `homePath`
- `nextActions`

### `machine config get`

Return a masked configuration snapshot:

- GitHub username and masked token
- LLM provider, base URL, model, masked API key, headers summary, active profile
- automation settings
- user profile

### `machine config set`

Return:

- `updatedKey`
- `appliedValue`
- updated masked snapshot
- scheduler sync summary where applicable

### `machine provider add` and `machine provider use`

Return:

- profile name
- active profile
- provider
- model
- base URL
- masked API key
- headers summary
- validation status if requested later

### `machine scout`

Return a stable ranked opportunity list:

- `opportunities[]`
- per-item repo, issue number, issue URL, score, summary, breakdown
- invocation mode metadata such as `refresh` and `repo`

### `machine analyze`

Return:

- repository identity
- selected suggestion
- suggestion list summary
- patch draft
- PR draft
- workspace summary
- artifact paths
- mode metadata: `headless`, `runChecks`, `dryRun`

### `machine agent`

Return one payload shape for both dry and write flows, with explicit outcome fields:

- `executionOutcome`: `draft_only | local_artifacts_written | changes_applied | pr_opened | blocked`
- `artifactsWritten: boolean`
- `repoMutated: boolean`
- `prCreated: boolean`
- `reviewRequired: boolean`
- `published: boolean`
- `executionPolicy`
- `skipReasons[]`

The payload must still include the selected issue, patch draft summary, validation results, changed files, artifact paths, and PR metadata when present.

### `machine runs`

Return either:

- a list envelope with run records and totals
- or a single run record envelope when `id` is provided

### `machine inbox` and `machine pow`

Return stable list payloads with the current stored items and their key identifiers and artifact paths.

## Architecture

### Command Layer

Add thin command registration files:

- `src/commands/machine.ts`
- `src/commands/skill.ts`

Update:

- `src/commands/index.ts`
- `src/cli.ts`

These files should only define flags and dispatch into orchestrators.

### Machine Orchestration Layer

Add:

```text
src/orchestration/machine/
  index.ts
  runtime.ts
  errors.ts
  types.ts
  doctor.ts
  config.ts
  provider.ts
  scout.ts
  analyze.ts
  agent.ts
  runs.ts
  inbox.ts
  pow.ts
```

Responsibilities:

- convert thrown errors into machine envelopes and exit codes
- guarantee JSON-only stdout
- call shared result-building methods
- never render through `ui.*`

### Shared Result Building

Refactor by extraction, not rewrite.

Keep current human orchestrators as the UX layer, but extract machine-safe result methods from:

- `DoctorOrchestrator.inspect()`
- `ConfigOrchestrator`
- `ProviderOrchestrator`
- `AgentOrchestrator`
- `AnalyzeOrchestrator`
- `RunsOrchestrator`

Target shape:

- human methods keep calling domain services and rendering through `ui.*`
- machine methods call the same domain paths but return typed result objects

Priority extraction targets:

1. `doctor`: already close to reusable
2. `runs`: current JSON path can be normalized into machine envelopes
3. `config` and `provider`: need non-UI result-returning methods
4. `analyze` and `agent`: need the most work because result building and UI are currently interleaved
5. `inbox` and `pow`: likely thin wrappers around current stored state

### Skill Bundle Layer

Add:

```text
src/orchestration/skill/
  index.ts
  catalog.ts
  renderer.ts
  installer.ts
  doctor.ts
```

Responsibilities:

- load the canonical OpenMeta skill definition
- render host-specific bundles
- export bundles into arbitrary directories
- install bundles into discovered host paths when safe
- diagnose missing bundles, missing binary access, and unsupported hosts

## Skill Bundle Assets

Ship a new package asset tree:

```text
skills/
  core/
  schema/
  templates/
    claude-code/
    openclaw/
  examples/
```

The CLI runtime must resolve these assets from the installed package location rather than from the repository root, so generated bundle commands continue to work after `npm i -g openmeta-cli`.

### Canonical Skill Content

Maintain one host-agnostic OpenMeta skill spec that teaches agents to:

1. run `openmeta machine doctor` first
2. use `openmeta machine config set` and `openmeta machine provider add/use` to resolve bootstrap gaps
3. use `openmeta machine scout` for issue discovery
4. use `openmeta machine analyze` when repository-first analysis is needed
5. use `openmeta machine agent` only when the user explicitly asks for execution
6. parse JSON payloads rather than prose
7. surface artifact paths, validation failures, and PR links back to the user

### Capability Catalog

Define a small machine-readable catalog that lists:

- supported commands
- required arguments
- outcome expectations
- dangerous execution notes for `machine agent`

### Host Adapters

Host-specific templates may vary in:

- file names
- metadata wrappers
- command invocation examples
- installation target paths

They must not vary in:

- workflow logic
- domain behavior
- contribution strategy

## Packaging

Update `package.json` `files` so published tarballs include:

- `bin/openmeta.js`
- `README.md`
- `package.json`
- `skills/**`

If runtime-loaded schemas or templates live outside the bundled binary, include any required runtime assets as published package files too.

## File and Type Changes

Expected touched areas:

- `src/cli.ts`
- `src/commands/index.ts`
- `src/commands/machine.ts`
- `src/commands/skill.ts`
- `src/orchestration/index.ts`
- `src/orchestration/machine/**`
- `src/orchestration/skill/**`
- existing orchestrators for extracted result methods
- `src/types/**` for machine-facing types
- `package.json`

The current `src/contracts/agent-contracts.ts` remains the LLM boundary. Machine payloads are a separate external API and should not be mixed into the LLM contract file.

## Testing

### Machine Command Tests

Add focused tests for:

- `machine doctor` success and missing-config failure
- `machine config get`
- `machine config set`
- `machine provider add`
- `machine provider use`
- `machine scout`
- `machine analyze --repo owner/name`
- `machine agent --draft-only`
- `machine runs`
- `machine inbox`
- `machine pow`

### Failure-Path Tests

Cover:

- invalid repo or issue input
- missing GitHub config
- missing LLM config
- GitHub credential failure
- LLM validation failure
- repository preparation failure
- dirty workspace restrictions
- blocked PR creation due to validation or review-required state
- unsupported skill host

### Skill Bundle Tests

Add tests that verify:

- one canonical skill spec renders both Claude Code and OpenClaw bundles
- generated host bundles reference `openmeta machine` commands only
- installer and doctor behavior are correct when host paths are present, absent, or unsupported

### Packaging Verification

Before completion, verify:

```bash
npm pack --dry-run --json
```

and assert the package includes:

- the CLI binary
- skill assets
- any required templates, schemas, and examples

### Standard Verification

Before implementation completion:

```bash
bun test
bun run typecheck
bun run build
```

## Rollout Notes

Implementation should be staged in this order:

1. machine runtime, types, and doctor/config/provider/runs surfaces
2. scout/analyze/agent result extraction and machine commands
3. inbox/pow surfaces
4. skill rendering, export, install, and doctor
5. packaging verification and end-to-end tests

This order gets a working machine contract online early while keeping the full v1 goal intact.
