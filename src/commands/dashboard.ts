import { Command } from 'commander';
import { dashboardOrchestrator } from '../orchestration/index.js';
import { runCommand } from './run-command.js';

function parsePortOption(value: string): number {
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 0) {
    throw new Error('Port must be a non-negative integer.');
  }
  return port;
}

export function registerDashboardCommand(program: Command): void {
  program
    .command('dashboard')
    .description('Serve the contribution dashboard with live local OpenMeta data')
    .option('--host <host>', 'Host to bind the local dashboard server', '127.0.0.1')
    .option('--port <port>', 'Preferred port for the local dashboard server', '4326')
    .option('--open', 'Open the dashboard in your default browser after the server starts')
    .action((options: { host?: string; port?: string; open?: boolean }) =>
      runCommand(
        'OpenMeta Dashboard',
        () =>
          dashboardOrchestrator.serve({
            host: options.host,
            port: parsePortOption(options.port || '4326'),
            open: options.open,
          }),
        { recordRun: false },
      ),
    );
}
