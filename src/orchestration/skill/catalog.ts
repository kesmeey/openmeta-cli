import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

function resolveSkillsRoot(): string {
  const modulePath = fileURLToPath(import.meta.url);
  const moduleDir = dirname(modulePath);
  const candidates = [
    join(moduleDir, '..', '..', '..', 'skills'),
    join(moduleDir, '..', '..', '..', '..', 'skills'),
    join(process.cwd(), 'skills'),
  ];

  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'core', 'openmeta.md'))) {
      return candidate;
    }
  }

  return candidates[0]!;
}

const SKILLS_ROOT = resolveSkillsRoot();

export type SkillHost = 'claude-code' | 'codex' | 'openclaw';

export function getSkillsRoot(): string {
  return SKILLS_ROOT;
}

export function getSupportedSkillHosts(): SkillHost[] {
  return ['claude-code', 'codex', 'openclaw'];
}

export function loadCoreSkill(): string {
  return readFileSync(join(SKILLS_ROOT, 'core', 'openmeta.md'), 'utf-8');
}

export function loadCapabilityCatalog(): string {
  return readFileSync(join(SKILLS_ROOT, 'schema', 'capability-catalog.json'), 'utf-8');
}

export function loadHostTemplate(host: SkillHost): string {
  return readFileSync(join(SKILLS_ROOT, 'templates', host, 'skill.md'), 'utf-8');
}
