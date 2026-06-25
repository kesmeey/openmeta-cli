export type IssueClaimStatus = 'none' | 'possible' | 'likely' | 'claimed';
export type IssueDiscussionDifficultyStatus = 'none' | 'possible' | 'likely' | 'high';

export interface GitHubIssueComment {
  author: string;
  authorAssociation: string;
  body: string;
  createdAt: string;
  htmlUrl: string;
}

export interface IssueClaimAssessment {
  status: IssueClaimStatus;
  evidence: string[];
  checkedAt: string;
}

export interface IssueDiscussionDifficultyAssessment {
  status: IssueDiscussionDifficultyStatus;
  evidence: string[];
  checkedAt: string;
}

export interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  body: string;
  htmlUrl: string;
  repoName: string;
  repoFullName: string;
  repoDescription: string;
  repoStars: number;
  labels: string[];
  createdAt: string;
  updatedAt: string;
  recentComments?: GitHubIssueComment[];
  claimAssessment?: IssueClaimAssessment;
  discussionDifficultyAssessment?: IssueDiscussionDifficultyAssessment;
}

export interface MatchedIssue extends GitHubIssue {
  matchScore: number;
  analysis: {
    coreDemand: string;
    techRequirements: string[];
    solutionSuggestion: string;
    estimatedWorkload: string;
  };
}
