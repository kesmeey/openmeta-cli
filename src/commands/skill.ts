import type { Command } from 'commander';
import {
  doctorSkillBundle,
  getSkillsRoot,
  getSupportedSkillHosts,
  installSkillBundle,
  renderSkillBundle,
  type SkillHost,
} from '../orchestration/skill/index.js';

function parseHost(value: string): SkillHost {
  if (value === 'claude-code' || value === 'codex' || value === 'openclaw') {
    return value;
  }

  throw new Error(`Unsupported skill host: ${value}`);
}

export function registerSkillCommand(program: Command): void {
  const skill = program.command('skill').description('Host-generated OpenMeta skill bundle management');

  skill
    .command('list')
    .description('List supported skill hosts and the canonical asset source path')
    .action(() => {
      process.stdout.write(
        `${JSON.stringify(
          {
            hosts: getSupportedSkillHosts(),
            sourceRoot: getSkillsRoot(),
          },
          null,
          2,
        )}\n`,
      );
    });

  skill
    .command('export')
    .description('Render a host skill bundle into an output directory')
    .requiredOption('--host <host>', 'Host name')
    .requiredOption('--output <dir>', 'Output directory')
    .action(async (options: { host?: string; output?: string }) => {
      const result = await renderSkillBundle(parseHost(options.host || ''), options.output || '');
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    });

  skill
    .command('install')
    .description('Install a host skill bundle into the default host path')
    .requiredOption('--host <host>', 'Host name')
    .action(async (options: { host?: string }) => {
      const result = await installSkillBundle(parseHost(options.host || ''));
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    });

  skill
    .command('doctor')
    .description('Diagnose host skill bundle installation state')
    .requiredOption('--host <host>', 'Host name')
    .action(async (options: { host?: string }) => {
      const result = await doctorSkillBundle(parseHost(options.host || ''));
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    });
}
