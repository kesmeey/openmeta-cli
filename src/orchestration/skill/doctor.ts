import { existsSync } from 'fs';
import { join } from 'path';
import { type BinaryResolution, inspectBinaryOnPath } from '../../services/index.js';
import type { SkillHost } from './catalog.js';
import { getInstallTarget } from './installer.js';
import { getInstalledSkillFileName } from './renderer.js';

export interface SkillDoctorResult {
  host: SkillHost;
  supported: boolean;
  installPath?: string;
  installPathExists: boolean;
  openmetaOnPath: boolean;
  openmetaBinary: BinaryResolution;
  skillFileExists: boolean;
  nextActions: string[];
}

export async function doctorSkillBundle(host: SkillHost): Promise<SkillDoctorResult> {
  const installPath = getInstallTarget(host);
  const openmetaBinary = inspectBinaryOnPath('openmeta');
  const installPathExists = Boolean(installPath && existsSync(installPath));
  const skillFileExists = Boolean(installPath && existsSync(join(installPath, getInstalledSkillFileName(host))));

  return {
    host,
    supported: Boolean(installPath),
    installPath: installPath || undefined,
    installPathExists,
    openmetaOnPath: openmetaBinary.onPath,
    openmetaBinary,
    skillFileExists,
    nextActions: [
      ...(installPathExists && skillFileExists ? [] : ['run_openmeta_skill_install']),
      ...(openmetaBinary.onPath ? [] : ['ensure_openmeta_on_path']),
    ],
  };
}
