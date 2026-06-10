import { describe, expect, test } from 'bun:test';
import { Command } from 'commander';
import { registerDashboardCommand } from '../src/commands/dashboard.js';

describe('registerDashboardCommand', () => {
  test('registers dashboard command with local server options', () => {
    const program = new Command();
    registerDashboardCommand(program);

    const dashboardCommand = program.commands.find((command) => command.name() === 'dashboard');
    const help = dashboardCommand?.helpInformation() ?? '';

    expect(help).toContain('dashboard');
    expect(help).toContain('--host <host>');
    expect(help).toContain('--port <port>');
    expect(help).toContain('--open');
  });
});
