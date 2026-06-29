import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

const dashboardHtml = readFileSync(join(process.cwd(), 'dashboard', 'index.html'), 'utf-8');

describe('dashboard template security', () => {
  test('uses shared escaping and URL sanitization helpers for dynamic rendering', () => {
    expect(dashboardHtml).toContain('function escapeHtml(value)');
    expect(dashboardHtml).toContain('function sanitizeUrl(value)');
    expect(dashboardHtml).toContain('const safeUrl = sanitizeUrl(url);');
    expect(dashboardHtml).toContain('${escapeHtml(item.title)}');
    expect(dashboardHtml).toContain('${escapeHtml(item.description)}');
  });

  test('does not interpolate raw dynamic URLs or labels into anchor attributes', () => {
    expect(dashboardHtml).not.toContain('href="${url}"');
    expect(dashboardHtml).not.toContain('aria-label="${label}"');
    expect(dashboardHtml).not.toContain('title="${label}"');
    expect(dashboardHtml).toContain('href="${escapeAttribute(safeUrl)}"');
    expect(dashboardHtml).toContain('aria-label="${safeAttributeLabel}"');
    expect(dashboardHtml).toContain('title="${safeAttributeLabel}"');
  });
});
