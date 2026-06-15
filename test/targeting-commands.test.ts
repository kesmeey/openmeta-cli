import { describe, expect, test } from 'bun:test';
import { Command } from 'commander';
import { registerAgentCommand } from '../src/commands/agent.js';
import { registerAnalyzeCommand } from '../src/commands/analyze.js';
import { registerScoutCommand } from '../src/commands/scout.js';

describe('repository targeting command options', () => {
  test('registers scout targeting options for presets and all-repos fallback', () => {
    const program = new Command();
    registerScoutCommand(program);

    const scoutCommand = program.commands.find((command) => command.name() === 'scout');
    const help = scoutCommand?.helpInformation() ?? '';

    expect(help).toContain('--preset <name>');
    expect(help).toContain('--all-repos');
  });

  test('registers agent targeting options for presets and all-repos fallback', () => {
    const program = new Command();
    registerAgentCommand(program);

    const agentCommand = program.commands.find((command) => command.name() === 'agent');
    const help = agentCommand?.helpInformation() ?? '';

    expect(help).toContain('--preset <name>');
    expect(help).toContain('--all-repos');
  });

  test('registers analyze targeting options for presets', () => {
    const program = new Command();
    registerAnalyzeCommand(program);

    const analyzeCommand = program.commands.find((command) => command.name() === 'analyze');
    const help = analyzeCommand?.helpInformation() ?? '';

    expect(help).toContain('--repo <repository>');
    expect(help).toContain('--preset <name>');
  });
});
