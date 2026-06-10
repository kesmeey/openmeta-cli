import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { homedir } from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

const LOOKBACK_DAYS = 90;
const WEEK_BUCKETS = 8;
const MONTH_BUCKETS = 6;
const STALE_ATTEMPT_DAYS = 14;
const RETURN_SESSION_GAP_DAYS = 10;

type AttemptSource = 'proof' | 'memory' | 'inbox' | 'artifact';
type AttemptOutcome = 'merged' | 'pr_open' | 'published' | 'stalled' | 'draft_only';
type WorkType = 'code' | 'tests' | 'docs' | 'infra' | 'planning' | 'mixed' | 'unknown';
type ValidationState = 'not_run' | 'failed' | 'passed' | 'reported';
type LedgerTraceEntry = 'dossier' | 'patch' | 'pr' | 'memory';
type OpenTargetKind = 'pr' | 'dossier' | 'patch' | 'pr_draft' | 'fallback';
type BlockedReason =
  | 'landed'
  | 'upstream_pr_open'
  | 'review_required'
  | 'validation_failed'
  | 'waiting_for_pr'
  | 'validated_local'
  | 'local_only';
type Decision = 'deepen' | 'watch' | 'pause';
type DashboardMode = 'real' | 'empty';
type ArchiveStatus = 'ready' | 'compounding' | 'review' | 'hold';
type ArchiveEvidenceLevel = 'proof-backed' | 'live-pr' | 'memory-backed' | 'artifact-only';
type FocusGroups = Record<Decision, FocusItem[]>;

interface ArtifactPaths {
  dossier: string;
  patchDraft: string;
  prDraft: string;
  memory: string;
  inbox: string;
  proofOfWork: string;
}

interface ArtifactSnapshot {
  key: string;
  artifactDir: string;
  repoFullName: string;
  issueNumber: number;
  generatedAt: string;
  title: string;
  summary: string;
  paths: ArtifactPaths;
}

interface ProofRecord {
  id: string;
  repoFullName: string;
  issueNumber: number;
  issueTitle?: string;
  overallScore?: number;
  opportunityScore?: number;
  branchName?: string;
  artifactDir?: string;
  generatedAt?: string;
  published?: boolean;
  pullRequestUrl?: string;
  pullRequestNumber?: number;
  merged?: boolean;
}

interface InboxItem {
  id: string;
  repoFullName: string;
  issueNumber?: number;
  issueTitle?: string;
  summary?: string;
  overallScore?: number;
  opportunityScore?: number;
  status?: string;
  artifactDir?: string;
  generatedAt?: string;
}

interface MemoryRunStats {
  totalRuns: number;
  publishedRuns: number;
  realPrRuns: number;
  reviewRequiredRuns: number;
  successfulValidationRuns: number;
  failedValidationRuns: number;
}

interface MemoryIssue {
  reference: string;
  title: string;
  overallScore: number;
  generatedAt: string;
  status: string;
  changedFiles: string[];
  published: boolean;
  reviewRequired: boolean;
  validationSummary: string;
  pullRequestUrl?: string;
  summary?: string;
}

interface MemorySnapshot {
  repoFullName: string;
  firstSeenAt: string;
  lastUpdatedAt: string;
  lastSelectedIssue: string;
  workspacePath: string;
  lastBranchName: string;
  detectedTestCommands: string[];
  preferredPaths: string[];
  generatedDossiers: number;
  runStats: MemoryRunStats;
  pathSignals: unknown[];
  validationSignals: unknown[];
  recentIssues: MemoryIssue[];
}

interface RunRecord {
  startedAt?: string;
  commandName?: string;
}

interface SourceBreakdown {
  proof: number;
  memory: number;
  inbox: number;
  artifact: number;
}

interface OutcomeFlags {
  hasLedgerPublication: boolean;
  hasUpstreamPr: boolean;
  hasMerged: boolean;
}

interface OpenTarget {
  url: string;
  label: string;
  kind: OpenTargetKind;
}

interface AssetCoverage {
  dossier: boolean;
  patch: boolean;
  pr: boolean;
  memory: boolean;
  count: number;
  label: string;
}

interface BaseAttempt {
  key: string;
  source: AttemptSource;
  sourceLabel: string;
  repoFullName: string;
  issueNumber: number;
  outcome: AttemptOutcome;
  title: string;
  summary: string;
  generatedAt: string;
  lastUpdatedAt: string;
  detailLink: string;
  openTarget: OpenTarget;
  artifactDir: string;
  ledgerTrace: LedgerTraceEntry[];
  published: boolean;
  pullRequestUrl: string;
  merged: boolean;
  outcomeFlags: OutcomeFlags;
  reviewRequired: boolean;
  validationSummary: string;
  score: number;
}

interface AttemptRecord extends BaseAttempt {
  reference: string;
  issueUrl: string;
  pullRequestNumber?: number;
  branchName: string;
  changedFiles: string[];
  changedFilesCount: number;
  changedFilePreview: string[];
  fileAreaHints: string[];
  workType: WorkType;
  validationState: ValidationState;
  blockedReason: BlockedReason;
  blockedLabel: string;
  assetCoverage: AssetCoverage;
  assetCompletenessCount: number;
  assetCompletenessLabel: string;
  ageDays: number;
  staleDays: number;
  isReopenable: boolean;
  reopenHint: string;
  highLeverage: boolean;
}

interface DashboardAttempt extends AttemptRecord {
  decision: Decision;
}

interface AttemptEnrichmentInput {
  branchName?: string;
  pullRequestNumber?: number;
  changedFiles?: string[];
  validationSummary?: string;
  artifact?: ArtifactSnapshot | null;
}

interface OutcomeResolutionInput {
  merged?: boolean;
  pullRequestUrl?: string;
  published?: boolean;
  reviewRequired?: boolean;
  validationSummary?: string;
}

interface BlockageInput {
  merged?: boolean;
  pullRequestUrl?: string;
  published?: boolean;
  reviewRequired?: boolean;
  validationState: ValidationState;
}

interface OutcomeContext {
  summary?: string;
}

interface ArtifactNameParts {
  repoFullName: string;
  issueNumber: number;
}

interface Blockage {
  key: BlockedReason;
  label: string;
}

interface OpenTargetInput {
  pullRequestUrl?: string;
  dossierPath?: string;
  patchDraftPath?: string;
  prDraftPath?: string;
  fallbackUrl?: string;
}

interface TrendRow {
  period: string;
  drafted: number;
  ledgerPublished: number;
  prOpen: number;
  merged: number;
  sourceBreakdown: SourceBreakdown;
}

interface Trends {
  weekly: TrendRow[];
  monthly: TrendRow[];
}

interface ProjectSignal {
  repoFullName: string;
  revisit: number;
  landing: number;
  memory: number;
  score: number;
  trend: number[];
}

interface ProjectStatsRow {
  repoFullName: string;
  attempts: AttemptRecord[];
  memory: MemorySnapshot | null;
  signal: ProjectSignal;
  contributionCount: number;
  publishedCount: number;
  prOpenCount: number;
  mergedCount: number;
  stalledCount: number;
  reviewRequiredCount: number;
  validationFailedCount: number;
  openAttemptCount: number;
  activeWeeks: number;
  attemptToPublishedRate: number;
  attemptToPrRate: number;
  attemptToMergedRate: number;
  lastSuccessfulLandingAt: string;
  lastMeaningfulLandingAt: string;
  reopenableAttemptCount: number;
  stalePublishedWithoutPrCount: number;
  stalePrOpenCount: number;
  oldestOpenAttemptAgeDays: number;
  activeWindowSpanDays: number;
  returnSessions: number;
  consecutiveActiveWindows: number;
  dominantWorkType: WorkType;
  topAreas: string[];
  highLeverageAttemptCount: number;
  latest: AttemptRecord;
  decision: Decision;
}

interface FocusItem {
  repoFullName: string;
  summary: string;
  reasons: string[];
}

interface ProjectRow {
  repoFullName: string;
  decision: Decision;
  contributionCount: number;
  mergedCount: number;
  publishedCount: number;
  ledgerPublishedCount: number;
  prOpenCount: number;
  reviewRequiredCount: number;
  validationFailedCount: number;
  openAttemptCount: number;
  activeWeeks: number;
  attemptToPublishedRate: number;
  attemptToPrRate: number;
  attemptToMergedRate: number;
  lastSuccessfulLandingAt: string;
  lastMeaningfulLandingAt: string;
  lastOutcome: AttemptOutcome;
  lastActiveAt: string;
  representativeTitle: string;
  score: number;
  detailLink: string;
  reopenableAttemptCount: number;
  stalePublishedWithoutPrCount: number;
  stalePrOpenCount: number;
  oldestOpenAttemptAgeDays: number;
  activeWindowSpanDays: number;
  returnSessions: number;
  consecutiveActiveWindows: number;
  dominantWorkType: WorkType;
  topAreas: string[];
  highLeverageAttemptCount: number;
  sourceMix: SourceBreakdown;
  note: string;
  conversionNote: string;
  blockageNote: string;
}

interface ActivityItem {
  type: AttemptOutcome;
  repoFullName: string;
  title: string;
  date: string;
  description: string;
}

interface ArchiveItem {
  label: string;
  repoFullName: string;
  title: string;
  lines: string[];
  status: ArchiveStatus;
  evidenceLevel: ArchiveEvidenceLevel;
  assetCompletenessLabel: string;
  assetCompletenessCount: number;
  reuseLabel: string;
  followThroughLabel: string;
  lastRevisitedAt: string;
}

interface AssetsSummary {
  dossiers: number;
  patchDrafts: number;
  prDrafts: number;
  memoryFiles: number;
}

interface SummaryBlock {
  totalContributions: number;
  uniqueProjects: number;
  publishedRuns: number;
  ledgerPublishedRuns: number;
  realPrRuns: number;
  mergedRuns: number;
  archivedAssets: number;
  reopenableBacklogTotal: number;
  stalePublishedBacklogTotal: number;
  reposWithReturnMotion: number;
  highLeverageAttemptTotal: number;
  dominantWorkType: WorkType;
  topAreas: string[];
  lastActiveAt: string;
  sourceBreakdown: SourceBreakdown;
  callout: string;
}

interface MetaEntry {
  label: string;
  value: string;
}

interface ProjectSignalMapEntry {
  revisit: number;
  landing: number;
  memory: number;
  trend: number[];
}

interface DashboardState {
  proofRecords: ProofRecord[];
  inboxItems: InboxItem[];
  runRecords: RunRecord[];
  memorySnapshots: MemorySnapshot[];
  artifacts: ArtifactSnapshot[];
}

export interface DashboardData {
  meta: {
    generatedAt: string;
    windowLabel: string;
    mode: DashboardMode;
    refreshLabel: string;
  };
  topMeta: MetaEntry[];
  filters: {
    availableRepos: string[];
    availableDecisions: Array<'all' | Decision>;
  };
  attemptFilters: {
    availableOutcomes: Array<'all' | AttemptOutcome>;
  };
  sync: {
    lastRefreshedAt: string;
    status: string;
  };
  summary: SummaryBlock;
  trends: Trends;
  focus: FocusGroups;
  projects: ProjectRow[];
  attempts: DashboardAttempt[];
  activity: ActivityItem[];
  assets: AssetsSummary;
  archive: ArchiveItem[];
  projectSignals: Record<string, ProjectSignalMapEntry>;
}

function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function getOpenMetaConfigDir(): string {
  return process.env['OPENMETA_CONFIG_DIR'] || path.join(homedir(), '.config', 'openmeta');
}

function getOpenMetaHome(): string {
  return process.env['OPENMETA_HOME'] || path.join(homedir(), '.openmeta');
}

function readJson<T>(filePath: string, fallback: T): T {
  try {
    if (!existsSync(filePath)) {
      return fallback;
    }
    return JSON.parse(readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

function readText(filePath: string): string {
  try {
    if (!existsSync(filePath)) {
      return '';
    }
    return readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

function normalizePath(filePath: string): string {
  return path.resolve(filePath).toLowerCase();
}

function parseIso(value: string | Date | null | undefined): Date | null {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

function pad(value: number | string): string {
  return String(value).padStart(2, '0');
}

function formatDateTime(value: string | Date | null | undefined): string {
  const date = value instanceof Date ? value : parseIso(value);
  if (!date) {
    return 'n/a';
  }

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDateOnly(value: string | Date | null | undefined): string {
  const date = value instanceof Date ? value : parseIso(value);
  if (!date) {
    return 'n/a';
  }

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function toFileUrl(filePath: string): string {
  return pathToFileURL(filePath).href;
}

function githubIssueUrl(repoFullName: string, issueNumber: number): string {
  if (!repoFullName || !issueNumber) {
    return '';
  }
  return `https://github.com/${repoFullName}/issues/${issueNumber}`;
}

function parseRepoIssueReference(reference: string): ArtifactNameParts | null {
  const match = /^([^#]+)#(\d+)$/.exec(reference || '');
  if (!match || !match[1] || !match[2]) {
    return null;
  }

  return {
    repoFullName: match[1],
    issueNumber: Number.parseInt(match[2], 10),
  };
}

function extractSectionValue(content: string, heading: string): string {
  const pattern = new RegExp(`${escapeRegExp(heading)}\\s*\\n\\s*\\n([^\\n]+)`, 'i');
  const match = content.match(pattern);
  return match && match[1] ? match[1].trim() : '';
}

function extractLineValue(content: string, prefix: string): string {
  const pattern = new RegExp(`^${escapeRegExp(prefix)}\\s*(.+)$`, 'im');
  const match = content.match(pattern);
  return match && match[1] ? match[1].trim() : '';
}

function cleanOptionalValue(value: string | undefined): string {
  if (!value) {
    return '';
  }

  return /^(n\/a|none yet|none recorded)$/i.test(value.trim()) ? '' : value.trim();
}

function parseInteger(value: unknown, fallback: undefined): number | undefined;
function parseInteger(value: unknown, fallback?: number): number;
function parseInteger(value: unknown, fallback: number | undefined = 0): number | undefined {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function extractBulletItems(content: string, heading: string): string[] {
  const lines = String(content || '').split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim().toLowerCase() === heading.trim().toLowerCase());
  if (start === -1) {
    return [];
  }

  const items: string[] = [];
  let index = start + 1;
  while (index < lines.length && (lines[index] ?? '').trim() === '') {
    index += 1;
  }

  for (; index < lines.length; index += 1) {
    const trimmed = (lines[index] ?? '').trim();
    if (!trimmed) {
      if (items.length > 0) {
        break;
      }
      continue;
    }

    if (trimmed.startsWith('#') || trimmed.startsWith('_Snapshot Date')) {
      break;
    }

    if (!trimmed.startsWith('- ')) {
      break;
    }

    items.push(trimmed.slice(2).trim());
  }

  return items;
}

function parseBooleanToken(value: unknown): boolean {
  return /^(true|yes)$/i.test(String(value || '').trim());
}

function parseArtifactDirName(dirName: string): ArtifactNameParts | null {
  const match = /^(.*)__(\d+)$/.exec(dirName);
  if (!match || !match[1] || !match[2]) {
    return null;
  }

  return {
    repoFullName: match[1].replace(/__/g, "/"),
    issueNumber: Number.parseInt(match[2], 10),
  };
}

function summarizeOutcome(outcome: AttemptOutcome, title: string, context: OutcomeContext): string {
  if (context.summary) {
    return context.summary;
  }

  if (outcome === 'merged') {
    return `${title} has already landed upstream and is preserved in the ledger.`;
  }

  if (outcome === 'pr_open') {
    return `${title} already has a live upstream PR linked to the local ledger trail.`;
  }

  if (outcome === 'published') {
    return `${title} has a published artifact bundle and can be resumed without rebuilding context.`;
  }

  if (outcome === 'stalled') {
    return `${title} still needs another validation or review pass before it can move forward.`;
  }

  return `${title} has a local artifact trail, but it has not crossed into a published outcome yet.`;
}

function resolveAttemptOutcome(input: OutcomeResolutionInput): AttemptOutcome {
  if (input.merged) {
    return 'merged';
  }

  if (input.pullRequestUrl) {
    return 'pr_open';
  }

  if (input.published) {
    return 'published';
  }

  if (input.reviewRequired || /failed/i.test(input.validationSummary || '')) {
    return 'stalled';
  }

  return 'draft_only';
}

function buildOutcomeFlags(input: OutcomeResolutionInput): OutcomeFlags {
  return {
    hasLedgerPublication: Boolean(input.published),
    hasUpstreamPr: Boolean(input.pullRequestUrl),
    hasMerged: Boolean(input.merged),
  };
}

function formatAttemptSourceLabel(source: AttemptSource): string {
  if (source === 'proof') {
    return 'Proof';
  }
  if (source === 'memory') {
    return 'Memory';
  }
  if (source === 'inbox') {
    return 'Inbox';
  }
  if (source === 'artifact') {
    return 'Artifact';
  }
  return 'Local';
}

function chooseOpenTarget(input: OpenTargetInput): OpenTarget {
  if (input.pullRequestUrl) {
    return {
      url: input.pullRequestUrl,
      label: 'PR',
      kind: 'pr',
    };
  }

  if (input.dossierPath) {
    return {
      url: toFileUrl(input.dossierPath),
      label: 'Dossier',
      kind: 'dossier',
    };
  }

  if (input.patchDraftPath) {
    return {
      url: toFileUrl(input.patchDraftPath),
      label: 'Patch',
      kind: 'patch',
    };
  }

  if (input.prDraftPath) {
    return {
      url: toFileUrl(input.prDraftPath),
      label: 'PR Draft',
      kind: 'pr_draft',
    };
  }

  return {
    url: input.fallbackUrl || '',
    label: 'Open',
    kind: 'fallback',
  };
}

function buildLedgerTrace(artifact: ArtifactSnapshot | null | undefined, pullRequestUrl: string): LedgerTraceEntry[] {
  const trace: LedgerTraceEntry[] = [];

  if (artifact?.paths.dossier) {
    trace.push('dossier');
  }
  if (artifact?.paths.patchDraft) {
    trace.push('patch');
  }
  if (pullRequestUrl || artifact?.paths.prDraft) {
    trace.push('pr');
  }
  if (artifact?.paths.memory) {
    trace.push('memory');
  }

  return trace.length > 0 ? trace : ['patch'];
}

function normalizeRepoFilePath(filePath: string): string {
  return String(filePath || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '');
}

function summarizeChangedFiles(changedFiles: string[] | undefined): string[] {
  return (changedFiles || [])
    .map((filePath) => normalizeRepoFilePath(filePath))
    .filter(Boolean);
}

function summarizeFileAreas(changedFiles: string[] | undefined): string[] {
  const seen = new Set<string>();
  const areas: string[] = [];

  for (const filePath of summarizeChangedFiles(changedFiles)) {
    const parts = filePath.split('/').filter(Boolean);
    if (parts.length === 0) {
      continue;
    }

    const area = parts.length >= 2 ? `${parts[0] ?? ''}/${parts[1] ?? ''}` : (parts[0] ?? '');
    if (!seen.has(area)) {
      seen.add(area);
      areas.push(area);
    }

    if (areas.length >= 3) {
      break;
    }
  }

  return areas;
}

function detectWorkType(changedFiles: string[] | undefined, summary: string, title: string): WorkType {
  const files = (changedFiles || []).map((item) => item.toLowerCase());
  const text = `${title} ${summary}`.toLowerCase();

  if (files.length === 0) {
    if (/doc|readme|guide|wiki|comment/i.test(text)) {
      return 'docs';
    }
    if (/test|spec|coverage/i.test(text)) {
      return 'tests';
    }
    if (/ci|workflow|release|build|lint|deps|infra/i.test(text)) {
      return 'infra';
    }
    if (/plan|draft|dossier|analysis|investigate|research/i.test(text)) {
      return 'planning';
    }
    return 'unknown';
  }

  let code = 0;
  let tests = 0;
  let docs = 0;
  let infra = 0;

  for (const file of files) {
    if (/(__tests__|\.test\.|\.spec\.|test\/|tests\/)/.test(file)) {
      tests += 2;
      continue;
    }
    if (/(^|\/)(readme|docs?)\/|\.md$|\.mdx$|\.txt$/.test(file)) {
      docs += 2;
      continue;
    }
    if (/(^|\/)(\.github|scripts|ops|infra|deploy|docker|helm|k8s)\//.test(file) || /(dockerfile|compose|\.ya?ml$|\.json$|\.toml$|\.lock$)/.test(file)) {
      infra += 2;
      continue;
    }
    code += 1;
  }

  const ranked = [
    { type: 'code', value: code },
    { type: 'tests', value: tests },
    { type: 'docs', value: docs },
    { type: 'infra', value: infra },
  ] as Array<{ type: WorkType; value: number }>;
  ranked.sort((left, right) => right.value - left.value);

  if (ranked[0] && ranked[1] && ranked[0].value > 0 && ranked[1].value > 0 && ranked[0].value === ranked[1].value) {
    return 'mixed';
  }

  return ranked[0]?.value ? ranked[0].type : 'unknown';
}

function workTypePriority(workType: WorkType): number {
  switch (workType) {
    case 'code':
      return 6;
    case 'tests':
      return 5;
    case 'infra':
      return 4;
    case 'docs':
      return 3;
    case 'planning':
      return 2;
    case 'mixed':
      return 1;
    default:
      return 0;
  }
}

function summarizeTopAreas(attempts: AttemptRecord[]): string[] {
  const counter = new Map<string, number>();

  for (const attempt of attempts) {
    for (const area of attempt.fileAreaHints || []) {
      counter.set(area, (counter.get(area) || 0) + 1);
    }
  }

  return [...counter.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 3)
    .map(([area]) => area);
}

function resolveDominantWorkType(attempts: AttemptRecord[]): WorkType {
  const counter = new Map<WorkType, number>();

  for (const attempt of attempts) {
    const key = attempt.workType || 'unknown';
    counter.set(key, (counter.get(key) || 0) + 1);
  }

  return [...counter.entries()]
    .sort((left, right) => {
      const byCount = right[1] - left[1];
      if (byCount !== 0) {
        return byCount;
      }
      return workTypePriority(right[0]) - workTypePriority(left[0]);
    })[0]?.[0] || 'unknown';
}

function parsePullRequestNumber(pullRequestUrl: string | undefined): number | undefined {
  const match = /\/pull\/(\d+)/.exec(pullRequestUrl || '');
  return match && match[1] ? Number.parseInt(match[1], 10) : undefined;
}

function deriveValidationState(validationSummary: string | undefined): ValidationState {
  const summary = String(validationSummary || '').trim().toLowerCase();
  if (!summary || summary === 'not run') {
    return 'not_run';
  }

  if (summary.includes('fail') || summary.includes('error')) {
    return 'failed';
  }

  if (summary.includes('pass') || summary.includes('success') || summary.includes('ok')) {
    return 'passed';
  }

  return 'reported';
}

function deriveAttemptBlockage(input: BlockageInput): Blockage {
  if (input.merged) {
    return {
      key: 'landed',
      label: 'landed upstream',
    };
  }

  if (input.pullRequestUrl) {
    return {
      key: 'upstream_pr_open',
      label: 'PR open upstream',
    };
  }

  if (input.reviewRequired) {
    return {
      key: 'review_required',
      label: 'review required',
    };
  }

  if (input.validationState === 'failed') {
    return {
      key: 'validation_failed',
      label: 'validation failed',
    };
  }

  if (input.published) {
    return {
      key: 'waiting_for_pr',
      label: 'published, waiting for PR',
    };
  }

  if (input.validationState === 'passed') {
    return {
      key: 'validated_local',
      label: 'validated locally',
    };
  }

  return {
    key: 'local_only',
    label: 'local draft only',
  };
}

function buildAssetCoverage(artifact: ArtifactSnapshot | null | undefined, pullRequestUrl: string): AssetCoverage {
  const coverage = {
    dossier: Boolean(artifact?.paths?.dossier),
    patch: Boolean(artifact?.paths?.patchDraft),
    pr: Boolean(pullRequestUrl || artifact?.paths?.prDraft),
    memory: Boolean(artifact?.paths?.memory),
  };
  const count = Object.values(coverage).filter(Boolean).length;

  return {
    ...coverage,
    count,
    label: `${count}/4 assets`,
  };
}

function enrichAttempt(baseAttempt: BaseAttempt, input: AttemptEnrichmentInput): AttemptRecord {
  const changedFiles = summarizeChangedFiles(input.changedFiles);
  const validationSummary = input.validationSummary || '';
  const validationState = deriveValidationState(validationSummary);
  const workType = detectWorkType(changedFiles, baseAttempt.summary, baseAttempt.title);
  const blockage = deriveAttemptBlockage({
    merged: baseAttempt.merged,
    pullRequestUrl: baseAttempt.pullRequestUrl,
    published: baseAttempt.published,
    reviewRequired: baseAttempt.reviewRequired,
    validationState,
  });
  const assetCoverage = buildAssetCoverage(input.artifact, baseAttempt.pullRequestUrl);
  const ageDays = diffDays(baseAttempt.generatedAt);
  const staleDays = ageDays;
  const isReopenable = isAttemptReopenable({
    merged: baseAttempt.merged,
    pullRequestUrl: baseAttempt.pullRequestUrl,
    published: baseAttempt.published,
    reviewRequired: baseAttempt.reviewRequired,
    validationState,
    assetCompletenessCount: assetCoverage.count,
  });
  const reopenHint = buildReopenHint({
    merged: baseAttempt.merged,
    pullRequestUrl: baseAttempt.pullRequestUrl,
    published: baseAttempt.published,
    reviewRequired: baseAttempt.reviewRequired,
    validationState,
  });
  const highLeverage = Boolean(
    baseAttempt.merged
    || baseAttempt.pullRequestUrl
    || (baseAttempt.published && assetCoverage.count >= 3)
    || (baseAttempt.score >= 80 && assetCoverage.count >= 3),
  );

  return {
    ...baseAttempt,
    reference: `${baseAttempt.repoFullName}#${baseAttempt.issueNumber}`,
    issueUrl: githubIssueUrl(baseAttempt.repoFullName, baseAttempt.issueNumber),
    pullRequestNumber: input.pullRequestNumber || parsePullRequestNumber(baseAttempt.pullRequestUrl),
    branchName: cleanOptionalValue(input.branchName || ""),
    changedFiles,
    changedFilesCount: changedFiles.length,
    changedFilePreview: changedFiles.slice(0, 2),
    fileAreaHints: summarizeFileAreas(changedFiles),
    workType,
    validationSummary,
    validationState,
    blockedReason: blockage.key,
    blockedLabel: blockage.label,
    assetCoverage,
    assetCompletenessCount: assetCoverage.count,
    assetCompletenessLabel: assetCoverage.label,
    ageDays,
    staleDays,
    isReopenable,
    reopenHint,
    highLeverage,
  };
}

function findLatestLandingDate(attempts: AttemptRecord[]): string {
  const latest = attempts.find((item) => item.merged || item.pullRequestUrl || item.published);
  return latest ? formatDateOnly(latest.generatedAt) : 'n/a';
}

function toRate(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 100) : 0;
}

function describeArchiveFollowThrough(attempt: AttemptRecord): string {
  if (attempt.merged) {
    return 'merged upstream';
  }
  if (attempt.pullRequestUrl) {
    return 'converted into PR';
  }
  if (attempt.published) {
    return 'ledger published';
  }
  if (attempt.reviewRequired || attempt.validationState === 'failed') {
    return 'stopped before landing';
  }
  return 'not landed yet';
}

function describeArchiveReuse(attempt: AttemptRecord): string {
  if (attempt.assetCoverage?.memory && (attempt.pullRequestUrl || attempt.published || attempt.merged)) {
    return 'context compounding';
  }
  if (attempt.assetCoverage?.memory) {
    return 'context retained';
  }
  if ((attempt.assetCompletenessCount || 0) >= 3) {
    return 'bundle retained';
  }
  return 'thin trail';
}

function diffDays(from: string | Date | null | undefined, to: Date = new Date()): number {
  const fromDate = parseIso(from);
  if (!fromDate) {
    return 0;
  }

  const delta = to.getTime() - fromDate.getTime();
  return Math.max(0, Math.floor(delta / (1000 * 60 * 60 * 24)));
}

function buildReopenHint(input: {
  merged: boolean;
  pullRequestUrl: string;
  published: boolean;
  reviewRequired: boolean;
  validationState: ValidationState;
}): string {
  if (input.merged) {
    return 'landed upstream';
  }
  if (input.pullRequestUrl) {
    return 'follow up on the open PR';
  }
  if (input.reviewRequired) {
    return 'address review-required follow-up';
  }
  if (input.validationState === 'failed') {
    return 'repair validation and retry';
  }
  if (input.published) {
    return 'convert published ledger work into a PR';
  }
  if (input.validationState === 'passed') {
    return 'package the validated draft into a PR';
  }
  return 'resume the local draft trail';
}

function isAttemptReopenable(input: {
  merged: boolean;
  pullRequestUrl: string;
  published: boolean;
  reviewRequired: boolean;
  validationState: ValidationState;
  assetCompletenessCount: number;
}): boolean {
  if (input.merged || input.pullRequestUrl) {
    return false;
  }
  if (input.reviewRequired || input.published || input.validationState === 'failed' || input.validationState === 'passed') {
    return true;
  }
  return input.assetCompletenessCount >= 2;
}

function findLastMeaningfulLandingDate(attempts: AttemptRecord[]): string {
  const latest = attempts.find((item) => item.merged || item.pullRequestUrl || item.published);
  return latest ? formatDateOnly(latest.generatedAt) : 'n/a';
}

function computeActiveWindowSpanDays(attempts: AttemptRecord[]): number {
  const dates = attempts
    .map((item) => parseIso(item.generatedAt))
    .filter((date): date is Date => Boolean(date))
    .sort((left, right) => left.getTime() - right.getTime());

  if (dates.length <= 1) {
    return dates.length === 1 ? 1 : 0;
  }

  const first = dates[0];
  const last = dates[dates.length - 1];
  if (!first || !last) {
    return 0;
  }

  return Math.max(1, Math.floor((last.getTime() - first.getTime()) / (1000 * 60 * 60 * 24)) + 1);
}

function computeReturnSessions(attempts: AttemptRecord[]): number {
  const dates = attempts
    .map((item) => parseIso(item.generatedAt))
    .filter((date): date is Date => Boolean(date))
    .sort((left, right) => left.getTime() - right.getTime());

  if (dates.length === 0) {
    return 0;
  }

  let sessions = 1;
  for (let index = 1; index < dates.length; index += 1) {
    const previous = dates[index - 1];
    const current = dates[index];
    if (!previous || !current) {
      continue;
    }

    const gapDays = Math.floor((current.getTime() - previous.getTime()) / (1000 * 60 * 60 * 24));
    if (gapDays >= RETURN_SESSION_GAP_DAYS) {
      sessions += 1;
    }
  }

  return sessions;
}

function computeConsecutiveActiveWindows(attempts: AttemptRecord[]): number {
  const labels = Array.from(
    new Set(
      attempts
        .map((item) => parseIso(item.generatedAt))
        .filter((date): date is Date => Boolean(date))
        .map((date) => getStartOfWeek(date).toISOString().slice(0, 10)),
    ),
  ).sort();

  if (labels.length === 0) {
    return 0;
  }

  let streak = 1;
  for (let index = labels.length - 1; index > 0; index -= 1) {
    const current = parseIso(labels[index]);
    const previous = parseIso(labels[index - 1]);
    if (!current || !previous) {
      break;
    }

    const gapDays = Math.floor((current.getTime() - previous.getTime()) / (1000 * 60 * 60 * 24));
    if (gapDays === 7) {
      streak += 1;
      continue;
    }
    break;
  }

  return streak;
}

function scanArtifactDirs(): ArtifactSnapshot[] {
  const artifactRoot = path.join(getOpenMetaHome(), 'artifacts');
  if (!existsSync(artifactRoot)) {
    return [];
  }

  const snapshots: ArtifactSnapshot[] = [];
  const dayEntries = readdirSync(artifactRoot, { withFileTypes: true });

  for (const dayEntry of dayEntries) {
    if (!dayEntry.isDirectory()) {
      continue;
    }

    const dayPath = path.join(artifactRoot, dayEntry.name);
    const candidateEntries = readdirSync(dayPath, { withFileTypes: true });

    for (const candidateEntry of candidateEntries) {
      if (!candidateEntry.isDirectory() || candidateEntry.name === 'analysis') {
        continue;
      }

      const parsed = parseArtifactDirName(candidateEntry.name);
      if (!parsed) {
        continue;
      }

      const artifactDir = path.join(dayPath, candidateEntry.name);
      const dossierPath = path.join(artifactDir, 'dossier.md');
      const patchDraftPath = path.join(artifactDir, 'patch-draft.md');
      const prDraftPath = path.join(artifactDir, 'pr-draft.md');
      const memoryPath = path.join(artifactDir, 'repo-memory.md');
      const inboxPath = path.join(artifactDir, 'inbox.md');
      const proofOfWorkPath = path.join(artifactDir, 'proof-of-work.md');
      const existingPaths = [dossierPath, patchDraftPath, prDraftPath, memoryPath, inboxPath, proofOfWorkPath].filter(
        (filePath) => existsSync(filePath),
      );
      const newestFileTime = existingPaths.reduce<Date | null>((latest, filePath) => {
        const mtime = statSync(filePath).mtime;
        return !latest || mtime > latest ? mtime : latest;
      }, null);
      const generatedAt = newestFileTime ? newestFileTime.toISOString() : `${dayEntry.name}T00:00:00.000Z`;
      const dossierText = readText(dossierPath);
      const patchText = readText(patchDraftPath);
      const prDraftText = readText(prDraftPath);

      snapshots.push({
        key: `${parsed.repoFullName}#${parsed.issueNumber}@${generatedAt}`,
        artifactDir,
        repoFullName: parsed.repoFullName,
        issueNumber: parsed.issueNumber,
        generatedAt,
        title:
          extractLineValue(prDraftText, 'Title:')
          || extractSectionValue(patchText, '## Goal')
          || `${parsed.repoFullName}#${parsed.issueNumber}`,
        summary:
          extractLineValue(dossierText, '- Summary:')
          || extractSectionValue(patchText, '## Goal')
          || '',
        paths: {
          dossier: existsSync(dossierPath) ? dossierPath : '',
          patchDraft: existsSync(patchDraftPath) ? patchDraftPath : '',
          prDraft: existsSync(prDraftPath) ? prDraftPath : '',
          memory: existsSync(memoryPath) ? memoryPath : '',
          inbox: existsSync(inboxPath) ? inboxPath : '',
          proofOfWork: existsSync(proofOfWorkPath) ? proofOfWorkPath : '',
        },
      });
    }
  }

  return snapshots.sort((left, right) => right.generatedAt.localeCompare(left.generatedAt));
}

function loadMemorySnapshots(): MemorySnapshot[] {
  const memoryDir = path.join(getOpenMetaConfigDir(), 'repo-memory');
  if (!existsSync(memoryDir)) {
    return [];
  }

  return readdirSync(memoryDir)
    .filter((fileName) => fileName.endsWith('.json'))
    .map((fileName) => readJson<MemorySnapshot | null>(path.join(memoryDir, fileName), null))
    .filter(isDefined);
}

function buildArtifactDerivedProofRecords(artifacts: ArtifactSnapshot[]): ProofRecord[] {
  return artifacts
    .filter((artifact) => artifact.paths.proofOfWork)
    .map((artifact) => {
      const proofMarkdown = readText(artifact.paths.proofOfWork);
      return deriveProofRecordFromArtifactMarkdown(artifact, proofMarkdown);
    })
    .filter(isDefined);
}

function buildArtifactDerivedInboxItems(artifacts: ArtifactSnapshot[]): InboxItem[] {
  return artifacts
    .filter((artifact) => artifact.paths.inbox)
    .map((artifact) => {
      const inboxMarkdown = readText(artifact.paths.inbox);
      return deriveInboxItemFromArtifactMarkdown(artifact, inboxMarkdown);
    })
    .filter(isDefined);
}

function buildArtifactDerivedMemorySnapshots(artifacts: ArtifactSnapshot[]): MemorySnapshot[] {
  const grouped = new Map<string, ArtifactSnapshot[]>();

  for (const artifact of artifacts.filter((item) => item.paths.memory)) {
    const bucket = grouped.get(artifact.repoFullName) || [];
    bucket.push(artifact);
    grouped.set(artifact.repoFullName, bucket);
  }

  return [...grouped.entries()].map(([repoFullName, repoArtifacts]) => {
    const sorted = [...repoArtifacts].sort((left, right) => right.generatedAt.localeCompare(left.generatedAt));
    const latest = sorted[0];
    if (!latest) {
      return null;
    }
    const latestMarkdown = readText(latest.paths.memory);
    const parsed = deriveMemorySnapshotFromArtifactMarkdown(latest, latestMarkdown);
    if (!parsed) {
      return null;
    }

    const references: string[] = [];
    for (const artifact of sorted) {
      const reference = `${artifact.repoFullName}#${artifact.issueNumber}`;
      if (!references.includes(reference)) {
        references.push(reference);
      }
    }

    return {
      ...parsed,
      repoFullName,
      firstSeenAt: sorted[sorted.length - 1]?.generatedAt || parsed.firstSeenAt,
      lastUpdatedAt: parsed.lastUpdatedAt || latest.generatedAt,
      generatedDossiers: Math.max(parsed.generatedDossiers || 0, sorted.filter((item) => item.paths.dossier).length),
      recentIssues:
        parsed.recentIssues && parsed.recentIssues.length > 0
          ? parsed.recentIssues
          : references.map((reference) => ({
              reference,
              title: reference,
              overallScore: 0,
              generatedAt: latest.generatedAt,
              status: "draft_only",
              changedFiles: [],
              published: false,
              reviewRequired: false,
              validationSummary: "not run",
            })),
    };
  }).filter(isDefined);
}

function mergeProofRecords(primaryRecords: ProofRecord[], fallbackRecords: ProofRecord[]): ProofRecord[] {
  const seen = new Set<string>();
  const merged: ProofRecord[] = [];

  for (const record of [...primaryRecords, ...fallbackRecords]) {
    const key = cleanOptionalValue(record.artifactDir)
      ? `artifact:${normalizePath(record.artifactDir || '')}`
      : `${record.repoFullName}#${record.issueNumber}@${record.generatedAt}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(record);
  }

  return merged;
}

function mergeInboxItems(primaryItems: InboxItem[], fallbackItems: InboxItem[]): InboxItem[] {
  const seen = new Set<string>();
  const merged: InboxItem[] = [];

  for (const item of [...primaryItems, ...fallbackItems]) {
    const key = cleanOptionalValue(item.artifactDir)
      ? `artifact:${normalizePath(item.artifactDir || '')}`
      : `${item.repoFullName}#${item.issueNumber}@${item.generatedAt}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(item);
  }

  return merged;
}

function mergeMemorySnapshots(primarySnapshots: MemorySnapshot[], fallbackSnapshots: MemorySnapshot[]): MemorySnapshot[] {
  const merged = new Map(primarySnapshots.map((snapshot) => [snapshot.repoFullName, snapshot]));

  for (const snapshot of fallbackSnapshots) {
    if (!merged.has(snapshot.repoFullName)) {
      merged.set(snapshot.repoFullName, snapshot);
    }
  }

  return [...merged.values()];
}

function deriveProofRecordFromArtifactMarkdown(artifact: ArtifactSnapshot, proofMarkdown: string): ProofRecord | null {
  const activityItems = extractBulletItems(proofMarkdown, '## Recent Activity');
  const topRepositories = extractBulletItems(proofMarkdown, '## Top Repositories');
  const recentMatch = activityItems.find((item) => item.startsWith(`${artifact.repoFullName}#${artifact.issueNumber} |`));
  const published = parseBooleanToken((/\|\s*published=(true|false|yes|no)/i.exec(recentMatch || '') || [])[1]);
  const overallScore = recentMatch ? parseInteger((/overall\s+(\d+)/i.exec(recentMatch) || [])[1], 0) : 0;
  const pullRequestUrl = recentMatch ? cleanOptionalValue((/\|\s*pr=(.+)$/i.exec(recentMatch) || [])[1]) : '';
  const issueTitle = artifact.title || `${artifact.repoFullName}#${artifact.issueNumber}`;

  if (
    !recentMatch
    && activityItems.length === 0
    && topRepositories.length === 0
    && !/-\s*Total Draft Contributions:/i.test(proofMarkdown)
    && !/-\s*Published Runs:/i.test(proofMarkdown)
  ) {
    return null;
  }

  return {
    id: `artifact-proof:${artifact.key}`,
    repoFullName: artifact.repoFullName,
    issueNumber: artifact.issueNumber,
    issueTitle,
    overallScore,
    opportunityScore: overallScore,
    branchName: cleanOptionalValue(extractLineValue(proofMarkdown, '- Last Branch:')),
    artifactDir: artifact.artifactDir,
    generatedAt: artifact.generatedAt,
    published,
    pullRequestUrl,
    pullRequestNumber: parseInteger((/\/pull\/(\d+)/.exec(pullRequestUrl) || [])[1], undefined),
  };
}

function deriveInboxItemFromArtifactMarkdown(artifact: ArtifactSnapshot, inboxMarkdown: string): InboxItem | null {
  const items = extractBulletItems(inboxMarkdown, '# Contribution Inbox');
  const entry = items.find((item) => item.includes(`${artifact.repoFullName}#${artifact.issueNumber}`));

  if (!entry) {
    return null;
  }

  const status = ((/^\[(\w+)\]/.exec(entry) || [])[1] || 'ready').toLowerCase();
  const overallScore = parseInteger((/\|\s*overall\s+(\d+)/i.exec(entry) || [])[1], 0);
  const summary = cleanOptionalValue((/\|\s*overall\s+\d+\s*\|\s*(.+)$/i.exec(entry) || [])[1]) || artifact.summary;

  return {
    id: `${artifact.repoFullName}#${artifact.issueNumber}`,
    repoFullName: artifact.repoFullName,
    issueNumber: artifact.issueNumber,
    issueTitle: artifact.title || `${artifact.repoFullName}#${artifact.issueNumber}`,
    summary,
    overallScore,
    opportunityScore: overallScore,
    status: ['scouted', 'drafted', 'ready'].includes(status) ? status : 'ready',
    artifactDir: artifact.artifactDir,
    generatedAt: artifact.generatedAt,
  };
}

function deriveMemorySnapshotFromArtifactMarkdown(artifact: ArtifactSnapshot, memoryMarkdown: string): MemorySnapshot | null {
  if (
    !/#\s*Repo Memory:/i.test(memoryMarkdown)
    && !/##\s*Run Stats/i.test(memoryMarkdown)
    && !/##\s*Recent Issues/i.test(memoryMarkdown)
    && !/-\s*Generated Dossiers:/i.test(memoryMarkdown)
  ) {
    return null;
  }

  const repoFullName = cleanOptionalValue(extractLineValue(memoryMarkdown, '# Repo Memory:')) || artifact.repoFullName;
  if (!repoFullName) {
    return null;
  }

  const recentIssues = extractBulletItems(memoryMarkdown, '## Recent Issues')
    .map((item) => {
      const parts = item.split('|').map((part) => part.trim());
      const reference = parts[0] || `${artifact.repoFullName}#${artifact.issueNumber}`;
      const overallScore = parseInteger((/score\s+(\d+)/i.exec(parts[1] || '') || [])[1], 0);
      const status = cleanOptionalValue((/status\s+(.+)$/i.exec(parts[2] || '') || [])[1]) || 'selected';
      const changedCount = parseInteger((/changed\s+(\d+)/i.exec(parts[3] || '') || [])[1], 0);
      const published = parseBooleanToken((/published\s+(yes|no)/i.exec(parts[4] || '') || [])[1]);
      const validationSummary = cleanOptionalValue((/validation\s+(.+)$/i.exec(parts[5] || '') || [])[1]) || 'not run';

      return {
        reference,
        title: artifact.title || reference,
        overallScore,
        generatedAt: artifact.generatedAt,
        status,
        changedFiles: Array.from({ length: changedCount }, (_, index) => `changed-${index + 1}`),
        published,
        reviewRequired: status === 'review_required',
        validationSummary,
      };
    });

  return {
    repoFullName,
    firstSeenAt: artifact.generatedAt,
    lastUpdatedAt: cleanOptionalValue(extractLineValue(memoryMarkdown, '- Last Updated:')) || artifact.generatedAt,
    lastSelectedIssue: cleanOptionalValue(extractLineValue(memoryMarkdown, '- Last Selected Issue:')),
    workspacePath: cleanOptionalValue(extractLineValue(memoryMarkdown, '- Workspace Path:')),
    lastBranchName: cleanOptionalValue(extractLineValue(memoryMarkdown, '- Last Branch:')),
    detectedTestCommands: extractBulletItems(memoryMarkdown, '## Detected Test Commands')
      .filter((item) => !/^none detected$/i.test(item))
      .map((item) => item.replace(/^`|`$/g, '')),
    preferredPaths: extractBulletItems(memoryMarkdown, '## Preferred Paths').filter((item) => !/^none recorded$/i.test(item)),
    generatedDossiers: parseInteger(extractLineValue(memoryMarkdown, '- Generated Dossiers:'), artifact.paths.dossier ? 1 : 0),
    runStats: {
      totalRuns: parseInteger(extractLineValue(memoryMarkdown, '- Total Runs:')),
      publishedRuns: parseInteger(extractLineValue(memoryMarkdown, '- Published Runs:')),
      realPrRuns: parseInteger(extractLineValue(memoryMarkdown, '- Draft PR Runs:')),
      reviewRequiredRuns: parseInteger(extractLineValue(memoryMarkdown, '- Review Required Runs:')),
      successfulValidationRuns: parseInteger(extractLineValue(memoryMarkdown, '- Successful Validation Runs:')),
      failedValidationRuns: parseInteger(extractLineValue(memoryMarkdown, '- Failed Validation Runs:')),
    },
    pathSignals: [],
    validationSignals: [],
    recentIssues,
  };
}

function loadState(): DashboardState {
  const configDir = getOpenMetaConfigDir();
  const proofRecords = readJson<{ records?: ProofRecord[] }>(path.join(configDir, 'proof-of-work.json'), { records: [] }).records || [];
  const inboxItems = readJson<{ items?: InboxItem[] }>(path.join(configDir, 'inbox.json'), { items: [] }).items || [];
  const runRecords = readJson<{ records?: RunRecord[] }>(path.join(configDir, 'runs.json'), { records: [] }).records || [];
  const memorySnapshots = loadMemorySnapshots();
  const artifacts = scanArtifactDirs();
  const artifactProofRecords = buildArtifactDerivedProofRecords(artifacts);
  const artifactInboxItems = buildArtifactDerivedInboxItems(artifacts);
  const artifactMemorySnapshots = buildArtifactDerivedMemorySnapshots(artifacts);

  return {
    proofRecords: mergeProofRecords(proofRecords, artifactProofRecords),
    inboxItems: mergeInboxItems(inboxItems, artifactInboxItems),
    runRecords,
    memorySnapshots: mergeMemorySnapshots(memorySnapshots, artifactMemorySnapshots),
    artifacts,
  };
}

function buildArtifactMaps(artifacts: ArtifactSnapshot[]): {
  byDir: Map<string, ArtifactSnapshot>;
  byReference: Map<string, ArtifactSnapshot[]>;
} {
  const byDir = new Map<string, ArtifactSnapshot>();
  const byReference = new Map<string, ArtifactSnapshot[]>();

  for (const artifact of artifacts) {
    byDir.set(normalizePath(artifact.artifactDir), artifact);
    const reference = `${artifact.repoFullName}#${artifact.issueNumber}`;
    const bucket = byReference.get(reference) || [];
    bucket.push(artifact);
    byReference.set(reference, bucket);
  }

  return { byDir, byReference };
}

function buildMemoryIssueMaps(memorySnapshots: MemorySnapshot[]): {
  memoryByRepo: Map<string, MemorySnapshot>;
  issuesByReference: Map<string, Array<MemoryIssue & { repoFullName: string }>>;
} {
  const memoryByRepo = new Map<string, MemorySnapshot>();
  const issuesByReference = new Map<string, Array<MemoryIssue & { repoFullName: string }>>();

  for (const memory of memorySnapshots) {
    if (!memory || !memory.repoFullName) {
      continue;
    }

    memoryByRepo.set(memory.repoFullName, memory);
    for (const issue of memory.recentIssues || []) {
      const reference = issue.reference;
      if (!reference) {
        continue;
      }

      const bucket = issuesByReference.get(reference) || [];
      bucket.push({
        ...issue,
        repoFullName: memory.repoFullName,
      });
      issuesByReference.set(reference, bucket);
    }
  }

  for (const [reference, items] of issuesByReference) {
    items.sort((left, right) => String(right.generatedAt || '').localeCompare(String(left.generatedAt || '')));
    issuesByReference.set(reference, items);
  }

  return { memoryByRepo, issuesByReference };
}

function buildAttemptFromProof(
  record: ProofRecord,
  artifact: ArtifactSnapshot | null | undefined,
  memoryIssue: MemoryIssue | undefined,
): AttemptRecord {
  const title = artifact?.title || memoryIssue?.title || record.issueTitle || `${record.repoFullName}#${record.issueNumber}`;
  const outcome = resolveAttemptOutcome({
    merged: record.merged === true,
    pullRequestUrl: record.pullRequestUrl,
    published: record.published,
    reviewRequired: memoryIssue?.reviewRequired,
    validationSummary: memoryIssue?.validationSummary,
  });
  const summary = summarizeOutcome(outcome, title, {
    summary: artifact?.summary || memoryIssue?.summary || '',
  });
  const generatedAt = record.generatedAt || artifact?.generatedAt || memoryIssue?.generatedAt || new Date().toISOString();
  const openTarget = chooseOpenTarget({
    pullRequestUrl: record.pullRequestUrl,
    dossierPath: artifact?.paths.dossier,
    patchDraftPath: artifact?.paths.patchDraft,
    prDraftPath: artifact?.paths.prDraft,
    fallbackUrl: githubIssueUrl(record.repoFullName, record.issueNumber),
  });

  return enrichAttempt({
    key: `pow:${record.id}`,
    source: 'proof',
    sourceLabel: formatAttemptSourceLabel('proof'),
    repoFullName: record.repoFullName,
    issueNumber: record.issueNumber,
    outcome,
    title,
    summary,
    generatedAt,
    lastUpdatedAt: formatDateOnly(generatedAt),
    detailLink: openTarget.url,
    openTarget,
    artifactDir: artifact?.artifactDir || record.artifactDir || '',
    ledgerTrace: buildLedgerTrace(artifact, record.pullRequestUrl || ''),
    published: Boolean(record.published),
    pullRequestUrl: record.pullRequestUrl || '',
    merged: Boolean(record.merged),
    outcomeFlags: buildOutcomeFlags({
      published: record.published,
      pullRequestUrl: record.pullRequestUrl,
      merged: record.merged,
    }),
    reviewRequired: Boolean(memoryIssue?.reviewRequired),
    validationSummary: memoryIssue?.validationSummary || '',
    score: Number(record.overallScore || record.opportunityScore || 0),
  }, {
    branchName: record.branchName,
    pullRequestNumber: record.pullRequestNumber,
    changedFiles: memoryIssue?.changedFiles || [],
    validationSummary: memoryIssue?.validationSummary || '',
    artifact,
  });
}

function buildAttemptFromMemory(issue: MemoryIssue, artifact: ArtifactSnapshot | null | undefined): AttemptRecord | null {
  const parsed = parseRepoIssueReference(issue.reference);
  if (!parsed) {
    return null;
  }

  const title = artifact?.title || issue.title || `${parsed.repoFullName}#${parsed.issueNumber}`;
  const outcome = resolveAttemptOutcome({
    merged: false,
    pullRequestUrl: issue.pullRequestUrl,
    published: issue.published,
    reviewRequired: issue.reviewRequired,
    validationSummary: issue.validationSummary,
  });
  const summary = summarizeOutcome(outcome, title, {
    summary: artifact?.summary || '',
  });
  const generatedAt = issue.generatedAt || artifact?.generatedAt || new Date().toISOString();
  const openTarget = chooseOpenTarget({
    pullRequestUrl: issue.pullRequestUrl,
    dossierPath: artifact?.paths.dossier,
    patchDraftPath: artifact?.paths.patchDraft,
    prDraftPath: artifact?.paths.prDraft,
    fallbackUrl: githubIssueUrl(parsed.repoFullName, parsed.issueNumber),
  });

  return enrichAttempt({
    key: `memory:${issue.reference}:${generatedAt}`,
    source: 'memory',
    sourceLabel: formatAttemptSourceLabel('memory'),
    repoFullName: parsed.repoFullName,
    issueNumber: parsed.issueNumber,
    outcome,
    title,
    summary,
    generatedAt,
    lastUpdatedAt: formatDateOnly(generatedAt),
    detailLink: openTarget.url,
    openTarget,
    artifactDir: artifact?.artifactDir || '',
    ledgerTrace: buildLedgerTrace(artifact, issue.pullRequestUrl || ''),
    published: Boolean(issue.published),
    pullRequestUrl: issue.pullRequestUrl || '',
    merged: false,
    outcomeFlags: buildOutcomeFlags({
      published: issue.published,
      pullRequestUrl: issue.pullRequestUrl,
      merged: false,
    }),
    reviewRequired: Boolean(issue.reviewRequired),
    validationSummary: issue.validationSummary || '',
    score: Number(issue.overallScore || 0),
  }, {
    branchName: '',
    changedFiles: issue.changedFiles || [],
    validationSummary: issue.validationSummary || '',
    artifact,
  });
}

function buildAttemptFromInbox(item: InboxItem, artifact: ArtifactSnapshot | null | undefined): AttemptRecord {
  const reference = parseRepoIssueReference(item.id);
  const issueNumber = reference?.issueNumber || Number(item.issueNumber || 0);
  const title = artifact?.title || item.issueTitle || `${item.repoFullName}#${issueNumber}`;
  const summary = artifact?.summary || item.summary || `${title} is staged in the contribution inbox and waiting for a deeper pass.`;
  const generatedAt = item.generatedAt || artifact?.generatedAt || new Date().toISOString();
  const openTarget = chooseOpenTarget({
    pullRequestUrl: '',
    dossierPath: artifact?.paths.dossier,
    patchDraftPath: artifact?.paths.patchDraft,
    prDraftPath: artifact?.paths.prDraft,
    fallbackUrl: githubIssueUrl(item.repoFullName, issueNumber),
  });

  return enrichAttempt({
    key: `inbox:${item.id}:${generatedAt}`,
    source: 'inbox',
    sourceLabel: formatAttemptSourceLabel('inbox'),
    repoFullName: item.repoFullName,
    issueNumber,
    outcome: 'draft_only',
    title,
    summary,
    generatedAt,
    lastUpdatedAt: formatDateOnly(generatedAt),
    detailLink: openTarget.url,
    openTarget,
    artifactDir: artifact?.artifactDir || item.artifactDir || '',
    ledgerTrace: buildLedgerTrace(artifact, ''),
    published: false,
    pullRequestUrl: '',
    merged: false,
    outcomeFlags: buildOutcomeFlags({
      published: false,
      pullRequestUrl: '',
      merged: false,
    }),
    reviewRequired: false,
    validationSummary: '',
    score: Number(item.overallScore || item.opportunityScore || 0),
  }, {
    branchName: '',
    changedFiles: [],
    validationSummary: '',
    artifact,
  });
}

function buildAttemptFromArtifact(artifact: ArtifactSnapshot): AttemptRecord {
  const title = artifact.title || `${artifact.repoFullName}#${artifact.issueNumber}`;
  const outcome: AttemptOutcome = 'draft_only';
  const summary = summarizeOutcome(outcome, title, {
    summary: artifact.summary,
  });
  const openTarget = chooseOpenTarget({
    pullRequestUrl: '',
    dossierPath: artifact.paths.dossier,
    patchDraftPath: artifact.paths.patchDraft,
    prDraftPath: artifact.paths.prDraft,
    fallbackUrl: githubIssueUrl(artifact.repoFullName, artifact.issueNumber),
  });

  return enrichAttempt({
    key: `artifact:${artifact.key}`,
    source: 'artifact',
    sourceLabel: formatAttemptSourceLabel('artifact'),
    repoFullName: artifact.repoFullName,
    issueNumber: artifact.issueNumber,
    outcome,
    title,
    summary,
    generatedAt: artifact.generatedAt,
    lastUpdatedAt: formatDateOnly(artifact.generatedAt),
    detailLink: openTarget.url,
    openTarget,
    artifactDir: artifact.artifactDir,
    ledgerTrace: buildLedgerTrace(artifact, ''),
    published: false,
    pullRequestUrl: '',
    merged: false,
    outcomeFlags: buildOutcomeFlags({
      published: false,
      pullRequestUrl: '',
      merged: false,
    }),
    reviewRequired: false,
    validationSummary: '',
    score: 0,
  }, {
    branchName: '',
    changedFiles: [],
    validationSummary: '',
    artifact,
  });
}

function buildAttempts(state: DashboardState): {
  attempts: AttemptRecord[];
  memoryByRepo: Map<string, MemorySnapshot>;
} {
  const { byDir, byReference } = buildArtifactMaps(state.artifacts);
  const { memoryByRepo, issuesByReference } = buildMemoryIssueMaps(state.memorySnapshots);
  const attempts: AttemptRecord[] = [];
  const consumedReferences = new Set<string>();
  const consumedArtifactDirs = new Set<string>();

  const proofRecords = [...state.proofRecords].sort((left, right) => String(right.generatedAt || '').localeCompare(String(left.generatedAt || '')));
  for (const record of proofRecords) {
    const reference = `${record.repoFullName}#${record.issueNumber}`;
    const artifact = record.artifactDir ? byDir.get(normalizePath(record.artifactDir)) : (byReference.get(reference) || [])[0];
    if (artifact) {
      consumedArtifactDirs.add(normalizePath(artifact.artifactDir));
    }
    const memoryIssue = (issuesByReference.get(reference) || [])[0];
    attempts.push(buildAttemptFromProof(record, artifact, memoryIssue));
    consumedReferences.add(reference);
  }

  for (const issues of issuesByReference.values()) {
    for (const issue of issues) {
      if (consumedReferences.has(issue.reference)) {
        continue;
      }

      const parsed = parseRepoIssueReference(issue.reference);
      const artifact = parsed ? (byReference.get(issue.reference) || [])[0] : null;
      if (artifact) {
        consumedArtifactDirs.add(normalizePath(artifact.artifactDir));
      }

      const attempt = buildAttemptFromMemory(issue, artifact);
      if (attempt) {
        attempts.push(attempt);
        consumedReferences.add(issue.reference);
      }
    }
  }

  for (const item of state.inboxItems) {
    const reference = item.id || `${item.repoFullName}#${item.issueNumber}`;
    if (consumedReferences.has(reference)) {
      continue;
    }

    const artifact = item.artifactDir ? byDir.get(normalizePath(item.artifactDir)) : (byReference.get(reference) || [])[0];
    if (artifact) {
      consumedArtifactDirs.add(normalizePath(artifact.artifactDir));
    }
    attempts.push(buildAttemptFromInbox(item, artifact));
    consumedReferences.add(reference);
  }

  for (const artifact of state.artifacts) {
    if (consumedArtifactDirs.has(normalizePath(artifact.artifactDir))) {
      continue;
    }
    attempts.push(buildAttemptFromArtifact(artifact));
  }

  const threshold = new Date();
  threshold.setDate(threshold.getDate() - LOOKBACK_DAYS);

  return {
    attempts: attempts
      .filter((item) => {
        const date = parseIso(item.generatedAt);
        return !date || date >= threshold;
      })
      .sort((left, right) => String(right.generatedAt || '').localeCompare(String(left.generatedAt || ''))),
    memoryByRepo,
  };
}

function getStartOfWeek(date: Date): Date {
  const start = new Date(date);
  const day = start.getDay();
  const delta = day === 0 ? -6 : 1 - day;
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() + delta);
  return start;
}

function getStartOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function formatWeekLabel(date: Date): string {
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())}`;
}

function formatMonthLabel(date: Date): string {
  return date.toLocaleString('en-US', { month: 'short' });
}

function buildTrends(attempts: AttemptRecord[]): Trends {
  const now = new Date();
  const weeklyBuckets: Array<{ start: Date; end: Date; label: string }> = [];
  const monthlyBuckets: Array<{ start: Date; end: Date; label: string }> = [];

  for (let index = WEEK_BUCKETS - 1; index >= 0; index -= 1) {
    const end = getStartOfWeek(now);
    end.setDate(end.getDate() - (index * 7));
    const start = new Date(end);
    const bucketEnd = new Date(start);
    bucketEnd.setDate(bucketEnd.getDate() + 7);
    weeklyBuckets.push({
      start,
      end: bucketEnd,
      label: formatWeekLabel(start),
    });
  }

  for (let index = MONTH_BUCKETS - 1; index >= 0; index -= 1) {
    const start = getStartOfMonth(new Date(now.getFullYear(), now.getMonth() - index, 1));
    const end = getStartOfMonth(new Date(start.getFullYear(), start.getMonth() + 1, 1));
    monthlyBuckets.push({
      start,
      end,
      label: formatMonthLabel(start),
    });
  }

  const toTrendRow = (bucket: { start: Date; end: Date; label: string }): TrendRow => {
    const bucketAttempts = attempts.filter((item) => {
      const date = parseIso(item.generatedAt);
      return Boolean(date && date >= bucket.start && date < bucket.end);
    });

    return {
      period: bucket.label,
      drafted: bucketAttempts.length,
      ledgerPublished: bucketAttempts.filter((item) => item.published).length,
      prOpen: bucketAttempts.filter((item) => item.pullRequestUrl).length,
      merged: bucketAttempts.filter((item) => item.merged).length,
      sourceBreakdown: {
          proof: bucketAttempts.filter((item) => item.source === 'proof').length,
          memory: bucketAttempts.filter((item) => item.source === 'memory').length,
          inbox: bucketAttempts.filter((item) => item.source === 'inbox').length,
          artifact: bucketAttempts.filter((item) => item.source === 'artifact').length,
        },
      };
  };

  return {
    weekly: weeklyBuckets.map(toTrendRow),
    monthly: monthlyBuckets.map(toTrendRow),
  };
}

function computeRepoSignal(repoFullName: string, attempts: AttemptRecord[], memory: MemorySnapshot | null): ProjectSignal {
  const attemptCount = attempts.length;
  const publishedCount = attempts.filter((item) => item.published).length;
  const prOpenCount = attempts.filter((item) => item.pullRequestUrl).length;
  const mergedCount = attempts.filter((item) => item.merged).length;
  const activeWeeks = new Set(
    attempts
      .map((item) => parseIso(item.generatedAt))
      .filter((date): date is Date => Boolean(date))
      .map((date) => formatWeekLabel(getStartOfWeek(date))),
  ).size;
  const successfulRuns = Number(memory?.runStats?.successfulValidationRuns || 0);
  const totalRuns = Number(memory?.runStats?.totalRuns || 0);
  const validationRate = totalRuns > 0 ? Math.round((successfulRuns / totalRuns) * 100) : 0;
  const revisit = clamp(Math.round(18 + attemptCount * 11 + activeWeeks * 5), 12, 95);
  const landingBase = attemptCount > 0
    ? ((publishedCount * 0.55 + prOpenCount * 0.8 + mergedCount) / attemptCount) * 100
    : 0;
  const landing = clamp(Math.round(landingBase * 0.75 + validationRate * 0.25), 8, 95);
  const memoryScore = clamp(
    Math.round(
      12
      + Number(memory?.generatedDossiers || 0) * 7
      + Number(memory?.preferredPaths?.length || 0) * 4
      + Math.min(18, Number(memory?.pathSignals?.length || 0) * 2)
      + Math.min(12, Number(memory?.detectedTestCommands?.length || 0) * 2)
      + Math.min(16, totalRuns * 3),
    ),
    10,
    95,
  );
  const score = clamp(Math.round(revisit * 0.35 + landing * 0.4 + memoryScore * 0.25), 0, 100);

  const trend = buildTrends(attempts).weekly.slice(-4).map((item) => item.drafted);

  return {
    repoFullName,
    revisit,
    landing,
    memory: memoryScore,
    score,
    trend,
  };
}

function decisionFromScore(
  score: number,
  index: number,
  repo: Pick<ProjectStatsRow, 'prOpenCount' | 'publishedCount'>,
): Decision {
  if (score >= 72 || (index === 0 && score >= 52) || (repo.prOpenCount > 0 && score >= 60)) {
    return 'deepen';
  }

  if (score >= 44 || repo.publishedCount > 0) {
    return 'watch';
  }

  return 'pause';
}

function buildProjectStats(attempts: AttemptRecord[], memoryByRepo: Map<string, MemorySnapshot>): ProjectStatsRow[] {
  const grouped = new Map<string, AttemptRecord[]>();

  for (const attempt of attempts) {
    const bucket = grouped.get(attempt.repoFullName) || [];
    bucket.push(attempt);
    grouped.set(attempt.repoFullName, bucket);
  }

  const rows = [...grouped.entries()].map(([repoFullName, items]) => {
    const sortedItems = [...items].sort((left, right) => String(right.generatedAt || '').localeCompare(String(left.generatedAt || '')));
    const memory = memoryByRepo.get(repoFullName) || null;
    const signal = computeRepoSignal(repoFullName, sortedItems, memory);
    const latest = sortedItems[0];
    if (!latest) {
      throw new Error(`Missing latest attempt for ${repoFullName}`);
    }
    const publishedCount = sortedItems.filter((item) => item.published).length;
    const prOpenCount = sortedItems.filter((item) => item.pullRequestUrl).length;
    const mergedCount = sortedItems.filter((item) => item.merged).length;
      const stalledCount = sortedItems.filter((item) => item.reviewRequired || item.outcome === 'stalled').length;
    const reviewRequiredCount = sortedItems.filter((item) => item.reviewRequired).length;
      const validationFailedCount = sortedItems.filter((item) => item.validationState === 'failed').length;
    const openAttemptCount = sortedItems.filter((item) => !item.merged && !item.pullRequestUrl).length;
    const reopenableAttemptCount = sortedItems.filter((item) => item.isReopenable).length;
    const stalePublishedWithoutPrCount = sortedItems.filter((item) => item.published && !item.pullRequestUrl && !item.merged && item.staleDays >= STALE_ATTEMPT_DAYS).length;
    const stalePrOpenCount = sortedItems.filter((item) => item.pullRequestUrl && !item.merged && item.staleDays >= STALE_ATTEMPT_DAYS).length;
    const openAttemptAges = sortedItems
      .filter((item) => !item.merged && !item.pullRequestUrl)
      .map((item) => item.ageDays);
    const oldestOpenAttemptAgeDays = openAttemptAges.length > 0 ? Math.max(...openAttemptAges) : 0;
    const activeWindowSpanDays = computeActiveWindowSpanDays(sortedItems);
    const returnSessions = computeReturnSessions(sortedItems);
    const consecutiveActiveWindows = computeConsecutiveActiveWindows(sortedItems);
    const dominantWorkType = resolveDominantWorkType(sortedItems);
    const topAreas = summarizeTopAreas(sortedItems);
    const highLeverageAttemptCount = sortedItems.filter((item) => item.highLeverage).length;
    const activeWeeks = new Set(
      sortedItems
        .map((item) => parseIso(item.generatedAt))
        .filter((date): date is Date => Boolean(date))
        .map((date) => formatWeekLabel(getStartOfWeek(date))),
    ).size;

    return {
      repoFullName,
      attempts: sortedItems,
      memory,
      signal,
      contributionCount: sortedItems.length,
      publishedCount,
      prOpenCount,
      mergedCount,
      stalledCount,
      reviewRequiredCount,
      validationFailedCount,
      openAttemptCount,
      reopenableAttemptCount,
      stalePublishedWithoutPrCount,
      stalePrOpenCount,
      oldestOpenAttemptAgeDays,
      activeWindowSpanDays,
      returnSessions,
      consecutiveActiveWindows,
      dominantWorkType,
      topAreas,
      highLeverageAttemptCount,
      activeWeeks,
      attemptToPublishedRate: toRate(publishedCount, sortedItems.length),
      attemptToPrRate: toRate(prOpenCount, sortedItems.length),
      attemptToMergedRate: toRate(mergedCount, sortedItems.length),
      lastSuccessfulLandingAt: findLatestLandingDate(sortedItems),
      lastMeaningfulLandingAt: findLastMeaningfulLandingDate(sortedItems),
      latest,
    };
  });

  rows.sort((left, right) => right.signal.score - left.signal.score || right.contributionCount - left.contributionCount);

  return rows.map((row, index) => ({
    ...row,
    decision: decisionFromScore(row.signal.score, index, row),
  }));
}

function buildFocus(projectRows: ProjectStatsRow[]): FocusGroups {
  const groups: FocusGroups = {
    deepen: [],
    watch: [],
    pause: [],
  };

  for (const row of projectRows) {
    const reasons = [
      `${row.contributionCount} tracked attempts in the current window`,
      `${row.publishedCount} ledger publications | ${row.prOpenCount} live PRs`,
      `${Number(row.memory?.generatedDossiers || 0)} dossiers | ${Number(row.memory?.preferredPaths?.length || 0)} preferred paths`,
    ];

    let summary = '';
    if (row.decision === 'deepen') {
      summary = `${row.repoFullName} already shows repeated contribution motion and enough saved context to justify another focused pass.`;
    } else if (row.decision === 'watch') {
      summary = `${row.repoFullName} has a usable trail, but it still wants one cleaner landing before it deserves more allocation.`;
    } else {
      summary = `${row.repoFullName} still has some retained context, but the lane is thinner than stronger opportunities right now.`;
    }

    groups[row.decision].push({
      repoFullName: row.repoFullName,
      summary,
      reasons,
    });
  }

  return {
    deepen: groups.deepen.slice(0, 3),
    watch: groups.watch.slice(0, 3),
    pause: groups.pause.slice(0, 3),
  };
}

function buildProjects(projectRows: ProjectStatsRow[]): ProjectRow[] {
  return projectRows.map((row) => ({
    repoFullName: row.repoFullName,
    decision: row.decision,
    contributionCount: row.contributionCount,
    mergedCount: row.mergedCount,
    publishedCount: row.publishedCount,
    ledgerPublishedCount: row.publishedCount,
    prOpenCount: row.prOpenCount,
    reviewRequiredCount: row.reviewRequiredCount,
    validationFailedCount: row.validationFailedCount,
    openAttemptCount: row.openAttemptCount,
    activeWeeks: row.activeWeeks,
    attemptToPublishedRate: row.attemptToPublishedRate,
    attemptToPrRate: row.attemptToPrRate,
    attemptToMergedRate: row.attemptToMergedRate,
    lastSuccessfulLandingAt: row.lastSuccessfulLandingAt,
    lastMeaningfulLandingAt: row.lastMeaningfulLandingAt,
    lastOutcome: row.latest.outcome,
    lastActiveAt: formatDateOnly(row.latest.generatedAt),
    representativeTitle: row.latest.title,
    score: row.signal.score,
    detailLink: row.latest.detailLink,
    reopenableAttemptCount: row.reopenableAttemptCount,
    stalePublishedWithoutPrCount: row.stalePublishedWithoutPrCount,
    stalePrOpenCount: row.stalePrOpenCount,
    oldestOpenAttemptAgeDays: row.oldestOpenAttemptAgeDays,
    activeWindowSpanDays: row.activeWindowSpanDays,
    returnSessions: row.returnSessions,
    consecutiveActiveWindows: row.consecutiveActiveWindows,
    dominantWorkType: row.dominantWorkType,
    topAreas: row.topAreas,
    highLeverageAttemptCount: row.highLeverageAttemptCount,
    sourceMix: {
        proof: row.attempts.filter((item) => item.source === 'proof').length,
        memory: row.attempts.filter((item) => item.source === 'memory').length,
        inbox: row.attempts.filter((item) => item.source === 'inbox').length,
        artifact: row.attempts.filter((item) => item.source === 'artifact').length,
      },
    note: `${row.publishedCount} ledger published | ${row.prOpenCount} PR open | ${row.reopenableAttemptCount} reopenable`,
    conversionNote: `pub ${row.attemptToPublishedRate}% | pr ${row.attemptToPrRate}% | merge ${row.attemptToMergedRate}%`,
    blockageNote: `${row.stalePublishedWithoutPrCount} published waiting PR | ${row.stalePrOpenCount} stale PR | ${row.oldestOpenAttemptAgeDays}d oldest open`,
  }));
}

function buildActivity(attempts: DashboardAttempt[]): ActivityItem[] {
  return attempts.slice(0, 12).map((item) => ({
    type: item.outcome,
    repoFullName: item.repoFullName,
    title: item.title,
    date: formatDateOnly(item.generatedAt),
    description: item.summary,
  }));
}

function archiveStatusFromAttempt(attempt: DashboardAttempt): ArchiveStatus {
  if (attempt.outcome === 'merged') {
    return 'ready';
  }
  if (attempt.outcome === 'pr_open' || attempt.outcome === 'published') {
    return 'compounding';
  }
  if (attempt.outcome === 'stalled') {
    return 'review';
  }
  return 'hold';
}

function buildArchive(attempts: DashboardAttempt[]): ArchiveItem[] {
  return attempts.slice(0, 8).map((attempt) => {
    const lines: string[] = [];

    if (attempt.ledgerTrace.includes('dossier')) {
      lines.push('dossier.md retained');
    }
    if (attempt.ledgerTrace.includes('patch')) {
      lines.push('patch-draft.md retained');
    }
    if (attempt.ledgerTrace.includes('pr')) {
      lines.push(attempt.pullRequestUrl ? 'live PR link retained' : 'pr-draft.md retained');
    }
    if (attempt.ledgerTrace.includes('memory')) {
      lines.push('repo-memory.md retained');
    }
    if (attempt.validationSummary) {
      lines.push(`validation: ${attempt.validationSummary}`);
    }
    if (lines.length === 0) {
      lines.push('local artifact trail retained');
    }

    const evidenceLevel: ArchiveEvidenceLevel = attempt.source === 'proof'
      ? 'proof-backed'
      : attempt.pullRequestUrl
        ? 'live-pr'
        : attempt.source === 'memory'
          ? 'memory-backed'
          : 'artifact-only';

    return {
      label:
        attempt.outcome === 'pr_open'
          ? 'Live PR trail'
          : attempt.outcome === 'published'
            ? 'Published ledger bundle'
            : attempt.outcome === 'stalled'
              ? 'Needs review bundle'
              : 'Local artifact bundle',
      repoFullName: attempt.repoFullName,
      title: attempt.title,
      lines: lines.slice(0, 4),
      status: archiveStatusFromAttempt(attempt),
      evidenceLevel,
      assetCompletenessLabel: attempt.assetCompletenessLabel,
      assetCompletenessCount: attempt.assetCompletenessCount,
      reuseLabel: describeArchiveReuse(attempt),
      followThroughLabel: describeArchiveFollowThrough(attempt),
      lastRevisitedAt: attempt.lastUpdatedAt || formatDateOnly(attempt.generatedAt),
    };
  });
}

function buildAssets(artifacts: ArtifactSnapshot[]): AssetsSummary {
  return artifacts.reduce(
    (acc, artifact) => ({
      dossiers: acc.dossiers + (artifact.paths.dossier ? 1 : 0),
      patchDrafts: acc.patchDrafts + (artifact.paths.patchDraft ? 1 : 0),
      prDrafts: acc.prDrafts + (artifact.paths.prDraft ? 1 : 0),
      memoryFiles: acc.memoryFiles + (artifact.paths.memory ? 1 : 0),
    }),
    {
      dossiers: 0,
      patchDrafts: 0,
      prDrafts: 0,
      memoryFiles: 0,
    } satisfies AssetsSummary,
  );
}

function buildSummary(
  attempts: DashboardAttempt[],
  projectRows: ProjectStatsRow[],
  assets: AssetsSummary,
  runRecords: RunRecord[],
): SummaryBlock {
  const lastAttempt = attempts[0];
  const publishedRuns = attempts.filter((item) => item.published).length;
  const realPrRuns = attempts.filter((item) => item.pullRequestUrl).length;
  const mergedRuns = attempts.filter((item) => item.merged).length;
  const reopenableBacklogTotal = attempts.filter((item) => item.isReopenable).length;
  const stalePublishedBacklogTotal = attempts.filter((item) => item.published && !item.pullRequestUrl && !item.merged && item.staleDays >= STALE_ATTEMPT_DAYS).length;
  const reposWithReturnMotion = projectRows.filter((item) => item.returnSessions > 1).length;
  const highLeverageAttemptTotal = attempts.filter((item) => item.highLeverage).length;
  const dominantWorkType = resolveDominantWorkType(attempts);
  const topAreas = summarizeTopAreas(attempts);
  const archivedAssets = Object.values(assets).reduce((sum, value) => sum + value, 0);
  const lastRun = [...runRecords].sort((left, right) => String(right.startedAt || '').localeCompare(String(left.startedAt || '')))[0];
  const lastActiveAt = lastAttempt?.generatedAt || lastRun?.startedAt || new Date().toISOString();
  const sourceBreakdown = {
     proof: attempts.filter((item) => item.source === 'proof').length,
     memory: attempts.filter((item) => item.source === 'memory').length,
     inbox: attempts.filter((item) => item.source === 'inbox').length,
     artifact: attempts.filter((item) => item.source === 'artifact').length,
   };

  return {
    totalContributions: attempts.length,
    uniqueProjects: projectRows.length,
    publishedRuns,
    ledgerPublishedRuns: publishedRuns,
    realPrRuns,
    mergedRuns,
    archivedAssets,
    reopenableBacklogTotal,
    stalePublishedBacklogTotal,
    reposWithReturnMotion,
    highLeverageAttemptTotal,
    dominantWorkType,
    topAreas,
    lastActiveAt: formatDateTime(lastActiveAt),
    sourceBreakdown,
    callout:
      attempts.length > 0
        ? `${realPrRuns} upstream PRs tracked, ${reopenableBacklogTotal} reopenable attempts, ${projectRows.filter((item) => item.decision === "deepen").length} lanes worth deeper follow-through.`
         : 'No real contribution records are available yet. Generate or publish one run to start the ledger trail.',
  };
}

function buildTopMeta(summary: SummaryBlock, _projectRows: ProjectStatsRow[], sources: DashboardState): MetaEntry[] {
  const activeRepos = summary.uniqueProjects;
  const sourceLabels: string[] = [];
  if (sources.proofRecords.length > 0) {
    sourceLabels.push('PoW');
  }
  if (sources.memorySnapshots.length > 0) {
    sourceLabels.push('memory');
  }
  if (sources.inboxItems.length > 0) {
    sourceLabels.push('inbox');
  }
  if (sources.artifacts.length > 0) {
    sourceLabels.push('artifacts');
  }

  return [
    {
      label: 'Ledger Snapshot',
      value: summary.totalContributions > 0 ? 'Real local state' : 'No real state yet',
    },
    {
      label: 'Tracked Repositories',
      value: `${activeRepos} active repos`,
    },
    {
      label: 'State Sources',
      value: sourceLabels.length > 0 ? sourceLabels.join(', ') : 'awaiting first contribution run',
    },
    {
      label: 'Attempt Sources',
      value: `${summary.sourceBreakdown.proof} proof | ${summary.sourceBreakdown.memory} memory | ${summary.sourceBreakdown.artifact} artifact`,
    },
  ];
}

function buildProjectSignals(projectRows: ProjectStatsRow[]): Record<string, ProjectSignalMapEntry> {
  return Object.fromEntries(
    projectRows.map((row) => [
      row.repoFullName,
      {
        revisit: row.signal.revisit,
        landing: row.signal.landing,
        memory: row.signal.memory,
        trend: row.signal.trend.length > 0 ? row.signal.trend : [0, 0, 0, 0],
      },
    ]),
  );
}

function buildDashboardData(): DashboardData {
  const state = loadState();
  const { attempts: rawAttempts, memoryByRepo } = buildAttempts(state);
  const attempts: AttemptRecord[] = rawAttempts.map((item) => ({
    ...item,
    outcome: item.outcome || resolveAttemptOutcome(item),
  }));
  const projectRows = buildProjectStats(attempts, memoryByRepo);
  const decisionByRepo = new Map<string, Decision>(projectRows.map((row) => [row.repoFullName, row.decision]));
  const normalizedAttempts: DashboardAttempt[] = attempts.map((item) => ({
    ...item,
    reference: item.reference || `${item.repoFullName}#${item.issueNumber}`,
    decision: decisionByRepo.get(item.repoFullName) || 'watch',
    outcome: item.outcome || resolveAttemptOutcome(item),
    sourceLabel: item.sourceLabel || formatAttemptSourceLabel(item.source),
    openTarget: item.openTarget || { url: item.detailLink, label: 'Open', kind: 'fallback' },
    issueUrl: item.issueUrl || githubIssueUrl(item.repoFullName, item.issueNumber),
    branchName: item.branchName || '',
    changedFiles: item.changedFiles || [],
    changedFilesCount: item.changedFilesCount || 0,
    changedFilePreview: item.changedFilePreview || [],
    fileAreaHints: item.fileAreaHints || [],
    reviewRequired: Boolean(item.reviewRequired),
    validationSummary: item.validationSummary || '',
    validationState: item.validationState || deriveValidationState(item.validationSummary),
    blockedReason: item.blockedReason || 'local_only',
    blockedLabel: item.blockedLabel || '',
    assetCoverage: item.assetCoverage || buildAssetCoverage(null, item.pullRequestUrl || ''),
    assetCompletenessCount: item.assetCompletenessCount || 0,
    assetCompletenessLabel: item.assetCompletenessLabel || '0/4 assets',
    outcomeFlags: item.outcomeFlags || buildOutcomeFlags(item),
  }));
  const assets = buildAssets(state.artifacts);
  const summary = buildSummary(normalizedAttempts, projectRows, assets, state.runRecords);
  const trends = buildTrends(normalizedAttempts);
  const focus = buildFocus(projectRows);
  const projects = buildProjects(projectRows);
  const activity = buildActivity(normalizedAttempts);
  const archive = buildArchive(normalizedAttempts);
  const topMeta = buildTopMeta(summary, projectRows, state);
  const availableRepos = ['all', ...projects.map((item) => item.repoFullName)];
  const generatedAt = new Date().toISOString();
  const lastRun = [...state.runRecords].sort((left, right) => String(right.startedAt || '').localeCompare(String(left.startedAt || '')))[0];
  const mode: DashboardMode = summary.totalContributions > 0 || Object.values(assets).some((value) => value > 0) ? 'real' : 'empty';
  const syncStatusParts = [mode === 'real' ? 'Real snapshot' : 'No local contribution state'];
  if (lastRun) {
    syncStatusParts.push(`latest run ${String(lastRun.commandName || "").replace(/^OpenMeta\s+/i, "").trim() || lastRun.commandName}`.trim());
  }

  return {
    meta: {
      generatedAt,
      windowLabel: `Last ${LOOKBACK_DAYS} days`,
      mode,
      refreshLabel: 'Refresh local snapshot',
    },
    topMeta,
    filters: {
      availableRepos,
      availableDecisions: ['all', 'deepen', 'watch', 'pause'],
    },
    attemptFilters: {
      availableOutcomes: ['all', 'merged', 'pr_open', 'published', 'draft_only', 'stalled'],
    },
    sync: {
      lastRefreshedAt: formatDateTime(generatedAt),
      status: syncStatusParts.join(" | "),
    },
    summary,
    trends,
    focus,
    projects,
    attempts: normalizedAttempts.slice(0, 50),
    activity,
    assets,
    archive,
    projectSignals: buildProjectSignals(projectRows),
  };
}

export {
  buildDashboardData,
};
