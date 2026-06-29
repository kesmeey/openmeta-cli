import type { Command } from 'commander';
import { resolve } from 'path';
import { configOrchestrator } from '../orchestration/index.js';
import { runCommand } from './run-command.js';

export function registerConfigCommand(program: Command): void {
  const config = program.command('config').description('View and modify OpenMeta CLI configuration');

  config
    .command('view')
    .description('View current configuration')
    .action(() => runCommand('OpenMeta Config', () => configOrchestrator.view()));

  config
    .command('set <key> <value>')
    .description('Set a configuration value')
    .action((key: string, value: string) => runCommand('OpenMeta Config', () => configOrchestrator.set(key, value)));

  config
    .command('scoring')
    .description('Configure scoring weights interactively with presets or custom values')
    .action(() => runCommand('OpenMeta Scoring', () => configOrchestrator.scoring()));

  config
    .command('export')
    .description('Export configuration to a portable JSON file (secrets redacted by default)')
    .option('-o, --output <path>', 'Output file path', 'openmeta-config.json')
    .option('--include-secrets', 'Include sensitive credentials in plaintext')
    .action((opts: { output: string; includeSecrets?: boolean }) =>
      runCommand('OpenMeta Config', () =>
        configOrchestrator.exportConfig(resolve(opts.output), { includeSecrets: opts.includeSecrets }),
      ),
    );

  config
    .command('import <path>')
    .description('Import configuration from a previously exported JSON file')
    .action((inputPath: string) =>
      runCommand('OpenMeta Config', () => configOrchestrator.importConfig(resolve(inputPath))),
    );

  config
    .command('reset')
    .description('Reset configuration to defaults')
    .action(() => runCommand('OpenMeta Config', () => configOrchestrator.reset()));
}
