import * as p from '@clack/prompts';
import chalk from 'chalk';
import figures from 'figures';
import { isMachineContext } from '../execution-context.js';
import type { TaskController, TaskOptions, Tone, UiCapabilities } from './types.js';

function renderStepLabel(options: TaskOptions): string {
  if (!options.step) {
    return options.title;
  }

  return `Step ${options.step.index}/${options.step.total} ${options.title}`;
}

function resolveHeartbeatMessage(options: TaskOptions, elapsedMs: number): string | null {
  if (!options.heartbeat) {
    return null;
  }

  const message =
    typeof options.heartbeat.message === 'function'
      ? options.heartbeat.message({ elapsedMs })
      : options.heartbeat.message;

  return message ? renderStepLabel({ ...options, title: message }) : null;
}

function toneColor(tone: Tone): 'green' | 'yellow' | 'red' | 'magenta' | 'white' | 'cyan' {
  switch (tone) {
    case 'success':
      return 'green';
    case 'warning':
      return 'yellow';
    case 'error':
      return 'red';
    case 'accent':
      return 'magenta';
    case 'muted':
      return 'white';
    case 'info':
    default:
      return 'cyan';
  }
}

function renderInlineStatus(symbol: string, text: string, tone: Tone): string {
  const color = toneColor(tone);

  switch (color) {
    case 'green':
      return chalk.greenBright(`${symbol} ${text}`);
    case 'yellow':
      return chalk.yellowBright(`${symbol} ${text}`);
    case 'red':
      return chalk.redBright(`${symbol} ${text}`);
    case 'magenta':
      return chalk.magentaBright(`${symbol} ${text}`);
    case 'white':
      return chalk.white(`${symbol} ${text}`);
    case 'cyan':
    default:
      return chalk.cyanBright(`${symbol} ${text}`);
  }
}

function writeMachineStatus(symbol: string, text: string, tone: Tone): void {
  process.stderr.write(`${renderInlineStatus(symbol, text, tone)}\n`);
}

export async function runTask<T>(
  capabilities: UiCapabilities,
  options: TaskOptions,
  task: (controller: TaskController) => Promise<T>,
): Promise<T> {
  const tone = options.tone ?? 'info';
  const title = renderStepLabel(options);
  const doneMessage = options.doneMessage ? renderStepLabel({ ...options, title: options.doneMessage }) : title;
  const failedMessage = options.failedMessage ? renderStepLabel({ ...options, title: options.failedMessage }) : title;
  const controller: TaskController = {
    setMessage(_message: string): void {
      // no-op by default; interactive mode replaces this with spinner.message(...)
    },
  };
  const startedAt = Date.now();
  const heartbeatIntervalMs = Math.max(10, options.heartbeat?.intervalMs ?? 10_000);
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let lastHeartbeatMessage = '';

  const startHeartbeat = (emit: (message: string) => void): void => {
    if (!options.heartbeat) {
      return;
    }

    heartbeatTimer = setInterval(() => {
      const message = resolveHeartbeatMessage(options, Date.now() - startedAt);
      if (!message || message === lastHeartbeatMessage) {
        return;
      }

      lastHeartbeatMessage = message;
      emit(message);
    }, heartbeatIntervalMs);
  };

  const stopHeartbeat = (): void => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  };

  if (isMachineContext()) {
    writeMachineStatus(figures.pointerSmall, title, tone);
    controller.setMessage = (message: string) => {
      writeMachineStatus(figures.ellipsis, renderStepLabel({ ...options, title: message }), tone);
    };
    startHeartbeat((message) => writeMachineStatus(figures.ellipsis, message, tone));

    try {
      const result = await task(controller);
      stopHeartbeat();
      writeMachineStatus(figures.tick, `[success] ${doneMessage}`, 'success');
      return result;
    } catch (error) {
      stopHeartbeat();
      writeMachineStatus(figures.cross, failedMessage, 'error');
      throw error;
    }
  }

  if (!capabilities.isInteractive || capabilities.mode === 'plain') {
    process.stdout.write(`${renderInlineStatus(figures.pointerSmall, title, tone)}\n`);
    startHeartbeat((message) => process.stdout.write(`${renderInlineStatus(figures.ellipsis, message, tone)}\n`));
    try {
      const result = await task(controller);
      stopHeartbeat();
      process.stdout.write(`${renderInlineStatus(figures.tick, `[success] ${doneMessage}`, 'success')}\n`);
      return result;
    } catch (error) {
      stopHeartbeat();
      process.stdout.write(`${renderInlineStatus(figures.cross, failedMessage, 'error')}\n`);
      throw error;
    }
  }

  const spinner = p.spinner({
    indicator: capabilities.supportsUnicode ? 'dots' : 'timer',
  });
  spinner.start(title);
  controller.setMessage = (message: string) => {
    spinner.message(renderStepLabel({ ...options, title: message }));
  };
  startHeartbeat((message) => spinner.message(message));

  try {
    const result = await task(controller);
    stopHeartbeat();
    spinner.stop(`${figures.tick} [success] ${doneMessage}`);
    return result;
  } catch (error) {
    stopHeartbeat();
    spinner.error(`${figures.cross} [error] ${failedMessage}`);
    throw error;
  }
}
