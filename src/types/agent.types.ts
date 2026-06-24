import type { z } from 'zod';
import type { PatchDraft, PullRequestDraft } from '../contracts/index.js';
import type { MatchedIssue } from './github.types.js';

export interface OpportunityBreakdown {
  technicalFit: number;
  freshness: number;
  onboardingClarity: number;
  mergePotential: number;
  impact: number;
}

export interface OpportunityAnalysis {
  score: number;
  overallScore: number;
  summary: string;
  breakdown: OpportunityBreakdown;
}

export type ScoutFeasibilityLevel = 'ready' | 'likely_fixable' | 'risky' | 'likely_blocked' | 'unknown';
export type ScoutIssueScope =
  | 'docs_only'
  | 'config_only'
  | 'test_only'
  | 'small_code_change'
  | 'runtime_bug'
  | 'performance'
  | 'hardware_specific'
  | 'unknown';

export interface ScoutFeasibilityHint {
  level: ScoutFeasibilityLevel;
  issueScope: ScoutIssueScope;
  repoRisks: string[];
  issueRisks: string[];
  missingLocalCapabilities: string[];
  mitigations: string[];
  confidence: 'low' | 'medium' | 'high';
  scoreAdjustment: number;
  adjustedOverallScore: number;
  explanation: string;
}

export interface RankedIssue extends MatchedIssue {
  opportunity: OpportunityAnalysis;
  scoutFeasibility?: ScoutFeasibilityHint;
}

export interface TestCommand {
  command: string;
  reason: string;
  source: 'tool-default' | 'repo-script';
}

export interface TestResult {
  command: string;
  exitCode: number | null;
  passed: boolean;
  output: string;
}

export interface RepoFileSnippet {
  path: string;
  content: string;
}

export interface GeneratedFileChange {
  path: string;
  reason: string;
  content: string;
}

export interface SkippedGeneratedFileChange {
  path: string;
  reason: string;
}

export interface GeneratedChangeApplyResult {
  appliedFiles: string[];
  skippedFiles: SkippedGeneratedFileChange[];
  reviewRequired: boolean;
  reviewReason?: string;
}

export interface ImplementationDraft {
  summary: string;
  fileChanges: GeneratedFileChange[];
}

export interface RepoWorkspaceContext {
  workspacePath: string;
  workspaceDirty: boolean;
  defaultBranch: string;
  branchName?: string;
  topLevelFiles: string[];
  candidateFiles: string[];
  snippets: RepoFileSnippet[];
  testCommands: TestCommand[];
  validationCommands: TestCommand[];
  validationWarnings: string[];
  testResults: TestResult[];
  executionMode: 'interactive' | 'headless';
}

export interface RepoMemoryIssueRecord {
  reference: string;
  title: string;
  overallScore: number;
  generatedAt: string;
  status: 'selected' | 'draft_only' | 'review_required' | 'validated' | 'published' | 'pr_opened';
  changedFiles: string[];
  published: boolean;
  reviewRequired: boolean;
  validationSummary: string;
  pullRequestUrl?: string;
}

export interface RepoMemoryRunStats {
  totalRuns: number;
  publishedRuns: number;
  realPrRuns: number;
  reviewRequiredRuns: number;
  successfulValidationRuns: number;
  failedValidationRuns: number;
}

export interface RepoMemoryPathSignal {
  path: string;
  candidateCount: number;
  changedCount: number;
  successfulValidationCount: number;
  publishedCount: number;
  lastSeenAt: string;
}

export interface RepoMemoryValidationSignal {
  command: string;
  failureCount: number;
  lastExitCode: number | null;
  lastSeenAt: string;
  sampleOutput?: string;
}

export interface RepoMemory {
  repoFullName: string;
  firstSeenAt: string;
  lastUpdatedAt: string;
  lastSelectedIssue?: string;
  workspacePath?: string;
  lastBranchName?: string;
  detectedTestCommands: string[];
  preferredPaths: string[];
  generatedDossiers: number;
  runStats: RepoMemoryRunStats;
  pathSignals: RepoMemoryPathSignal[];
  validationSignals: RepoMemoryValidationSignal[];
  recentIssues: RepoMemoryIssueRecord[];
}

export type InboxStatus = 'scouted' | 'drafted' | 'ready';

export interface ContributionInboxItem {
  id: string;
  repoFullName: string;
  issueNumber: number;
  issueTitle: string;
  summary: string;
  overallScore: number;
  opportunityScore: number;
  status: InboxStatus;
  artifactDir: string;
  generatedAt: string;
}

export interface ProofOfWorkRecord {
  id: string;
  repoFullName: string;
  issueNumber: number;
  issueTitle: string;
  overallScore: number;
  opportunityScore: number;
  branchName?: string;
  artifactDir: string;
  generatedAt: string;
  published: boolean;
  pullRequestUrl?: string;
  pullRequestNumber?: number;
}

export interface ContributionArtifacts {
  artifactDir: string;
  dossierPath: string;
  patchDraftPath: string;
  prDraftPath: string;
  memoryPath: string;
  inboxPath: string;
  proofOfWorkPath: string;
}

export interface ContributionAgentResult {
  issue: RankedIssue;
  workspace: RepoWorkspaceContext;
  memory: RepoMemory;
  patchDraft: PatchDraft;
  prDraft: PullRequestDraft;
  dossier: string;
  artifacts: ContributionArtifacts;
  inboxItem: ContributionInboxItem;
  proofRecord: ProofOfWorkRecord;
  changedFiles?: string[];
  pullRequestUrl?: string;
}

export type AgentRunStatus = 'running' | 'success' | 'failed' | 'cancelled';

export interface AgentRunRecord {
  id: string;
  commandName: string;
  args: string[];
  status: AgentRunStatus;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  error?: string;
}

export type AgentEventType =
  | 'run_started'
  | 'run_finished'
  | 'run_cancelled'
  | 'run_failed'
  | 'permission_decision'
  | 'context_assembled'
  | 'agent_checkpoint'
  | 'agent_role_completed'
  | 'tool_execution_started'
  | 'tool_execution_completed'
  | 'tool_execution_blocked'
  | 'tool_execution_failed';

export interface AgentEventLogEntry {
  version: 1;
  id: string;
  runId: string;
  type: AgentEventType;
  timestamp: string;
  data: Record<string, unknown>;
}

export type PermissionDecisionOutcome = 'allow' | 'deny' | 'ask' | 'review';
export type PermissionRiskLevel = 'low' | 'medium' | 'high';

export interface PermissionDecision {
  outcome: PermissionDecisionOutcome;
  action: string;
  riskLevel: PermissionRiskLevel;
  reason: string;
  details?: Record<string, unknown>;
}

export interface AgentCapability {
  name: string;
  description: string;
  isReadOnly: boolean;
  isConcurrencySafe: boolean;
  riskLevel: PermissionRiskLevel;
  inputSchemaName: string;
  outputSchemaName: string;
  requiredPermissions: string[];
}

export interface AgentToolContext {
  allowReview?: boolean;
  permissionDecision?: PermissionDecision;
}

export interface AgentTool<Input, Output> extends AgentCapability {
  inputSchema: z.ZodType<Input>;
  outputSchema: z.ZodType<Output>;
  checkPermission: (input: Input, context: AgentToolContext) => PermissionDecision;
  execute: (input: Input, context: AgentToolContext) => Promise<Output> | Output;
}

export type ToolExecutionStatus = 'success' | 'blocked' | 'failed';

export interface ToolExecutionResult<Output> {
  toolName: string;
  status: ToolExecutionStatus;
  permissionDecision?: PermissionDecision;
  output?: Output;
  error?: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

export type AgentHookEvent =
  | 'permission_decision'
  | 'context_assembled'
  | 'before_tool_execute'
  | 'after_tool_execute'
  | 'tool_execute_failed';

export interface AgentHookPayload {
  event: AgentHookEvent;
  timestamp: string;
  runId?: string;
  data: Record<string, unknown>;
}

export interface AgentHookResult {
  continue?: boolean;
  reason?: string;
  updatedInput?: unknown;
  permissionDecision?: PermissionDecision;
}

export type AgentHookHandler = (payload: AgentHookPayload) => AgentHookResult | void | Promise<AgentHookResult | void>;

export interface ContextSection {
  id: string;
  content: string;
  priority: number;
  required?: boolean;
}

export interface ContextBudgetResult {
  content: string;
  estimatedTokens: number;
  originalEstimatedTokens: number;
  truncatedSections: string[];
}

export type AgentCheckpointStage =
  | 'target_selected'
  | 'workspace_prepared'
  | 'patch_drafted'
  | 'changes_applied'
  | 'validation_completed'
  | 'pr_drafted'
  | 'pr_created'
  | 'artifacts_written'
  | 'artifacts_published';

export interface AgentResumePlan {
  runId: string;
  resumable: boolean;
  completedStages: AgentCheckpointStage[];
  lastStage?: AgentCheckpointStage;
  nextStage?: AgentCheckpointStage;
  reason: string;
  nextActions: string[];
}

export type AgentRole = 'research' | 'patch' | 'verify';

export interface AgentRoleHandoff<T = unknown> {
  from: AgentRole;
  to: AgentRole;
  createdAt: string;
  runId?: string;
  payload: T;
}

export interface AgentRolePipelineResult<Research, Patch, Verification> {
  research: Research;
  patch: Patch;
  verification: Verification;
  handoffs: [AgentRoleHandoff<Research>, AgentRoleHandoff<Patch>];
}
