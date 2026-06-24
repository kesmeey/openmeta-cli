import type { AgentCapability } from '../types/index.js';

export class CapabilityRegistryService {
  private readonly capabilities: AgentCapability[] = [
    {
      name: 'github.issue_discovery',
      description: 'Discover and load GitHub issues for contribution workflows.',
      isReadOnly: true,
      isConcurrencySafe: true,
      riskLevel: 'low',
      inputSchemaName: 'GitHubIssueDiscoveryInput',
      outputSchemaName: 'GitHubIssueDiscoveryOutput',
    },
    {
      name: 'workspace.prepare',
      description: 'Clone or reuse a repository workspace for agent execution.',
      isReadOnly: false,
      isConcurrencySafe: false,
      riskLevel: 'medium',
      inputSchemaName: 'WorkspacePrepareInput',
      outputSchemaName: 'RepoWorkspaceContext',
    },
    {
      name: 'workspace.file_write',
      description: 'Apply generated file changes inside the selected workspace context.',
      isReadOnly: false,
      isConcurrencySafe: false,
      riskLevel: 'high',
      inputSchemaName: 'GeneratedFileChange[]',
      outputSchemaName: 'GeneratedChangeApplyResult',
    },
    {
      name: 'validation.command',
      description: 'Run detected validation commands inside a prepared workspace.',
      isReadOnly: true,
      isConcurrencySafe: false,
      riskLevel: 'medium',
      inputSchemaName: 'TestCommand[]',
      outputSchemaName: 'TestResult[]',
    },
    {
      name: 'github.create_draft_pr',
      description: 'Push generated changes to a fork and open an upstream draft pull request.',
      isReadOnly: false,
      isConcurrencySafe: false,
      riskLevel: 'high',
      inputSchemaName: 'ContributionPullRequestInput',
      outputSchemaName: 'ContributionPullRequestResult',
    },
    {
      name: 'artifact.publish',
      description: 'Publish generated contribution artifacts into the configured artifact repository.',
      isReadOnly: false,
      isConcurrencySafe: false,
      riskLevel: 'medium',
      inputSchemaName: 'ArtifactPublishInput',
      outputSchemaName: 'ArtifactPublishResult',
    },
    {
      name: 'agent.role_pipeline',
      description: 'Execute research, patch, and independent verification roles through explicit handoffs.',
      isReadOnly: false,
      isConcurrencySafe: false,
      riskLevel: 'medium',
      inputSchemaName: 'AgentRolePipelineInput',
      outputSchemaName: 'AgentRolePipelineResult',
    },
  ];

  list(): AgentCapability[] {
    return [...this.capabilities];
  }

  find(name: string): AgentCapability | undefined {
    return this.capabilities.find((capability) => capability.name === name);
  }
}

export const capabilityRegistryService = new CapabilityRegistryService();
