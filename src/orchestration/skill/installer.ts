import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { SkillHost } from './catalog.js';
import { getInstalledSkillFileName, renderInstallSkillContent } from './renderer.js';

export interface SkillInstallResult {
  host: SkillHost;
  installed: boolean;
  installPath?: string;
  exportedFiles: string[];
  manualInstructions?: string;
}

export interface SkillInstallOptions {
  homeDir?: string;
}

function resolveDefaultInstallPath(host: SkillHost, homeDir = homedir()): string | null {
  if (host === 'claude-code') {
    return join(homeDir, '.claude', 'skills', 'openmeta');
  }

  if (host === 'codex') {
    return join(homeDir, '.agents', 'skills', 'openmeta');
  }

  if (host === 'openclaw') {
    return join(homeDir, '.openclaw', 'skills', 'openmeta');
  }

  return null;
}

export async function installSkillBundle(
  host: SkillHost,
  options: SkillInstallOptions = {},
): Promise<SkillInstallResult> {
  const installPath = resolveDefaultInstallPath(host, options.homeDir);
  if (!installPath) {
    return {
      host,
      installed: false,
      exportedFiles: [],
      manualInstructions: `Unsupported skill host: ${host}`,
    };
  }

  mkdirSync(installPath, { recursive: true });
  const skillPath = join(installPath, getInstalledSkillFileName(host));
  const rendered = renderInstallSkillContent(host);
  writeFileSync(skillPath, rendered, 'utf-8');

  return {
    host,
    installed: existsSync(skillPath),
    installPath,
    exportedFiles: [skillPath],
  };
}

export function getInstallTarget(host: SkillHost): string | null {
  return resolveDefaultInstallPath(host);
}
