# OpenMeta CLI Development Guide

This document is for contributors working on the OpenMeta CLI codebase.

It is intentionally developer-facing. It should help someone understand how the repository is organized today, how the main agent flow works, which safety constraints matter, how to run tests locally, and what a safe release path looks like.

It does **not** describe the old daily note workflow as the primary product model. The current product is an autonomous, local-first contribution agent with supporting state, artifact, and automation systems.

## 1. Repository Purpose

OpenMeta CLI helps a developer move from open-source opportunity discovery to contribution-ready output.

The current product center is:

1. Discover GitHub issues worth attempting
2. Rank them against a saved user profile
3. Prepare local repository context
4. Draft patch and PR materials
5. Optionally apply constrained file edits
6. Optionally open a real upstream draft PR
7. Persist artifacts, memory, inbox state, and proof-of-work

The project is local-first:

- state lives on disk
- workspaces are cloned locally
- artifacts are written locally before publication
- automation is installed on the host machine with `launchd` or `cron`

## 2. Architecture Map

The codebase follows a layered CLI architecture:

```text
src/
  cli.ts                    -> process entrypoint, command registration
  commands/                 -> thin Commander command definitions
  orchestration/            -> workflow coordinators and user-facing control flow
  services/                 -> domain logic and side-effect integrations
  infra/                    -> config, paths, prompts, logger, UI helpers, crypto
  contracts/                -> structured LLM output schemas
  types/                    -> shared application types
test/                       -> unit and service-level tests
```

### Command layer

Files in `src/commands/` should stay thin. They:

- define CLI flags and help text
- call a single orchestrator entrypoint
- wrap execution with `runCommand(...)`

They should not hold business logic.

### Orchestration layer

Files in `src/orchestration/` coordinate end-to-end flows:

- `agent.ts`
- `init.ts`
- `config.ts`
- `automation.ts`
- `doctor.ts`
- `runs.ts`
- `daily.ts`

Orchestrators should:

- sequence domain operations
- own user confirmations and UX checkpoints
- aggregate outputs for display
- convert lower-level errors into workflow-safe behavior

Orchestrators should avoid accumulating low-level domain logic when that logic can live in a service.

### Service layer

Files in `src/services/` own domain-specific logic and external integrations.

Current major services:

- `github.ts`
  GitHub issue discovery, repository metadata lookup, cache management
- `llm.ts`
  LLM validation, structured prompting, patch drafting, implementation drafting
- `workspace.ts`
  local clone preparation, candidate file ranking, test command detection, generated file application
- `issue-ranking.ts`
  profile-based pre-ranking, local heuristic matching, LLM batch scoring, scout diversification
- `contribution-pr.ts`
  fork synchronization, contribution branch naming, commit creation on fork, draft PR creation
- `git.ts`
  artifact repository write / branch / commit / push operations
- `memory.ts`
  per-repository long-term memory state
- `inbox.ts`
  drafted opportunity inbox state
- `proof-of-work.ts`
  contribution evidence ledger
- `run-history.ts`
  local command execution ledger
- `scheduler.ts`
  `launchd` / `cron` automation sync
- `opportunity.ts`
  issue opportunity scoring from matched issues
- `content.ts`
  dossier, PR draft, patch draft, inbox, and proof-of-work markdown rendering

### Infra layer

Files in `src/infra/` are shared support utilities:

- `config.ts`
- `paths.ts`
- `crypto.ts`
- `prompts.ts`
- `select.ts`
- `logger.ts`
- `ui/`
- `errors.ts`
- `prompt-templates.ts`

These should remain generic infrastructure, not product-specific workflow logic.

### Contracts and types

`src/contracts/agent-contracts.ts` is important. It defines the structured envelopes expected from the LLM:

- issue match lists
- patch drafts
- implementation drafts
- PR drafts

This schema boundary is one of the main guards against unstructured model output drift.

## 3. Current Command Surface

The CLI currently registers the following top-level commands:

- `openmeta init`
- `openmeta agent`
- `openmeta daily`
- `openmeta scout`
- `openmeta inbox`
- `openmeta pow`
- `openmeta config`
- `openmeta automation`
- `openmeta doctor`
- `openmeta runs`

Notes:

- `daily` is a compatibility alias to the agent workflow, not a separate legacy content workflow.
- `agent` is the main product entrypoint.
- `doctor` is the preferred first-stop command for environment diagnostics.

## 4. Agent Workflow Notes

The main agent flow lives in [src/orchestration/agent.ts](/Users/nianjiu/Desktop/openmeta-cli/src/orchestration/agent.ts).

At a high level, the workflow is:

```text
validate config
  -> initialize GitHub and LLM clients
  -> discover and rank issues
  -> select target issue
  -> prepare local workspace
  -> load and update repo memory
  -> generate patch draft
  -> optionally generate/apply concrete file edits
  -> optionally run validation commands
  -> optionally attempt one repair pass
  -> generate PR draft
  -> optionally create a real upstream draft PR
  -> write local artifacts
  -> optionally publish artifacts to target repository
  -> record inbox / proof-of-work / run memory
```

### Ranking path

Issue ranking now has a dedicated service:

- [issue-ranking.ts](/Users/nianjiu/Desktop/openmeta-cli/src/services/issue-ranking.ts)

It is responsible for:

- local pre-ranking against the saved profile
- local heuristic issue matching before batched scoring
- batched LLM issue scoring
- selecting the first issue above the automation threshold
- diversifying scout output across repositories

### PR submission path

Contribution PR creation now has a dedicated service:

- [contribution-pr.ts](/Users/nianjiu/Desktop/openmeta-cli/src/services/contribution-pr.ts)

It is responsible for:

- deriving upstream repository context
- ensuring the authenticated user's fork exists
- syncing the fork with upstream where possible
- building the contribution branch name
- building the contribution commit message
- creating tree / commit / ref objects on the fork
- opening or reusing an upstream draft PR

The orchestrator still owns:

- whether a PR should be attempted
- how validation failures are presented
- how interactive confirmation is collected
- how failures are downgraded into local-only artifact flow

### Workspace path

Workspace preparation happens in:

- [workspace.ts](/Users/nianjiu/Desktop/openmeta-cli/src/services/workspace.ts)

The service:

- clones missing repositories into the OpenMeta workspace root
- fetches origin
- determines the default branch
- avoids automatic patch application in dirty workspaces
- finds candidate files using a path-scoring heuristic plus repo memory
- detects validation commands from project files
- runs a constrained subset of validation commands

### Memory and artifacts

OpenMeta keeps durable state in several forms:

- repo memory
- inbox
- proof-of-work
- run history
- GitHub issue cache
- generated markdown artifacts

That state is part of the product, not an implementation accident. When changing agent behavior, think about what should be remembered across runs.

## 5. Local State and Filesystem Layout

OpenMeta uses two main local roots:

- config root
  default: `~/.config/openmeta`
- home root
  default: `~/.openmeta`

Important paths:

- config file: `~/.config/openmeta/config.json`
- encryption key: `~/.config/openmeta/secret.key`
- logs: `~/.config/openmeta/logs/`
- run history: `~/.config/openmeta/runs.json`
- repo memory: `~/.config/openmeta/repo-memory/`
- inbox state: `~/.config/openmeta/inbox.json`
- proof-of-work state: `~/.config/openmeta/proof-of-work.json`
- GitHub issue cache: `~/.config/openmeta/cache/github-issues.json`
- workspaces: `~/.openmeta/workspaces/`
- artifacts: `~/.openmeta/artifacts/`

Environment overrides:

- `OPENMETA_CONFIG_DIR`
- `OPENMETA_HOME`

These are heavily used in tests and are the safest way to run isolated manual experiments.

## 6. Testing Commands

Primary local commands:

```bash
bun install
bun test
bun run typecheck
bun run build
```

Useful targeted commands:

```bash
bun test test/agent.test.ts
bun test test/issue-ranking.test.ts
bun test test/contribution-pr.test.ts
bun test test/workspace.test.ts
bun run ./src/cli.ts --help
bun run ./src/cli.ts doctor
```

Recommended validation order for non-trivial changes:

1. `bun test`
2. `bun run typecheck`
3. `bun run build`
4. Run one CLI smoke check such as `bun run ./src/cli.ts --help`

For changes affecting prompts, ranking, PR submission, or workspace behavior, prefer both:

- targeted tests for the touched service
- a full `bun test` pass before committing

## 7. Safety Invariants

These rules are core to the current product behavior. Be cautious when changing them.

### Generated patch safety

- OpenMeta must not write generated files outside the repository workspace root.
- OpenMeta must not automatically apply generated edits to a dirty workspace.
- OpenMeta must limit the number of auto-applied files.
- OpenMeta must reject generated edits outside the selected implementation context.
- OpenMeta must treat review-required drafts as a stop signal for automatic file modification.

### Validation safety

- Headless mode skips repository-defined script validation commands.
- Infrastructure failures such as `command not found` are treated differently from true test failures.
- Only a constrained validation subset should run automatically.
- The current repair loop is intentionally limited to a single repair pass.

### Credential and config safety

- GitHub PAT and LLM API keys are stored encrypted.
- The encryption key must never be committed.
- Config normalization should preserve backward-safe defaults.

### Publication safety

- Artifact publication and upstream draft PR creation are separate concerns.
- Failing to create a PR must not block local artifact generation.
- Scheduled headless automation is high-impact and should remain explicit in warnings and docs.

### State integrity

- Repo memory, inbox, proof-of-work, cache, and run history should remain readable after normal command execution.
- When changing stored shapes, think about migration and backward compatibility even if explicit migrations do not yet exist.

## 8. Development Guidelines

### When adding features

- Prefer extending an existing service if the behavior is clearly within that service's domain.
- Extract a new service when logic is reusable, cohesive, and currently bloating an orchestrator.
- Keep command files thin.
- Keep orchestrators focused on flow control, not implementation details.

### When changing prompts or contracts

- Update `src/contracts/agent-contracts.ts` if the structured output shape changes.
- Keep prompt expectations aligned with schema expectations.
- Add or update tests that parse realistic model output.

### When changing stateful services

- Review both read and write paths.
- Confirm markdown renderers still reflect the stored data shape.
- Use isolated environment variables in tests if behavior touches the filesystem.

### When changing automation

- Validate both macOS and Linux assumptions where possible.
- Keep the manual fallback behavior intact for unsupported platforms.
- Be careful with anything that changes what scheduled runs are allowed to do without interaction.

## 9. Architecture Pressure Points

These are the current hotspots contributors should be aware of.

### `src/orchestration/agent.ts`

This remains the largest orchestration file in the repository. It is smaller than before, but still carries substantial flow complexity.

Likely future extraction candidates:

- artifact writing / publication helper
- patch application and repair helper
- target repository management helper
- UI presentation helper for agent stages and summaries

### Config evolution

The config model still contains some legacy-shaped fields related to earlier product directions. Be careful not to deepen those inconsistencies when adding new options.

### Provider compatibility

`llm.ts` uses the OpenAI SDK against multiple providers. Changes here should be made carefully and covered with validation tests.

## 10. Release Process

This repository is currently source-first and `package.json` is still marked `private: true`.

That means the practical release process today is closer to "prepare a safe repository state" than "publish an npm package".

### Before merging a substantial change

Run:

```bash
bun test
bun run typecheck
bun run build
```

Also confirm:

- command help still renders
- changed docs reflect actual behavior
- no credentials or machine-specific files are staged

### If preparing for future packaging work

In addition to the standard checks, inspect:

```bash
npm pack --dry-run --json
```

This helps verify what would be shipped if packaging is enabled later.

### Commit and PR expectations

Good commits in this repo should:

- isolate one conceptual change
- preserve behavior unless intentionally changing it
- include tests when moving logic across boundaries
- explain the refactor target clearly in the commit message

Useful commit examples:

- `refactor(agent): extract issue ranking service`
- `refactor(agent): extract contribution pr service`
- `fix(workspace): skip generated paths outside implementation context`
- `docs(claude): rewrite contributor development guide`

## 11. Contributor Checklist

Before you open a PR, we should be able to say yes to these:

- The change matches the current contribution-agent product model.
- `CLAUDE.md`, `README.md`, and command behavior do not contradict each other.
- New logic lives in an appropriate layer.
- Tests cover the important behavior.
- Full local validation was run.
- No old daily note assumptions were reintroduced.

## 12. Quick Orientation

If you are new to the codebase, start here:

1. Read [README.md](/Users/nianjiu/Desktop/openmeta-cli/README.md) for the current product story.
2. Read [src/cli.ts](/Users/nianjiu/Desktop/openmeta-cli/src/cli.ts) for the command surface.
3. Read [src/orchestration/agent.ts](/Users/nianjiu/Desktop/openmeta-cli/src/orchestration/agent.ts) for the main workflow.
4. Read [src/services/workspace.ts](/Users/nianjiu/Desktop/openmeta-cli/src/services/workspace.ts), [src/services/llm.ts](/Users/nianjiu/Desktop/openmeta-cli/src/services/llm.ts), [src/services/issue-ranking.ts](/Users/nianjiu/Desktop/openmeta-cli/src/services/issue-ranking.ts), and [src/services/contribution-pr.ts](/Users/nianjiu/Desktop/openmeta-cli/src/services/contribution-pr.ts).
5. Run `bun test` before changing behavior.

That path gives a contributor enough context to make informed changes without inheriting outdated product assumptions.
