/**
 * Analysis Artifact Generator Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  AnalysisArtifactGenerator,
  generateArtifacts,
  generateAndSaveArtifacts,
  type RepoStructure,
  type AnalysisArtifacts,
} from './artifact-generator.js';
import type { RepositoryMap, DetectedFramework, LanguageBreakdown, DirectoryStats } from './repository-mapper.js';
import type { DependencyGraphResult, DependencyNode, DependencyEdge, FileCluster } from './dependency-graph.js';
import type { ScoredFile, ProjectType } from '../../types/index.js';

// ============================================================================
// TEST HELPERS
// ============================================================================

async function createTempDir(): Promise<string> {
  const dir = join(tmpdir(), `artifact-gen-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

function createScoredFile(overrides: Partial<ScoredFile> & { name: string; path: string }): ScoredFile {
  return {
    path: overrides.path,
    absolutePath: overrides.absolutePath ?? `/test/${overrides.path}`,
    name: overrides.name,
    extension: overrides.extension ?? '.ts',
    size: overrides.size ?? 100,
    lines: overrides.lines ?? 10,
    depth: overrides.depth ?? 0,
    directory: overrides.directory ?? '',
    isEntryPoint: overrides.isEntryPoint ?? false,
    isConfig: overrides.isConfig ?? false,
    isTest: overrides.isTest ?? false,
    isGenerated: overrides.isGenerated ?? false,
    score: overrides.score ?? 50,
    scoreBreakdown: overrides.scoreBreakdown ?? { name: 10, path: 10, structure: 10, connectivity: 20 },
    tags: overrides.tags ?? [],
  };
}

function createMockRepoMap(overrides: Partial<RepositoryMap> = {}): RepositoryMap {
  const defaultFiles: ScoredFile[] = [
    createScoredFile({ name: 'index.ts', path: 'src/index.ts', directory: 'src', isEntryPoint: true, score: 80, tags: ['entry-point'] }),
    createScoredFile({ name: 'user.ts', path: 'src/models/user.ts', directory: 'src/models', score: 75, tags: ['schema'] }),
    createScoredFile({ name: 'user-service.ts', path: 'src/services/user-service.ts', directory: 'src/services', score: 70 }),
    createScoredFile({ name: 'user-controller.ts', path: 'src/controllers/user-controller.ts', directory: 'src/controllers', score: 65 }),
    createScoredFile({ name: 'user-repository.ts', path: 'src/repositories/user-repository.ts', directory: 'src/repositories', score: 60 }),
    createScoredFile({ name: 'config.ts', path: 'src/config/config.ts', directory: 'src/config', isConfig: true, score: 55 }),
    createScoredFile({ name: 'auth.ts', path: 'src/middleware/auth.ts', directory: 'src/middleware', score: 50 }),
  ];

  const defaultFrameworks: DetectedFramework[] = [
    { name: 'Express', category: 'backend', confidence: 'high', evidence: ['package.json'] },
    { name: 'Jest', category: 'testing', confidence: 'high', evidence: ['jest.config.js'] },
  ];

  const defaultLanguages: LanguageBreakdown[] = [
    { language: 'TypeScript', extension: '.ts', fileCount: 50, percentage: 80 },
    { language: 'JavaScript', extension: '.js', fileCount: 10, percentage: 16 },
    { language: 'JSON', extension: '.json', fileCount: 3, percentage: 4 },
  ];

  const defaultDirs: DirectoryStats[] = [
    { path: 'src/models', fileCount: 5, purpose: 'Data models', avgScore: 70 },
    { path: 'src/services', fileCount: 8, purpose: 'Business logic', avgScore: 65 },
    { path: 'src/controllers', fileCount: 6, purpose: 'Request handlers', avgScore: 60 },
  ];

  return {
    metadata: {
      projectName: overrides.metadata?.projectName ?? 'test-project',
      projectType: overrides.metadata?.projectType ?? 'nodejs',
      rootPath: overrides.metadata?.rootPath ?? '/test',
      analyzedAt: overrides.metadata?.analyzedAt ?? '2024-01-15T10:00:00Z',
      version: overrides.metadata?.version ?? '1.0.0',
    },
    summary: {
      totalFiles: overrides.summary?.totalFiles ?? 100,
      analyzedFiles: overrides.summary?.analyzedFiles ?? 70,
      skippedFiles: overrides.summary?.skippedFiles ?? 30,
      languages: overrides.summary?.languages ?? defaultLanguages,
      frameworks: overrides.summary?.frameworks ?? defaultFrameworks,
      directories: overrides.summary?.directories ?? defaultDirs,
    },
    highValueFiles: overrides.highValueFiles ?? defaultFiles,
    entryPoints: overrides.entryPoints ?? [defaultFiles[0]],
    schemaFiles: overrides.schemaFiles ?? [defaultFiles[1]],
    configFiles: overrides.configFiles ?? [defaultFiles[5]],
    clusters: overrides.clusters ?? {
      byDirectory: {
        'src/models': [defaultFiles[1]],
        'src/services': [defaultFiles[2]],
      },
      byDomain: {
        'user': [defaultFiles[1], defaultFiles[2], defaultFiles[3]],
      },
      byLayer: {
        presentation: [defaultFiles[3]],
        business: [defaultFiles[2]],
        data: [defaultFiles[1], defaultFiles[4]],
        infrastructure: [defaultFiles[5], defaultFiles[6]],
      },
    },
    allFiles: overrides.allFiles ?? defaultFiles,
  };
}

function createMockDepGraph(overrides: Partial<DependencyGraphResult> = {}): DependencyGraphResult {
  const nodes: DependencyNode[] = overrides.nodes ?? [
    {
      id: '/test/src/index.ts',
      file: createScoredFile({ name: 'index.ts', path: 'src/index.ts' }),
      exports: [],
      metrics: { inDegree: 0, outDegree: 3, betweenness: 0.2, pageRank: 0.3 },
    },
    {
      id: '/test/src/services/user-service.ts',
      file: createScoredFile({ name: 'user-service.ts', path: 'src/services/user-service.ts' }),
      exports: [],
      metrics: { inDegree: 2, outDegree: 1, betweenness: 0.5, pageRank: 0.6 },
    },
    {
      id: '/test/src/models/user.ts',
      file: createScoredFile({ name: 'user.ts', path: 'src/models/user.ts' }),
      exports: [],
      metrics: { inDegree: 3, outDegree: 0, betweenness: 0.1, pageRank: 0.8 },
    },
  ];

  const edges: DependencyEdge[] = overrides.edges ?? [
    { source: '/test/src/index.ts', target: '/test/src/services/user-service.ts', importedNames: ['UserService'], isTypeOnly: false, weight: 1 },
    { source: '/test/src/services/user-service.ts', target: '/test/src/models/user.ts', importedNames: ['User'], isTypeOnly: false, weight: 1 },
  ];

  const clusters: FileCluster[] = overrides.clusters ?? [
    {
      id: 'cluster-0',
      name: 'services',
      files: ['/test/src/services/user-service.ts'],
      internalEdges: 0,
      externalEdges: 2,
      cohesion: 0,
      coupling: 1,
      suggestedDomain: 'services',
    },
  ];

  return {
    nodes,
    edges,
    clusters,
    rankings: overrides.rankings ?? {
      byImportance: ['/test/src/models/user.ts', '/test/src/services/user-service.ts', '/test/src/index.ts'],
      byConnectivity: ['/test/src/services/user-service.ts', '/test/src/models/user.ts', '/test/src/index.ts'],
      clusterCenters: ['/test/src/services/user-service.ts'],
      leafNodes: ['/test/src/index.ts'],
      bridgeNodes: ['/test/src/services/user-service.ts'],
      orphanNodes: [],
    },
    cycles: overrides.cycles ?? [],
    statistics: overrides.statistics ?? {
      nodeCount: 3,
      edgeCount: 2,
      avgDegree: 2,
      density: 0.33,
      clusterCount: 1,
      cycleCount: 0,
    },
  };
}

// ============================================================================
// TESTS
// ============================================================================

describe('AnalysisArtifactGenerator', () => {
  let tempDir: string;
  let outputDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    outputDir = join(tempDir, '.spec-gen', 'analysis');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('RepoStructure Generation', () => {
    it('should generate valid repo-structure.json', async () => {
      const repoMap = createMockRepoMap();
      const depGraph = createMockDepGraph();

      const artifacts = await generateArtifacts(repoMap, depGraph, {
        rootDir: tempDir,
        outputDir,
      });

      expect(artifacts.repoStructure).toBeDefined();
      expect(artifacts.repoStructure.projectName).toBe('test-project');
      expect(artifacts.repoStructure.projectType).toBe('node-typescript');
    });

    it('should include frameworks list', async () => {
      const repoMap = createMockRepoMap();
      const depGraph = createMockDepGraph();

      const artifacts = await generateArtifacts(repoMap, depGraph, {
        rootDir: tempDir,
        outputDir,
      });

      expect(artifacts.repoStructure.frameworks).toContain('Express');
      expect(artifacts.repoStructure.frameworks).toContain('Jest');
    });

    it('should detect architecture pattern', async () => {
      const repoMap = createMockRepoMap();
      const depGraph = createMockDepGraph();

      const artifacts = await generateArtifacts(repoMap, depGraph, {
        rootDir: tempDir,
        outputDir,
      });

      // Should detect layered architecture based on directory structure
      expect(['layered', 'modular', 'microservices', 'monolith', 'unknown']).toContain(
        artifacts.repoStructure.architecture.pattern
      );
    });

    it('should generate architecture layers', async () => {
      const repoMap = createMockRepoMap();
      const depGraph = createMockDepGraph();

      const artifacts = await generateArtifacts(repoMap, depGraph, {
        rootDir: tempDir,
        outputDir,
      });

      expect(artifacts.repoStructure.architecture.layers.length).toBeGreaterThan(0);

      for (const layer of artifacts.repoStructure.architecture.layers) {
        expect(layer.name).toBeDefined();
        expect(layer.purpose).toBeDefined();
        expect(Array.isArray(layer.files)).toBe(true);
      }
    });

    it('should generate domains', async () => {
      const repoMap = createMockRepoMap();
      const depGraph = createMockDepGraph();

      const artifacts = await generateArtifacts(repoMap, depGraph, {
        rootDir: tempDir,
        outputDir,
      });

      expect(artifacts.repoStructure.domains.length).toBeGreaterThan(0);

      for (const domain of artifacts.repoStructure.domains) {
        expect(domain.name).toBeDefined();
        expect(domain.suggestedSpecPath).toMatch(/^openspec\/specs\//);
        expect(Array.isArray(domain.files)).toBe(true);
        expect(Array.isArray(domain.entities)).toBe(true);
      }
    });

    it('should generate entry points', async () => {
      const repoMap = createMockRepoMap();
      const depGraph = createMockDepGraph();

      const artifacts = await generateArtifacts(repoMap, depGraph, {
        rootDir: tempDir,
        outputDir,
      });

      expect(artifacts.repoStructure.entryPoints.length).toBeGreaterThan(0);

      for (const entry of artifacts.repoStructure.entryPoints) {
        expect(entry.file).toBeDefined();
        expect(['application-entry', 'api-entry', 'test-entry', 'build-entry']).toContain(entry.type);
        expect(Array.isArray(entry.initializes)).toBe(true);
      }
    });

    it('should generate data flow information', async () => {
      const repoMap = createMockRepoMap();
      const depGraph = createMockDepGraph();

      const artifacts = await generateArtifacts(repoMap, depGraph, {
        rootDir: tempDir,
        outputDir,
      });

      expect(artifacts.repoStructure.dataFlow).toBeDefined();
      expect(Array.isArray(artifacts.repoStructure.dataFlow.sources)).toBe(true);
      expect(Array.isArray(artifacts.repoStructure.dataFlow.sinks)).toBe(true);
      expect(Array.isArray(artifacts.repoStructure.dataFlow.transformers)).toBe(true);
    });

    it('should generate key files', async () => {
      const repoMap = createMockRepoMap();
      const depGraph = createMockDepGraph();

      const artifacts = await generateArtifacts(repoMap, depGraph, {
        rootDir: tempDir,
        outputDir,
      });

      expect(artifacts.repoStructure.keyFiles).toBeDefined();
      expect(Array.isArray(artifacts.repoStructure.keyFiles.schemas)).toBe(true);
      expect(Array.isArray(artifacts.repoStructure.keyFiles.config)).toBe(true);
      expect(Array.isArray(artifacts.repoStructure.keyFiles.auth)).toBe(true);
      expect(Array.isArray(artifacts.repoStructure.keyFiles.database)).toBe(true);
    });

    it('should include statistics', async () => {
      const repoMap = createMockRepoMap();
      const depGraph = createMockDepGraph();

      const artifacts = await generateArtifacts(repoMap, depGraph, {
        rootDir: tempDir,
        outputDir,
      });

      expect(artifacts.repoStructure.statistics).toBeDefined();
      expect(artifacts.repoStructure.statistics.totalFiles).toBe(100);
      expect(artifacts.repoStructure.statistics.analyzedFiles).toBe(70);
      expect(artifacts.repoStructure.statistics.nodeCount).toBe(3);
      expect(artifacts.repoStructure.statistics.edgeCount).toBe(2);
    });
  });

  describe('Summary Markdown Generation', () => {
    it('should generate valid markdown', async () => {
      const repoMap = createMockRepoMap();
      const depGraph = createMockDepGraph();

      const artifacts = await generateArtifacts(repoMap, depGraph, {
        rootDir: tempDir,
        outputDir,
      });

      expect(artifacts.summaryMarkdown).toBeDefined();
      expect(typeof artifacts.summaryMarkdown).toBe('string');
      expect(artifacts.summaryMarkdown.length).toBeGreaterThan(0);
    });

    it('should include project header', async () => {
      const repoMap = createMockRepoMap({ metadata: { projectName: 'my-awesome-project', projectType: 'nodejs', rootPath: '/test', analyzedAt: '2024-01-15', version: '1.0.0' } });
      const depGraph = createMockDepGraph();

      const artifacts = await generateArtifacts(repoMap, depGraph, {
        rootDir: tempDir,
        outputDir,
      });

      expect(artifacts.summaryMarkdown).toContain('# Repository Analysis: my-awesome-project');
    });

    it('should include overview section', async () => {
      const repoMap = createMockRepoMap();
      const depGraph = createMockDepGraph();

      const artifacts = await generateArtifacts(repoMap, depGraph, {
        rootDir: tempDir,
        outputDir,
      });

      expect(artifacts.summaryMarkdown).toContain('## Overview');
      expect(artifacts.summaryMarkdown).toContain('**Type**');
      expect(artifacts.summaryMarkdown).toContain('**Files Analyzed**');
    });

    it('should include architecture section', async () => {
      const repoMap = createMockRepoMap();
      const depGraph = createMockDepGraph();

      const artifacts = await generateArtifacts(repoMap, depGraph, {
        rootDir: tempDir,
        outputDir,
      });

      expect(artifacts.summaryMarkdown).toContain('## Architecture Pattern');
    });

    it('should include language breakdown', async () => {
      const repoMap = createMockRepoMap();
      const depGraph = createMockDepGraph();

      const artifacts = await generateArtifacts(repoMap, depGraph, {
        rootDir: tempDir,
        outputDir,
      });

      expect(artifacts.summaryMarkdown).toContain('## Language Breakdown');
      expect(artifacts.summaryMarkdown).toContain('TypeScript');
    });

    it('should include domains table', async () => {
      const repoMap = createMockRepoMap();
      const depGraph = createMockDepGraph();

      const artifacts = await generateArtifacts(repoMap, depGraph, {
        rootDir: tempDir,
        outputDir,
      });

      expect(artifacts.summaryMarkdown).toContain('## Detected Domains');
      expect(artifacts.summaryMarkdown).toContain('| Domain | Files |');
    });

    it('should include dependency insights', async () => {
      const repoMap = createMockRepoMap();
      const depGraph = createMockDepGraph();

      const artifacts = await generateArtifacts(repoMap, depGraph, {
        rootDir: tempDir,
        outputDir,
      });

      expect(artifacts.summaryMarkdown).toContain('## Dependency Insights');
      expect(artifacts.summaryMarkdown).toContain('**Most Connected Files:**');
    });

    it('should include cycles if present', async () => {
      const repoMap = createMockRepoMap();
      const depGraph = createMockDepGraph({
        cycles: [['/test/a.ts', '/test/b.ts', '/test/a.ts']],
        statistics: { nodeCount: 3, edgeCount: 2, avgDegree: 2, density: 0.33, clusterCount: 1, cycleCount: 1 },
      });

      const artifacts = await generateArtifacts(repoMap, depGraph, {
        rootDir: tempDir,
        outputDir,
      });

      expect(artifacts.summaryMarkdown).toContain('Circular Dependencies');
    });

    it('should include top files section', async () => {
      const repoMap = createMockRepoMap();
      const depGraph = createMockDepGraph();

      const artifacts = await generateArtifacts(repoMap, depGraph, {
        rootDir: tempDir,
        outputDir,
      });

      expect(artifacts.summaryMarkdown).toContain('## Files Selected for Deep Analysis');
    });

    it('should include recommendations', async () => {
      const repoMap = createMockRepoMap();
      const depGraph = createMockDepGraph();

      const artifacts = await generateArtifacts(repoMap, depGraph, {
        rootDir: tempDir,
        outputDir,
      });

      expect(artifacts.summaryMarkdown).toContain('## Recommendations');
    });
  });

  describe('Dependency Diagram Generation', () => {
    it('should generate Mermaid diagram', async () => {
      const repoMap = createMockRepoMap();
      const depGraph = createMockDepGraph();

      const artifacts = await generateArtifacts(repoMap, depGraph, {
        rootDir: tempDir,
        outputDir,
      });

      expect(artifacts.dependencyDiagram).toBeDefined();
      expect(artifacts.dependencyDiagram).toContain('```mermaid');
      expect(artifacts.dependencyDiagram).toContain('graph TD');
    });

    it('should include nodes', async () => {
      const repoMap = createMockRepoMap();
      const depGraph = createMockDepGraph();

      const artifacts = await generateArtifacts(repoMap, depGraph, {
        rootDir: tempDir,
        outputDir,
      });

      // Should contain node definitions
      expect(artifacts.dependencyDiagram).toContain('["');
    });
  });

  describe('LLM Context Generation', () => {
    it('should generate all three phases', async () => {
      const repoMap = createMockRepoMap();
      const depGraph = createMockDepGraph();

      const artifacts = await generateArtifacts(repoMap, depGraph, {
        rootDir: tempDir,
        outputDir,
      });

      expect(artifacts.llmContext).toBeDefined();
      expect(artifacts.llmContext.phase1_survey).toBeDefined();
      expect(artifacts.llmContext.phase2_deep).toBeDefined();
      expect(artifacts.llmContext.phase3_validation).toBeDefined();
    });

    it('should have correct phase purposes', async () => {
      const repoMap = createMockRepoMap();
      const depGraph = createMockDepGraph();

      const artifacts = await generateArtifacts(repoMap, depGraph, {
        rootDir: tempDir,
        outputDir,
      });

      expect(artifacts.llmContext.phase1_survey.purpose).toContain('categorization');
      expect(artifacts.llmContext.phase2_deep.purpose).toContain('extraction');
      expect(artifacts.llmContext.phase3_validation.purpose).toContain('Verification');
    });

    it('should include files in each phase', async () => {
      const repoMap = createMockRepoMap();
      const depGraph = createMockDepGraph();

      const artifacts = await generateArtifacts(repoMap, depGraph, {
        rootDir: tempDir,
        outputDir,
      });

      expect(Array.isArray(artifacts.llmContext.phase1_survey.files)).toBe(true);
      expect(Array.isArray(artifacts.llmContext.phase2_deep.files)).toBe(true);
      expect(Array.isArray(artifacts.llmContext.phase3_validation.files)).toBe(true);
    });

    it('should estimate tokens', async () => {
      const repoMap = createMockRepoMap();
      const depGraph = createMockDepGraph();

      const artifacts = await generateArtifacts(repoMap, depGraph, {
        rootDir: tempDir,
        outputDir,
      });

      expect(artifacts.llmContext.phase1_survey.estimatedTokens).toBeGreaterThan(0);
    });
  });

  describe('File Saving', () => {
    it('should save all artifacts to disk', async () => {
      // Create actual files for reading
      const srcDir = join(tempDir, 'src');
      await mkdir(srcDir, { recursive: true });
      await writeFile(join(srcDir, 'index.ts'), 'export const main = () => {};');

      const repoMap = createMockRepoMap({
        highValueFiles: [
          createScoredFile({
            name: 'index.ts',
            path: 'src/index.ts',
            absolutePath: join(srcDir, 'index.ts'),
          }),
        ],
      });
      const depGraph = createMockDepGraph();

      await generateAndSaveArtifacts(repoMap, depGraph, {
        rootDir: tempDir,
        outputDir,
      });

      // Check files exist
      await expect(access(join(outputDir, 'repo-structure.json'))).resolves.not.toThrow();
      await expect(access(join(outputDir, 'SUMMARY.md'))).resolves.not.toThrow();
      await expect(access(join(outputDir, 'dependencies.mermaid'))).resolves.not.toThrow();
      await expect(access(join(outputDir, 'llm-context.json'))).resolves.not.toThrow();
    });

    it('should save valid JSON files', async () => {
      const srcDir = join(tempDir, 'src');
      await mkdir(srcDir, { recursive: true });
      await writeFile(join(srcDir, 'index.ts'), 'export const main = () => {};');

      const repoMap = createMockRepoMap({
        highValueFiles: [
          createScoredFile({
            name: 'index.ts',
            path: 'src/index.ts',
            absolutePath: join(srcDir, 'index.ts'),
          }),
        ],
      });
      const depGraph = createMockDepGraph();

      await generateAndSaveArtifacts(repoMap, depGraph, {
        rootDir: tempDir,
        outputDir,
      });

      // Verify JSON is parseable
      const repoStructure = JSON.parse(await readFile(join(outputDir, 'repo-structure.json'), 'utf-8'));
      expect(repoStructure.projectName).toBe('test-project');

      const llmContext = JSON.parse(await readFile(join(outputDir, 'llm-context.json'), 'utf-8'));
      expect(llmContext.phase1_survey).toBeDefined();
    });

    it('should create output directory if it does not exist', async () => {
      const nestedOutputDir = join(tempDir, 'nested', 'deeply', '.spec-gen', 'analysis');

      const repoMap = createMockRepoMap();
      const depGraph = createMockDepGraph();

      await generateAndSaveArtifacts(repoMap, depGraph, {
        rootDir: tempDir,
        outputDir: nestedOutputDir,
      });

      await expect(access(join(nestedOutputDir, 'repo-structure.json'))).resolves.not.toThrow();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty repo map', async () => {
      const repoMap = createMockRepoMap({
        allFiles: [],
        highValueFiles: [],
        entryPoints: [],
        schemaFiles: [],
        configFiles: [],
        summary: {
          totalFiles: 0,
          analyzedFiles: 0,
          skippedFiles: 0,
          languages: [],
          frameworks: [],
          directories: [],
        },
        clusters: {
          byDirectory: {},
          byDomain: {},
          byLayer: { presentation: [], business: [], data: [], infrastructure: [] },
        },
      });
      const depGraph = createMockDepGraph({
        nodes: [],
        edges: [],
        clusters: [],
        rankings: {
          byImportance: [],
          byConnectivity: [],
          clusterCenters: [],
          leafNodes: [],
          bridgeNodes: [],
          orphanNodes: [],
        },
        statistics: {
          nodeCount: 0,
          edgeCount: 0,
          avgDegree: 0,
          density: 0,
          clusterCount: 0,
          cycleCount: 0,
        },
      });

      const artifacts = await generateArtifacts(repoMap, depGraph, {
        rootDir: tempDir,
        outputDir,
      });

      expect(artifacts.repoStructure.statistics.totalFiles).toBe(0);
      expect(artifacts.repoStructure.domains).toHaveLength(0);
    });

    it('should handle different project types', async () => {
      const projectTypes: ProjectType[] = ['nodejs', 'python', 'rust', 'go', 'java', 'ruby', 'php', 'unknown'];

      for (const projectType of projectTypes) {
        const repoMap = createMockRepoMap({
          metadata: { projectName: 'test', projectType, rootPath: '/test', analyzedAt: '2024-01-15', version: '1.0.0' },
        });
        const depGraph = createMockDepGraph();

        const artifacts = await generateArtifacts(repoMap, depGraph, {
          rootDir: tempDir,
          outputDir,
        });

        expect(artifacts.repoStructure.projectType).toBeDefined();
      }
    });

    it('should limit deep analysis files', async () => {
      const manyFiles = Array.from({ length: 50 }, (_, i) =>
        createScoredFile({ name: `file${i}.ts`, path: `src/file${i}.ts`, score: 50 - i })
      );

      const repoMap = createMockRepoMap({ highValueFiles: manyFiles });
      const depGraph = createMockDepGraph();

      const artifacts = await generateArtifacts(repoMap, depGraph, {
        rootDir: tempDir,
        outputDir,
        maxDeepAnalysisFiles: 10,
      });

      // Files array is capped (though content reading may fail for mock files)
      expect(artifacts.llmContext.phase2_deep.files.length).toBeLessThanOrEqual(10);
    });

    it('should handle files that cannot be read', async () => {
      const repoMap = createMockRepoMap({
        highValueFiles: [
          createScoredFile({
            name: 'missing.ts',
            path: 'src/missing.ts',
            absolutePath: '/nonexistent/path/missing.ts',
          }),
        ],
      });
      const depGraph = createMockDepGraph();

      // Should not throw
      const artifacts = await generateArtifacts(repoMap, depGraph, {
        rootDir: tempDir,
        outputDir,
      });

      expect(artifacts).toBeDefined();
    });
  });
});
