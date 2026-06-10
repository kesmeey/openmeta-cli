const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");

const LOOKBACK_DAYS = 90;
const WEEK_BUCKETS = 8;
const MONTH_BUCKETS = 6;

function getOpenMetaConfigDir() {
  return process.env.OPENMETA_CONFIG_DIR || path.join(os.homedir(), ".config", "openmeta");
}

function getOpenMetaHome() {
  return process.env.OPENMETA_HOME || path.join(os.homedir(), ".openmeta");
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return fallback;
  }
}

function readText(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return "";
    }
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

function normalizePath(filePath) {
  return path.resolve(filePath).toLowerCase();
}

function parseIso(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function formatDateTime(value) {
  const date = value instanceof Date ? value : parseIso(value);
  if (!date) {
    return "n/a";
  }

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDateOnly(value) {
  const date = value instanceof Date ? value : parseIso(value);
  if (!date) {
    return "n/a";
  }

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toFileUrl(filePath) {
  return pathToFileURL(filePath).href;
}

function githubIssueUrl(repoFullName, issueNumber) {
  if (!repoFullName || !issueNumber) {
    return "";
  }
  return `https://github.com/${repoFullName}/issues/${issueNumber}`;
}

function parseRepoIssueReference(reference) {
  const match = /^([^#]+)#(\d+)$/.exec(reference || "");
  if (!match || !match[1] || !match[2]) {
    return null;
  }

  return {
    repoFullName: match[1],
    issueNumber: Number.parseInt(match[2], 10),
  };
}

function extractSectionValue(content, heading) {
  const pattern = new RegExp(`${escapeRegExp(heading)}\\s*\\n\\s*\\n([^\\n]+)`, "i");
  const match = content.match(pattern);
  return match && match[1] ? match[1].trim() : "";
}

function extractLineValue(content, prefix) {
  const pattern = new RegExp(`^${escapeRegExp(prefix)}\\s*(.+)$`, "im");
  const match = content.match(pattern);
  return match && match[1] ? match[1].trim() : "";
}

function cleanOptionalValue(value) {
  if (!value) {
    return "";
  }

  return /^(n\/a|none yet|none recorded)$/i.test(value.trim()) ? "" : value.trim();
}

function parseInteger(value, fallback = 0) {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function extractBulletItems(content, heading) {
  const lines = String(content || "").split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim().toLowerCase() === heading.trim().toLowerCase());
  if (start === -1) {
    return [];
  }

  const items = [];
  let index = start + 1;
  while (index < lines.length && lines[index].trim() === "") {
    index += 1;
  }

  for (; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (!trimmed) {
      if (items.length > 0) {
        break;
      }
      continue;
    }

    if (trimmed.startsWith("#") || trimmed.startsWith("_Snapshot Date")) {
      break;
    }

    if (!trimmed.startsWith("- ")) {
      break;
    }

    items.push(trimmed.slice(2).trim());
  }

  return items;
}

function parseBooleanToken(value) {
  return /^(true|yes)$/i.test(String(value || "").trim());
}

function parseArtifactDirName(dirName) {
  const match = /^(.*)__(\d+)$/.exec(dirName);
  if (!match || !match[1] || !match[2]) {
    return null;
  }

  return {
    repoFullName: match[1].replace(/__/g, "/"),
    issueNumber: Number.parseInt(match[2], 10),
  };
}

function summarizeOutcome(outcome, title, context) {
  if (context.summary) {
    return context.summary;
  }

  if (outcome === "merged") {
    return `${title} has already landed upstream and is preserved in the ledger.`;
  }

  if (outcome === "pr_open") {
    return `${title} already has a live upstream PR linked to the local ledger trail.`;
  }

  if (outcome === "published") {
    return `${title} has a published artifact bundle and can be resumed without rebuilding context.`;
  }

  if (outcome === "stalled") {
    return `${title} still needs another validation or review pass before it can move forward.`;
  }

  return `${title} has a local artifact trail, but it has not crossed into a published outcome yet.`;
}

function resolveAttemptOutcome(input) {
  if (input.merged) {
    return "merged";
  }

  if (input.pullRequestUrl) {
    return "pr_open";
  }

  if (input.published) {
    return "published";
  }

  if (input.reviewRequired || /failed/i.test(input.validationSummary || "")) {
    return "stalled";
  }

  return "draft_only";
}

function buildOutcomeFlags(input) {
  return {
    hasLedgerPublication: Boolean(input.published),
    hasUpstreamPr: Boolean(input.pullRequestUrl),
    hasMerged: Boolean(input.merged),
  };
}

function formatAttemptSourceLabel(source) {
  if (source === "proof") {
    return "Proof";
  }
  if (source === "memory") {
    return "Memory";
  }
  if (source === "inbox") {
    return "Inbox";
  }
  if (source === "artifact") {
    return "Artifact";
  }
  return "Local";
}

function chooseOpenTarget(input) {
  if (input.pullRequestUrl) {
    return {
      url: input.pullRequestUrl,
      label: "PR",
      kind: "pr",
    };
  }

  if (input.dossierPath) {
    return {
      url: toFileUrl(input.dossierPath),
      label: "Dossier",
      kind: "dossier",
    };
  }

  if (input.patchDraftPath) {
    return {
      url: toFileUrl(input.patchDraftPath),
      label: "Patch",
      kind: "patch",
    };
  }

  if (input.prDraftPath) {
    return {
      url: toFileUrl(input.prDraftPath),
      label: "PR Draft",
      kind: "pr_draft",
    };
  }

  return {
    url: input.fallbackUrl || "",
    label: "Open",
    kind: "fallback",
  };
}

function buildLedgerTrace(artifact, pullRequestUrl) {
  const trace = [];

  if (artifact?.paths.dossier) {
    trace.push("dossier");
  }
  if (artifact?.paths.patchDraft) {
    trace.push("patch");
  }
  if (pullRequestUrl || artifact?.paths.prDraft) {
    trace.push("pr");
  }
  if (artifact?.paths.memory) {
    trace.push("memory");
  }

  return trace.length > 0 ? trace : ["patch"];
}

function normalizeRepoFilePath(filePath) {
  return String(filePath || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "");
}

function summarizeChangedFiles(changedFiles) {
  return (changedFiles || [])
    .map((filePath) => normalizeRepoFilePath(filePath))
    .filter(Boolean);
}

function summarizeFileAreas(changedFiles) {
  const seen = new Set();
  const areas = [];

  for (const filePath of summarizeChangedFiles(changedFiles)) {
    const parts = filePath.split("/").filter(Boolean);
    if (parts.length === 0) {
      continue;
    }

    const area = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parts[0];
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

function parsePullRequestNumber(pullRequestUrl) {
  const match = /\/pull\/(\d+)/.exec(pullRequestUrl || "");
  return match && match[1] ? Number.parseInt(match[1], 10) : undefined;
}

function deriveValidationState(validationSummary) {
  const summary = String(validationSummary || "").trim().toLowerCase();
  if (!summary || summary === "not run") {
    return "not_run";
  }

  if (summary.includes("fail") || summary.includes("error")) {
    return "failed";
  }

  if (summary.includes("pass") || summary.includes("success") || summary.includes("ok")) {
    return "passed";
  }

  return "reported";
}

function deriveAttemptBlockage(input) {
  if (input.merged) {
    return {
      key: "landed",
      label: "landed upstream",
    };
  }

  if (input.pullRequestUrl) {
    return {
      key: "upstream_pr_open",
      label: "PR open upstream",
    };
  }

  if (input.reviewRequired) {
    return {
      key: "review_required",
      label: "review required",
    };
  }

  if (input.validationState === "failed") {
    return {
      key: "validation_failed",
      label: "validation failed",
    };
  }

  if (input.published) {
    return {
      key: "waiting_for_pr",
      label: "published, waiting for PR",
    };
  }

  if (input.validationState === "passed") {
    return {
      key: "validated_local",
      label: "validated locally",
    };
  }

  return {
    key: "local_only",
    label: "local draft only",
  };
}

function buildAssetCoverage(artifact, pullRequestUrl) {
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

function enrichAttempt(baseAttempt, input) {
  const changedFiles = summarizeChangedFiles(input.changedFiles);
  const validationSummary = input.validationSummary || "";
  const validationState = deriveValidationState(validationSummary);
  const blockage = deriveAttemptBlockage({
    merged: baseAttempt.merged,
    pullRequestUrl: baseAttempt.pullRequestUrl,
    published: baseAttempt.published,
    reviewRequired: baseAttempt.reviewRequired,
    validationState,
  });
  const assetCoverage = buildAssetCoverage(input.artifact, baseAttempt.pullRequestUrl);

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
    validationSummary,
    validationState,
    blockedReason: blockage.key,
    blockedLabel: blockage.label,
    assetCoverage,
    assetCompletenessCount: assetCoverage.count,
    assetCompletenessLabel: assetCoverage.label,
  };
}

function findLatestLandingDate(attempts) {
  const latest = attempts.find((item) => item.merged || item.pullRequestUrl || item.published);
  return latest ? formatDateOnly(latest.generatedAt) : "n/a";
}

function toRate(numerator, denominator) {
  return denominator > 0 ? Math.round((numerator / denominator) * 100) : 0;
}

function describeArchiveFollowThrough(attempt) {
  if (attempt.merged) {
    return "merged upstream";
  }
  if (attempt.pullRequestUrl) {
    return "converted into PR";
  }
  if (attempt.published) {
    return "ledger published";
  }
  if (attempt.reviewRequired || attempt.validationState === "failed") {
    return "stopped before landing";
  }
  return "not landed yet";
}

function describeArchiveReuse(attempt) {
  if (attempt.assetCoverage?.memory && (attempt.pullRequestUrl || attempt.published || attempt.merged)) {
    return "context compounding";
  }
  if (attempt.assetCoverage?.memory) {
    return "context retained";
  }
  if ((attempt.assetCompletenessCount || 0) >= 3) {
    return "bundle retained";
  }
  return "thin trail";
}

function scanArtifactDirs() {
  const artifactRoot = path.join(getOpenMetaHome(), "artifacts");
  if (!fs.existsSync(artifactRoot)) {
    return [];
  }

  const snapshots = [];
  const dayEntries = fs.readdirSync(artifactRoot, { withFileTypes: true });

  for (const dayEntry of dayEntries) {
    if (!dayEntry.isDirectory()) {
      continue;
    }

    const dayPath = path.join(artifactRoot, dayEntry.name);
    const candidateEntries = fs.readdirSync(dayPath, { withFileTypes: true });

    for (const candidateEntry of candidateEntries) {
      if (!candidateEntry.isDirectory() || candidateEntry.name === "analysis") {
        continue;
      }

      const parsed = parseArtifactDirName(candidateEntry.name);
      if (!parsed) {
        continue;
      }

      const artifactDir = path.join(dayPath, candidateEntry.name);
      const dossierPath = path.join(artifactDir, "dossier.md");
      const patchDraftPath = path.join(artifactDir, "patch-draft.md");
      const prDraftPath = path.join(artifactDir, "pr-draft.md");
      const memoryPath = path.join(artifactDir, "repo-memory.md");
      const inboxPath = path.join(artifactDir, "inbox.md");
      const proofOfWorkPath = path.join(artifactDir, "proof-of-work.md");
      const existingPaths = [dossierPath, patchDraftPath, prDraftPath, memoryPath, inboxPath, proofOfWorkPath].filter(
        (filePath) => fs.existsSync(filePath),
      );
      const newestFileTime = existingPaths.reduce((latest, filePath) => {
        const mtime = fs.statSync(filePath).mtime;
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
          extractLineValue(prDraftText, "Title:")
          || extractSectionValue(patchText, "## Goal")
          || `${parsed.repoFullName}#${parsed.issueNumber}`,
        summary:
          extractLineValue(dossierText, "- Summary:")
          || extractSectionValue(patchText, "## Goal")
          || "",
        paths: {
          dossier: fs.existsSync(dossierPath) ? dossierPath : "",
          patchDraft: fs.existsSync(patchDraftPath) ? patchDraftPath : "",
          prDraft: fs.existsSync(prDraftPath) ? prDraftPath : "",
          memory: fs.existsSync(memoryPath) ? memoryPath : "",
          inbox: fs.existsSync(inboxPath) ? inboxPath : "",
          proofOfWork: fs.existsSync(proofOfWorkPath) ? proofOfWorkPath : "",
        },
      });
    }
  }

  return snapshots.sort((left, right) => right.generatedAt.localeCompare(left.generatedAt));
}

function loadMemorySnapshots() {
  const memoryDir = path.join(getOpenMetaConfigDir(), "repo-memory");
  if (!fs.existsSync(memoryDir)) {
    return [];
  }

  return fs.readdirSync(memoryDir)
    .filter((fileName) => fileName.endsWith(".json"))
    .map((fileName) => readJson(path.join(memoryDir, fileName), null))
    .filter(Boolean);
}

function buildArtifactDerivedProofRecords(artifacts) {
  return artifacts
    .filter((artifact) => artifact.paths.proofOfWork)
    .map((artifact) => {
      const proofMarkdown = readText(artifact.paths.proofOfWork);
      return deriveProofRecordFromArtifactMarkdown(artifact, proofMarkdown);
    })
    .filter(Boolean);
}

function buildArtifactDerivedInboxItems(artifacts) {
  return artifacts
    .filter((artifact) => artifact.paths.inbox)
    .map((artifact) => {
      const inboxMarkdown = readText(artifact.paths.inbox);
      return deriveInboxItemFromArtifactMarkdown(artifact, inboxMarkdown);
    })
    .filter(Boolean);
}

function buildArtifactDerivedMemorySnapshots(artifacts) {
  const grouped = new Map();

  for (const artifact of artifacts.filter((item) => item.paths.memory)) {
    const bucket = grouped.get(artifact.repoFullName) || [];
    bucket.push(artifact);
    grouped.set(artifact.repoFullName, bucket);
  }

  return [...grouped.entries()].map(([repoFullName, repoArtifacts]) => {
    const sorted = [...repoArtifacts].sort((left, right) => right.generatedAt.localeCompare(left.generatedAt));
    const latest = sorted[0];
    const latestMarkdown = readText(latest.paths.memory);
    const parsed = deriveMemorySnapshotFromArtifactMarkdown(latest, latestMarkdown);
    if (!parsed) {
      return null;
    }

    const references = [];
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
  }).filter(Boolean);
}

function mergeProofRecords(primaryRecords, fallbackRecords) {
  const seen = new Set();
  const merged = [];

  for (const record of [...primaryRecords, ...fallbackRecords]) {
    const key = cleanOptionalValue(record.artifactDir)
      ? `artifact:${normalizePath(record.artifactDir)}`
      : `${record.repoFullName}#${record.issueNumber}@${record.generatedAt}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(record);
  }

  return merged;
}

function mergeInboxItems(primaryItems, fallbackItems) {
  const seen = new Set();
  const merged = [];

  for (const item of [...primaryItems, ...fallbackItems]) {
    const key = cleanOptionalValue(item.artifactDir)
      ? `artifact:${normalizePath(item.artifactDir)}`
      : `${item.repoFullName}#${item.issueNumber}@${item.generatedAt}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(item);
  }

  return merged;
}

function mergeMemorySnapshots(primarySnapshots, fallbackSnapshots) {
  const merged = new Map(primarySnapshots.map((snapshot) => [snapshot.repoFullName, snapshot]));

  for (const snapshot of fallbackSnapshots) {
    if (!merged.has(snapshot.repoFullName)) {
      merged.set(snapshot.repoFullName, snapshot);
    }
  }

  return [...merged.values()];
}

function deriveProofRecordFromArtifactMarkdown(artifact, proofMarkdown) {
  const activityItems = extractBulletItems(proofMarkdown, "## Recent Activity");
  const topRepositories = extractBulletItems(proofMarkdown, "## Top Repositories");
  const recentMatch = activityItems.find((item) => item.startsWith(`${artifact.repoFullName}#${artifact.issueNumber} |`));
  const published = parseBooleanToken((/\|\s*published=(true|false|yes|no)/i.exec(recentMatch || "") || [])[1]);
  const overallScore = recentMatch ? parseInteger((/overall\s+(\d+)/i.exec(recentMatch) || [])[1], 0) : 0;
  const pullRequestUrl = recentMatch ? cleanOptionalValue((/\|\s*pr=(.+)$/i.exec(recentMatch) || [])[1]) : "";
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
    branchName: cleanOptionalValue(extractLineValue(proofMarkdown, "- Last Branch:")),
    artifactDir: artifact.artifactDir,
    generatedAt: artifact.generatedAt,
    published,
    pullRequestUrl,
    pullRequestNumber: parseInteger((/\/pull\/(\d+)/.exec(pullRequestUrl) || [])[1], undefined),
  };
}

function deriveInboxItemFromArtifactMarkdown(artifact, inboxMarkdown) {
  const items = extractBulletItems(inboxMarkdown, "# Contribution Inbox");
  const entry = items.find((item) => item.includes(`${artifact.repoFullName}#${artifact.issueNumber}`));

  if (!entry) {
    return null;
  }

  const status = ((/^\[(\w+)\]/.exec(entry) || [])[1] || "ready").toLowerCase();
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
    status: ["scouted", "drafted", "ready"].includes(status) ? status : "ready",
    artifactDir: artifact.artifactDir,
    generatedAt: artifact.generatedAt,
  };
}

function deriveMemorySnapshotFromArtifactMarkdown(artifact, memoryMarkdown) {
  if (
    !/#\s*Repo Memory:/i.test(memoryMarkdown)
    && !/##\s*Run Stats/i.test(memoryMarkdown)
    && !/##\s*Recent Issues/i.test(memoryMarkdown)
    && !/-\s*Generated Dossiers:/i.test(memoryMarkdown)
  ) {
    return null;
  }

  const repoFullName = cleanOptionalValue(extractLineValue(memoryMarkdown, "# Repo Memory:")) || artifact.repoFullName;
  if (!repoFullName) {
    return null;
  }

  const recentIssues = extractBulletItems(memoryMarkdown, "## Recent Issues")
    .map((item) => {
      const parts = item.split("|").map((part) => part.trim());
      const reference = parts[0] || `${artifact.repoFullName}#${artifact.issueNumber}`;
      const overallScore = parseInteger((/score\s+(\d+)/i.exec(parts[1] || "") || [])[1], 0);
      const status = cleanOptionalValue((/status\s+(.+)$/i.exec(parts[2] || "") || [])[1]) || "selected";
      const changedCount = parseInteger((/changed\s+(\d+)/i.exec(parts[3] || "") || [])[1], 0);
      const published = parseBooleanToken((/published\s+(yes|no)/i.exec(parts[4] || "") || [])[1]);
      const validationSummary = cleanOptionalValue((/validation\s+(.+)$/i.exec(parts[5] || "") || [])[1]) || "not run";

      return {
        reference,
        title: artifact.title || reference,
        overallScore,
        generatedAt: artifact.generatedAt,
        status,
        changedFiles: Array.from({ length: changedCount }, (_, index) => `changed-${index + 1}`),
        published,
        reviewRequired: status === "review_required",
        validationSummary,
      };
    });

  return {
    repoFullName,
    firstSeenAt: artifact.generatedAt,
    lastUpdatedAt: cleanOptionalValue(extractLineValue(memoryMarkdown, "- Last Updated:")) || artifact.generatedAt,
    lastSelectedIssue: cleanOptionalValue(extractLineValue(memoryMarkdown, "- Last Selected Issue:")),
    workspacePath: cleanOptionalValue(extractLineValue(memoryMarkdown, "- Workspace Path:")),
    lastBranchName: cleanOptionalValue(extractLineValue(memoryMarkdown, "- Last Branch:")),
    detectedTestCommands: extractBulletItems(memoryMarkdown, "## Detected Test Commands")
      .filter((item) => !/^none detected$/i.test(item))
      .map((item) => item.replace(/^`|`$/g, "")),
    preferredPaths: extractBulletItems(memoryMarkdown, "## Preferred Paths").filter((item) => !/^none recorded$/i.test(item)),
    generatedDossiers: parseInteger(extractLineValue(memoryMarkdown, "- Generated Dossiers:"), artifact.paths.dossier ? 1 : 0),
    runStats: {
      totalRuns: parseInteger(extractLineValue(memoryMarkdown, "- Total Runs:")),
      publishedRuns: parseInteger(extractLineValue(memoryMarkdown, "- Published Runs:")),
      realPrRuns: parseInteger(extractLineValue(memoryMarkdown, "- Draft PR Runs:")),
      reviewRequiredRuns: parseInteger(extractLineValue(memoryMarkdown, "- Review Required Runs:")),
      successfulValidationRuns: parseInteger(extractLineValue(memoryMarkdown, "- Successful Validation Runs:")),
      failedValidationRuns: parseInteger(extractLineValue(memoryMarkdown, "- Failed Validation Runs:")),
    },
    pathSignals: [],
    validationSignals: [],
    recentIssues,
  };
}

function loadState() {
  const configDir = getOpenMetaConfigDir();
  const proofRecords = readJson(path.join(configDir, "proof-of-work.json"), { records: [] }).records || [];
  const inboxItems = readJson(path.join(configDir, "inbox.json"), { items: [] }).items || [];
  const runRecords = readJson(path.join(configDir, "runs.json"), { records: [] }).records || [];
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

function buildArtifactMaps(artifacts) {
  const byDir = new Map();
  const byReference = new Map();

  for (const artifact of artifacts) {
    byDir.set(normalizePath(artifact.artifactDir), artifact);
    const reference = `${artifact.repoFullName}#${artifact.issueNumber}`;
    const bucket = byReference.get(reference) || [];
    bucket.push(artifact);
    byReference.set(reference, bucket);
  }

  return { byDir, byReference };
}

function buildMemoryIssueMaps(memorySnapshots) {
  const memoryByRepo = new Map();
  const issuesByReference = new Map();

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
    items.sort((left, right) => String(right.generatedAt || "").localeCompare(String(left.generatedAt || "")));
    issuesByReference.set(reference, items);
  }

  return { memoryByRepo, issuesByReference };
}

function buildAttemptFromProof(record, artifact, memoryIssue) {
  const title = artifact?.title || memoryIssue?.title || record.issueTitle || `${record.repoFullName}#${record.issueNumber}`;
  const outcome = resolveAttemptOutcome({
    merged: record.merged === true,
    pullRequestUrl: record.pullRequestUrl,
    published: record.published,
    reviewRequired: memoryIssue?.reviewRequired,
    validationSummary: memoryIssue?.validationSummary,
  });
  const summary = summarizeOutcome(outcome, title, {
    summary: artifact?.summary || memoryIssue?.summary || "",
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
    source: "proof",
    sourceLabel: formatAttemptSourceLabel("proof"),
    repoFullName: record.repoFullName,
    issueNumber: record.issueNumber,
    outcome,
    title,
    summary,
    generatedAt,
    lastUpdatedAt: formatDateOnly(generatedAt),
    detailLink: openTarget.url,
    openTarget,
    artifactDir: artifact?.artifactDir || record.artifactDir || "",
    ledgerTrace: buildLedgerTrace(artifact, record.pullRequestUrl),
    published: Boolean(record.published),
    pullRequestUrl: record.pullRequestUrl || "",
    merged: Boolean(record.merged),
    outcomeFlags: buildOutcomeFlags({
      published: record.published,
      pullRequestUrl: record.pullRequestUrl,
      merged: record.merged,
    }),
    reviewRequired: Boolean(memoryIssue?.reviewRequired),
    validationSummary: memoryIssue?.validationSummary || "",
    score: Number(record.overallScore || record.opportunityScore || 0),
  }, {
    branchName: record.branchName,
    pullRequestNumber: record.pullRequestNumber,
    changedFiles: memoryIssue?.changedFiles || [],
    validationSummary: memoryIssue?.validationSummary || "",
    artifact,
  });
}

function buildAttemptFromMemory(issue, artifact) {
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
    summary: artifact?.summary || "",
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
    source: "memory",
    sourceLabel: formatAttemptSourceLabel("memory"),
    repoFullName: parsed.repoFullName,
    issueNumber: parsed.issueNumber,
    outcome,
    title,
    summary,
    generatedAt,
    lastUpdatedAt: formatDateOnly(generatedAt),
    detailLink: openTarget.url,
    openTarget,
    artifactDir: artifact?.artifactDir || "",
    ledgerTrace: buildLedgerTrace(artifact, issue.pullRequestUrl),
    published: Boolean(issue.published),
    pullRequestUrl: issue.pullRequestUrl || "",
    merged: false,
    outcomeFlags: buildOutcomeFlags({
      published: issue.published,
      pullRequestUrl: issue.pullRequestUrl,
      merged: false,
    }),
    reviewRequired: Boolean(issue.reviewRequired),
    validationSummary: issue.validationSummary || "",
    score: Number(issue.overallScore || 0),
  }, {
    branchName: "",
    changedFiles: issue.changedFiles || [],
    validationSummary: issue.validationSummary || "",
    artifact,
  });
}

function buildAttemptFromInbox(item, artifact) {
  const reference = parseRepoIssueReference(item.id);
  const issueNumber = reference?.issueNumber || Number(item.issueNumber || 0);
  const title = artifact?.title || item.issueTitle || `${item.repoFullName}#${issueNumber}`;
  const summary = artifact?.summary || item.summary || `${title} is staged in the contribution inbox and waiting for a deeper pass.`;
  const generatedAt = item.generatedAt || artifact?.generatedAt || new Date().toISOString();
  const openTarget = chooseOpenTarget({
    pullRequestUrl: "",
    dossierPath: artifact?.paths.dossier,
    patchDraftPath: artifact?.paths.patchDraft,
    prDraftPath: artifact?.paths.prDraft,
    fallbackUrl: githubIssueUrl(item.repoFullName, issueNumber),
  });

  return enrichAttempt({
    key: `inbox:${item.id}:${generatedAt}`,
    source: "inbox",
    sourceLabel: formatAttemptSourceLabel("inbox"),
    repoFullName: item.repoFullName,
    issueNumber,
    outcome: "draft_only",
    title,
    summary,
    generatedAt,
    lastUpdatedAt: formatDateOnly(generatedAt),
    detailLink: openTarget.url,
    openTarget,
    artifactDir: artifact?.artifactDir || item.artifactDir || "",
    ledgerTrace: buildLedgerTrace(artifact, ""),
    published: false,
    pullRequestUrl: "",
    merged: false,
    outcomeFlags: buildOutcomeFlags({
      published: false,
      pullRequestUrl: "",
      merged: false,
    }),
    reviewRequired: false,
    validationSummary: "",
    score: Number(item.overallScore || item.opportunityScore || 0),
  }, {
    branchName: "",
    changedFiles: [],
    validationSummary: "",
    artifact,
  });
}

function buildAttemptFromArtifact(artifact) {
  const title = artifact.title || `${artifact.repoFullName}#${artifact.issueNumber}`;
  const outcome = "draft_only";
  const summary = summarizeOutcome(outcome, title, {
    summary: artifact.summary,
  });
  const openTarget = chooseOpenTarget({
    pullRequestUrl: "",
    dossierPath: artifact.paths.dossier,
    patchDraftPath: artifact.paths.patchDraft,
    prDraftPath: artifact.paths.prDraft,
    fallbackUrl: githubIssueUrl(artifact.repoFullName, artifact.issueNumber),
  });

  return enrichAttempt({
    key: `artifact:${artifact.key}`,
    source: "artifact",
    sourceLabel: formatAttemptSourceLabel("artifact"),
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
    ledgerTrace: buildLedgerTrace(artifact, ""),
    published: false,
    pullRequestUrl: "",
    merged: false,
    outcomeFlags: buildOutcomeFlags({
      published: false,
      pullRequestUrl: "",
      merged: false,
    }),
    reviewRequired: false,
    validationSummary: "",
    score: 0,
  }, {
    branchName: "",
    changedFiles: [],
    validationSummary: "",
    artifact,
  });
}

function buildAttempts(state) {
  const { byDir, byReference } = buildArtifactMaps(state.artifacts);
  const { memoryByRepo, issuesByReference } = buildMemoryIssueMaps(state.memorySnapshots);
  const attempts = [];
  const consumedReferences = new Set();
  const consumedArtifactDirs = new Set();

  const proofRecords = [...state.proofRecords].sort((left, right) => String(right.generatedAt || "").localeCompare(String(left.generatedAt || "")));
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
      .sort((left, right) => String(right.generatedAt || "").localeCompare(String(left.generatedAt || ""))),
    memoryByRepo,
  };
}

function getStartOfWeek(date) {
  const start = new Date(date);
  const day = start.getDay();
  const delta = day === 0 ? -6 : 1 - day;
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() + delta);
  return start;
}

function getStartOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function formatWeekLabel(date) {
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())}`;
}

function formatMonthLabel(date) {
  return date.toLocaleString("en-US", { month: "short" });
}

function buildTrends(attempts) {
  const now = new Date();
  const weeklyBuckets = [];
  const monthlyBuckets = [];

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

  const toTrendRow = (bucket) => {
    const bucketAttempts = attempts.filter((item) => {
      const date = parseIso(item.generatedAt);
      return date && date >= bucket.start && date < bucket.end;
    });

    return {
      period: bucket.label,
      drafted: bucketAttempts.length,
      ledgerPublished: bucketAttempts.filter((item) => item.published).length,
      prOpen: bucketAttempts.filter((item) => item.pullRequestUrl).length,
      merged: bucketAttempts.filter((item) => item.merged).length,
      sourceBreakdown: {
        proof: bucketAttempts.filter((item) => item.source === "proof").length,
        memory: bucketAttempts.filter((item) => item.source === "memory").length,
        inbox: bucketAttempts.filter((item) => item.source === "inbox").length,
        artifact: bucketAttempts.filter((item) => item.source === "artifact").length,
      },
    };
  };

  return {
    weekly: weeklyBuckets.map(toTrendRow),
    monthly: monthlyBuckets.map(toTrendRow),
  };
}

function computeRepoSignal(repoFullName, attempts, memory) {
  const attemptCount = attempts.length;
  const publishedCount = attempts.filter((item) => item.published).length;
  const prOpenCount = attempts.filter((item) => item.pullRequestUrl).length;
  const mergedCount = attempts.filter((item) => item.merged).length;
  const activeWeeks = new Set(
    attempts
      .map((item) => parseIso(item.generatedAt))
      .filter(Boolean)
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

function decisionFromScore(score, index, repo) {
  if (score >= 72 || (index === 0 && score >= 52) || (repo.prOpenCount > 0 && score >= 60)) {
    return "deepen";
  }

  if (score >= 44 || repo.publishedCount > 0) {
    return "watch";
  }

  return "pause";
}

function buildProjectStats(attempts, memoryByRepo) {
  const grouped = new Map();

  for (const attempt of attempts) {
    const bucket = grouped.get(attempt.repoFullName) || [];
    bucket.push(attempt);
    grouped.set(attempt.repoFullName, bucket);
  }

  const rows = [...grouped.entries()].map(([repoFullName, items]) => {
    const sortedItems = [...items].sort((left, right) => String(right.generatedAt || "").localeCompare(String(left.generatedAt || "")));
    const memory = memoryByRepo.get(repoFullName) || null;
    const signal = computeRepoSignal(repoFullName, sortedItems, memory);
    const latest = sortedItems[0];
    const publishedCount = sortedItems.filter((item) => item.published).length;
    const prOpenCount = sortedItems.filter((item) => item.pullRequestUrl).length;
    const mergedCount = sortedItems.filter((item) => item.merged).length;
    const stalledCount = sortedItems.filter((item) => item.reviewRequired || item.outcome === "stalled").length;
    const reviewRequiredCount = sortedItems.filter((item) => item.reviewRequired).length;
    const validationFailedCount = sortedItems.filter((item) => item.validationState === "failed").length;
    const openAttemptCount = sortedItems.filter((item) => !item.merged && !item.pullRequestUrl).length;
    const activeWeeks = new Set(
      sortedItems
        .map((item) => parseIso(item.generatedAt))
        .filter(Boolean)
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
      activeWeeks,
      attemptToPublishedRate: toRate(publishedCount, sortedItems.length),
      attemptToPrRate: toRate(prOpenCount, sortedItems.length),
      attemptToMergedRate: toRate(mergedCount, sortedItems.length),
      lastSuccessfulLandingAt: findLatestLandingDate(sortedItems),
      latest,
    };
  });

  rows.sort((left, right) => right.signal.score - left.signal.score || right.contributionCount - left.contributionCount);

  return rows.map((row, index) => ({
    ...row,
    decision: decisionFromScore(row.signal.score, index, row),
  }));
}

function buildFocus(projectRows) {
  const groups = {
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

    let summary = "";
    if (row.decision === "deepen") {
      summary = `${row.repoFullName} already shows repeated contribution motion and enough saved context to justify another focused pass.`;
    } else if (row.decision === "watch") {
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

function buildProjects(projectRows) {
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
    lastOutcome: row.latest.outcome,
    lastActiveAt: formatDateOnly(row.latest.generatedAt),
    representativeTitle: row.latest.title,
    score: row.signal.score,
    detailLink: row.latest.detailLink,
    sourceMix: {
      proof: row.attempts.filter((item) => item.source === "proof").length,
      memory: row.attempts.filter((item) => item.source === "memory").length,
      inbox: row.attempts.filter((item) => item.source === "inbox").length,
      artifact: row.attempts.filter((item) => item.source === "artifact").length,
    },
    note: `${row.publishedCount} ledger published | ${row.prOpenCount} PR open | ${Number(row.memory?.generatedDossiers || 0)} dossiers`,
    conversionNote: `pub ${row.attemptToPublishedRate}% | pr ${row.attemptToPrRate}% | merge ${row.attemptToMergedRate}%`,
    blockageNote: `${row.reviewRequiredCount} review | ${row.validationFailedCount} validation fail | ${row.openAttemptCount} open`,
  }));
}

function buildActivity(attempts) {
  return attempts.slice(0, 12).map((item) => ({
    type: item.outcome,
    repoFullName: item.repoFullName,
    title: item.title,
    date: formatDateOnly(item.generatedAt),
    description: item.summary,
  }));
}

function archiveStatusFromAttempt(attempt) {
  if (attempt.outcome === "merged") {
    return "ready";
  }
  if (attempt.outcome === "pr_open" || attempt.outcome === "published") {
    return "compounding";
  }
  if (attempt.outcome === "stalled") {
    return "review";
  }
  return "hold";
}

function buildArchive(attempts) {
  return attempts.slice(0, 8).map((attempt) => {
    const lines = [];

    if (attempt.ledgerTrace.includes("dossier")) {
      lines.push("dossier.md retained");
    }
    if (attempt.ledgerTrace.includes("patch")) {
      lines.push("patch-draft.md retained");
    }
    if (attempt.ledgerTrace.includes("pr")) {
      lines.push(attempt.pullRequestUrl ? "live PR link retained" : "pr-draft.md retained");
    }
    if (attempt.ledgerTrace.includes("memory")) {
      lines.push("repo-memory.md retained");
    }
    if (attempt.validationSummary) {
      lines.push(`validation: ${attempt.validationSummary}`);
    }
    if (lines.length === 0) {
      lines.push("local artifact trail retained");
    }

    const evidenceLevel = attempt.source === "proof"
      ? "proof-backed"
      : attempt.pullRequestUrl
        ? "live-pr"
        : attempt.source === "memory"
          ? "memory-backed"
          : "artifact-only";

    return {
      label:
        attempt.outcome === "pr_open"
          ? "Live PR trail"
          : attempt.outcome === "published"
            ? "Published ledger bundle"
            : attempt.outcome === "stalled"
              ? "Needs review bundle"
              : "Local artifact bundle",
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

function buildAssets(artifacts) {
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
    },
  );
}

function buildSummary(attempts, projectRows, assets, runRecords) {
  const lastAttempt = attempts[0];
  const publishedRuns = attempts.filter((item) => item.published).length;
  const realPrRuns = attempts.filter((item) => item.pullRequestUrl).length;
  const mergedRuns = attempts.filter((item) => item.merged).length;
  const archivedAssets = Object.values(assets).reduce((sum, value) => sum + value, 0);
  const lastRun = [...runRecords].sort((left, right) => String(right.startedAt || "").localeCompare(String(left.startedAt || "")))[0];
  const lastActiveAt = lastAttempt?.generatedAt || lastRun?.startedAt || new Date().toISOString();
  const sourceBreakdown = {
    proof: attempts.filter((item) => item.source === "proof").length,
    memory: attempts.filter((item) => item.source === "memory").length,
    inbox: attempts.filter((item) => item.source === "inbox").length,
    artifact: attempts.filter((item) => item.source === "artifact").length,
  };

  return {
    totalContributions: attempts.length,
    uniqueProjects: projectRows.length,
    publishedRuns,
    ledgerPublishedRuns: publishedRuns,
    realPrRuns,
    mergedRuns,
    archivedAssets,
    lastActiveAt: formatDateTime(lastActiveAt),
    sourceBreakdown,
    callout:
      attempts.length > 0
        ? `${realPrRuns} upstream PRs tracked, ${publishedRuns} ledger publications, ${projectRows.filter((item) => item.decision === "deepen").length} lanes worth deeper follow-through.`
        : "No real contribution records are available yet. Generate or publish one run to start the ledger trail.",
  };
}

function buildTopMeta(summary, projectRows, sources) {
  const activeRepos = summary.uniqueProjects;
  const sourceLabels = [];
  if (sources.proofRecords.length > 0) {
    sourceLabels.push("PoW");
  }
  if (sources.memorySnapshots.length > 0) {
    sourceLabels.push("memory");
  }
  if (sources.inboxItems.length > 0) {
    sourceLabels.push("inbox");
  }
  if (sources.artifacts.length > 0) {
    sourceLabels.push("artifacts");
  }

  return [
    {
      label: "Ledger Snapshot",
      value: summary.totalContributions > 0 ? "Real local state" : "No real state yet",
    },
    {
      label: "Tracked Repositories",
      value: `${activeRepos} active repos`,
    },
    {
      label: "State Sources",
      value: sourceLabels.length > 0 ? sourceLabels.join(", ") : "awaiting first contribution run",
    },
    {
      label: "Attempt Sources",
      value: `${summary.sourceBreakdown.proof} proof | ${summary.sourceBreakdown.memory} memory | ${summary.sourceBreakdown.artifact} artifact`,
    },
  ];
}

function buildProjectSignals(projectRows) {
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

function buildDashboardData() {
  const state = loadState();
  const { attempts: rawAttempts, memoryByRepo } = buildAttempts(state);
  const attempts = rawAttempts.map((item) => ({
    ...item,
    outcome: item.outcome || resolveAttemptOutcome(item),
  }));
  const projectRows = buildProjectStats(attempts, memoryByRepo);
  const decisionByRepo = new Map(projectRows.map((row) => [row.repoFullName, row.decision]));
  const normalizedAttempts = attempts.map((item) => ({
    repoFullName: item.repoFullName,
    issueNumber: item.issueNumber,
    reference: item.reference || `${item.repoFullName}#${item.issueNumber}`,
    decision: decisionByRepo.get(item.repoFullName) || "watch",
    outcome: item.outcome || resolveAttemptOutcome(item),
    source: item.source,
    sourceLabel: item.sourceLabel || formatAttemptSourceLabel(item.source),
    title: item.title,
    summary: item.summary,
    ledgerTrace: item.ledgerTrace,
    lastUpdatedAt: item.lastUpdatedAt,
    detailLink: item.detailLink,
    openTarget: item.openTarget || { url: item.detailLink, label: "Open", kind: "fallback" },
    generatedAt: item.generatedAt,
    published: item.published,
    pullRequestUrl: item.pullRequestUrl,
    pullRequestNumber: item.pullRequestNumber,
    merged: item.merged,
    issueUrl: item.issueUrl || githubIssueUrl(item.repoFullName, item.issueNumber),
    branchName: item.branchName || "",
    changedFiles: item.changedFiles || [],
    changedFilesCount: item.changedFilesCount || 0,
    changedFilePreview: item.changedFilePreview || [],
    fileAreaHints: item.fileAreaHints || [],
    reviewRequired: Boolean(item.reviewRequired),
    validationSummary: item.validationSummary || "",
    validationState: item.validationState || deriveValidationState(item.validationSummary),
    blockedReason: item.blockedReason || "",
    blockedLabel: item.blockedLabel || "",
    assetCoverage: item.assetCoverage || buildAssetCoverage(null, item.pullRequestUrl),
    assetCompletenessCount: item.assetCompletenessCount || 0,
    assetCompletenessLabel: item.assetCompletenessLabel || "0/4 assets",
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
  const availableRepos = ["all", ...projects.map((item) => item.repoFullName)];
  const generatedAt = new Date().toISOString();
  const lastRun = [...state.runRecords].sort((left, right) => String(right.startedAt || "").localeCompare(String(left.startedAt || "")))[0];
  const mode = summary.totalContributions > 0 || Object.values(assets).some((value) => value > 0) ? "real" : "empty";
  const syncStatusParts = [mode === "real" ? "Real snapshot" : "No local contribution state"];
  if (lastRun) {
    syncStatusParts.push(`latest run ${String(lastRun.commandName || "").replace(/^OpenMeta\s+/i, "").trim() || lastRun.commandName}`.trim());
  }

  return {
    meta: {
      generatedAt,
      windowLabel: `Last ${LOOKBACK_DAYS} days`,
      mode,
      refreshLabel: "Refresh local snapshot",
    },
    topMeta,
    filters: {
      availableRepos,
      availableDecisions: ["all", "deepen", "watch", "pause"],
    },
    attemptFilters: {
      availableOutcomes: ["all", "merged", "pr_open", "published", "draft_only", "stalled"],
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

module.exports = {
  buildDashboardData,
};
