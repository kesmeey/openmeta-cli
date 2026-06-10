#!/usr/bin/env bun
import { Command } from 'commander';
import {
  registerAgentCommand,
  registerAnalyzeCommand,
  registerAutomationCommand,
  registerConfigCommand,
  registerDashboardCommand,
  registerDailyCommand,
  registerDoctorCommand,
  registerInboxCommand,
  registerInitCommand,
  registerMachineCommand,
  registerPowCommand,
  registerProviderCommand,
  registerRunsCommand,
  registerScoutCommand,
  registerSkillCommand,
} from './commands/index.js';
import { getErrorMessage, ui } from './infra/index.js';

const VERSION = '1.2.3';

async function main(): Promise<void> {
  const program = new Command();

  program
    .name('openmeta')
    .description("OpenMeta CLI - Developer's daily open source growth companion")
    .version(VERSION, '-v, --version', 'Show version')
    .helpOption('-h, --help', 'Show help')
    .showSuggestionAfterError()
    .showHelpAfterError();

  registerInitCommand(program);
  registerAgentCommand(program);
  registerAnalyzeCommand(program);
  registerDailyCommand(program);
  registerScoutCommand(program);
  registerInboxCommand(program);
  registerPowCommand(program);
  registerConfigCommand(program);
  registerDashboardCommand(program);
  registerProviderCommand(program);
  registerAutomationCommand(program);
  registerDoctorCommand(program);
  registerRunsCommand(program);
  registerMachineCommand(program);
  registerSkillCommand(program);

  program.on('command:*', () => {
    ui.commandFailed(
      'openmeta',
      `Unknown command "${program.args.join(' ')}". Run "openmeta --help" to see available commands.`,
    );
    process.exit(1);
  });

  if (process.argv.length === 2) {
    program.help();
  }

  await program.parseAsync(process.argv);
}

main().catch((error) => {
  ui.commandFailed('openmeta', getErrorMessage(error));
  process.exit(1);
});
