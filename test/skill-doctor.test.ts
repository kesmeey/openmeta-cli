import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { doctorSkillBundle } from '../src/orchestration/skill/doctor.js';
import * as runtimeDiagnosticsModule from '../src/services/runtime-diagnostics.js';

describe('doctorSkillBundle', () => {
  afterEach(() => {
    mock.restore();
  });

  test('reports the resolved openmeta binary details when PATH wiring is healthy', async () => {
    spyOn(runtimeDiagnosticsModule, 'inspectBinaryOnPath').mockReturnValue({
      onPath: true,
      command: 'openmeta',
      version: '1.2.3',
      invokedPath: '/Users/demo/.bun/bin/openmeta',
      resolvedPath: '/Users/demo/work/openmeta-cli/bin/openmeta.js',
      symlinkTarget: '../install/global/node_modules/openmeta-cli/bin/openmeta.js',
      source: 'bun-link',
    });

    const result = await doctorSkillBundle('claude-code');

    expect(result.openmetaOnPath).toBe(true);
    expect(result.openmetaBinary).toEqual(
      expect.objectContaining({
        source: 'bun-link',
        invokedPath: '/Users/demo/.bun/bin/openmeta',
        resolvedPath: '/Users/demo/work/openmeta-cli/bin/openmeta.js',
        version: '1.2.3',
      }),
    );
    expect(result.nextActions).not.toContain('ensure_openmeta_on_path');
  });

  test('keeps the missing PATH remediation when openmeta cannot be resolved', async () => {
    spyOn(runtimeDiagnosticsModule, 'inspectBinaryOnPath').mockReturnValue({
      onPath: false,
      command: 'openmeta',
      source: 'missing',
      error: 'openmeta is not available on PATH.',
    });

    const result = await doctorSkillBundle('claude-code');

    expect(result.openmetaOnPath).toBe(false);
    expect(result.openmetaBinary.source).toBe('missing');
    expect(result.nextActions).toContain('ensure_openmeta_on_path');
  });
});
