import { describe, expect, test } from 'bun:test';
import { contextBudgetService } from '../src/services/context-budget.js';

describe('ContextBudgetService', () => {
  test('preserves section order when content fits the budget', () => {
    const result = contextBudgetService.assemble(
      [
        { id: 'first', content: 'first section', priority: 10 },
        { id: 'second', content: 'second section', priority: 100 },
      ],
      100,
    );

    expect(result.content).toBe('first section\n\nsecond section');
    expect(result.truncatedSections).toEqual([]);
  });

  test('drops lower-priority optional sections when the budget is exceeded', () => {
    const result = contextBudgetService.assemble(
      [
        { id: 'required', content: 'R'.repeat(20), priority: 100, required: true },
        { id: 'important', content: 'I'.repeat(20), priority: 90 },
        { id: 'optional', content: 'O'.repeat(100), priority: 10 },
      ],
      15,
    );

    expect(result.content).toContain('R'.repeat(20));
    expect(result.content).toContain('I'.repeat(20));
    expect(result.content).not.toContain('O'.repeat(20));
    expect(result.truncatedSections).toContain('optional');
    expect(result.estimatedTokens).toBeLessThanOrEqual(15);
  });
});
