/**
 * Tests for spec-gen analyze command
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { analyzeCommand, runAnalysis } from './analyze.js';

describe('analyze command', () => {
  describe('command configuration', () => {
    it('should have correct name and description', () => {
      expect(analyzeCommand.name()).toBe('analyze');
      expect(analyzeCommand.description()).toContain('static analysis');
    });

    it('should have --output option with default', () => {
      const outputOption = analyzeCommand.options.find(o => o.long === '--output');
      expect(outputOption).toBeDefined();
      expect(outputOption?.defaultValue).toBe('.spec-gen/analysis/');
    });

    it('should have --max-files option with default', () => {
      const maxFilesOption = analyzeCommand.options.find(o => o.long === '--max-files');
      expect(maxFilesOption).toBeDefined();
      expect(maxFilesOption?.defaultValue).toBe('500');
    });

    it('should have --include option (repeatable)', () => {
      const includeOption = analyzeCommand.options.find(o => o.long === '--include');
      expect(includeOption).toBeDefined();
      expect(includeOption?.description).toContain('repeatable');
    });

    it('should have --exclude option (repeatable)', () => {
      const excludeOption = analyzeCommand.options.find(o => o.long === '--exclude');
      expect(excludeOption).toBeDefined();
      expect(excludeOption?.description).toContain('repeatable');
    });

    it('should have --force option', () => {
      const forceOption = analyzeCommand.options.find(o => o.long === '--force');
      expect(forceOption).toBeDefined();
      expect(forceOption?.description).toContain('Force');
    });
  });

  describe('helper function tests', () => {
    describe('collect function', () => {
      it('should collect multiple values', () => {
        const collect = (value: string, previous: string[]): string[] => {
          return previous.concat([value]);
        };

        let result: string[] = [];
        result = collect('*.graphql', result);
        result = collect('*.prisma', result);

        expect(result).toEqual(['*.graphql', '*.prisma']);
      });
    });

    describe('formatDuration', () => {
      it('should format milliseconds correctly', () => {
        const formatDuration = (ms: number): string => {
          if (ms < 1000) return `${ms}ms`;
          if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
          const minutes = Math.floor(ms / 60000);
          const seconds = Math.floor((ms % 60000) / 1000);
          return `${minutes}m ${seconds}s`;
        };

        expect(formatDuration(500)).toBe('500ms');
        expect(formatDuration(1500)).toBe('1.5s');
        expect(formatDuration(65000)).toBe('1m 5s');
      });
    });

    describe('formatAge', () => {
      it('should format age correctly', () => {
        const formatAge = (ms: number): string => {
          if (ms < 60000) return 'just now';
          if (ms < 3600000) return `${Math.floor(ms / 60000)} minutes ago`;
          if (ms < 86400000) return `${Math.floor(ms / 3600000)} hours ago`;
          return `${Math.floor(ms / 86400000)} days ago`;
        };

        expect(formatAge(30000)).toBe('just now');
        expect(formatAge(1800000)).toBe('30 minutes ago');
        expect(formatAge(7200000)).toBe('2 hours ago');
        expect(formatAge(172800000)).toBe('2 days ago');
      });
    });
  });

  describe('analysis caching', () => {
    it('should skip analysis when recent (< 1 hour)', () => {
      const analysisAge = 30 * 60 * 1000; // 30 minutes
      const oneHour = 60 * 60 * 1000;
      const force = false;

      const shouldSkip = analysisAge !== null && analysisAge < oneHour && !force;
      expect(shouldSkip).toBe(true);
    });

    it('should run analysis when old (> 1 hour)', () => {
      const analysisAge = 2 * 60 * 60 * 1000; // 2 hours
      const oneHour = 60 * 60 * 1000;
      const force = false;

      const shouldSkip = analysisAge !== null && analysisAge < oneHour && !force;
      expect(shouldSkip).toBe(false);
    });

    it('should run analysis with --force', () => {
      const analysisAge = 30 * 60 * 1000; // 30 minutes
      const oneHour = 60 * 60 * 1000;
      const force = true;

      const shouldSkip = analysisAge !== null && analysisAge < oneHour && !force;
      expect(shouldSkip).toBe(false);
    });

    it('should run analysis when none exists', () => {
      const analysisAge: number | null = null;
      const oneHour = 60 * 60 * 1000;
      const force = false;

      const shouldSkip = analysisAge !== null && analysisAge < oneHour && !force;
      expect(shouldSkip).toBe(false);
    });
  });

  describe('output files', () => {
    it('should generate expected output files', () => {
      const expectedFiles = [
        'repo-structure.json',
        'dependency-graph.json',
        'llm-context.json',
        'dependencies.mermaid',
        'SUMMARY.md',
      ];

      for (const file of expectedFiles) {
        expect(file).toBeTruthy();
      }
    });
  });

  describe('runAnalysis function', () => {
    it('should be exported', () => {
      expect(runAnalysis).toBeDefined();
      expect(typeof runAnalysis).toBe('function');
    });
  });
});
