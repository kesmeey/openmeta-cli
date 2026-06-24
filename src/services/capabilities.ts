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
      requiredPermissions: ['github:read'],
    },
    {
      name: 'workspace.prepare',
      description: 'Clone or reuse a repository workspace for agent execution.',
      isReadOnly: false,
      isConcurrencySafe: false,
      riskLevel: 'medium',
      inputSchemaName: 'WorkspacePrepareInput',
      outputSchemaName: 'RepoWorkspaceContext',
      requiredPermissions: ['filesystem:read', 'git:write'],
    },
    {
      name: 'workspace.file_write',
      description: 'Apply generated file changes inside the selected workspace context.',
      isReadOnly: false,
      isConcurrencySafe: false,
      riskLevel: 'high',
      inputSchemaName: 'FilePatchToolInput',
      outputSchemaName: 'GeneratedChangeApplyResult',
      requiredPermissions: ['filesystem:write'],
    },
    {
      name: 'validation.command',
      description: 'Run detected validation commands inside a prepared workspace.',
      isReadOnly: false,
      isConcurrencySafe: false,
      riskLevel: 'medium',
      inputSchemaName: 'ValidationToolInput',
      outputSchemaName: 'TestResult[]',
      requiredPermissions: ['process:execute'],
    },
    {
      name: 'github.create_draft_pr',
      description: 'Push generated changes to a fork and open an upstream draft pull request.',
      isReadOnly: false,
      isConcurrencySafe: false,
      riskLevel: 'high',
      inputSchemaName: 'PullRequestToolInput',
      outputSchemaName: 'ContributionPrSubmissionResult',
      requiredPermissions: ['git:push', 'github:write'],
    },
    {
      name: 'artifact.publish',
      description: 'Publish generated contribution artifacts into the configured artifact repository.',
      isReadOnly: false,
      isConcurrencySafe: false,
      riskLevel: 'high',
      inputSchemaName: 'ArtifactPublishToolInput',
      outputSchemaName: 'GitPublishResult',
      requiredPermissions: ['filesystem:write', 'git:push'],
    },
    {
      name: 'agent.role_pipeline',
      description: 'Execute research, patch, and independent verification roles through explicit handoffs.',
      isReadOnly: false,
      isConcurrencySafe: false,
      riskLevel: 'medium',
      inputSchemaName: 'AgentRolePipelineInput',
      outputSchemaName: 'AgentRolePipelineResult',
      requiredPermissions: ['agent:delegate'],
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
