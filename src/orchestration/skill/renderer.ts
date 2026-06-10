import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getSkillsRoot, loadCapabilityCatalog, loadCoreSkill, loadHostTemplate, type SkillHost } from './catalog.js';

export interface RenderedSkillBundle {
  host: SkillHost;
  files: string[];
  sourceRoot: string;
}

function renderSkillMarkdown(host: SkillHost): string {
  return loadHostTemplate(host)
    .replace('{{coreSkill}}', loadCoreSkill())
    .replace('{{capabilityCatalog}}', loadCapabilityCatalog());
}

function addClaudeCodeFrontmatter(content: string): string {
  if (content.startsWith('---\n')) {
    return content;
  }

  return `---\nname: openmeta\ndescription: Use when connecting Claude Code to OpenMeta, using openmeta-cli, running OpenMeta machine commands, installing or validating the OpenMeta skill bundle, scouting or analyzing contribution opportunities, or executing an OpenMeta workflow.\n---\n\n${content}`;
}

export function getInstalledSkillFileName(host: SkillHost): string {
  return host === 'claude-code' ? 'SKILL.md' : 'skill.md';
}

export function renderInstallSkillContent(host: SkillHost): string {
  const rendered = renderSkillMarkdown(host);
  return host === 'claude-code' ? addClaudeCodeFrontmatter(rendered) : rendered;
}

export async function renderSkillBundle(host: SkillHost, outputDir: string): Promise<RenderedSkillBundle> {
  const targetDir = join(outputDir, host);
  mkdirSync(targetDir, { recursive: true });

  const rendered = renderInstallSkillContent(host);
  const skillPath = join(targetDir, getInstalledSkillFileName(host));
  writeFileSync(skillPath, rendered, 'utf-8');

  return {
    host,
    files: [skillPath],
    sourceRoot: getSkillsRoot(),
  };
}
