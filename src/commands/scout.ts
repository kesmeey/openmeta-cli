import { Command } from 'commander';
import { agentOrchestrator } from '../orchestration/index.js';
import { runCommand } from './run-command.js';

export function registerScoutCommand(program: Command): void {
  program
    .command('scout')
    .description('Rank the highest-value contribution opportunities')
    .option('--limit <count>', 'Number of opportunities to show', '10')
    .option('--refresh', 'Ignore cached GitHub issue discovery results')
    .option('--repo <repository>', 'Limit issue discovery to one GitHub repository URL or owner/name')
    .action((options: { limit?: string; refresh?: boolean; repo?: string }) =>
      runCommand('OpenMeta Scout', () =>
        agentOrchestrator.scout({
          limit: Number.parseInt(options.limit || '10', 10) || 10,
          refresh: options.refresh,
          repo: options.repo,
        }),
      ),
    );
}
