import type { ContextBudgetResult, ContextSection } from '../types/index.js';

const CHARS_PER_TOKEN_ESTIMATE = 4;

export class ContextBudgetService {
  estimateTokens(content: string): number {
    return Math.ceil(content.length / CHARS_PER_TOKEN_ESTIMATE);
  }

  assemble(sections: ContextSection[], maxEstimatedTokens?: number): ContextBudgetResult {
    const originalContent = sections
      .map((section) => section.content)
      .filter(Boolean)
      .join('\n\n');
    const originalEstimatedTokens = this.estimateTokens(originalContent);

    if (!maxEstimatedTokens || originalEstimatedTokens <= maxEstimatedTokens) {
      return {
        content: originalContent,
        estimatedTokens: originalEstimatedTokens,
        originalEstimatedTokens,
        truncatedSections: [],
      };
    }

    const maxChars = maxEstimatedTokens * CHARS_PER_TOKEN_ESTIMATE;
    const selected = new Map<number, string>();
    const truncatedSections = new Set<string>();
    let usedChars = 0;

    const ranked = sections
      .map((section, index) => ({ section, index }))
      .sort(
        (left, right) =>
          Number(Boolean(right.section.required)) - Number(Boolean(left.section.required)) ||
          right.section.priority - left.section.priority ||
          left.index - right.index,
      );

    for (const { section, index } of ranked) {
      if (!section.content) {
        continue;
      }

      const separatorChars = selected.size > 0 ? 2 : 0;
      const remainingChars = maxChars - usedChars - separatorChars;
      if (remainingChars <= 0) {
        truncatedSections.add(section.id);
        continue;
      }

      if (section.content.length <= remainingChars) {
        selected.set(index, section.content);
        usedChars += separatorChars + section.content.length;
        continue;
      }

      if (section.required || selected.size === 0) {
        const marker = '\n[context truncated]';
        const contentChars = Math.max(0, remainingChars - marker.length);
        selected.set(index, `${section.content.slice(0, contentChars)}${marker}`);
        usedChars += separatorChars + remainingChars;
      }
      truncatedSections.add(section.id);
    }

    const content = [...selected.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, value]) => value)
      .join('\n\n');

    return {
      content,
      estimatedTokens: this.estimateTokens(content),
      originalEstimatedTokens,
      truncatedSections: [...truncatedSections],
    };
  }
}

export const contextBudgetService = new ContextBudgetService();
