(function () {
  const state = {
    repo: "all",
    decision: "all",
    period: "weekly",
    syncPending: false,
    filtersInitialized: false,
  };

  let data = null;

  const decisionLabelMap = {
    all: "All decisions",
    deepen: "Deepen",
    watch: "Watch",
    pause: "Pause",
  };

  const outcomeLabelMap = {
    merged: "Merged",
    pr_open: "PR Open",
    published: "Ledger Published",
    draft_only: "Draft Only",
    stalled: "Stalled",
  };

  const archiveToneMap = {
    ready: "published",
    review: "stalled",
    hold: "draft_only",
    compounding: "pr_open",
  };

  function formatRepoLabel(repo) {
    return repo === "all" ? "All repositories" : repo;
  }

  function formatDecisionLabel(decision) {
    return decisionLabelMap[decision] || decision;
  }

  function formatOutcomeLabel(outcome) {
    return outcomeLabelMap[outcome] || outcome;
  }

  function formatValidationLabel(stateValue, summary) {
    if (stateValue === "passed") {
      return `validation passed${summary ? ` | ${summary}` : ""}`;
    }
    if (stateValue === "failed") {
      return `validation failed${summary ? ` | ${summary}` : ""}`;
    }
    if (stateValue === "reported") {
      return summary || "validation reported";
    }
    return "validation not run";
  }

  function formatAttemptReference(item) {
    const parts = [item.reference || `${item.repoFullName}#${item.issueNumber}`];
    if (item.pullRequestNumber) {
      parts.push(`PR #${item.pullRequestNumber}`);
    }
    if (item.branchName) {
      parts.push(item.branchName);
    }
    return parts.join(" | ");
  }

  function formatAttemptWorkSummary(item) {
    const pieces = [];

    if (item.changedFilesCount > 0) {
      const preview = (item.changedFilePreview || []).join(", ");
      pieces.push(`${item.changedFilesCount} files${preview ? ` | ${preview}` : ""}`);
    } else if ((item.fileAreaHints || []).length > 0) {
      pieces.push(`areas ${item.fileAreaHints.join(", ")}`);
    } else {
      pieces.push("no changed files recorded");
    }

    pieces.push(item.blockedLabel || "local draft only");
    return pieces.join(" | ");
  }

  function getProjectSignals(repoFullName) {
    const projectSignals = data.projectSignals || {};
    return projectSignals[repoFullName] || { revisit: 40, landing: 40, memory: 40, trend: [0, 0, 0, 0] };
  }

  function filteredProjects() {
    return data.projects.filter((item) => {
      const repoMatch = state.repo === "all" || item.repoFullName === state.repo;
      const decisionMatch = state.decision === "all" || item.decision === state.decision;
      return repoMatch && decisionMatch;
    });
  }

  function filteredActivity() {
    const visibleRepos = new Set(filteredProjects().map((item) => item.repoFullName));
    return data.activity.filter((item) => {
      if (state.repo !== "all" && item.repoFullName !== state.repo) {
        return false;
      }
      if (state.decision === "all") {
        return true;
      }
      return visibleRepos.has(item.repoFullName);
    });
  }

  function filteredAttempts() {
    return data.attempts.filter((item) => {
      const repoMatch = state.repo === "all" || item.repoFullName === state.repo;
      const decisionMatch = state.decision === "all" || item.decision === state.decision;
      return repoMatch && decisionMatch;
    });
  }

  function decisionItems() {
    return [
      ...data.focus.deepen.map((item) => ({ ...item, decision: "deepen" })),
      ...data.focus.watch.map((item) => ({ ...item, decision: "watch" })),
      ...data.focus.pause.map((item) => ({ ...item, decision: "pause" })),
    ].filter((item) => {
      const repoMatch = state.repo === "all" || item.repoFullName === state.repo;
      const decisionMatch = state.decision === "all" || item.decision === state.decision;
      return repoMatch && decisionMatch;
    });
  }

  function shortlistDecisionItems() {
    return decisionItems().slice(0, 4);
  }

  function trendRecords() {
    return data.trends[state.period] || [];
  }

  function buildTrendInsight(records) {
    if (records.length === 0) {
      return "Insight: No contribution rhythm has been recorded yet.";
    }

    const latest = records[records.length - 1];
    const previous = records[records.length - 2] || latest;
    const draftedDelta = latest.drafted - previous.drafted;
    const publishedDelta = (latest.ledgerPublished ?? latest.published ?? 0) - (previous.ledgerPublished ?? previous.published ?? 0);
    const prOpenDelta = (latest.prOpen ?? 0) - (previous.prOpen ?? 0);
    const mergedDelta = latest.merged - previous.merged;

    if (latest.drafted === 0 && (latest.ledgerPublished ?? latest.published ?? 0) === 0 && latest.merged === 0) {
      return "Insight: The current window is empty, so the dashboard is waiting for the first real contribution trail.";
    }

    if (draftedDelta > publishedDelta && publishedDelta <= 0) {
      return "Insight: Draft volume is present, but ledger landing is flattening.";
    }

    if (prOpenDelta > 0 && publishedDelta > 0) {
      return "Insight: Ledger publication and upstream PR creation are still moving together.";
    }

    if (mergedDelta <= 0 && publishedDelta > 0) {
      return "Insight: Ledger publication is stable, but final upstream landing is still thinner.";
    }

    return "Insight: Contribution momentum is steady, with no major break in the landing path.";
  }

  function buildTrendSummary(records) {
    if (records.length === 0) {
      return [
        { label: "Latest Drafted", value: 0, note: "n/a" },
        { label: "Ledger Rate", value: "0%", note: "0/0" },
        { label: "PR Rate", value: "0%", note: "0/0" },
      ];
    }

    const latest = records[records.length - 1];
    const drafted = latest.drafted;
    const published = latest.ledgerPublished ?? latest.published ?? 0;
    const prOpen = latest.prOpen ?? 0;
    const merged = latest.merged;
    const publishRate = drafted > 0 ? Math.round((published / drafted) * 100) : 0;
    const prRate = drafted > 0 ? Math.round((prOpen / drafted) * 100) : 0;

    return [
      { label: "Latest Drafted", value: drafted, note: latest.period },
      { label: "Ledger Rate", value: `${publishRate}%`, note: `${published}/${drafted}` },
      { label: "PR Rate", value: `${prRate}%`, note: `${prOpen}/${drafted}` },
    ];
  }

  function ensureCurrentFiltersStillValid() {
    if (!data.filters.availableRepos.includes(state.repo)) {
      state.repo = "all";
    }
    if (!data.filters.availableDecisions.includes(state.decision)) {
      state.decision = "all";
    }
  }

  function populateSelect(select, values, formatter, currentValue) {
    select.innerHTML = "";
    values.forEach((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = formatter(value);
      option.selected = value === currentValue;
      select.appendChild(option);
    });
  }

  function initFilters() {
    const repoSelect = document.getElementById("repo-filter");
    const decisionSelect = document.getElementById("decision-filter");
    const refreshButton = document.getElementById("refresh-button");

    ensureCurrentFiltersStillValid();
    populateSelect(repoSelect, data.filters.availableRepos, formatRepoLabel, state.repo);
    populateSelect(decisionSelect, data.filters.availableDecisions, formatDecisionLabel, state.decision);

    if (!state.filtersInitialized) {
      repoSelect.addEventListener("change", (event) => {
        state.repo = event.target.value;
        renderDashboard();
      });

      decisionSelect.addEventListener("change", (event) => {
        state.decision = event.target.value;
        renderDashboard();
      });

      document.getElementById("period-segment").querySelectorAll("button").forEach((button) => {
        button.addEventListener("click", () => {
          state.period = button.dataset.period;
          document
            .querySelectorAll("#period-segment button")
            .forEach((item) => item.classList.toggle("active", item === button));
          renderTrend();
        });
      });

      refreshButton.addEventListener("click", async () => {
        if (state.syncPending) {
          return;
        }

        state.syncPending = true;
        refreshButton.textContent = "Refreshing...";
        document.getElementById("sync-status").textContent = "Refreshing latest local snapshot...";

        try {
          await loadDashboardData({ forceRefresh: true });
          renderDashboard();
        } catch (error) {
          document.getElementById("sync-status").textContent =
            `Refresh failed | ${error instanceof Error ? error.message : String(error)}`;
        } finally {
          state.syncPending = false;
          refreshButton.textContent = data?.meta?.refreshLabel || "Refresh Snapshot";
        }
      });

      state.filtersInitialized = true;
    }

    refreshButton.textContent = data.meta.refreshLabel || "Refresh Snapshot";
  }

  function renderTopMeta() {
    const container = document.getElementById("topbar-meta");
    container.innerHTML = "";

    data.topMeta.forEach((item) => {
      const block = document.createElement("div");
      block.className = "meta-block";
      block.innerHTML = `
        <p class="meta-label">${item.label}</p>
        <p class="meta-value">${item.value}</p>
      `;
      container.appendChild(block);
    });

    document.getElementById("toolbar-note").textContent = data.meta.windowLabel;
    document.getElementById("overview-badge").textContent = data.summary.callout;
    document.getElementById("focus-badge").textContent =
      `${data.focus.deepen.length} deepen | ${data.focus.watch.length} watch | ${data.focus.pause.length} pause`;
    document.getElementById("projects-badge").textContent = `${data.projects.length} tracked projects`;
    document.getElementById("activity-badge").textContent = `${Math.min(filteredActivity().length, 5)} recent items`;
    document.getElementById("archive-badge").textContent = `${data.archive.length} archive records`;
    document.getElementById("sync-status").textContent =
      `${data.sync.status} | last refreshed ${data.sync.lastRefreshedAt}`;
  }

  function renderOverview() {
    const stats = [
      {
        label: "Tracked Contributions",
        value: data.summary.totalContributions,
        meta: [
          `${data.summary.uniqueProjects} active repos`,
          `last active ${data.summary.lastActiveAt}`,
          `${data.summary.sourceBreakdown.proof} proof-backed`,
        ],
        foot: "Contribution attempts tracked in the current ledger window",
        accent: "var(--blue)",
      },
      {
        label: "Real PRs",
        value: data.summary.realPrRuns,
        meta: [
          `${data.summary.ledgerPublishedRuns} ledger publications`,
          `${data.summary.realPrRuns} upstream PRs`,
          `${data.summary.mergedRuns || 0} merged`,
        ],
        foot: "Pull requests opened against upstream repositories",
        accent: "var(--green)",
      },
      {
        label: "Archived Assets",
        value: data.summary.archivedAssets,
        meta: [
          `${data.assets.dossiers} dossiers`,
          `${data.assets.patchDrafts} patch drafts`,
          `${data.assets.memoryFiles} memory files`,
        ],
        foot: "Reusable dossier, draft, and memory material",
        accent: "var(--slate)",
      },
    ];

    const container = document.getElementById("overview-primary");
    container.innerHTML = "";

    stats.forEach((item) => {
      const block = document.createElement("article");
      block.className = "stat";
      block.innerHTML = `
        <div>
          <div class="stat-label">${item.label}</div>
          <p class="stat-value">${item.value}</p>
        </div>
        <div class="stat-meta">
          <div class="stat-meta-row">
            ${item.meta.map((entry) => `<span class="stat-tag">${entry}</span>`).join("")}
          </div>
          <div class="stat-foot">
            <span>${item.foot}</span>
            <span class="stat-accent" style="background:${item.accent};"></span>
          </div>
        </div>
      `;
      container.appendChild(block);
    });
  }

  function renderOverviewFunnel() {
    const totalAttempts = data.projects.reduce((sum, item) => sum + item.contributionCount, 0);
    const published = data.projects.reduce((sum, item) => sum + (item.ledgerPublishedCount ?? item.publishedCount ?? 0), 0);
    const prOpen = data.summary.realPrRuns;
    const merged = data.projects.reduce((sum, item) => sum + item.mergedCount, 0);
    const stages = [
      { label: "Attempts", value: totalAttempts, tone: "slate" },
      { label: "Ledger Published", value: published, tone: "published" },
      { label: "PR Open", value: prOpen, tone: "pr_open" },
      { label: "Merged", value: merged, tone: "merged" },
    ];
    const max = Math.max(...stages.map((item) => item.value), 1);
    const container = document.getElementById("overview-funnel");

    container.innerHTML = `
      <div class="funnel-head">
        <h3>Outcome Funnel</h3>
        <div class="funnel-caption">${published}/${totalAttempts} ledger published | ${merged}/${prOpen || 0} merged</div>
      </div>
      <div class="funnel-list">
        ${stages
          .map((item, index) => {
            const previous = index === 0 ? item.value : stages[index - 1].value;
            const ratio = previous > 0 ? Math.round((item.value / previous) * 100) : 0;
            return `
              <div class="funnel-item">
                <div class="funnel-top">
                  <div class="funnel-label">${item.label}</div>
                  <div class="funnel-meta">${item.value} <span>${index === 0 ? "base" : `${ratio}% from prev`}</span></div>
                </div>
                <div class="funnel-bar">
                  <span data-tone="${item.tone}" style="width:${(item.value / max) * 100}%;"></span>
                </div>
              </div>
            `;
          })
          .join("")}
      </div>
    `;
  }

  function renderDecisionCallout() {
    const items = shortlistDecisionItems();
    const fallback = data.projects[0];
    const top = items[0] || (fallback ? {
      repoFullName: fallback.repoFullName,
      summary: fallback.note,
      reasons: [],
      decision: fallback.decision,
    } : null);
    const container = document.getElementById("decision-callout");

    if (!top) {
      container.innerHTML = `
        <p class="decision-title">Recommendation: wait for the first real contribution trail</p>
        <p class="decision-copy">Once OpenMeta writes proof-of-work, memory, or artifact state, deepen recommendations will appear here.</p>
      `;
      return;
    }

    const signals = getProjectSignals(top.repoFullName);
    const recommendationLead =
      top.decision === "deepen"
        ? `Recommendation: shift contribution focus toward ${top.repoFullName}`
        : top.decision === "watch"
          ? `Recommendation: keep ${top.repoFullName} warm and look for one cleaner landing`
          : `Recommendation: keep ${top.repoFullName} archived, but do not deepen yet`;
    container.innerHTML = `
      <p class="decision-title">${recommendationLead}</p>
      <p class="decision-copy">${top.summary}</p>
      <div class="decision-strength">
        <div class="decision-meter">
          <span data-kind="revisit" style="width:${signals.revisit}%;"></span>
          <span data-kind="landing" style="width:${signals.landing}%;"></span>
          <span data-kind="memory" style="width:${signals.memory}%;"></span>
        </div>
        <span class="decision-strength-meta">R ${signals.revisit} | L ${signals.landing} | M ${signals.memory}</span>
      </div>
    `;
  }

  function renderDecisionList() {
    const groups = shortlistDecisionItems();
    const container = document.getElementById("decision-list");
    container.innerHTML = "";

    if (groups.length === 0) {
      const row = document.createElement("article");
      row.className = "decision-item";
      row.innerHTML = `
        <div class="decision-top">
          <div class="decision-repo">No recommendation lanes yet</div>
        </div>
        <div class="decision-reason">Generate real contribution records to let the dashboard rank deepen, watch, and pause lanes.</div>
      `;
      container.appendChild(row);
      return;
    }

    groups.forEach((item) => {
      const signals = getProjectSignals(item.repoFullName);
      const row = document.createElement("article");
      row.className = "decision-item";
      row.innerHTML = `
        <div class="decision-top">
          <div class="decision-repo">${item.repoFullName}</div>
          <span class="pill" data-tone="${item.decision}">${formatDecisionLabel(item.decision)}</span>
        </div>
        <div class="decision-reason">${(item.reasons || []).slice(0, 1).join("")}</div>
        <div class="decision-strength">
          <div class="decision-meter">
            <span data-kind="revisit" style="width:${signals.revisit}%;"></span>
            <span data-kind="landing" style="width:${signals.landing}%;"></span>
            <span data-kind="memory" style="width:${signals.memory}%;"></span>
          </div>
          <span class="decision-strength-meta">R ${signals.revisit} | L ${signals.landing} | M ${signals.memory}</span>
        </div>
      `;
      container.appendChild(row);
    });
  }

  function renderSparkline(values) {
    const pointsSource = Array.isArray(values) && values.length > 0 ? values : [0, 0, 0, 0];
    const max = Math.max(...pointsSource, 1);
    const width = 90;
    const height = 22;
    const step = pointsSource.length > 1 ? width / (pointsSource.length - 1) : width;
    const points = pointsSource
      .map((value, index) => {
        const x = index * step;
        const y = height - (value / max) * (height - 4) - 2;
        return `${x},${y}`;
      })
      .join(" ");

    return `
      <svg class="sparkline" viewBox="0 0 ${width} ${height}" aria-hidden="true">
        <polyline points="${points}" fill="none" stroke="#2f6df6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></polyline>
      </svg>
    `;
  }

  function renderSourceMix(sourceMix) {
    const segments = [
      { key: "proof", short: "P", value: sourceMix.proof || 0 },
      { key: "memory", short: "M", value: sourceMix.memory || 0 },
      { key: "inbox", short: "I", value: sourceMix.inbox || 0 },
      { key: "artifact", short: "A", value: sourceMix.artifact || 0 },
    ];
    const total = segments.reduce((sum, item) => sum + item.value, 0);

    return `
      <div class="source-mix-compact" aria-label="Attempt source mix">
        <div class="source-mix-bar" aria-hidden="true">
          ${segments
            .map((item) => {
              const width = total > 0 ? (item.value / total) * 100 : 0;
              return `<span data-source="${item.key}" style="width:${width}%;"></span>`;
            })
            .join("")}
        </div>
        <div class="source-mix-meta">
          ${segments.map((item) => `<span>${item.short} ${item.value}</span>`).join("")}
        </div>
      </div>
    `;
  }

  function formatOpenTargetAction(openTarget) {
    const label = openTarget?.label || "Open";
    if (label === "Open") {
      return "Open Trail";
    }
    return `Open ${label}`;
  }

  function renderOpenAction(url, label) {
    if (!url) {
      return `
        <span class="link-button link-button-inline link-button-disabled" aria-disabled="true" title="No linked trail yet">
          <span>No Trail</span>
        </span>
      `;
    }

    return `
      <a class="link-button link-button-inline" href="${url}" target="_blank" rel="noreferrer" aria-label="${label}" title="${label}">
        <span>${label}</span>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M5.25 2H12V8.75" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M12 2L2 12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
          <path d="M10.25 7.5V11.25C10.25 11.6642 9.91421 12 9.5 12H2.75C2.33579 12 2 11.6642 2 11.25V4.5C2 4.08579 2.33579 3.75 2.75 3.75H6.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </a>
    `;
  }

  function renderProjectsTable() {
    const rows = filteredProjects();
    const table = document.getElementById("projects-table");

    table.innerHTML = "";
    document.getElementById("projects-summary").textContent =
      `${rows.length} projects | ${formatRepoLabel(state.repo)} | ${formatDecisionLabel(state.decision)}`;
    document.getElementById("projects-detail").textContent =
      `${rows.reduce((sum, item) => sum + item.contributionCount, 0)} attempts | ${rows.reduce(
        (sum, item) => sum + (item.ledgerPublishedCount ?? item.publishedCount ?? 0),
        0,
      )} ledger published | ${rows.reduce((sum, item) => sum + (item.prOpenCount ?? 0), 0)} PR open`;

    if (rows.length === 0) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td colspan="5">No projects match the current filter state.</td>`;
      table.appendChild(tr);
      return;
    }

    rows.forEach((item) => {
      const signals = getProjectSignals(item.repoFullName);
      const latestOutcome = `${formatOutcomeLabel(item.lastOutcome)} (${item.lastActiveAt})`;
      const sourceMix = item.sourceMix || { proof: 0, memory: 0, inbox: 0, artifact: 0 };
      const projectActionLabel = "Open Trail";
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td data-label="Project">
          <div class="project-cell">
            <div class="repo-title">${item.repoFullName}</div>
            <div class="repo-sub">${item.representativeTitle}</div>
            <div class="repo-sub">${item.note}</div>
            ${renderSourceMix(sourceMix)}
          </div>
        </td>
        <td data-label="State">
          <span class="status-dot" data-tone="${item.decision}"></span>
          <span class="pill" data-tone="${item.decision}">${formatDecisionLabel(item.decision)}</span>
        </td>
        <td data-label="Contribution">
          <div class="project-cell">
            <div>${item.contributionCount} attempts | ${item.ledgerPublishedCount ?? item.publishedCount ?? 0} ledger published</div>
            <div class="repo-sub">${item.conversionNote || `${item.attemptToPublishedRate ?? 0}% to pub | ${item.attemptToPrRate ?? 0}% to pr | ${item.attemptToMergedRate ?? 0}% to merge`}</div>
            <div class="repo-sub">${renderSparkline(signals.trend)}</div>
          </div>
        </td>
        <td data-label="Latest Outcome">
          <div class="project-cell">
            <div>${latestOutcome}</div>
            <div class="repo-sub">${item.prOpenCount ?? 0} PR open | ${item.mergedCount} merged | landed ${item.lastSuccessfulLandingAt || "n/a"}</div>
            <div class="repo-sub">${item.blockageNote || `${item.reviewRequiredCount ?? 0} review | ${item.validationFailedCount ?? 0} validation fail | ${item.openAttemptCount ?? 0} open`}</div>
          </div>
        </td>
        <td data-label="Score">
          <div class="project-cell">
            <div>${item.score}</div>
            <div class="repo-sub">
              ${renderOpenAction(item.detailLink, projectActionLabel)}
            </div>
          </div>
        </td>
      `;
      table.appendChild(tr);
    });
  }

  function renderAttemptsTable() {
    const rows = filteredAttempts();
    const table = document.getElementById("attempts-table");

    table.innerHTML = "";
    document.getElementById("attempts-badge").textContent = `${rows.length} visible attempts`;
    document.getElementById("attempts-summary").textContent =
      `${rows.length} attempts | ${formatRepoLabel(state.repo)} | ${formatDecisionLabel(state.decision)}`;
    document.getElementById("attempts-detail").textContent =
      `${rows.filter((item) => item.outcome === "merged").length} merged | ${rows.filter((item) => item.outcome === "pr_open").length} PR open | ${rows.filter((item) => item.outcome === "published").length} ledger published`;

    if (rows.length === 0) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td colspan="5">No contribution attempts match the current filter state.</td>`;
      table.appendChild(tr);
      return;
    }

    rows.forEach((item) => {
      const openActionLabel = formatOpenTargetAction(item.openTarget);
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td data-label="Attempt">
          <div class="project-cell">
            <div class="attempt-head">
            <div class="repo-title">${item.title}</div>
              <span class="pill source-pill" data-source="${item.source}">${item.sourceLabel}</span>
            </div>
            <div class="repo-sub">${formatAttemptReference(item)}</div>
            <div class="repo-sub">${formatAttemptWorkSummary(item)}</div>
            <div class="repo-sub">${formatValidationLabel(item.validationState, item.validationSummary)}</div>
          </div>
        </td>
        <td data-label="Outcome">
          <div class="project-cell">
            <span class="pill" data-tone="${item.outcome}">${formatOutcomeLabel(item.outcome)}</span>
            <div class="repo-sub">${item.assetCompletenessLabel || "0/4 assets"}</div>
          </div>
        </td>
        <td data-label="Ledger Trace">
          <div class="trace-cell">
            ${item.ledgerTrace.map((entry) => `<span class="trace-tag">${entry}</span>`).join("")}
          </div>
        </td>
        <td data-label="Last Update">
          <div class="project-cell">
            <div>${item.lastUpdatedAt}</div>
            <div class="repo-sub">${formatDecisionLabel(item.decision)}</div>
          </div>
        </td>
        <td data-label="Open">
          <div class="project-cell">
            ${renderOpenAction(item.detailLink, openActionLabel)}
          </div>
        </td>
      `;
      table.appendChild(tr);
    });
  }

  function renderTrend() {
    const records = trendRecords();
    const maxValue = Math.max(...records.map((item) => item.drafted + (item.ledgerPublished ?? item.published ?? 0) + (item.prOpen ?? 0) + item.merged), 1);
    const container = document.getElementById("trend-bars");
    const yAxis = document.getElementById("trend-y-axis");
    const summary = document.getElementById("trend-summary");

    document.getElementById("trend-badge").textContent =
      state.period === "weekly" ? `${records.length} weekly buckets` : `${records.length} monthly buckets`;
    document.getElementById("trend-insight").textContent = buildTrendInsight(records);
    summary.innerHTML = buildTrendSummary(records)
      .map(
        (item) => `
          <div class="trend-summary-item">
            <div class="trend-summary-label">${item.label}</div>
            <div class="trend-summary-value">${item.value}</div>
            <div class="trend-summary-note">${item.note}</div>
          </div>
        `,
      )
      .join("");

    container.innerHTML = "";
    yAxis.innerHTML = "";

    [maxValue, Math.round(maxValue * 0.75), Math.round(maxValue * 0.5), Math.round(maxValue * 0.25), 0].forEach(
      (tick) => {
        const label = document.createElement("div");
        label.className = "trend-y-tick";
        label.textContent = String(tick);
        yAxis.appendChild(label);
      },
    );

    records.forEach((item) => {
      const draftedHeight = (item.drafted / maxValue) * 182;
      const publishedHeight = ((item.ledgerPublished ?? item.published ?? 0) / maxValue) * 182;
      const prOpenHeight = ((item.prOpen ?? 0) / maxValue) * 182;
      const mergedHeight = (item.merged / maxValue) * 182;
      const col = document.createElement("div");
      col.className = "trend-col";
      col.innerHTML = `
        <div class="trend-stack">
          <div class="trend-bar" data-kind="drafted" style="height:${Math.max(8, draftedHeight)}px;"></div>
          <div class="trend-bar" data-kind="published" style="height:${Math.max(8, publishedHeight)}px;"></div>
          <div class="trend-bar" data-kind="pr_open" style="height:${Math.max(8, prOpenHeight)}px;"></div>
          <div class="trend-bar" data-kind="merged" style="height:${Math.max(8, mergedHeight)}px;"></div>
        </div>
        <div class="trend-meta">
          <div class="trend-period">${item.period}</div>
          <div class="trend-total">${item.drafted}/${item.ledgerPublished ?? item.published ?? 0}/${item.prOpen ?? 0}/${item.merged}</div>
          <div class="trend-source">P ${item.sourceBreakdown?.proof ?? 0} | M ${item.sourceBreakdown?.memory ?? 0} | A ${item.sourceBreakdown?.artifact ?? 0}</div>
        </div>
      `;
      container.appendChild(col);
    });
  }

  function renderActivityTimeline() {
    const container = document.getElementById("activity-list");
    container.innerHTML = "";

    const items = filteredActivity().slice(0, 5);
    if (items.length === 0) {
      const block = document.createElement("article");
      block.className = "activity-item";
      block.innerHTML = `
        <div class="activity-top">
          <div class="activity-title">No activity yet</div>
        </div>
        <div class="activity-sub">Once OpenMeta records real contribution attempts, the newest moves will appear here.</div>
      `;
      container.appendChild(block);
      return;
    }

    items.forEach((item) => {
      const block = document.createElement("article");
      block.className = "activity-item";
      block.innerHTML = `
        <div class="activity-top">
          <div class="activity-title">${item.title}</div>
          <span class="pill" data-tone="${item.type}">${formatOutcomeLabel(item.type)}</span>
        </div>
        <div class="activity-meta">${item.repoFullName} | ${item.date}</div>
        <div class="activity-sub">${item.description}</div>
      `;
      container.appendChild(block);
    });
  }

  function renderVaultComposition() {
    const total = Math.max(1, Object.values(data.assets).reduce((sum, value) => sum + value, 0));
    const container = document.getElementById("vault-composition");
    container.innerHTML = "";

    Object.entries(data.assets).forEach(([key, value]) => {
      const span = document.createElement("span");
      span.dataset.kind = key;
      span.style.width = `${(value / total) * 100}%`;
      container.appendChild(span);
    });
  }

  function renderArchive() {
    const groups = [
      {
        title: "High Leverage",
        tone: "published",
        items: data.archive.filter((item) => item.status === "ready" || item.status === "compounding"),
      },
      {
        title: "Needs Revisit",
        tone: "watch",
        items: data.archive.filter((item) => item.status === "review" || item.status === "hold"),
      },
    ];

    const container = document.getElementById("archive-grid");
    container.innerHTML = "";

    groups.forEach((group) => {
      const section = document.createElement("section");
      section.className = "archive-column";
      section.innerHTML = `
        <div class="archive-column-head">
          <h3>${group.title}</h3>
          <span class="pill" data-tone="${group.tone}">${group.items.length}</span>
        </div>
        ${
          group.items.length > 0
            ? group.items
                .map(
                  (item) => `
                    <article class="archive-item">
                      <div class="archive-top">
                        <div class="archive-cell">
                          <div class="archive-title">${item.label}</div>
                          <div class="archive-sub">${item.repoFullName} | ${item.title}</div>
                        </div>
                        <span class="pill" data-tone="${archiveToneMap[item.status]}">${item.status}</span>
                      </div>
                      <div class="archive-evidence">${item.evidenceLevel} | ${item.assetCompletenessLabel || "0/4 assets"} | ${item.reuseLabel}</div>
                      <div class="archive-lines">
                        <div class="archive-line archive-line-strong">${item.followThroughLabel} | revisit ${item.lastRevisitedAt}</div>
                        ${item.lines.map((line) => `<div class="archive-line">${line}</div>`).join("")}
                      </div>
                    </article>
                  `,
                )
                .join("")
            : `<article class="archive-item"><div class="archive-line">No archive entries in this group yet.</div></article>`
        }
      `;
      container.appendChild(section);
    });
  }

  function renderDashboard() {
    renderTopMeta();
    renderOverview();
    renderOverviewFunnel();
    renderDecisionCallout();
    renderDecisionList();
    renderProjectsTable();
    renderAttemptsTable();
    renderTrend();
    renderActivityTimeline();
    renderVaultComposition();
    renderArchive();
  }

  async function loadDashboardData(options) {
    const requestPath = options?.forceRefresh ? "./api/dashboard/refresh" : "./api/dashboard";
    const response = await fetch(requestPath, {
      method: options?.forceRefresh ? "POST" : "GET",
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    data = await response.json();
    return data;
  }

  async function bootstrap() {
    await loadDashboardData();
    initFilters();
    renderDashboard();
  }

  bootstrap().catch((error) => {
    document.getElementById("sync-status").textContent =
      `Dashboard failed to initialize | ${error instanceof Error ? error.message : String(error)}`;
  });
})();
