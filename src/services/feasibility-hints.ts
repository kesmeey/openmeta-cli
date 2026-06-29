import type {
  EnvironmentInfo,
  RankedIssue,
  ScoutFeasibilityHint,
  ScoutFeasibilityLevel,
  ScoutIssueScope,
} from '../types/index.js';
import type { RepositoryProbe } from './github.js';

const READY_ADJUSTMENT = 3;
const FIXABLE_ADJUSTMENT = -5;
const RISKY_ADJUSTMENT = -15;
const LIKELY_BLOCKED_ADJUSTMENT = -30;
const UNKNOWN_ADJUSTMENT = -8;

export class FeasibilityHintService {
  assess(issue: RankedIssue, probe: RepositoryProbe | null, environment: EnvironmentInfo): ScoutFeasibilityHint {
    const issueScope = this.classifyIssueScope(issue);
    const repoRisks = probe ? this.detectRepoRisks(probe) : [];
    const issueRisks = this.detectIssueRisks(issue);
    const missingLocalCapabilities = this.detectMissingCapabilities(
      [...repoRisks, ...issueRisks],
      environment,
      issueScope,
      this.searchText(issue),
    );
    const mitigations = this.detectMitigations([...repoRisks, ...issueRisks], environment);
    const staticFriendly = issueScope === 'docs_only' || issueScope === 'config_only';
    const issueHasHardRuntimeRisk =
      issueScope === 'hardware_specific' ||
      issueScope === 'performance' ||
      (issueScope === 'runtime_bug' && issueRisks.length > 0);

    let level: ScoutFeasibilityLevel = 'ready';
    if (!probe) {
      level = 'unknown';
    } else if (issueHasHardRuntimeRisk && missingLocalCapabilities.length > 0) {
      level = 'likely_blocked';
    } else if (!staticFriendly && missingLocalCapabilities.length > 0) {
      level = mitigations.length > 0 ? 'risky' : 'likely_blocked';
    } else if (!staticFriendly && repoRisks.length > 0) {
      level = mitigations.length > 0 ? 'likely_fixable' : 'risky';
    } else if (staticFriendly && repoRisks.length > 0) {
      level = 'likely_fixable';
    }

    const scoreAdjustment = this.scoreAdjustment(level, staticFriendly, issueHasHardRuntimeRisk);
    const adjustedOverallScore = this.clampScore(issue.opportunity.overallScore + scoreAdjustment);

    return {
      level,
      issueScope,
      repoRisks,
      issueRisks,
      missingLocalCapabilities,
      mitigations,
      confidence: this.confidence(probe, repoRisks, issueRisks, missingLocalCapabilities),
      scoreAdjustment,
      adjustedOverallScore,
      explanation: this.explain(level, issueScope, repoRisks, issueRisks, missingLocalCapabilities, mitigations),
    };
  }

  isSafeForHeadless(issue: RankedIssue): boolean {
    const hint = issue.scoutFeasibility;
    if (!hint) {
      return true;
    }

    if (hint.level === 'likely_blocked') {
      return false;
    }

    if (
      hint.level === 'risky' &&
      ['unknown', 'hardware_specific', 'performance', 'runtime_bug'].includes(hint.issueScope)
    ) {
      return false;
    }

    return true;
  }

  private classifyIssueScope(issue: RankedIssue): ScoutIssueScope {
    const text = this.searchText(issue);
    const labels = this.normalize(issue.labels.join(' '));
    const docsLike =
      /\b(readme|docs?|documentation|typo|spelling|comment|examples?|guide|tutorial)\b/.test(text) ||
      /\b(setup notes?|deployment notes?|installation notes?|install docs?)\b/.test(text);
    const configLike = /\b(config|yaml|yml|json|toml|workflow|ci|metadata|lint config)\b/.test(text);

    if (
      /\b(oom|out of memory|training|fine tune|benchmark|cuda crash|gpu crash|kernel failure)\b/.test(text) ||
      (/\b(cuda|gpu|nvidia|rocm|mps|tpu|vram)\b/.test(text) && !docsLike && !configLike)
    ) {
      return 'hardware_specific';
    }
    if (/\b(performance|slow|latency|benchmark|optimi[sz]e|memory leak|throughput)\b/.test(text)) {
      return 'performance';
    }
    if (/\b(crash|exception|stack trace|repro|reproduce|runtime error|fails when|bug)\b/.test(text)) {
      return 'runtime_bug';
    }
    if (/\b(test|coverage|flaky|spec|unit test|integration test)\b/.test(text) || labels.includes('test')) {
      return 'test_only';
    }
    if (docsLike) {
      return 'docs_only';
    }
    if (configLike) {
      return 'config_only';
    }
    if (/\b(refactor|type|typescript|typing|small|minor|cleanup)\b/.test(text)) {
      return 'small_code_change';
    }

    return 'unknown';
  }

  private detectRepoRisks(probe: RepositoryProbe): string[] {
    const risks = new Set<string>();
    const files = probe.files;
    const all = this.normalize(
      [
        files.packageJson,
        files.pyprojectToml,
        files.requirementsTxt,
        files.cargoToml,
        files.goMod,
        files.dockerCompose,
        files.dockerfile,
        files.readme,
        ...files.workflows.map((workflow) => workflow.content),
      ]
        .filter(Boolean)
        .join('\n'),
    );

    if (files.dockerCompose || /\bdocker compose\b|\bdocker-compose\b|\bservices:\b/.test(all)) risks.add('docker');
    if (/\b(postgres|postgresql|mysql|redis|mongodb|elasticsearch|kafka|rabbitmq)\b/.test(all)) risks.add('service');
    if (/\b(playwright|cypress|selenium|webdriver|puppeteer)\b/.test(all)) risks.add('browser_e2e');
    if (/\b(torch|tensorflow|cuda|cudnn|nvidia|rocm|deepspeed|accelerate|transformers)\b/.test(all)) {
      risks.add('gpu_ml');
    }
    if (/\b(android|ios|xcode|gradle|emulator|react native|swift|kotlin)\b/.test(all)) risks.add('mobile');
    if (/\b(cmake|node-gyp|gcc|clang|makefile|native build|build-essential)\b/.test(all)) risks.add('native_build');
    if (/\bubuntu|linux only|linux-only|apt-get|systemd\b/.test(all)) risks.add('linux_specific');
    if (/\bmacos only|macos-only|darwin|xcodebuild\b/.test(all)) risks.add('macos_specific');
    if (/\bwindows only|windows-only|powershell\b/.test(all)) risks.add('windows_specific');

    return [...risks];
  }

  private detectIssueRisks(issue: RankedIssue): string[] {
    const text = this.searchText(issue);
    const risks = new Set<string>();

    if (/\b(cuda|gpu|nvidia|rocm|mps|tpu|vram|training|fine tune|benchmark)\b/.test(text)) risks.add('gpu_ml');
    if (/\bdocker\b|\bdocker compose\b|\bdocker-compose\b/.test(text)) risks.add('docker');
    if (/\b(postgres|postgresql|mysql|redis|mongodb|elasticsearch|kafka|rabbitmq)\b/.test(text)) risks.add('service');
    if (/\b(playwright|cypress|selenium|webdriver|puppeteer)\b/.test(text)) risks.add('browser_e2e');
    if (/\b(android|ios|xcode|emulator|react native|swift|kotlin)\b/.test(text)) risks.add('mobile');
    if (/\b(cmake|node-gyp|gcc|clang|native build)\b/.test(text)) risks.add('native_build');
    if (/\blinux only|linux-only|ubuntu|apt-get|systemd\b/.test(text)) risks.add('linux_specific');
    if (/\bmacos only|macos-only|darwin|xcodebuild\b/.test(text)) risks.add('macos_specific');
    if (/\bwindows only|windows-only|powershell\b/.test(text)) risks.add('windows_specific');

    return [...risks];
  }

  private detectMissingCapabilities(
    risks: string[],
    environment: EnvironmentInfo,
    issueScope: ScoutIssueScope,
    issueText: string,
  ): string[] {
    const missing = new Set<string>();
    const hasTool = (name: string) => environment.tools.some((tool) => tool.name === name && tool.available);
    const platform = environment.os.platform;
    const hasCuda = environment.gpu.some((gpu) => gpu.cudaVersion) || hasTool('nvidia-smi');
    const maxCudaVramMB = Math.max(0, ...environment.gpu.filter((gpu) => gpu.cudaVersion).map((gpu) => gpu.vramMB));
    const needsHeavyGpu =
      issueScope === 'hardware_specific' &&
      /\b(oom|out of memory|memory leak|training|fine tune|benchmark|conv3d|large model)\b/.test(issueText);

    if (risks.includes('gpu_ml') && !hasCuda) missing.add('cuda_gpu');
    if (risks.includes('gpu_ml') && hasCuda && needsHeavyGpu && maxCudaVramMB > 0 && maxCudaVramMB < 8192) {
      missing.add('high_vram_gpu');
    }
    if (risks.includes('docker') && !hasTool('docker')) missing.add('docker');
    if (risks.includes('browser_e2e') && !hasTool('node') && !hasTool('bun')) missing.add('node_runtime');
    if (risks.includes('mobile')) missing.add('mobile_toolchain');
    if (risks.includes('native_build') && !hasTool('cmake') && !hasTool('gcc') && !hasTool('clang')) {
      missing.add('native_toolchain');
    }
    if (risks.includes('linux_specific') && platform !== 'linux' && environment.os.wslDistros.length === 0) {
      missing.add('linux_surface');
    }
    if (risks.includes('macos_specific') && platform !== 'darwin') missing.add('macos_surface');
    if (risks.includes('windows_specific') && platform !== 'win32') missing.add('windows_surface');
    if (risks.includes('service') && !hasTool('docker')) missing.add('service_runtime');

    return [...missing];
  }

  private detectMitigations(risks: string[], environment: EnvironmentInfo): string[] {
    const mitigations = new Set<string>();
    const hasTool = (name: string) => environment.tools.some((tool) => tool.name === name && tool.available);
    const hypervisor = environment.os.hypervisor;

    if (environment.os.wslDistros.length > 0) mitigations.add('wsl_available');
    if (hypervisor.isVM) mitigations.add(`${hypervisor.type}_vm_available`);
    if (hypervisor.isContainer) mitigations.add('container_environment');
    if (hypervisor.isCI) mitigations.add('ci_environment');
    if (hasTool('docker')) mitigations.add('docker_available');
    if (risks.includes('service') && hasTool('docker')) mitigations.add('services_can_use_docker');
    if (risks.includes('linux_specific') && environment.os.wslDistros.length > 0)
      mitigations.add('linux_possible_via_wsl');

    return [...mitigations];
  }

  private scoreAdjustment(
    level: ScoutFeasibilityLevel,
    staticFriendly: boolean,
    issueHasHardRuntimeRisk: boolean,
  ): number {
    if (staticFriendly && level !== 'unknown' && level !== 'ready') {
      return Math.min(0, level === 'likely_blocked' ? RISKY_ADJUSTMENT : FIXABLE_ADJUSTMENT);
    }

    if (issueHasHardRuntimeRisk && level === 'likely_blocked') {
      return LIKELY_BLOCKED_ADJUSTMENT;
    }

    switch (level) {
      case 'ready':
        return READY_ADJUSTMENT;
      case 'likely_fixable':
        return FIXABLE_ADJUSTMENT;
      case 'risky':
        return RISKY_ADJUSTMENT;
      case 'likely_blocked':
        return LIKELY_BLOCKED_ADJUSTMENT;
      case 'unknown':
        return UNKNOWN_ADJUSTMENT;
    }
  }

  private confidence(
    probe: RepositoryProbe | null,
    repoRisks: string[],
    issueRisks: string[],
    missingLocalCapabilities: string[],
  ): ScoutFeasibilityHint['confidence'] {
    if (!probe) return 'low';
    if (issueRisks.length > 0 && missingLocalCapabilities.length > 0) return 'high';
    if (repoRisks.length > 0 || issueRisks.length > 0) return 'medium';
    return 'low';
  }

  private explain(
    level: ScoutFeasibilityLevel,
    issueScope: ScoutIssueScope,
    repoRisks: string[],
    issueRisks: string[],
    missingLocalCapabilities: string[],
    mitigations: string[],
  ): string {
    const riskText = [...new Set([...issueRisks, ...repoRisks])].join(', ') || 'no major environment risk detected';
    const missingText = missingLocalCapabilities.join(', ') || 'no missing capability detected';
    const mitigationText = mitigations.length > 0 ? ` Mitigations: ${mitigations.join(', ')}.` : '';
    return `Scout hint ${level}: scope=${issueScope}; risks=${riskText}; missing=${missingText}.${mitigationText}`;
  }

  private searchText(issue: RankedIssue): string {
    return this.normalize(
      [
        issue.title,
        issue.body,
        issue.repoDescription,
        issue.labels.join(' '),
        issue.analysis.coreDemand,
        issue.analysis.techRequirements.join(' '),
      ].join('\n'),
    );
  }

  private normalize(value: string): string {
    return value
      .toLowerCase()
      .replace(/\+\+/g, ' plus plus')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private clampScore(value: number): number {
    return Math.max(0, Math.min(100, Math.round(value)));
  }
}

export const feasibilityHintService = new FeasibilityHintService();
