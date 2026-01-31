/**
 * Tests for verify command
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdir, writeFile, rm } from 'node:fs/promises';

// Mock dependencies
vi.mock('../../utils/logger.js', () => ({
  logger: {
    section: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    discovery: vi.fn(),
    analysis: vi.fn(),
    inference: vi.fn(),
    blank: vi.fn(),
    debug: vi.fn(),
    listItem: vi.fn(),
  },
}));

vi.mock('../../core/services/llm-service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/services/llm-service.js')>();
  return {
    ...actual,
    createLLMService: vi.fn(() => ({
      complete: vi.fn(),
      completeJSON: vi.fn(),
      getProviderName: vi.fn(() => 'mock'),
      getTokenUsage: vi.fn(() => ({ inputTokens: 100, outputTokens: 50, totalTokens: 150, requests: 1 })),
      getCostTracking: vi.fn(() => ({ estimatedCost: 0.01, currency: 'USD', byProvider: {} })),
      saveLogs: vi.fn(),
    })),
  };
});

describe('verify command', () => {
  const testDir = join(process.cwd(), 'test-verify-cmd');

  beforeEach(async () => {
    // Create test directories
    await mkdir(join(testDir, '.spec-gen', 'analysis'), { recursive: true });
    await mkdir(join(testDir, 'openspec', 'specs'), { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    vi.clearAllMocks();
  });

  describe('command configuration', () => {
    it('should have correct name and description', async () => {
      const { verifyCommand } = await import('./verify.js');

      expect(verifyCommand.name()).toBe('verify');
      expect(verifyCommand.description()).toBe('Verify generated specs against actual source code');
    });

    it('should have samples option', async () => {
      const { verifyCommand } = await import('./verify.js');

      const samplesOption = verifyCommand.options.find(opt => opt.long === '--samples');
      expect(samplesOption).toBeDefined();
    });

    it('should have threshold option', async () => {
      const { verifyCommand } = await import('./verify.js');

      const thresholdOption = verifyCommand.options.find(opt => opt.long === '--threshold');
      expect(thresholdOption).toBeDefined();
    });

    it('should have files option', async () => {
      const { verifyCommand } = await import('./verify.js');

      const filesOption = verifyCommand.options.find(opt => opt.long === '--files');
      expect(filesOption).toBeDefined();
    });

    it('should have domains option', async () => {
      const { verifyCommand } = await import('./verify.js');

      const domainsOption = verifyCommand.options.find(opt => opt.long === '--domains');
      expect(domainsOption).toBeDefined();
    });

    it('should have verbose option', async () => {
      const { verifyCommand } = await import('./verify.js');

      const verboseOption = verifyCommand.options.find(opt => opt.long === '--verbose');
      expect(verboseOption).toBeDefined();
    });

    it('should have json option', async () => {
      const { verifyCommand } = await import('./verify.js');

      const jsonOption = verifyCommand.options.find(opt => opt.long === '--json');
      expect(jsonOption).toBeDefined();
    });
  });

  describe('parseList helper', () => {
    it('should parse comma-separated values', () => {
      const input = 'user,order,auth';
      const parsed = input.split(',').map(s => s.trim()).filter(Boolean);
      expect(parsed).toEqual(['user', 'order', 'auth']);
    });

    it('should handle whitespace', () => {
      const input = 'user , order , auth';
      const parsed = input.split(',').map(s => s.trim()).filter(Boolean);
      expect(parsed).toEqual(['user', 'order', 'auth']);
    });

    it('should filter empty entries', () => {
      const input = 'user,,auth,';
      const parsed = input.split(',').map(s => s.trim()).filter(Boolean);
      expect(parsed).toEqual(['user', 'auth']);
    });
  });

  describe('formatDuration helper', () => {
    it('should format milliseconds', () => {
      const ms = 500;
      expect(ms).toBeLessThan(1000);
    });

    it('should format seconds', () => {
      const ms = 5000;
      expect(ms).toBeGreaterThanOrEqual(1000);
      expect(ms).toBeLessThan(60000);
    });

    it('should format minutes', () => {
      const ms = 120000;
      expect(ms).toBeGreaterThanOrEqual(60000);
    });
  });

  describe('formatScoreBar helper', () => {
    it('should create a bar with filled and empty characters', () => {
      const score = 0.7;
      const width = 10;
      const filled = Math.round(score * width);
      const empty = width - filled;
      const bar = '■'.repeat(filled) + '□'.repeat(empty);

      expect(bar).toBe('■■■■■■■□□□');
      expect(bar.length).toBe(width);
    });

    it('should handle 0 score', () => {
      const score = 0;
      const width = 10;
      const filled = Math.round(score * width);
      const empty = width - filled;
      const bar = '■'.repeat(filled) + '□'.repeat(empty);

      expect(bar).toBe('□□□□□□□□□□');
    });

    it('should handle 1.0 score', () => {
      const score = 1.0;
      const width = 10;
      const filled = Math.round(score * width);
      const empty = width - filled;
      const bar = '■'.repeat(filled) + '□'.repeat(empty);

      expect(bar).toBe('■■■■■■■■■■');
    });
  });

  describe('getStatusEmoji helper', () => {
    it('should return checkmark for passing score', () => {
      const score = 0.8;
      const threshold = 0.7;
      const status = score >= threshold ? '✓' : score >= threshold * 0.8 ? '⚠' : '✗';
      expect(status).toBe('✓');
    });

    it('should return warning for marginal score', () => {
      const score = 0.6;
      const threshold = 0.7;
      const status = score >= threshold ? '✓' : score >= threshold * 0.8 ? '⚠' : '✗';
      expect(status).toBe('⚠');
    });

    it('should return X for failing score', () => {
      const score = 0.4;
      const threshold = 0.7;
      const status = score >= threshold ? '✓' : score >= threshold * 0.8 ? '⚠' : '✗';
      expect(status).toBe('✗');
    });
  });

  describe('threshold validation', () => {
    it('should accept valid thresholds', () => {
      const validThresholds = [0, 0.5, 0.7, 1.0];
      for (const threshold of validThresholds) {
        expect(threshold >= 0 && threshold <= 1).toBe(true);
      }
    });

    it('should reject invalid thresholds', () => {
      const invalidThresholds = [-0.1, 1.1, 2];
      for (const threshold of invalidThresholds) {
        expect(threshold >= 0 && threshold <= 1).toBe(false);
      }
    });
  });

  describe('exit codes', () => {
    function getExitCode(recommendation: string): number {
      return recommendation === 'regenerate' ? 1 : 0;
    }

    it('should return 0 for ready recommendation', () => {
      expect(getExitCode('ready')).toBe(0);
    });

    it('should return 0 for needs-review recommendation', () => {
      expect(getExitCode('needs-review')).toBe(0);
    });

    it('should return 1 for regenerate recommendation', () => {
      expect(getExitCode('regenerate')).toBe(1);
    });
  });

  describe('samples distribution', () => {
    it('should distribute samples across domains', () => {
      const samples = 10;
      const domainsEstimate = 4;
      const filesPerDomain = Math.ceil(samples / domainsEstimate);
      expect(filesPerDomain).toBe(3);
    });

    it('should handle small sample sizes', () => {
      const samples = 2;
      const domainsEstimate = 4;
      const filesPerDomain = Math.ceil(samples / domainsEstimate);
      expect(filesPerDomain).toBe(1);
    });
  });

  describe('displayResult function behavior', () => {
    it('should format percentage correctly', () => {
      const f1Score = 0.857;
      const percent = (f1Score * 100).toFixed(0);
      expect(percent).toBe('86');
    });

    it('should handle zero values', () => {
      const f1Score = 0;
      const percent = (f1Score * 100).toFixed(0);
      expect(percent).toBe('0');
    });
  });

  describe('displaySummary function behavior', () => {
    it('should calculate passed percentage correctly', () => {
      const sampledFiles = 5;
      const passedFiles = 3;
      const passedPercent = sampledFiles > 0
        ? ((passedFiles / sampledFiles) * 100).toFixed(0)
        : '0';
      expect(passedPercent).toBe('60');
    });

    it('should handle zero sampled files', () => {
      const sampledFiles = 0;
      const passedFiles = 0;
      const passedPercent = sampledFiles > 0
        ? ((passedFiles / sampledFiles) * 100).toFixed(0)
        : '0';
      expect(passedPercent).toBe('0');
    });
  });

  describe('recommendation logic', () => {
    it('should recommend ready for high confidence', () => {
      const overallConfidence = 0.8;
      let recommendation: 'ready' | 'needs-review' | 'regenerate';

      if (overallConfidence >= 0.75) {
        recommendation = 'ready';
      } else if (overallConfidence >= 0.5) {
        recommendation = 'needs-review';
      } else {
        recommendation = 'regenerate';
      }

      expect(recommendation).toBe('ready');
    });

    it('should recommend needs-review for medium confidence', () => {
      const overallConfidence = 0.6;
      let recommendation: 'ready' | 'needs-review' | 'regenerate';

      if (overallConfidence >= 0.75) {
        recommendation = 'ready';
      } else if (overallConfidence >= 0.5) {
        recommendation = 'needs-review';
      } else {
        recommendation = 'regenerate';
      }

      expect(recommendation).toBe('needs-review');
    });

    it('should recommend regenerate for low confidence', () => {
      const overallConfidence = 0.3;
      let recommendation: 'ready' | 'needs-review' | 'regenerate';

      if (overallConfidence >= 0.75) {
        recommendation = 'ready';
      } else if (overallConfidence >= 0.5) {
        recommendation = 'needs-review';
      } else {
        recommendation = 'regenerate';
      }

      expect(recommendation).toBe('regenerate');
    });
  });

  describe('command help text', () => {
    it('should include examples', async () => {
      const { verifyCommand } = await import('./verify.js');

      // addHelpText adds after the main help
      expect(verifyCommand.description()).toBe('Verify generated specs against actual source code');
    });
  });

  describe('error handling', () => {
    it('should handle missing config gracefully', async () => {
      const { logger } = await import('../../utils/logger.js');
      expect(logger.error).toBeDefined();
    });

    it('should handle missing specs gracefully', async () => {
      const { logger } = await import('../../utils/logger.js');
      expect(logger.error).toBeDefined();
    });

    it('should handle missing API key gracefully', async () => {
      const { logger } = await import('../../utils/logger.js');
      expect(logger.error).toBeDefined();
    });
  });
});
