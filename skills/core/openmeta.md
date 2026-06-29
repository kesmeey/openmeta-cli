# OpenMeta Machine Skill

Use OpenMeta through machine-readable commands rather than scraping human CLI output.

## Purpose

This skill lets an external agent treat OpenMeta as a stable execution substrate.

- Prefer `openmeta machine ...` over human-first commands.
- Read JSON envelopes from stdout.
- Treat stderr as optional diagnostics only.
- Escalate to `openmeta machine agent` only when the user explicitly asks for execution.

## What OpenMeta Can Do

OpenMeta is built for contribution-oriented open source work.

- Discover and rank worthwhile issues across one repository or a broader issue stream.
- Analyze a repository and draft a grounded patch plan plus PR narrative before writing code.
- Execute a fuller contribution flow when the user explicitly wants OpenMeta to mutate files or open a PR.
- Inspect prior runs, saved opportunity backlog, and proof-of-work records to understand what already happened.

## Installation Expectations

- Install the OpenMeta CLI and ensure `openmeta` is on `PATH`.
- Install this skill bundle with `openmeta skill install --host <host>` when automatic host placement is supported.
- Validate host wiring with `openmeta skill doctor --host <host>`.
- If automatic install is unavailable, export with `openmeta skill export --host <host> --output <dir>` and place the generated `skill.md` into the host's skill directory manually.

## Host Paths

- Claude Code default install path: `~/.claude/skills/openmeta`
- Codex default personal install path: `~/.agents/skills/openmeta`
- OpenClaw default install path: `~/.openclaw/skills/openmeta`

## Non-Negotiable Rules

1. Start with `openmeta machine doctor`.
2. Never scrape prose from human-first OpenMeta commands.
3. Parse JSON from stdout only.
4. Assume secrets are masked in returned snapshots.
5. Do not run `openmeta machine agent` unless the user explicitly wants OpenMeta to execute work.
6. When `reviewRequired` is true, do not claim the task is complete.
7. When `executionOutcome` is `blocked`, surface `skipReasons`, `validationResults`, and `nextActions`.
8. Treat `dry-run` and `draft-only` as planning or preview modes, not completion modes.

## Recommended Workflow

1. Run `openmeta machine doctor`.
2. If `ready` is false, use `openmeta machine config set` and `openmeta machine provider add/use` until doctor is healthy.
3. Run `openmeta machine scout` to discover ranked contribution opportunities.
4. Run `openmeta machine analyze --repo <repository>` when the user wants repository-first analysis before choosing an issue.
5. Run `openmeta machine agent` only for explicit execution requests.
6. Use `openmeta machine runs`, `openmeta machine inbox`, and `openmeta machine pow` to inspect persisted state and prior outcomes.

## Bootstrap Commands

### Health and Configuration

- `openmeta machine doctor`
- `openmeta machine config get`
- `openmeta machine config set <key> <value>`
- `openmeta machine provider add <name> --base-url <url> --model <model> --api-key <key> [--provider <provider>] [--reasoning-effort <effort>] [--stream <true|false>] [--header key=value]`
- `openmeta machine provider use <name>`

### Discovery and Execution

- `openmeta machine scout [--limit <count>] [--refresh] [--repo <owner/name>]`
- `openmeta machine analyze --repo <owner/name|url> [--headless] [--run-checks] [--dry-run]`
- `openmeta machine agent [--headless] [--run-checks] [--draft-only] [--refresh] [--repo <owner/name>] [--issue <number|url>] [--dry-run]`

### State Inspection

- `openmeta machine runs [id] [--limit <count>]`
- `openmeta machine inbox`
- `openmeta machine pow`

## Config Keys For `machine config set`

Accepted keys:

- `userProfile.techStack` with comma-separated values
- `userProfile.proficiency` with `beginner`, `intermediate`, or `advanced`
- `userProfile.focusAreas` with comma-separated values
- `github.username`
- `github.pat`
- `github.targetRepoPath`
- `llm.provider`
- `llm.apiBaseUrl`
- `llm.apiKey`
- `llm.modelName`
- `llm.reasoningEffort`
- `llm.stream`
- `automation.enabled`
- `automation.scheduleTime`
- `automation.contentType`
- `automation.minMatchScore`
- `automation.skipIfAlreadyGeneratedToday`
- `commitTemplate`

Important value formats:

- Boolean fields accept `true|false`, `yes|no`, `1|0`, or `on|off`.
- `automation.scheduleTime` must use `HH:mm`.
- `automation.contentType` must be `research_note` or `development_diary`.
- `automation.minMatchScore` must be an integer from `0` to `100`.
- `llm.reasoningEffort` must match the installed OpenMeta reasoning effort enum.

## Result Interpretation

### Standard Envelope

Successful machine commands write:

```json
{
  "version": 1,
  "command": "machine scout",
  "timestamp": "2026-06-08T12:34:56.000Z",
  "data": {}
}
```

Failed machine commands write:

```json
{
  "version": 1,
  "command": "machine scout",
  "timestamp": "2026-06-08T12:34:56.000Z",
  "error": {
    "code": "CONFIG_MISSING",
    "message": "..."
  }
}
```

### High-Value Fields

- `nextActions`: follow-up actions the host agent should surface or perform
- `reviewRequired`: generated output needs human review before claiming success
- `validationResults`: baseline or repair check outcomes
- `artifactPaths` or command-specific artifact fields: local files produced by OpenMeta
- `pullRequestUrl` and PR metadata: downstream publication state
- `executionOutcome`: canonical outcome for `machine agent`

### `machine agent` Outcomes

- `draft_only`: drafts were generated but repository files were not changed
- `local_artifacts_written`: local artifact files were written without mutating the target repo
- `changes_applied`: repository files changed locally but no PR was opened
- `pr_opened`: repository changes were applied and a draft PR was opened
- `blocked`: OpenMeta could not safely continue

Execution guidance:

- `repoMutated: true` means the repository working tree changed.
- `prCreated: true` means a real PR exists and should be surfaced back to the user.
- `published: true` means artifact publication succeeded.
- `artifactsWritten: true` means dossier, drafts, inbox, or proof-of-work files were updated.

## Command-Specific Guidance

### `machine doctor`

Use this to decide whether the host can proceed.

Look for:

- `ready`
- `configPath`
- `homePath`
- `nextActions`

If `ready` is false, stop and remediate before scout, analyze, or agent.

### `machine config get`

Use this when you need a masked snapshot of current machine state.

Look for:

- saved provider profiles
- active provider profile
- automation policy
- masked GitHub and LLM secrets

### `machine provider add` and `machine provider use`

Use these to manage named LLM backends.

Look for:

- `profileName`
- `activeProfile`
- `provider`
- `modelName`
- `apiBaseUrl`
- `validation`
- `validationMessage`

### `machine scout`

Use this for opportunity discovery across repositories or inside one repository.

Look for:

- `opportunities`
- per-item `repoFullName`, `issueNumber`, `issueUrl`, `overallScore`, and scoring breakdown
- mode flags such as `refresh` and `repo`

### `machine analyze`

Use this when the user wants repository-first planning before selecting a concrete issue.

Look for:

- `repoFullName`
- `selectedSuggestion`
- `suggestions`
- `patchDraft`
- `prDraft`
- `workspace`
- analysis artifact paths
- mode flags `headless`, `runChecks`, `dryRun`

### `machine agent`

Use this only for explicit execution requests.

Look for:

- selected issue identity
- `executionOutcome`
- `reviewRequired`
- `changedFiles`
- `validationResults`
- `pullRequestUrl`
- artifact paths
- `skipReasons`

Safety rules:

- Prefer `--dry-run` when the user wants a preview.
- Prefer `--draft-only` when the user wants artifacts without repository mutation.
- Use `--headless` only when unattended execution is explicitly desired.

### `machine runs`

Use this to inspect prior runs or a specific run record.

Look for:

- run identifiers
- command names
- started and finished timestamps
- exit codes
- ledger path

### `machine inbox`

Use this to inspect saved opportunity backlog.

Look for:

- sorted opportunity items
- score ordering
- inbox storage path

### `machine pow`

Use this to inspect proof-of-work records and publication history.

Look for:

- proof records
- `published`
- artifact paths
- PR links

## Error Handling

Treat these machine error codes as stable:

- `INVALID_ARGUMENT`: command syntax or option value is wrong
- `CONFIG_MISSING`: required config is absent
- `CONFIG_INVALID`: config exists but fails validation rules
- `GITHUB_AUTH_FAILED`: GitHub credentials failed verification
- `LLM_AUTH_FAILED`: LLM provider credentials failed verification
- `REPO_PREP_FAILED`: target repository or workspace preparation failed
- `VALIDATION_FAILED`: execution checks failed
- `DIRTY_WORKSPACE`: workspace was not safe to mutate
- `PR_CREATION_SKIPPED`: PR creation was intentionally skipped
- `PR_CREATION_FAILED`: PR creation was attempted but failed
- `SKILL_HOST_UNSUPPORTED`: requested host is not supported
- `SKILL_INSTALL_FAILED`: skill bundle install failed
- `INTERNAL_ERROR`: unexpected failure

Exit code guidance:

- `0`: success
- `2`: invalid input
- `3`: missing prerequisites or incomplete config
- `4`: external validation or dependency failure
- `5`: execution failed after work started

## Recovery Playbook

- On `CONFIG_MISSING`, run `machine doctor`, then patch config with `machine config set`, then retry.
- On provider setup failures, save a named provider with `machine provider add`, switch with `machine provider use`, then rerun doctor.
- On `VALIDATION_FAILED`, inspect `validationResults` and avoid claiming success.
- On `DIRTY_WORKSPACE`, ask for a clean working tree before rerunning mutation flows.
- On `PR_CREATION_FAILED`, report local artifacts and changed files; a successful draft generation is not the same as a published PR.

## Reporting Back To The User

Always surface:

- what command ran
- whether execution was preview-only, draft-only, local-write, or PR-opening
- any validation failures
- any artifact paths the user may need
- any PR URL that was created
- any `nextActions` or `skipReasons`
