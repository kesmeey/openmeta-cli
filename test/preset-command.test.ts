import { describe, expect, test } from 'bun:test';
import { Command } from 'commander';
import { registerPresetCommand } from '../src/commands/preset.js';

describe('registerPresetCommand', () => {
  test('registers preset management commands and options', () => {
    const program = new Command();
    registerPresetCommand(program);

    const presetCommand = program.commands.find((command) => command.name() === 'preset');
    const help = presetCommand?.helpInformation() ?? '';
    const addHelp = presetCommand?.commands.find((command) => command.name() === 'add')?.helpInformation() ?? '';

    expect(help).toContain('list');
    expect(help).toContain('add');
    expect(help).toContain('use');
    expect(help).toContain('remove');
    expect(addHelp).toContain('--repo <repository>');
    expect(addHelp).toContain('--activate');
  });
});
