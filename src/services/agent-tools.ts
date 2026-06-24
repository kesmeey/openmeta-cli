import { z } from 'zod';
import { type PullRequestDraft, PullRequestDraftSchema } from '../contracts/index.js';
import type {
  AgentTool,
  GeneratedChangeApplyResult,
  GeneratedFileChange,
  RankedIssue,
  TestCommand,
  TestResult,
} from '../types/index.js';
import { type ContributionPrSubmissionResult, contributionPrService } from './contribution-pr.js';
import { type FileWriteRequest, type GitPublishResult, gitService } from './git.js';
import { permissionPolicyService } from './permission-policy.js';
import { type ToolExecutorService, toolExecutorService } from './tool-executor.js';
import { workspaceService } from './workspace.js';

const GeneratedFileChangeSchema = z.object({
  path: z.string().min(1),
  reason: z.string(),
  content: z.string(),
});
const GeneratedChangeApplyResultSchema = z.object({
  appliedFiles: z.array(z.string()),
  skippedFiles: z.array(z.object({ path: z.string(), reason: z.string() })),
  reviewRequired: z.boolean(),
  reviewReason: z.string().optional(),
});
const TestCommandSchema = z.object({
  command: z.string().min(1),
  reason: z.string(),
  source: z.enum(['tool-default', 'repo-script']),
});
const TestResultSchema = z.object({
  command: z.string(),
  exitCode: z.number().nullable(),
  passed: z.boolean(),
  output: z.string(),
});
const RankedIssueSchema = z.custom<RankedIssue>(
  (value) =>
    typeof value === 'object' &&
    value !== null &&
    'repoFullName' in value &&
    typeof value.repoFullName === 'string' &&
    'number' in value &&
    typeof value.number === 'number',
  'Expected a ranked GitHub issue.',
);

interface FilePatchToolInput {
  workspacePath: string;
  fileChanges: GeneratedFileChange[];
  allowedPaths?: string[];
}

interface ValidationToolInput {
  workspacePath: string;
  commands: TestCommand[];
  executionMode: 'interactive' | 'headless';
}

interface PullRequestToolInput {
  issue: RankedIssue;
  prDraft: PullRequestDraft;
  workspacePath: string;
  changedFiles: string[];
  allowRealPr: boolean;
  headless: boolean;
  hasBlockingValidationFailures: boolean;
  confirmed: boolean;
}

interface ArtifactPublishToolInput {
  targetRepoPath: string;
  files: FileWriteRequest[];
  commitMessage: string;
  branchName: string;
  baseBranch: string;
  headless: boolean;
  confirmed: boolean;
}

const filePatchTool: AgentTool<FilePatchToolInput, GeneratedChangeApplyResult> = {
  name: 'workspace.file_write',
  description: 'Apply bounded generated file changes inside a prepared repository workspace.',
  isReadOnly: false,
  isConcurrencySafe: false,
  riskLevel: 'high',
  inputSchemaName: 'FilePatchToolInput',
  outputSchemaName: 'GeneratedChangeApplyResult',
  requiredPermissions: ['filesystem:write'],
  inputSchema: z.object({
    workspacePath: z.string().min(1),
    fileChanges: z.array(GeneratedFileChangeSchema),
    allowedPaths: z.array(z.string()).optional(),
  }),
  outputSchema: GeneratedChangeApplyResultSchema,
  checkPermission: (input) =>
    permissionPolicyService.evaluateGeneratedFileChanges({
      workspacePath: input.workspacePath,
      fileChanges: input.fileChanges,
      allowedPaths: input.allowedPaths,
      maxFiles: 6,
      maxFileChars: 60_000,
    }),
  execute: (input, context) =>
    workspaceService.applyGeneratedChanges(input.workspacePath, input.fileChanges, {
      allowedPaths: input.allowedPaths,
      permissionDecision: context.permissionDecision,
    }),
};

const validationTool: AgentTool<ValidationToolInput, TestResult[]> = {
  name: 'validation.command',
  description: 'Execute validation commands selected for the current execution mode.',
  isReadOnly: false,
  isConcurrencySafe: false,
  riskLevel: 'medium',
  inputSchemaName: 'ValidationToolInput',
  outputSchemaName: 'TestResult[]',
  requiredPermissions: ['process:execute'],
  inputSchema: z.object({
    workspacePath: z.string().min(1),
    commands: z.array(TestCommandSchema),
    executionMode: z.enum(['interactive', 'headless']),
  }),
  outputSchema: z.array(TestResultSchema),
  checkPermission: (input) => permissionPolicyService.evaluateValidationExecution(input.commands, input.executionMode),
  execute: (input) => workspaceService.runValidationCommands(input.workspacePath, input.commands),
};

const pullRequestTool: AgentTool<PullRequestToolInput, ContributionPrSubmissionResult> = {
  name: 'github.create_draft_pr',
  description: 'Push generated changes to a fork and create an upstream draft pull request.',
  isReadOnly: false,
  isConcurrencySafe: false,
  riskLevel: 'high',
  inputSchemaName: 'PullRequestToolInput',
  outputSchemaName: 'ContributionPrSubmissionResult',
  requiredPermissions: ['git:push', 'github:write'],
  inputSchema: z.object({
    issue: RankedIssueSchema,
    prDraft: PullRequestDraftSchema,
    workspacePath: z.string().min(1),
    changedFiles: z.array(z.string().min(1)).min(1),
    allowRealPr: z.boolean(),
    headless: z.boolean(),
    hasBlockingValidationFailures: z.boolean(),
    confirmed: z.boolean(),
  }),
  outputSchema: z.object({
    branchName: z.string().min(1),
    url: z.string().url(),
    number: z.number().int().positive(),
  }),
  checkPermission: (input) =>
    permissionPolicyService.evaluatePullRequest({
      allowRealPr: input.allowRealPr,
      headless: input.headless,
      hasBlockingValidationFailures: input.hasBlockingValidationFailures,
      confirmed: input.confirmed,
    }),
  execute: (input) =>
    contributionPrService.submitDraftPullRequest({
      issue: input.issue,
      prDraft: input.prDraft,
      workspacePath: input.workspacePath,
      changedFiles: input.changedFiles,
    }),
};

const artifactPublishTool: AgentTool<ArtifactPublishToolInput, GitPublishResult> = {
  name: 'artifact.publish',
  description: 'Write contribution artifacts, commit them, and push the configured artifact branch.',
  isReadOnly: false,
  isConcurrencySafe: false,
  riskLevel: 'high',
  inputSchemaName: 'ArtifactPublishToolInput',
  outputSchemaName: 'GitPublishResult',
  requiredPermissions: ['filesystem:write', 'git:push'],
  inputSchema: z.object({
    targetRepoPath: z.string().min(1),
    files: z.array(z.object({ path: z.string().min(1), content: z.string() })).min(1),
    commitMessage: z.string().min(1),
    branchName: z.string().min(1),
    baseBranch: z.string().min(1),
    headless: z.boolean(),
    confirmed: z.boolean(),
  }),
  outputSchema: z.object({
    branch: z.string().min(1),
    fileNames: z.array(z.string()),
    filePaths: z.array(z.string()),
    pushed: z.boolean(),
  }),
  checkPermission: (input) =>
    permissionPolicyService.evaluateArtifactPublish({
      headless: input.headless,
      confirmed: input.confirmed,
    }),
  execute: async (input) => {
    const result = await gitService.writeAndPublish(input.files, input.commitMessage, {
      branchName: input.branchName,
      baseBranch: input.baseBranch,
    });
    if (!result) {
      throw new Error('OpenMeta could not publish the generated contribution artifacts.');
    }
    return result;
  },
};

const DEFAULT_AGENT_TOOLS = [filePatchTool, validationTool, pullRequestTool, artifactPublishTool] as const;

export function registerDefaultAgentTools(executor: ToolExecutorService = toolExecutorService): void {
  const registered = new Set(executor.list().map((tool) => tool.name));
  for (const tool of DEFAULT_AGENT_TOOLS) {
    if (!registered.has(tool.name)) {
      executor.register(tool as unknown as AgentTool<unknown, unknown>);
    }
  }
}

registerDefaultAgentTools();
