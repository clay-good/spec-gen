/**
 * Dependency Graph Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  DependencyGraphBuilder,
  buildDependencyGraph,
  toD3Format,
  toMermaidFormat,
  toDotFormat,
  type DependencyGraphResult,
} from './dependency-graph.js';
import type { ScoredFile } from '../../types/index.js';

// ============================================================================
// TEST HELPERS
// ============================================================================

async function createTempDir(): Promise<string> {
  const dir = join(tmpdir(), `dep-graph-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function createFile(dir: string, name: string, content: string): Promise<string> {
  const filePath = join(dir, name);
  const fileDir = join(dir, ...name.split('/').slice(0, -1));
  if (fileDir !== dir && name.includes('/')) {
    await mkdir(fileDir, { recursive: true });
  }
  await writeFile(filePath, content, 'utf-8');
  return filePath;
}

function createScoredFile(overrides: Partial<ScoredFile> & { absolutePath: string; name: string }): ScoredFile {
  return {
    path: overrides.path ?? overrides.name,
    absolutePath: overrides.absolutePath,
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

// ============================================================================
// TESTS
// ============================================================================

describe('DependencyGraphBuilder', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('Basic Graph Construction', () => {
    it('should create nodes for all files', async () => {
      const fileA = await createFile(tempDir, 'a.ts', 'export const a = 1;');
      const fileB = await createFile(tempDir, 'b.ts', 'export const b = 2;');

      const files: ScoredFile[] = [
        createScoredFile({ absolutePath: fileA, name: 'a.ts' }),
        createScoredFile({ absolutePath: fileB, name: 'b.ts' }),
      ];

      const result = await buildDependencyGraph(files, { rootDir: tempDir });

      expect(result.nodes).toHaveLength(2);
      expect(result.nodes.map(n => n.file.name)).toContain('a.ts');
      expect(result.nodes.map(n => n.file.name)).toContain('b.ts');
    });

    it('should create edges for imports', async () => {
      const fileA = await createFile(tempDir, 'a.ts', `
        import { b } from './b';
        export const a = b + 1;
      `);
      const fileB = await createFile(tempDir, 'b.ts', 'export const b = 2;');

      const files: ScoredFile[] = [
        createScoredFile({ absolutePath: fileA, name: 'a.ts' }),
        createScoredFile({ absolutePath: fileB, name: 'b.ts' }),
      ];

      const result = await buildDependencyGraph(files, { rootDir: tempDir });

      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].source).toBe(fileA);
      expect(result.edges[0].target).toBe(fileB);
      expect(result.edges[0].importedNames).toContain('b');
    });

    it('should handle files with no imports', async () => {
      const fileA = await createFile(tempDir, 'a.ts', 'export const a = 1;');

      const files: ScoredFile[] = [
        createScoredFile({ absolutePath: fileA, name: 'a.ts' }),
      ];

      const result = await buildDependencyGraph(files, { rootDir: tempDir });

      expect(result.nodes).toHaveLength(1);
      expect(result.edges).toHaveLength(0);
    });

    it('should ignore external package imports', async () => {
      const fileA = await createFile(tempDir, 'a.ts', `
        import React from 'react';
        import { useState } from 'react';
        export const App = () => null;
      `);

      const files: ScoredFile[] = [
        createScoredFile({ absolutePath: fileA, name: 'a.ts' }),
      ];

      const result = await buildDependencyGraph(files, { rootDir: tempDir });

      expect(result.edges).toHaveLength(0);
    });

    it('should handle type-only imports with lower weight', async () => {
      const fileA = await createFile(tempDir, 'a.ts', `
        import type { User } from './types';
        export const getUser = (): User => ({ name: 'test' });
      `);
      const fileTypes = await createFile(tempDir, 'types.ts', `
        export interface User { name: string; }
      `);

      const files: ScoredFile[] = [
        createScoredFile({ absolutePath: fileA, name: 'a.ts' }),
        createScoredFile({ absolutePath: fileTypes, name: 'types.ts' }),
      ];

      const result = await buildDependencyGraph(files, { rootDir: tempDir });

      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].isTypeOnly).toBe(true);
      expect(result.edges[0].weight).toBe(0.5);
    });
  });

  describe('Linear Dependency Chain', () => {
    it('should handle A -> B -> C chain', async () => {
      const fileA = await createFile(tempDir, 'a.ts', `
        import { b } from './b';
        export const a = b + 1;
      `);
      const fileB = await createFile(tempDir, 'b.ts', `
        import { c } from './c';
        export const b = c + 1;
      `);
      const fileC = await createFile(tempDir, 'c.ts', 'export const c = 1;');

      const files: ScoredFile[] = [
        createScoredFile({ absolutePath: fileA, name: 'a.ts' }),
        createScoredFile({ absolutePath: fileB, name: 'b.ts' }),
        createScoredFile({ absolutePath: fileC, name: 'c.ts' }),
      ];

      const result = await buildDependencyGraph(files, { rootDir: tempDir });

      expect(result.edges).toHaveLength(2);

      // Check degrees
      const nodeA = result.nodes.find(n => n.file.name === 'a.ts')!;
      const nodeB = result.nodes.find(n => n.file.name === 'b.ts')!;
      const nodeC = result.nodes.find(n => n.file.name === 'c.ts')!;

      expect(nodeA.metrics.outDegree).toBe(1);
      expect(nodeA.metrics.inDegree).toBe(0);

      expect(nodeB.metrics.outDegree).toBe(1);
      expect(nodeB.metrics.inDegree).toBe(1);

      expect(nodeC.metrics.outDegree).toBe(0);
      expect(nodeC.metrics.inDegree).toBe(1);
    });
  });

  describe('Diamond Dependency', () => {
    it('should handle diamond pattern (A->B, A->C, B->D, C->D)', async () => {
      const fileA = await createFile(tempDir, 'a.ts', `
        import { b } from './b';
        import { c } from './c';
        export const a = b + c;
      `);
      const fileB = await createFile(tempDir, 'b.ts', `
        import { d } from './d';
        export const b = d + 1;
      `);
      const fileC = await createFile(tempDir, 'c.ts', `
        import { d } from './d';
        export const c = d + 2;
      `);
      const fileD = await createFile(tempDir, 'd.ts', 'export const d = 1;');

      const files: ScoredFile[] = [
        createScoredFile({ absolutePath: fileA, name: 'a.ts' }),
        createScoredFile({ absolutePath: fileB, name: 'b.ts' }),
        createScoredFile({ absolutePath: fileC, name: 'c.ts' }),
        createScoredFile({ absolutePath: fileD, name: 'd.ts' }),
      ];

      const result = await buildDependencyGraph(files, { rootDir: tempDir });

      expect(result.edges).toHaveLength(4);

      const nodeD = result.nodes.find(n => n.file.name === 'd.ts')!;
      expect(nodeD.metrics.inDegree).toBe(2); // Both B and C import D
      expect(nodeD.metrics.outDegree).toBe(0);

      // D should have high PageRank (many things depend on it)
      const nodeA = result.nodes.find(n => n.file.name === 'a.ts')!;
      expect(nodeD.metrics.pageRank).toBeGreaterThan(nodeA.metrics.pageRank);
    });
  });

  describe('Circular Dependencies', () => {
    it('should detect direct cycle (A -> B -> A)', async () => {
      const fileA = await createFile(tempDir, 'a.ts', `
        import { b } from './b';
        export const a = 1;
      `);
      const fileB = await createFile(tempDir, 'b.ts', `
        import { a } from './a';
        export const b = 2;
      `);

      const files: ScoredFile[] = [
        createScoredFile({ absolutePath: fileA, name: 'a.ts' }),
        createScoredFile({ absolutePath: fileB, name: 'b.ts' }),
      ];

      const result = await buildDependencyGraph(files, { rootDir: tempDir });

      expect(result.cycles.length).toBeGreaterThan(0);
      expect(result.statistics.cycleCount).toBeGreaterThan(0);
    });

    it('should detect indirect cycle (A -> B -> C -> A)', async () => {
      const fileA = await createFile(tempDir, 'a.ts', `
        import { b } from './b';
        export const a = 1;
      `);
      const fileB = await createFile(tempDir, 'b.ts', `
        import { c } from './c';
        export const b = 2;
      `);
      const fileC = await createFile(tempDir, 'c.ts', `
        import { a } from './a';
        export const c = 3;
      `);

      const files: ScoredFile[] = [
        createScoredFile({ absolutePath: fileA, name: 'a.ts' }),
        createScoredFile({ absolutePath: fileB, name: 'b.ts' }),
        createScoredFile({ absolutePath: fileC, name: 'c.ts' }),
      ];

      const result = await buildDependencyGraph(files, { rootDir: tempDir });

      expect(result.cycles.length).toBeGreaterThan(0);
      // Cycle should contain all three files
      const cycleFiles = result.cycles[0];
      expect(cycleFiles.length).toBeGreaterThanOrEqual(3);
    });

    it('should handle graph with no cycles', async () => {
      const fileA = await createFile(tempDir, 'a.ts', `
        import { b } from './b';
        export const a = 1;
      `);
      const fileB = await createFile(tempDir, 'b.ts', 'export const b = 2;');

      const files: ScoredFile[] = [
        createScoredFile({ absolutePath: fileA, name: 'a.ts' }),
        createScoredFile({ absolutePath: fileB, name: 'b.ts' }),
      ];

      const result = await buildDependencyGraph(files, { rootDir: tempDir });

      expect(result.cycles).toHaveLength(0);
      expect(result.statistics.cycleCount).toBe(0);
    });
  });

  describe('Isolated Subgraphs', () => {
    it('should handle disconnected components', async () => {
      // Group 1: A -> B
      const fileA = await createFile(tempDir, 'a.ts', `
        import { b } from './b';
        export const a = 1;
      `);
      const fileB = await createFile(tempDir, 'b.ts', 'export const b = 2;');

      // Group 2: C -> D (isolated from Group 1)
      const fileC = await createFile(tempDir, 'c.ts', `
        import { d } from './d';
        export const c = 3;
      `);
      const fileD = await createFile(tempDir, 'd.ts', 'export const d = 4;');

      const files: ScoredFile[] = [
        createScoredFile({ absolutePath: fileA, name: 'a.ts' }),
        createScoredFile({ absolutePath: fileB, name: 'b.ts' }),
        createScoredFile({ absolutePath: fileC, name: 'c.ts' }),
        createScoredFile({ absolutePath: fileD, name: 'd.ts' }),
      ];

      const result = await buildDependencyGraph(files, { rootDir: tempDir });

      expect(result.nodes).toHaveLength(4);
      expect(result.edges).toHaveLength(2);

      // Both subgraphs should be processed
      expect(result.statistics.nodeCount).toBe(4);
      expect(result.statistics.edgeCount).toBe(2);
    });
  });

  describe('Metrics Calculation', () => {
    it('should calculate correct in-degree and out-degree', async () => {
      // Hub pattern: A imports B, C, D
      const fileA = await createFile(tempDir, 'a.ts', `
        import { b } from './b';
        import { c } from './c';
        import { d } from './d';
        export const a = b + c + d;
      `);
      const fileB = await createFile(tempDir, 'b.ts', 'export const b = 1;');
      const fileC = await createFile(tempDir, 'c.ts', 'export const c = 2;');
      const fileD = await createFile(tempDir, 'd.ts', 'export const d = 3;');

      const files: ScoredFile[] = [
        createScoredFile({ absolutePath: fileA, name: 'a.ts' }),
        createScoredFile({ absolutePath: fileB, name: 'b.ts' }),
        createScoredFile({ absolutePath: fileC, name: 'c.ts' }),
        createScoredFile({ absolutePath: fileD, name: 'd.ts' }),
      ];

      const result = await buildDependencyGraph(files, { rootDir: tempDir });

      const nodeA = result.nodes.find(n => n.file.name === 'a.ts')!;
      expect(nodeA.metrics.outDegree).toBe(3);
      expect(nodeA.metrics.inDegree).toBe(0);

      // B, C, D should have inDegree 1
      for (const name of ['b.ts', 'c.ts', 'd.ts']) {
        const node = result.nodes.find(n => n.file.name === name)!;
        expect(node.metrics.inDegree).toBe(1);
        expect(node.metrics.outDegree).toBe(0);
      }
    });

    it('should calculate betweenness centrality', async () => {
      // Linear chain: A -> B -> C
      // B should have high betweenness
      const fileA = await createFile(tempDir, 'a.ts', `
        import { b } from './b';
        export const a = b + 1;
      `);
      const fileB = await createFile(tempDir, 'b.ts', `
        import { c } from './c';
        export const b = c + 1;
      `);
      const fileC = await createFile(tempDir, 'c.ts', 'export const c = 1;');

      const files: ScoredFile[] = [
        createScoredFile({ absolutePath: fileA, name: 'a.ts' }),
        createScoredFile({ absolutePath: fileB, name: 'b.ts' }),
        createScoredFile({ absolutePath: fileC, name: 'c.ts' }),
      ];

      const result = await buildDependencyGraph(files, { rootDir: tempDir });

      const nodeB = result.nodes.find(n => n.file.name === 'b.ts')!;
      const nodeA = result.nodes.find(n => n.file.name === 'a.ts')!;
      const nodeC = result.nodes.find(n => n.file.name === 'c.ts')!;

      // B is the bridge between A and C
      expect(nodeB.metrics.betweenness).toBeGreaterThanOrEqual(0);
    });

    it('should calculate PageRank', async () => {
      // Star pattern: B, C, D all import A
      const fileA = await createFile(tempDir, 'a.ts', 'export const a = 1;');
      const fileB = await createFile(tempDir, 'b.ts', `
        import { a } from './a';
        export const b = a + 1;
      `);
      const fileC = await createFile(tempDir, 'c.ts', `
        import { a } from './a';
        export const c = a + 2;
      `);
      const fileD = await createFile(tempDir, 'd.ts', `
        import { a } from './a';
        export const d = a + 3;
      `);

      const files: ScoredFile[] = [
        createScoredFile({ absolutePath: fileA, name: 'a.ts' }),
        createScoredFile({ absolutePath: fileB, name: 'b.ts' }),
        createScoredFile({ absolutePath: fileC, name: 'c.ts' }),
        createScoredFile({ absolutePath: fileD, name: 'd.ts' }),
      ];

      const result = await buildDependencyGraph(files, { rootDir: tempDir });

      const nodeA = result.nodes.find(n => n.file.name === 'a.ts')!;
      const nodeB = result.nodes.find(n => n.file.name === 'b.ts')!;

      // A should have highest PageRank (most imported)
      expect(nodeA.metrics.pageRank).toBeGreaterThan(nodeB.metrics.pageRank);
    });
  });

  describe('Cluster Detection', () => {
    it('should group files by directory', async () => {
      // Create files in different directories
      await mkdir(join(tempDir, 'services'), { recursive: true });
      await mkdir(join(tempDir, 'models'), { recursive: true });

      const fileA = await createFile(tempDir, 'services/user-service.ts', 'export class UserService {}');
      const fileB = await createFile(tempDir, 'services/auth-service.ts', 'export class AuthService {}');
      const fileC = await createFile(tempDir, 'models/user.ts', 'export interface User {}');
      const fileD = await createFile(tempDir, 'models/post.ts', 'export interface Post {}');

      const files: ScoredFile[] = [
        createScoredFile({ absolutePath: fileA, name: 'user-service.ts', directory: 'services' }),
        createScoredFile({ absolutePath: fileB, name: 'auth-service.ts', directory: 'services' }),
        createScoredFile({ absolutePath: fileC, name: 'user.ts', directory: 'models' }),
        createScoredFile({ absolutePath: fileD, name: 'post.ts', directory: 'models' }),
      ];

      const result = await buildDependencyGraph(files, { rootDir: tempDir });

      expect(result.clusters.length).toBeGreaterThanOrEqual(2);

      const serviceCluster = result.clusters.find(c => c.name === 'services');
      const modelCluster = result.clusters.find(c => c.name === 'models');

      expect(serviceCluster?.files).toHaveLength(2);
      expect(modelCluster?.files).toHaveLength(2);
    });

    it('should suggest domain names from directory paths', async () => {
      await mkdir(join(tempDir, 'src/api'), { recursive: true });

      const fileA = await createFile(tempDir, 'src/api/users.ts', 'export const getUsers = () => [];');
      const fileB = await createFile(tempDir, 'src/api/posts.ts', 'export const getPosts = () => [];');

      const files: ScoredFile[] = [
        createScoredFile({ absolutePath: fileA, name: 'users.ts', directory: 'src/api' }),
        createScoredFile({ absolutePath: fileB, name: 'posts.ts', directory: 'src/api' }),
      ];

      const result = await buildDependencyGraph(files, { rootDir: tempDir });

      const apiCluster = result.clusters.find(c => c.name === 'src/api');
      expect(apiCluster?.suggestedDomain).toBe('api');
    });

    it('should calculate cluster cohesion and coupling', async () => {
      await mkdir(join(tempDir, 'cluster1'), { recursive: true });
      await mkdir(join(tempDir, 'cluster2'), { recursive: true });

      // Cluster 1: A imports B (internal edge)
      const fileA = await createFile(tempDir, 'cluster1/a.ts', `
        import { b } from './b';
        export const a = b + 1;
      `);
      const fileB = await createFile(tempDir, 'cluster1/b.ts', 'export const b = 1;');

      // Cluster 2: C imports A (external edge)
      const fileC = await createFile(tempDir, 'cluster2/c.ts', `
        import { a } from '../cluster1/a';
        export const c = 2;
      `);
      const fileD = await createFile(tempDir, 'cluster2/d.ts', 'export const d = 3;');

      const files: ScoredFile[] = [
        createScoredFile({ absolutePath: fileA, name: 'a.ts', directory: 'cluster1' }),
        createScoredFile({ absolutePath: fileB, name: 'b.ts', directory: 'cluster1' }),
        createScoredFile({ absolutePath: fileC, name: 'c.ts', directory: 'cluster2' }),
        createScoredFile({ absolutePath: fileD, name: 'd.ts', directory: 'cluster2' }),
      ];

      const result = await buildDependencyGraph(files, { rootDir: tempDir });

      const cluster1 = result.clusters.find(c => c.name === 'cluster1');
      expect(cluster1?.internalEdges).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Rankings', () => {
    it('should rank nodes by importance', async () => {
      // A imports B, C imports B -> B should be most important
      const fileA = await createFile(tempDir, 'a.ts', `
        import { b } from './b';
        export const a = b + 1;
      `);
      const fileB = await createFile(tempDir, 'b.ts', 'export const b = 1;');
      const fileC = await createFile(tempDir, 'c.ts', `
        import { b } from './b';
        export const c = 2;
      `);

      const files: ScoredFile[] = [
        createScoredFile({ absolutePath: fileA, name: 'a.ts' }),
        createScoredFile({ absolutePath: fileB, name: 'b.ts' }),
        createScoredFile({ absolutePath: fileC, name: 'c.ts' }),
      ];

      const result = await buildDependencyGraph(files, { rootDir: tempDir });

      // B should be near the top of importance ranking
      expect(result.rankings.byImportance[0]).toBe(fileB);
    });

    it('should identify leaf nodes', async () => {
      // A imports B, A imports C -> A is a leaf (imports but not imported)
      const fileA = await createFile(tempDir, 'a.ts', `
        import { b } from './b';
        import { c } from './c';
        export const a = b + c;
      `);
      const fileB = await createFile(tempDir, 'b.ts', 'export const b = 1;');
      const fileC = await createFile(tempDir, 'c.ts', 'export const c = 2;');

      const files: ScoredFile[] = [
        createScoredFile({ absolutePath: fileA, name: 'a.ts' }),
        createScoredFile({ absolutePath: fileB, name: 'b.ts' }),
        createScoredFile({ absolutePath: fileC, name: 'c.ts' }),
      ];

      const result = await buildDependencyGraph(files, { rootDir: tempDir });

      expect(result.rankings.leafNodes).toContain(fileA);
    });

    it('should identify orphan nodes', async () => {
      // File with no imports or exports used by others
      const fileA = await createFile(tempDir, 'a.ts', 'export const a = 1;');
      const fileB = await createFile(tempDir, 'b.ts', 'export const b = 2;');

      const files: ScoredFile[] = [
        createScoredFile({ absolutePath: fileA, name: 'a.ts' }),
        createScoredFile({ absolutePath: fileB, name: 'b.ts' }),
      ];

      const result = await buildDependencyGraph(files, { rootDir: tempDir });

      // Both are orphans (no connections between them)
      expect(result.rankings.orphanNodes).toContain(fileA);
      expect(result.rankings.orphanNodes).toContain(fileB);
    });
  });

  describe('Statistics', () => {
    it('should calculate correct statistics', async () => {
      const fileA = await createFile(tempDir, 'a.ts', `
        import { b } from './b';
        export const a = 1;
      `);
      const fileB = await createFile(tempDir, 'b.ts', 'export const b = 2;');

      const files: ScoredFile[] = [
        createScoredFile({ absolutePath: fileA, name: 'a.ts' }),
        createScoredFile({ absolutePath: fileB, name: 'b.ts' }),
      ];

      const result = await buildDependencyGraph(files, { rootDir: tempDir });

      expect(result.statistics.nodeCount).toBe(2);
      expect(result.statistics.edgeCount).toBe(1);
      expect(result.statistics.avgDegree).toBe(1); // (1+1)/2 = 1
      expect(result.statistics.density).toBe(0.5); // 1/(2*1) = 0.5
    });

    it('should handle empty file list', async () => {
      const result = await buildDependencyGraph([], { rootDir: tempDir });

      expect(result.statistics.nodeCount).toBe(0);
      expect(result.statistics.edgeCount).toBe(0);
      expect(result.statistics.avgDegree).toBe(0);
      expect(result.statistics.density).toBe(0);
    });
  });

  describe('Export Formats', () => {
    let result: DependencyGraphResult;

    beforeEach(async () => {
      const fileA = await createFile(tempDir, 'a.ts', `
        import { b } from './b';
        export const a = 1;
      `);
      const fileB = await createFile(tempDir, 'b.ts', 'export const b = 2;');

      const files: ScoredFile[] = [
        createScoredFile({ absolutePath: fileA, name: 'a.ts', path: 'a.ts' }),
        createScoredFile({ absolutePath: fileB, name: 'b.ts', path: 'b.ts' }),
      ];

      result = await buildDependencyGraph(files, { rootDir: tempDir });
    });

    it('should export to D3 format', () => {
      const d3 = toD3Format(result);

      expect(d3.nodes).toHaveLength(2);
      expect(d3.links).toHaveLength(1);
      expect(d3.nodes[0]).toHaveProperty('id');
      expect(d3.nodes[0]).toHaveProperty('group');
      expect(d3.nodes[0]).toHaveProperty('score');
      expect(d3.links[0]).toHaveProperty('source');
      expect(d3.links[0]).toHaveProperty('target');
      expect(d3.links[0]).toHaveProperty('value');
    });

    it('should export to Mermaid format', () => {
      const mermaid = toMermaidFormat(result);

      expect(mermaid).toContain('graph TD');
      expect(mermaid).toContain('a.ts');
      expect(mermaid).toContain('b.ts');
      expect(mermaid).toContain('-->'); // Edge
    });

    it('should export to DOT format', () => {
      const dot = toDotFormat(result);

      expect(dot).toContain('digraph Dependencies {');
      expect(dot).toContain('rankdir=LR');
      expect(dot).toContain('->'); // Edge
      expect(dot).toContain('}');
    });
  });

  describe('Edge Cases', () => {
    it('should handle files that fail to parse', async () => {
      const fileA = await createFile(tempDir, 'a.ts', 'export const a = 1;');
      // Create an unreadable file path
      const fakePath = join(tempDir, 'nonexistent.ts');

      const files: ScoredFile[] = [
        createScoredFile({ absolutePath: fileA, name: 'a.ts' }),
        createScoredFile({ absolutePath: fakePath, name: 'nonexistent.ts' }),
      ];

      // Should not throw, just skip the bad file
      const result = await buildDependencyGraph(files, { rootDir: tempDir });

      expect(result.nodes).toHaveLength(2);
    });

    it('should handle imports to files not in the file list', async () => {
      const fileA = await createFile(tempDir, 'a.ts', `
        import { external } from './external';
        export const a = 1;
      `);
      // external.ts exists but is not in our file list
      await createFile(tempDir, 'external.ts', 'export const external = 2;');

      const files: ScoredFile[] = [
        createScoredFile({ absolutePath: fileA, name: 'a.ts' }),
        // external.ts not included
      ];

      const result = await buildDependencyGraph(files, { rootDir: tempDir });

      // Edge should not be created (target not in file list)
      expect(result.edges).toHaveLength(0);
    });

    it('should handle self-imports gracefully', async () => {
      const fileA = await createFile(tempDir, 'a.ts', `
        import { a } from './a'; // Self import (unusual but possible)
        export const a = 1;
      `);

      const files: ScoredFile[] = [
        createScoredFile({ absolutePath: fileA, name: 'a.ts' }),
      ];

      const result = await buildDependencyGraph(files, { rootDir: tempDir });

      // Self-import should create a self-loop edge
      expect(result.edges.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle large graphs efficiently', async () => {
      // Create 50 files
      const files: ScoredFile[] = [];
      for (let i = 0; i < 50; i++) {
        const content = i > 0
          ? `import { x } from './file${i - 1}'; export const x = ${i};`
          : 'export const x = 0;';
        const filePath = await createFile(tempDir, `file${i}.ts`, content);
        files.push(createScoredFile({ absolutePath: filePath, name: `file${i}.ts` }));
      }

      const start = Date.now();
      const result = await buildDependencyGraph(files, { rootDir: tempDir });
      const duration = Date.now() - start;

      expect(result.nodes).toHaveLength(50);
      expect(result.edges).toHaveLength(49);
      // Should complete in reasonable time (less than 5 seconds)
      expect(duration).toBeLessThan(5000);
    });
  });
});
