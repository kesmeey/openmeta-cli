import { Command } from 'commander';
import { analyzeOrchestrator } from '../orchestration/index.js';
import { runCommand } from './run-command.js';

export function registerAnalyzeCommand(program: Command): void {
  program
    .command('analyze')
    .description('Analyze a repository and draft contribution suggestions without relying on existing issues')
    .option('--repo <repository>', 'GitHub repository URL or owner/name to analyze')
    .option('--preset <name>', 'Use one saved repository preset as the analysis scope')
    .option('--repo-path <path>', 'Reuse a local repository path via an isolated worktree')
    .option('--headless', 'Select the highest-scoring suggestion without prompting')
    .option('--run-checks', 'Execute detected baseline validation commands during workspace preparation')
    .option('--dry-run', 'Preview artifact paths without writing local analysis files')
    .action(
      (options: {
        repo?: string;
        preset?: string;
        repoPath?: string;
        headless?: boolean;
        runChecks?: boolean;
        dryRun?: boolean;
      }) =>
        runCommand('OpenMeta Analyze', () =>
          analyzeOrchestrator.run({
            repo: options.repo,
            preset: options.preset,
            repoPath: options.repoPath,
            headless: options.headless,
            runChecks: options.runChecks,
            dryRun: options.dryRun,
          }),
        ),
    );
}
