/**
 * Tests for Spec Verification Engine
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import {
  SpecVerificationEngine,
  verifySpecs,
  type VerificationCandidate,
  type VerificationReport,
} from './verification-engine.js';
import { MockLLMProvider, LLMService } from '../services/llm-service.js';
import type { DependencyGraphResult, DependencyNode } from '../analyzer/dependency-graph.js';
import type { ScoredFile } from '../../types/index.js';

// Mock logger
vi.mock('../../utils/logger.js', () => ({
  default: {
    discovery: vi.fn(),
    analysis: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    blank: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('SpecVerificationEngine', () => {
  const testDir = join(process.cwd(), 'test-verify-engine');
  const openspecDir = join(testDir, 'openspec');
  const specsDir = join(openspecDir, 'specs');
  const outputDir = join(testDir, '.spec-gen', 'verification');
  const srcDir = join(testDir, 'src');

  let mockProvider: MockLLMProvider;
  let llmService: LLMService;

  beforeEach(async () => {
    // Create test directories
    await mkdir(specsDir, { recursive: true });
    await mkdir(outputDir, { recursive: true });
    await mkdir(srcDir, { recursive: true });

    // Create mock provider
    mockProvider = new MockLLMProvider();
    llmService = new LLMService(mockProvider);

    // Create a sample spec
    await mkdir(join(specsDir, 'user'), { recursive: true });
    await writeFile(join(specsDir, 'user', 'spec.md'), `# User Domain

## Purpose

Handles user management operations including authentication and profile management.

## Requirements

### UserAuthentication

The system SHALL authenticate users with email and password.

#### Scenario: SuccessfulLogin

- **Given** a registered user
- **When** they provide valid credentials
- **Then** they receive an authentication token

### UserProfile

The system SHOULD allow users to update their profile.
`);

    // Create a sample source file
    await writeFile(join(srcDir, 'user-service.ts'), `/**
 * User Service
 *
 * Handles user authentication and profile management.
 */

import { database } from './database.js';
import { hashPassword } from './utils/crypto.js';

export interface User {
  id: string;
  email: string;
  name: string;
}

export class UserService {
  async authenticate(email: string, password: string): Promise<User | null> {
    const hashedPassword = hashPassword(password);
    return database.findUser(email, hashedPassword);
  }

  async updateProfile(userId: string, data: Partial<User>): Promise<User> {
    return database.updateUser(userId, data);
  }
}

export function createUserService(): UserService {
  return new UserService();
}
`);
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    vi.clearAllMocks();
  });

  // Helper to create mock dependency graph
  function createMockDepGraph(files: Array<{ path: string; lines: number }>): DependencyGraphResult {
    const nodes: DependencyNode[] = files.map((f, i) => ({
      id: f.path,
      file: {
        path: f.path,
        absolutePath: join(testDir, f.path),
        name: f.path.split('/').pop()!,
        extension: '.ts',
        size: f.lines * 50,
        lines: f.lines,
        depth: 1,
        directory: 'src',
        isEntryPoint: false,
        isConfig: false,
        isTest: false,
        isGenerated: false,
        score: 5,
        scoreBreakdown: { name: 1, path: 1, structure: 1, connectivity: 2 },
        tags: [],
      } as ScoredFile,
      exports: [{ name: 'default', isDefault: true, isType: false, isReExport: false, kind: 'class' as const, line: 1 }],
      metrics: {
        inDegree: 1,
        outDegree: 2,
        betweenness: 0.1,
        pageRank: 0.5,
      },
    }));

    return {
      nodes,
      edges: [],
      clusters: [],
      rankings: {
        byImportance: files.map(f => f.path),
        byConnectivity: files.map(f => f.path),
        clusterCenters: [],
        leafNodes: files.map(f => f.path),
        bridgeNodes: [],
        orphanNodes: [],
      },
      cycles: [],
      statistics: {
        nodeCount: files.length,
        edgeCount: 0,
        avgDegree: 1,
        density: 0.1,
        clusterCount: 1,
        cycleCount: 0,
      },
    };
  }

  describe('constructor', () => {
    it('should create engine with default options', () => {
      const engine = new SpecVerificationEngine(llmService, {
        rootPath: testDir,
        openspecPath: openspecDir,
        outputDir,
      });

      expect(engine).toBeDefined();
    });

    it('should accept custom options', () => {
      const engine = new SpecVerificationEngine(llmService, {
        rootPath: testDir,
        openspecPath: openspecDir,
        outputDir,
        minComplexity: 30,
        maxComplexity: 200,
        filesPerDomain: 5,
        passThreshold: 0.7,
      });

      expect(engine).toBeDefined();
    });
  });

  describe('selectCandidates', () => {
    it('should select files within complexity range', () => {
      const engine = new SpecVerificationEngine(llmService, {
        rootPath: testDir,
        openspecPath: openspecDir,
        outputDir,
        minComplexity: 50,
        maxComplexity: 200,
      });

      const depGraph = createMockDepGraph([
        { path: 'src/small.ts', lines: 20 },  // Too small
        { path: 'src/medium.ts', lines: 100 }, // Good
        { path: 'src/large.ts', lines: 500 },  // Too large
        { path: 'src/good.ts', lines: 150 },   // Good
      ]);

      const candidates = engine.selectCandidates(depGraph);

      // Should only include medium and good files
      expect(candidates.length).toBe(2);
      expect(candidates.map(c => c.path)).toContain('src/medium.ts');
      expect(candidates.map(c => c.path)).toContain('src/good.ts');
    });

    it('should exclude files used in generation', () => {
      const engine = new SpecVerificationEngine(llmService, {
        rootPath: testDir,
        openspecPath: openspecDir,
        outputDir,
        minComplexity: 50,
        maxComplexity: 200,
        generationContext: ['src/used.ts'],
      });

      const depGraph = createMockDepGraph([
        { path: 'src/used.ts', lines: 100 },
        { path: 'src/unused.ts', lines: 100 },
      ]);

      const candidates = engine.selectCandidates(depGraph);

      expect(candidates.length).toBe(1);
      expect(candidates[0].path).toBe('src/unused.ts');
    });

    it('should exclude test files', () => {
      const engine = new SpecVerificationEngine(llmService, {
        rootPath: testDir,
        openspecPath: openspecDir,
        outputDir,
        minComplexity: 50,
        maxComplexity: 200,
      });

      const depGraph = createMockDepGraph([
        { path: 'src/service.ts', lines: 100 },
      ]);

      // Mark one file as test
      depGraph.nodes[0].file.isTest = true;

      const candidates = engine.selectCandidates(depGraph);

      expect(candidates.length).toBe(0);
    });

    it('should limit files per domain', () => {
      const engine = new SpecVerificationEngine(llmService, {
        rootPath: testDir,
        openspecPath: openspecDir,
        outputDir,
        minComplexity: 50,
        maxComplexity: 200,
        filesPerDomain: 2,
      });

      const depGraph = createMockDepGraph([
        { path: 'src/services/a.ts', lines: 100 },
        { path: 'src/services/b.ts', lines: 100 },
        { path: 'src/services/c.ts', lines: 100 },
        { path: 'src/services/d.ts', lines: 100 },
      ]);

      const candidates = engine.selectCandidates(depGraph);

      // Should be limited to 2 per domain
      expect(candidates.length).toBeLessThanOrEqual(2);
    });
  });

  describe('verifyFile', () => {
    it('should verify a file and return result', async () => {
      // Set up mock LLM response
      mockProvider.setDefaultResponse(JSON.stringify({
        predictedPurpose: 'Handles user authentication and profile management',
        predictedImports: ['database', 'crypto'],
        predictedExports: ['UserService', 'User', 'createUserService'],
        predictedLogic: ['authenticate with email/password', 'update profile'],
        relatedRequirements: ['UserAuthentication', 'UserProfile'],
        confidence: 0.8,
        reasoning: 'The user spec clearly describes these operations',
      }));

      const engine = new SpecVerificationEngine(llmService, {
        rootPath: testDir,
        openspecPath: openspecDir,
        outputDir,
      });

      // Load specs first
      await (engine as any).loadSpecs();

      const candidate: VerificationCandidate = {
        path: 'src/user-service.ts',
        absolutePath: join(srcDir, 'user-service.ts'),
        domain: 'user',
        usedInGeneration: false,
        complexity: 100,
        lines: 30,
        imports: 2,
        exports: 3,
      };

      const result = await (engine as any).verifyFile(candidate);

      expect(result).toBeDefined();
      expect(result.filePath).toBe('src/user-service.ts');
      expect(result.domain).toBe('user');
      expect(result.overallScore).toBeGreaterThanOrEqual(0);
      expect(result.overallScore).toBeLessThanOrEqual(1);
      expect(result.llmConfidence).toBe(0.8);
    });
  });

  describe('comparePurpose', () => {
    it('should calculate similarity between purposes', () => {
      const engine = new SpecVerificationEngine(llmService, {
        rootPath: testDir,
        openspecPath: openspecDir,
        outputDir,
      });

      const result = (engine as any).comparePurpose(
        'Handles user authentication',
        '// Handles authentication for users\nfunction login() {}'
      );

      expect(result.predicted).toBe('Handles user authentication');
      expect(result.actual).toContain('authentication');
      expect(result.similarity).toBeGreaterThan(0);
    });
  });

  describe('extractPurpose', () => {
    it('should extract purpose from JSDoc comments', () => {
      const engine = new SpecVerificationEngine(llmService, {
        rootPath: testDir,
        openspecPath: openspecDir,
        outputDir,
      });

      const content = `/**
 * User Service
 *
 * Handles user authentication and profile management.
 */
export class UserService {}`;

      const purpose = (engine as any).extractPurpose(content);

      expect(purpose).toContain('User Service');
      expect(purpose).toContain('authentication');
    });

    it('should extract purpose from single-line comments', () => {
      const engine = new SpecVerificationEngine(llmService, {
        rootPath: testDir,
        openspecPath: openspecDir,
        outputDir,
      });

      const content = `// This handles user login
// and session management
export function login() {}`;

      const purpose = (engine as any).extractPurpose(content);

      expect(purpose).toContain('user login');
    });
  });

  describe('calculateSetMatch', () => {
    it('should calculate precision, recall, and F1', () => {
      const engine = new SpecVerificationEngine(llmService, {
        rootPath: testDir,
        openspecPath: openspecDir,
        outputDir,
      });

      // Perfect match
      const perfectMatch = (engine as any).calculateSetMatch(
        ['a', 'b', 'c'],
        ['a', 'b', 'c']
      );
      expect(perfectMatch.precision).toBe(1);
      expect(perfectMatch.recall).toBe(1);
      expect(perfectMatch.f1Score).toBe(1);

      // Partial match
      const partialMatch = (engine as any).calculateSetMatch(
        ['a', 'b', 'd'],  // 2 correct, 1 wrong
        ['a', 'b', 'c']   // 2 found, 1 missing
      );
      expect(partialMatch.precision).toBeCloseTo(2/3, 2);
      expect(partialMatch.recall).toBeCloseTo(2/3, 2);
      expect(partialMatch.f1Score).toBeCloseTo(2/3, 2);

      // No match
      const noMatch = (engine as any).calculateSetMatch(
        ['x', 'y'],
        ['a', 'b']
      );
      expect(noMatch.precision).toBe(0);
      expect(noMatch.recall).toBe(0);
      expect(noMatch.f1Score).toBe(0);
    });

    it('should handle empty arrays', () => {
      const engine = new SpecVerificationEngine(llmService, {
        rootPath: testDir,
        openspecPath: openspecDir,
        outputDir,
      });

      const emptyPredicted = (engine as any).calculateSetMatch([], ['a', 'b']);
      expect(emptyPredicted.precision).toBe(0);
      expect(emptyPredicted.recall).toBe(0);

      const emptyActual = (engine as any).calculateSetMatch(['a', 'b'], []);
      expect(emptyActual.precision).toBe(0);
      expect(emptyActual.recall).toBe(0);
    });
  });

  describe('calculateOverallScore', () => {
    it('should weight scores correctly', () => {
      const engine = new SpecVerificationEngine(llmService, {
        rootPath: testDir,
        openspecPath: openspecDir,
        outputDir,
      });

      const score = (engine as any).calculateOverallScore(
        { similarity: 1.0 },           // 25%
        { f1Score: 1.0 },              // 30%
        { f1Score: 1.0 },              // 30%
        { coverage: 1.0 }              // 15%
      );

      expect(score).toBe(1.0);

      const zeroScore = (engine as any).calculateOverallScore(
        { similarity: 0 },
        { f1Score: 0 },
        { f1Score: 0 },
        { coverage: 0 }
      );

      expect(zeroScore).toBe(0);
    });
  });

  describe('generateReport', () => {
    it('should generate correct recommendation based on confidence', () => {
      const engine = new SpecVerificationEngine(llmService, {
        rootPath: testDir,
        openspecPath: openspecDir,
        outputDir,
        passThreshold: 0.6,
      });

      // High confidence results
      const highConfResults = [
        { overallScore: 0.8, domain: 'user', filePath: 'a.ts', purposeMatch: { similarity: 0.8 }, importMatch: { f1Score: 0.8 }, exportMatch: { f1Score: 0.8 }, requirementCoverage: { coverage: 0.8, relatedRequirements: [], actuallyImplements: [] }, llmConfidence: 0.8, feedback: [] },
        { overallScore: 0.85, domain: 'user', filePath: 'b.ts', purposeMatch: { similarity: 0.85 }, importMatch: { f1Score: 0.85 }, exportMatch: { f1Score: 0.85 }, requirementCoverage: { coverage: 0.85, relatedRequirements: [], actuallyImplements: [] }, llmConfidence: 0.85, feedback: [] },
      ];

      const highReport = (engine as any).generateReport(highConfResults, '1.0.0');
      expect(highReport.recommendation).toBe('ready');

      // Medium confidence results
      const medConfResults = [
        { overallScore: 0.6, domain: 'user', filePath: 'a.ts', purposeMatch: { similarity: 0.6 }, importMatch: { f1Score: 0.6 }, exportMatch: { f1Score: 0.6 }, requirementCoverage: { coverage: 0.6, relatedRequirements: [], actuallyImplements: [] }, llmConfidence: 0.6, feedback: [] },
      ];

      const medReport = (engine as any).generateReport(medConfResults, '1.0.0');
      expect(medReport.recommendation).toBe('needs-review');

      // Low confidence results
      const lowConfResults = [
        { overallScore: 0.3, domain: 'user', filePath: 'a.ts', purposeMatch: { similarity: 0.3 }, importMatch: { f1Score: 0.3 }, exportMatch: { f1Score: 0.3 }, requirementCoverage: { coverage: 0.3, relatedRequirements: [], actuallyImplements: [] }, llmConfidence: 0.3, feedback: [] },
      ];

      const lowReport = (engine as any).generateReport(lowConfResults, '1.0.0');
      expect(lowReport.recommendation).toBe('regenerate');
    });

    it('should calculate domain breakdown correctly', () => {
      const engine = new SpecVerificationEngine(llmService, {
        rootPath: testDir,
        openspecPath: openspecDir,
        outputDir,
      });

      const results = [
        { overallScore: 0.8, domain: 'user', filePath: 'user/a.ts', purposeMatch: { similarity: 0.9 }, importMatch: { f1Score: 0.7 }, exportMatch: { f1Score: 0.8 }, requirementCoverage: { coverage: 0.6, relatedRequirements: [], actuallyImplements: [] }, llmConfidence: 0.8, feedback: [] },
        { overallScore: 0.6, domain: 'order', filePath: 'order/b.ts', purposeMatch: { similarity: 0.5 }, importMatch: { f1Score: 0.7 }, exportMatch: { f1Score: 0.6 }, requirementCoverage: { coverage: 0.4, relatedRequirements: [], actuallyImplements: [] }, llmConfidence: 0.6, feedback: [] },
      ];

      const report = (engine as any).generateReport(results, '1.0.0');

      expect(report.domainBreakdown.length).toBe(2);
      expect(report.domainBreakdown.find((d: any) => d.domain === 'user')).toBeDefined();
      expect(report.domainBreakdown.find((d: any) => d.domain === 'order')).toBeDefined();
    });
  });

  describe('generateMarkdownReport', () => {
    it('should generate valid markdown', () => {
      const engine = new SpecVerificationEngine(llmService, {
        rootPath: testDir,
        openspecPath: openspecDir,
        outputDir,
      });

      const report: VerificationReport = {
        timestamp: '2024-01-01T00:00:00.000Z',
        specVersion: '1.0.0',
        sampledFiles: 2,
        passedFiles: 1,
        overallConfidence: 0.65,
        domainBreakdown: [
          { domain: 'user', specPath: 'openspec/specs/user/spec.md', filesVerified: 2, averageScore: 0.65, weakestArea: 'exports' },
        ],
        commonGaps: ['Missing dependencies'],
        recommendation: 'needs-review',
        suggestedImprovements: [
          { domain: 'user', issue: 'Low score', suggestion: 'Add more details' },
        ],
        results: [
          {
            filePath: 'src/test.ts',
            domain: 'user',
            overallScore: 0.65,
            llmConfidence: 0.7,
            purposeMatch: { predicted: 'test', actual: 'test', similarity: 0.8 },
            importMatch: { predicted: [], actual: [], precision: 0.6, recall: 0.6, f1Score: 0.6 },
            exportMatch: { predicted: [], actual: [], precision: 0.5, recall: 0.5, f1Score: 0.5 },
            requirementCoverage: { relatedRequirements: [], actuallyImplements: [], coverage: 0.7 },
            feedback: ['Some feedback'],
          },
        ],
      };

      const markdown = (engine as any).generateMarkdownReport(report);

      expect(markdown).toContain('# Spec Verification Report');
      expect(markdown).toContain('## Summary');
      expect(markdown).toContain('## Domain Breakdown');
      expect(markdown).toContain('needs-review');
      expect(markdown).toContain('65');
    });
  });

  describe('verifySpecs convenience function', () => {
    it('should run verification end-to-end', async () => {
      mockProvider.setDefaultResponse(JSON.stringify({
        predictedPurpose: 'Handles user operations',
        predictedImports: ['database'],
        predictedExports: ['UserService'],
        predictedLogic: ['authentication'],
        relatedRequirements: ['UserAuthentication'],
        confidence: 0.7,
        reasoning: 'Based on user spec',
      }));

      const depGraph = createMockDepGraph([
        { path: 'src/user-service.ts', lines: 100 },
      ]);

      const report = await verifySpecs(
        llmService,
        depGraph,
        {
          rootPath: testDir,
          openspecPath: openspecDir,
          outputDir,
          minComplexity: 10,
          maxComplexity: 200,
        },
        '1.0.0'
      );

      expect(report).toBeDefined();
      expect(report.specVersion).toBe('1.0.0');
      expect(report.sampledFiles).toBeGreaterThanOrEqual(0);
    });
  });

  describe('inferDomain', () => {
    it('should infer domain from file path', () => {
      const engine = new SpecVerificationEngine(llmService, {
        rootPath: testDir,
        openspecPath: openspecDir,
        outputDir,
      });

      expect((engine as any).inferDomain('src/user/service.ts')).toBe('user');
      expect((engine as any).inferDomain('src/services/order-service.ts')).toBe('services');
      expect((engine as any).inferDomain('lib/auth/provider.ts')).toBe('auth');
    });

    it('should skip common non-domain directories', () => {
      const engine = new SpecVerificationEngine(llmService, {
        rootPath: testDir,
        openspecPath: openspecDir,
        outputDir,
      });

      expect((engine as any).inferDomain('src/lib/auth/provider.ts')).toBe('auth');
      expect((engine as any).inferDomain('src/core/user/model.ts')).toBe('user');
    });
  });

  describe('normalizeImport', () => {
    it('should normalize import paths', () => {
      const engine = new SpecVerificationEngine(llmService, {
        rootPath: testDir,
        openspecPath: openspecDir,
        outputDir,
      });

      expect((engine as any).normalizeImport('./database.js')).toBe('database');
      expect((engine as any).normalizeImport('../utils/crypto.ts')).toBe('crypto');
      expect((engine as any).normalizeImport('lodash')).toBe('lodash');
    });
  });
});
