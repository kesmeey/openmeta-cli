import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import packageJson from '../package.json';
import { getSupportedSkillHosts, installSkillBundle, renderSkillBundle } from '../src/orchestration/skill/index.js';

let tempRoot = '';

describe('skill bundle rendering', () => {
  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'openmeta-skill-bundle-'));
  });

  afterEach(() => {
    if (tempRoot) {
      rmSync(tempRoot, { recursive: true, force: true });
      tempRoot = '';
    }
  });

  test('renders claude-code and openclaw bundles from one canonical spec', async () => {
    expect(getSupportedSkillHosts()).toEqual(['claude-code', 'openclaw']);

    const claude = await renderSkillBundle('claude-code', tempRoot);
    const openclaw = await renderSkillBundle('openclaw', tempRoot);

    const claudeSkill = readFileSync(claude.files[0]!, 'utf-8');
    const openclawSkill = readFileSync(openclaw.files[0]!, 'utf-8');

    expect(claude.files[0]).toBe(join(tempRoot, 'claude-code', 'SKILL.md'));
    expect(claudeSkill).toStartWith('---\nname: openmeta\n');
    expect(claudeSkill).toContain('Install target: `~/.claude/skills/openmeta`');
    expect(claudeSkill).toContain('Keep the generated file at `SKILL.md`');
    expect(claudeSkill).toContain('## What OpenMeta Can Do');
    expect(claudeSkill).toContain('Discover and rank worthwhile issues');
    expect(claudeSkill).toContain('## Config Keys For `machine config set`');
    expect(claudeSkill).toContain('`executionOutcome`');
    expect(claudeSkill).toContain('"errorCodes"');
    expect(claudeSkill).toContain('openmeta machine agent');

    expect(openclaw.files[0]).toBe(join(tempRoot, 'openclaw', 'skill.md'));
    expect(openclawSkill).toContain('Install target: `~/.openclaw/skills/openmeta`');
    expect(openclawSkill).toContain('## Recovery Playbook');
    expect(openclawSkill).toContain('`reviewRequired`');
    expect(openclawSkill).toContain('"openmeta machine pow"');
    expect(openclawSkill).toContain('openmeta machine doctor');
  });

  test('export works from the packed CLI with runtime-resolved skill assets', () => {
    const packedRoot = mkdtempSync(join(tmpdir(), 'openmeta-pack-runtime-'));
    const exportRoot = join(packedRoot, 'exported');

    execFileSync('bun', ['run', 'build'], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'inherit'],
      encoding: 'utf-8',
    });
    const packed = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', packedRoot], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'inherit'],
      encoding: 'utf-8',
    })) as Array<{ filename: string }>;
    execFileSync('tar', ['-xzf', join(packedRoot, packed[0]!.filename), '-C', packedRoot]);
    execFileSync('bun', [
      join(packedRoot, 'package', 'bin', 'openmeta.js'),
      'skill',
      'export',
      '--host',
      'claude-code',
      '--output',
      exportRoot,
    ], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'inherit'],
      encoding: 'utf-8',
    });

    expect(existsSync(join(exportRoot, 'claude-code', 'SKILL.md'))).toBe(true);
    const exportedSkill = readFileSync(join(exportRoot, 'claude-code', 'SKILL.md'), 'utf-8');
    expect(exportedSkill).toStartWith('---\nname: openmeta\n');
    expect(exportedSkill).toContain('Install target: `~/.claude/skills/openmeta`');
    expect(exportedSkill).toContain('## What OpenMeta Can Do');
    expect(exportedSkill).toContain('## Result Interpretation');
    expect(exportedSkill).toContain('"inspectFields"');
    expect(exportedSkill).toContain('openmeta machine doctor');
  });

  test('installs claude-code bundle at the Claude Code skill discovery entrypoint', async () => {
    const homeRoot = join(tempRoot, 'home');

    const result = await installSkillBundle('claude-code', { homeDir: homeRoot });
    const skillPath = join(homeRoot, '.claude', 'skills', 'openmeta', 'SKILL.md');
    const legacyNestedPath = join(homeRoot, '.claude', 'skills', 'openmeta', 'claude-code', 'skill.md');

    expect(result.installed).toBe(true);
    expect(result.installPath).toBe(join(homeRoot, '.claude', 'skills', 'openmeta'));
    expect(result.exportedFiles).toEqual([skillPath]);
    expect(existsSync(skillPath)).toBe(true);
    expect(existsSync(legacyNestedPath)).toBe(false);

    const installedSkill = readFileSync(skillPath, 'utf-8');
    expect(installedSkill).toStartWith('---\nname: openmeta\n');
    expect(installedSkill).toContain('description: Use when');
    expect(installedSkill).toContain('## What OpenMeta Can Do');
    expect(installedSkill).toContain('openmeta machine doctor');
  });
});

describe('package files', () => {
  test('publishes skill assets with the CLI binary', () => {
    expect(packageJson.files).toContain('bin/openmeta.js');
    expect(packageJson.files).toContain('skills');
  });
});
