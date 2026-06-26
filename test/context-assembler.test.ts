import { describe, expect, test } from 'bun:test';
import { contextAssemblerService } from '../src/services/context-assembler.js';
import { createMemory, createWorkspace } from './helpers/factories.js';

describe('ContextAssemblerService', () => {
  test('builds layered repository and memory context from workspace state', () => {
    const workspace = createWorkspace({
      workspacePath: '/tmp/repo',
      topLevelFiles: ['package.json', 'src'],
      candidateFiles: ['src/index.ts'],
      validationWarnings: ['Skipped unsafe command'],
      snippets: [{ path: 'src/index.ts', content: 'export const ready = true;\n' }],
      testResults: [{ command: 'bun test', exitCode: 0, passed: true, output: 'ok' }],
    });
    const memory = createMemory({
      generatedDossiers: 2,
      preferredPaths: ['src/index.ts'],
    });

    const repoContext = contextAssemblerService.buildRepositoryContext(workspace, {
      repoFullName: 'owner/repo',
      includeTopLevelFiles: true,
      includeBaselineResults: true,
    });
    const memoryContext = contextAssemblerService.buildRepoMemoryContext(memory);

    expect(repoContext).toContain('Repository: owner/repo');
    expect(repoContext).toContain('Top-Level Files: package.json, src');
    expect(repoContext).toContain('FILE: src/index.ts');
    expect(repoContext).toContain('Baseline Results: bun test => passed');
    expect(memoryContext).toContain('Generated Dossiers: 2');
    expect(memoryContext).toContain('Preferred Paths: src/index.ts');
  });

  test('uses a caller-specific fallback for empty editable file context', () => {
    expect(contextAssemblerService.buildEditableFilesContext([], 'No current files were provided.')).toBe(
      'No current files were provided.',
    );
  });
});
