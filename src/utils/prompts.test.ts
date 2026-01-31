import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isInteractive, setInteractiveMode } from './prompts.js';

// Note: We don't test the actual prompt functions as they require interactive input
// Instead we test the utility functions that control interactive mode

describe('prompts', () => {
  describe('isInteractive', () => {
    it('should return a boolean', () => {
      const result = isInteractive();
      expect(typeof result).toBe('boolean');
    });
  });

  describe('setInteractiveMode', () => {
    let originalMode: boolean;

    beforeEach(() => {
      originalMode = isInteractive();
    });

    afterEach(() => {
      setInteractiveMode(originalMode);
    });

    it('should enable interactive mode', () => {
      setInteractiveMode(true);
      expect(isInteractive()).toBe(true);
    });

    it('should disable interactive mode', () => {
      setInteractiveMode(false);
      expect(isInteractive()).toBe(false);
    });
  });
});

// Integration tests would require mocking @inquirer/prompts
// which is complex. These functions are best tested manually
// or through E2E tests with PTY simulation.

describe('prompt function signatures', () => {
  // Verify exports exist without calling them
  it('should export promptOverwrite', async () => {
    const { promptOverwrite } = await import('./prompts.js');
    expect(typeof promptOverwrite).toBe('function');
  });

  it('should export confirmOverwriteAll', async () => {
    const { confirmOverwriteAll } = await import('./prompts.js');
    expect(typeof confirmOverwriteAll).toBe('function');
  });

  it('should export confirmLongAnalysis', async () => {
    const { confirmLongAnalysis } = await import('./prompts.js');
    expect(typeof confirmLongAnalysis).toBe('function');
  });

  it('should export confirmGeneration', async () => {
    const { confirmGeneration } = await import('./prompts.js');
    expect(typeof confirmGeneration).toBe('function');
  });

  it('should export promptApiKey', async () => {
    const { promptApiKey } = await import('./prompts.js');
    expect(typeof promptApiKey).toBe('function');
  });

  it('should export selectProvider', async () => {
    const { selectProvider } = await import('./prompts.js');
    expect(typeof selectProvider).toBe('function');
  });

  it('should export selectSampleCount', async () => {
    const { selectSampleCount } = await import('./prompts.js');
    expect(typeof selectSampleCount).toBe('function');
  });

  it('should export promptContinueAfterError', async () => {
    const { promptContinueAfterError } = await import('./prompts.js');
    expect(typeof promptContinueAfterError).toBe('function');
  });

  it('should export selectDomains', async () => {
    const { selectDomains } = await import('./prompts.js');
    expect(typeof selectDomains).toBe('function');
  });
});
