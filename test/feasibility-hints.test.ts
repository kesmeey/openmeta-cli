import { describe, expect, test } from 'bun:test';
import { feasibilityHintService } from '../src/services/feasibility-hints.js';
import type { RepositoryProbe } from '../src/services/github.js';
import type { EnvironmentInfo } from '../src/types/index.js';
import { createRankedIssue } from './helpers/factories.js';

function createProbe(overrides: Partial<RepositoryProbe> = {}): RepositoryProbe {
  return {
    repoFullName: 'acme/ml-demo',
    files: {
      packageJson: undefined,
      pyprojectToml: '[project]\ndependencies = ["torch", "transformers"]\n',
      requirementsTxt: 'torch\ntransformers\n',
      cargoToml: undefined,
      goMod: undefined,
      dockerCompose: undefined,
      dockerfile: undefined,
      readme: '# ML Demo\n\nRequires CUDA for training examples.\n',
      workflows: [],
    },
    missingPaths: [],
    ...overrides,
  };
}

function createEnvironment(overrides: Partial<EnvironmentInfo> = {}): EnvironmentInfo {
  return {
    os: {
      platform: 'win32',
      arch: 'x64',
      distro: 'Windows',
      version: '10.0',
      isWSL: true,
      wslDistros: ['Ubuntu'],
      hypervisor: {
        isVM: true,
        type: 'hyper-v',
        isContainer: false,
        isCI: false,
      },
    },
    cpu: { model: 'Test CPU', cores: 8, threads: 16 },
    gpu: [],
    totalRAMGB: 16,
    disks: [{ mountPoint: 'C:', totalGB: 512, freeGB: 128 }],
    tools: [
      { name: 'git', available: true, version: 'git version 2.45.0' },
      { name: 'docker', available: false },
      { name: 'nvidia-smi', available: false },
      { name: 'node', available: true, version: 'v22.0.0' },
    ],
    ...overrides,
  };
}

describe('FeasibilityHintService', () => {
  test('keeps docs issues in GPU-heavy repositories as soft static-friendly risks', () => {
    const hint = feasibilityHintService.assess(
      createRankedIssue({
        repoFullName: 'acme/ml-demo',
        title: 'Clarify CUDA install docs',
        body: 'Update README wording only.',
        labels: ['documentation'],
      }),
      createProbe(),
      createEnvironment(),
    );

    expect(hint.issueScope).toBe('docs_only');
    expect(hint.repoRisks).toContain('gpu_ml');
    expect(hint.missingLocalCapabilities).toContain('cuda_gpu');
    expect(hint.level).toBe('likely_fixable');
    expect(hint.scoreAdjustment).toBe(-5);
    expect(hint.mitigations).toContain('wsl_available');
  });

  test('strongly downgrades CUDA runtime issues when local CUDA is missing or too small', () => {
    const hint = feasibilityHintService.assess(
      createRankedIssue({
        repoFullName: 'acme/ml-demo',
        title: 'Fix CUDA OOM during training benchmark',
        body: 'Training crashes with CUDA out of memory and needs reproduction.',
        labels: ['bug'],
      }),
      createProbe(),
      createEnvironment({
        os: {
          platform: 'win32',
          arch: 'x64',
          distro: 'Windows',
          version: '10.0',
          isWSL: false,
          wslDistros: [],
          hypervisor: {
            isVM: false,
            type: 'none',
            isContainer: false,
            isCI: false,
          },
        },
      }),
    );

    expect(hint.issueScope).toBe('hardware_specific');
    expect(hint.issueRisks).toContain('gpu_ml');
    expect(hint.missingLocalCapabilities).toContain('cuda_gpu');
    expect(hint.level).toBe('likely_blocked');
    expect(hint.scoreAdjustment).toBe(-30);
    expect(feasibilityHintService.isSafeForHeadless({ ...createRankedIssue(), scoutFeasibility: hint })).toBe(false);

    const lowVramHint = feasibilityHintService.assess(
      createRankedIssue({
        repoFullName: 'acme/ml-demo',
        title: 'Fix CUDA OOM during Conv3d training benchmark',
        body: 'Training crashes with CUDA out of memory and needs reproduction.',
        labels: ['bug'],
      }),
      createProbe(),
      createEnvironment({
        gpu: [{ model: 'NVIDIA GTX 1660 Ti', vramMB: 4095, cudaVersion: '12.1' }],
        tools: [
          { name: 'git', available: true },
          { name: 'docker', available: true },
          { name: 'nvidia-smi', available: true },
        ],
      }),
    );

    expect(lowVramHint.missingLocalCapabilities).toContain('high_vram_gpu');
    expect(lowVramHint.level).toBe('likely_blocked');
    expect(feasibilityHintService.isSafeForHeadless({ ...createRankedIssue(), scoutFeasibility: lowVramHint })).toBe(
      false,
    );
  });
});
