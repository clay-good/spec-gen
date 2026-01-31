/**
 * Tests for File Significance Scorer
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  SignificanceScorer,
  scoreFiles,
  getTopFiles,
  getFilesByTag,
  getFilesAboveThreshold,
  groupFilesByTag,
  buildFileRelationships,
} from './significance-scorer.js';
import type { FileMetadata, ScoredFile } from '../../types/index.js';

/**
 * Helper to create mock FileMetadata
 */
function createMockFile(overrides: Partial<FileMetadata> = {}): FileMetadata {
  const name = overrides.name ?? 'file.ts';
  const path = overrides.path ?? name;
  return {
    path,
    absolutePath: overrides.absolutePath ?? `/project/${path}`,
    name,
    extension: overrides.extension ?? '.ts',
    size: overrides.size ?? 1000,
    lines: overrides.lines ?? 100,
    depth: overrides.depth ?? 0,
    directory: overrides.directory ?? '',
    isEntryPoint: overrides.isEntryPoint ?? false,
    isConfig: overrides.isConfig ?? false,
    isTest: overrides.isTest ?? false,
    isGenerated: overrides.isGenerated ?? false,
  };
}

describe('SignificanceScorer', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `spec-gen-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('name-based scoring', () => {
    it('should give high scores to schema/model files', async () => {
      const schemaPath = join(testDir, 'schema.ts');
      await writeFile(schemaPath, 'export interface User {}');

      const file = createMockFile({
        name: 'schema.ts',
        path: 'schema.ts',
        absolutePath: schemaPath,
      });

      const scorer = new SignificanceScorer();
      const scored = await scorer.scoreFile(file);

      expect(scored.scoreBreakdown.name).toBe(25);
    });

    it('should give high scores to auth files', async () => {
      const authPath = join(testDir, 'authentication.ts');
      await writeFile(authPath, 'export function login() {}');

      const file = createMockFile({
        name: 'authentication.ts',
        path: 'authentication.ts',
        absolutePath: authPath,
      });

      const scorer = new SignificanceScorer();
      const scored = await scorer.scoreFile(file);

      expect(scored.scoreBreakdown.name).toBe(25);
    });

    it('should give high scores to API/routes files', async () => {
      const routesPath = join(testDir, 'routes.ts');
      await writeFile(routesPath, 'export const routes = [];');

      const file = createMockFile({
        name: 'routes.ts',
        path: 'routes.ts',
        absolutePath: routesPath,
      });

      const scorer = new SignificanceScorer();
      const scored = await scorer.scoreFile(file);

      expect(scored.scoreBreakdown.name).toBe(25);
    });

    it('should give medium scores to service files', async () => {
      const servicePath = join(testDir, 'user-service.ts');
      await writeFile(servicePath, 'export class UserService {}');

      const file = createMockFile({
        name: 'user-service.ts',
        path: 'user-service.ts',
        absolutePath: servicePath,
      });

      const scorer = new SignificanceScorer();
      const scored = await scorer.scoreFile(file);

      expect(scored.scoreBreakdown.name).toBe(15);
    });

    it('should give low scores to utils files', async () => {
      const utilsPath = join(testDir, 'utils.ts');
      await writeFile(utilsPath, 'export function helper() {}');

      const file = createMockFile({
        name: 'utils.ts',
        path: 'utils.ts',
        absolutePath: utilsPath,
      });

      const scorer = new SignificanceScorer();
      const scored = await scorer.scoreFile(file);

      expect(scored.scoreBreakdown.name).toBe(5);
    });

    it('should penalize test files', async () => {
      const testPath = join(testDir, 'app.test.ts');
      await writeFile(testPath, 'test("works", () => {});');

      const file = createMockFile({
        name: 'app.test.ts',
        path: 'app.test.ts',
        absolutePath: testPath,
        isTest: true,
      });

      const scorer = new SignificanceScorer();
      const scored = await scorer.scoreFile(file);

      // Name contains 'test' so should be penalized
      expect(scored.scoreBreakdown.name).toBe(0); // Clamped to 0
    });

    it('should penalize deprecated files', async () => {
      const deprecatedPath = join(testDir, 'old-api.deprecated.ts');
      await writeFile(deprecatedPath, '// old code');

      const file = createMockFile({
        name: 'old-api.deprecated.ts',
        path: 'old-api.deprecated.ts',
        absolutePath: deprecatedPath,
      });

      const scorer = new SignificanceScorer();
      const scored = await scorer.scoreFile(file);

      // Should have negative adjustments from both 'old' and 'deprecated'
      expect(scored.scoreBreakdown.name).toBe(0); // Clamped to 0
    });
  });

  describe('path-based scoring', () => {
    it('should give bonus to root directory files', async () => {
      const rootPath = join(testDir, 'main.ts');
      await writeFile(rootPath, 'console.log("main");');

      const file = createMockFile({
        name: 'main.ts',
        path: 'main.ts',
        absolutePath: rootPath,
        depth: 0,
      });

      const scorer = new SignificanceScorer();
      const scored = await scorer.scoreFile(file);

      expect(scored.scoreBreakdown.path).toBeGreaterThanOrEqual(15);
    });

    it('should give bonus to src/ files', async () => {
      await mkdir(join(testDir, 'src'));
      const srcPath = join(testDir, 'src', 'app.ts');
      await writeFile(srcPath, 'export const app = {};');

      const file = createMockFile({
        name: 'app.ts',
        path: 'src/app.ts',
        absolutePath: srcPath,
        depth: 1,
        directory: 'src',
      });

      const scorer = new SignificanceScorer();
      const scored = await scorer.scoreFile(file);

      expect(scored.scoreBreakdown.path).toBe(10);
    });

    it('should give bonus to core/ files', async () => {
      await mkdir(join(testDir, 'core'));
      const corePath = join(testDir, 'core', 'domain.ts');
      await writeFile(corePath, 'export class Domain {}');

      const file = createMockFile({
        name: 'domain.ts',
        path: 'core/domain.ts',
        absolutePath: corePath,
        depth: 1,
        directory: 'core',
      });

      const scorer = new SignificanceScorer();
      const scored = await scorer.scoreFile(file);

      expect(scored.scoreBreakdown.path).toBe(15);
    });

    it('should penalize deeply nested files', async () => {
      await mkdir(join(testDir, 'a', 'b', 'c', 'd', 'e', 'f'), { recursive: true });
      const deepPath = join(testDir, 'a', 'b', 'c', 'd', 'e', 'f', 'deep.ts');
      await writeFile(deepPath, '// deep file');

      const file = createMockFile({
        name: 'deep.ts',
        path: 'a/b/c/d/e/f/deep.ts',
        absolutePath: deepPath,
        depth: 6,
        directory: 'a/b/c/d/e/f',
      });

      const scorer = new SignificanceScorer();
      const scored = await scorer.scoreFile(file);

      expect(scored.scoreBreakdown.path).toBe(0); // Penalized and clamped
    });
  });

  describe('structure-based scoring', () => {
    it('should give bonus for class definitions', async () => {
      const classPath = join(testDir, 'service.ts');
      await writeFile(classPath, 'export class UserService {\n  getUser() {}\n}');

      const file = createMockFile({
        name: 'service.ts',
        path: 'service.ts',
        absolutePath: classPath,
        lines: 100,
      });

      const scorer = new SignificanceScorer();
      const scored = await scorer.scoreFile(file);

      // Class (+10) + Export (+5) + Sweet spot lines (+5) = 20
      expect(scored.scoreBreakdown.structure).toBeGreaterThanOrEqual(15);
    });

    it('should give bonus for interface definitions', async () => {
      const typesPath = join(testDir, 'types.ts');
      await writeFile(typesPath, 'export interface User {\n  id: string;\n  name: string;\n}');

      const file = createMockFile({
        name: 'types.ts',
        path: 'types.ts',
        absolutePath: typesPath,
        lines: 100,
      });

      const scorer = new SignificanceScorer();
      const scored = await scorer.scoreFile(file);

      // Interface (+15) + Export (+5) + Sweet spot lines (+5) = 25
      expect(scored.scoreBreakdown.structure).toBe(25);
    });

    it('should give bonus for decorators', async () => {
      const decoratorPath = join(testDir, 'controller.ts');
      await writeFile(
        decoratorPath,
        '@Controller("users")\nexport class UserController {\n  @Get()\n  getUsers() {}\n}'
      );

      const file = createMockFile({
        name: 'controller.ts',
        path: 'controller.ts',
        absolutePath: decoratorPath,
        lines: 100,
      });

      const scorer = new SignificanceScorer();
      const scored = await scorer.scoreFile(file);

      // Should include decorator bonus
      expect(scored.scoreBreakdown.structure).toBeGreaterThanOrEqual(15);
    });

    it('should penalize very long files', async () => {
      const longPath = join(testDir, 'data.ts');
      const longContent = 'export const data = [\n' + '  {},\n'.repeat(1500) + '];';
      await writeFile(longPath, longContent);

      const file = createMockFile({
        name: 'data.ts',
        path: 'data.ts',
        absolutePath: longPath,
        lines: 1502,
      });

      const scorer = new SignificanceScorer();
      const scored = await scorer.scoreFile(file);

      // Export (+5) - Long file (-5) = 0
      expect(scored.scoreBreakdown.structure).toBeLessThanOrEqual(5);
    });

    it('should give bonus for files with many imports', async () => {
      const manyImportsPath = join(testDir, 'aggregator.ts');
      const imports = Array.from(
        { length: 15 },
        (_, i) => `import { mod${i} } from './mod${i}';`
      ).join('\n');
      await writeFile(manyImportsPath, imports + '\nexport const all = {};');

      const file = createMockFile({
        name: 'aggregator.ts',
        path: 'aggregator.ts',
        absolutePath: manyImportsPath,
        lines: 100,
      });

      const scorer = new SignificanceScorer();
      const scored = await scorer.scoreFile(file);

      // Many imports (+10) + Export (+5) + Sweet spot (+5) = 20
      expect(scored.scoreBreakdown.structure).toBeGreaterThanOrEqual(15);
    });
  });

  describe('tagging', () => {
    it('should add entry-point tag', async () => {
      const entryPath = join(testDir, 'index.ts');
      await writeFile(entryPath, 'export * from "./app";');

      const file = createMockFile({
        name: 'index.ts',
        path: 'index.ts',
        absolutePath: entryPath,
        isEntryPoint: true,
      });

      const scorer = new SignificanceScorer();
      const scored = await scorer.scoreFile(file);

      expect(scored.tags).toContain('entry-point');
    });

    it('should add config tag', async () => {
      const configPath = join(testDir, 'config.ts');
      await writeFile(configPath, 'export const config = {};');

      const file = createMockFile({
        name: 'config.ts',
        path: 'config.ts',
        absolutePath: configPath,
        isConfig: true,
      });

      const scorer = new SignificanceScorer();
      const scored = await scorer.scoreFile(file);

      expect(scored.tags).toContain('config');
    });

    it('should add test tag', async () => {
      const testPath = join(testDir, 'app.test.ts');
      await writeFile(testPath, 'test("works", () => {});');

      const file = createMockFile({
        name: 'app.test.ts',
        path: 'app.test.ts',
        absolutePath: testPath,
        isTest: true,
      });

      const scorer = new SignificanceScorer();
      const scored = await scorer.scoreFile(file);

      expect(scored.tags).toContain('test');
    });

    it('should add schema tag for schema files', async () => {
      const schemaPath = join(testDir, 'user.schema.ts');
      await writeFile(schemaPath, 'export const userSchema = {};');

      const file = createMockFile({
        name: 'user.schema.ts',
        path: 'user.schema.ts',
        absolutePath: schemaPath,
      });

      const scorer = new SignificanceScorer();
      const scored = await scorer.scoreFile(file);

      expect(scored.tags).toContain('schema');
    });

    it('should add api tag for route files', async () => {
      const routePath = join(testDir, 'user.routes.ts');
      await writeFile(routePath, 'export const routes = [];');

      const file = createMockFile({
        name: 'user.routes.ts',
        path: 'user.routes.ts',
        absolutePath: routePath,
      });

      const scorer = new SignificanceScorer();
      const scored = await scorer.scoreFile(file);

      expect(scored.tags).toContain('api');
    });

    it('should add service tag for service files', async () => {
      const servicePath = join(testDir, 'user.service.ts');
      await writeFile(servicePath, 'export class UserService {}');

      const file = createMockFile({
        name: 'user.service.ts',
        path: 'user.service.ts',
        absolutePath: servicePath,
      });

      const scorer = new SignificanceScorer();
      const scored = await scorer.scoreFile(file);

      expect(scored.tags).toContain('service');
    });

    it('should add high-value-name tag for high-scoring names', async () => {
      const authPath = join(testDir, 'authentication.ts');
      await writeFile(authPath, 'export function authenticate() {}');

      const file = createMockFile({
        name: 'authentication.ts',
        path: 'authentication.ts',
        absolutePath: authPath,
      });

      const scorer = new SignificanceScorer();
      const scored = await scorer.scoreFile(file);

      expect(scored.tags).toContain('high-value-name');
    });
  });

  describe('scoreFiles', () => {
    it('should score multiple files and sort by score', async () => {
      // Create files with different significance
      const schemaPath = join(testDir, 'schema.ts');
      const utilsPath = join(testDir, 'utils.ts');
      const testPath = join(testDir, 'app.test.ts');

      await writeFile(schemaPath, 'export interface User {}');
      await writeFile(utilsPath, 'export function helper() {}');
      await writeFile(testPath, 'test("x", () => {});');

      const files: FileMetadata[] = [
        createMockFile({ name: 'utils.ts', path: 'utils.ts', absolutePath: utilsPath }),
        createMockFile({ name: 'schema.ts', path: 'schema.ts', absolutePath: schemaPath }),
        createMockFile({ name: 'app.test.ts', path: 'app.test.ts', absolutePath: testPath, isTest: true }),
      ];

      const scored = await scoreFiles(files);

      // Should be sorted by score descending
      expect(scored[0].name).toBe('schema.ts');
      expect(scored[scored.length - 1].isTest).toBe(true);
    });

    it('should respect minScore config', async () => {
      const highPath = join(testDir, 'authentication.ts');
      const lowPath = join(testDir, 'random.ts');

      await writeFile(highPath, 'export class AuthService {}');
      await writeFile(lowPath, '// low value file with no significance');

      const files: FileMetadata[] = [
        createMockFile({ name: 'authentication.ts', path: 'authentication.ts', absolutePath: highPath }),
        createMockFile({ name: 'random.ts', path: 'random.ts', absolutePath: lowPath, depth: 5 }),
      ];

      const scored = await scoreFiles(files, { minScore: 30 });

      // Only high-scoring file should be included (auth name = 25, class = 10, export = 5, root = 15)
      // random.ts has low score (root = 15, but depth 5 penalty, no structure points)
      expect(scored.length).toBe(1);
      expect(scored[0].name).toBe('authentication.ts');
    });
  });

  describe('utility functions', () => {
    it('getTopFiles should return top N files', () => {
      const files: ScoredFile[] = [
        { ...createMockFile({ name: 'a.ts' }), score: 50, scoreBreakdown: { name: 10, path: 10, structure: 10, connectivity: 20 }, tags: [] },
        { ...createMockFile({ name: 'b.ts' }), score: 80, scoreBreakdown: { name: 20, path: 20, structure: 20, connectivity: 20 }, tags: [] },
        { ...createMockFile({ name: 'c.ts' }), score: 30, scoreBreakdown: { name: 5, path: 5, structure: 10, connectivity: 10 }, tags: [] },
        { ...createMockFile({ name: 'd.ts' }), score: 70, scoreBreakdown: { name: 15, path: 15, structure: 20, connectivity: 20 }, tags: [] },
      ];

      const top2 = getTopFiles(files, 2);

      expect(top2).toHaveLength(2);
      expect(top2[0].name).toBe('b.ts');
      expect(top2[1].name).toBe('d.ts');
    });

    it('getFilesByTag should filter by tag', () => {
      const files: ScoredFile[] = [
        { ...createMockFile({ name: 'a.ts' }), score: 50, scoreBreakdown: { name: 10, path: 10, structure: 10, connectivity: 20 }, tags: ['api', 'service'] },
        { ...createMockFile({ name: 'b.ts' }), score: 80, scoreBreakdown: { name: 20, path: 20, structure: 20, connectivity: 20 }, tags: ['schema'] },
        { ...createMockFile({ name: 'c.ts' }), score: 30, scoreBreakdown: { name: 5, path: 5, structure: 10, connectivity: 10 }, tags: ['api'] },
      ];

      const apiFiles = getFilesByTag(files, 'api');

      expect(apiFiles).toHaveLength(2);
      expect(apiFiles.map((f) => f.name)).toContain('a.ts');
      expect(apiFiles.map((f) => f.name)).toContain('c.ts');
    });

    it('getFilesAboveThreshold should filter by score', () => {
      const files: ScoredFile[] = [
        { ...createMockFile({ name: 'a.ts' }), score: 50, scoreBreakdown: { name: 10, path: 10, structure: 10, connectivity: 20 }, tags: [] },
        { ...createMockFile({ name: 'b.ts' }), score: 80, scoreBreakdown: { name: 20, path: 20, structure: 20, connectivity: 20 }, tags: [] },
        { ...createMockFile({ name: 'c.ts' }), score: 30, scoreBreakdown: { name: 5, path: 5, structure: 10, connectivity: 10 }, tags: [] },
      ];

      const highScoring = getFilesAboveThreshold(files, 50);

      expect(highScoring).toHaveLength(2);
      expect(highScoring.map((f) => f.name)).toContain('a.ts');
      expect(highScoring.map((f) => f.name)).toContain('b.ts');
    });

    it('groupFilesByTag should group files', () => {
      const files: ScoredFile[] = [
        { ...createMockFile({ name: 'a.ts' }), score: 50, scoreBreakdown: { name: 10, path: 10, structure: 10, connectivity: 20 }, tags: ['api', 'service'] },
        { ...createMockFile({ name: 'b.ts' }), score: 80, scoreBreakdown: { name: 20, path: 20, structure: 20, connectivity: 20 }, tags: ['schema'] },
        { ...createMockFile({ name: 'c.ts' }), score: 30, scoreBreakdown: { name: 5, path: 5, structure: 10, connectivity: 10 }, tags: ['api'] },
      ];

      const groups = groupFilesByTag(files);

      expect(groups.get('api')).toHaveLength(2);
      expect(groups.get('schema')).toHaveLength(1);
      expect(groups.get('service')).toHaveLength(1);
    });
  });

  describe('custom scoring config', () => {
    it('should use custom high-value names', async () => {
      const customPath = join(testDir, 'graphql.ts');
      await writeFile(customPath, 'export const schema = {};');

      const file = createMockFile({
        name: 'graphql.ts',
        path: 'graphql.ts',
        absolutePath: customPath,
      });

      const scorer = new SignificanceScorer({
        highValueNames: { graphql: 30 },
      });
      const scored = await scorer.scoreFile(file);

      expect(scored.scoreBreakdown.name).toBe(30);
    });

    it('should use custom high-value paths', async () => {
      await mkdir(join(testDir, 'graphql'));
      const customPath = join(testDir, 'graphql', 'resolvers.ts');
      await writeFile(customPath, 'export const resolvers = {};');

      const file = createMockFile({
        name: 'resolvers.ts',
        path: 'graphql/resolvers.ts',
        absolutePath: customPath,
        depth: 1,
        directory: 'graphql',
      });

      const scorer = new SignificanceScorer({
        highValuePaths: { 'graphql/': 20 },
      });
      const scored = await scorer.scoreFile(file);

      expect(scored.scoreBreakdown.path).toBe(20);
    });
  });

  describe('realistic project structures', () => {
    it('should correctly score an Express API structure', async () => {
      // Create Express-like structure
      await mkdir(join(testDir, 'src', 'routes'), { recursive: true });
      await mkdir(join(testDir, 'src', 'controllers'));
      await mkdir(join(testDir, 'src', 'models'));
      await mkdir(join(testDir, 'src', 'middleware'));
      await mkdir(join(testDir, 'tests'));

      const files: { path: string; content: string }[] = [
        { path: 'src/app.ts', content: 'import express from "express";\nexport const app = express();' },
        { path: 'src/routes/users.ts', content: 'import { Router } from "express";\nexport const router = Router();' },
        { path: 'src/controllers/userController.ts', content: 'export class UserController {\n  getUsers() {}\n}' },
        { path: 'src/models/User.ts', content: 'export interface User {\n  id: string;\n  name: string;\n}' },
        { path: 'src/middleware/auth.ts', content: 'export function authMiddleware(req, res, next) {}' },
        { path: 'tests/users.test.ts', content: 'test("users", () => {});' },
      ];

      const fileMetadata: FileMetadata[] = [];

      for (const f of files) {
        const fullPath = join(testDir, f.path);
        await mkdir(join(fullPath, '..'), { recursive: true });
        await writeFile(fullPath, f.content);

        const parts = f.path.split('/');
        fileMetadata.push(
          createMockFile({
            name: parts[parts.length - 1],
            path: f.path,
            absolutePath: fullPath,
            depth: parts.length - 1,
            directory: parts.slice(0, -1).join('/'),
            isTest: f.path.includes('test'),
          })
        );
      }

      const scored = await scoreFiles(fileMetadata);

      // Models and controllers should score highest
      const modelFile = scored.find((f) => f.name === 'User.ts');
      const controllerFile = scored.find((f) => f.name === 'userController.ts');
      const testFile = scored.find((f) => f.name === 'users.test.ts');

      expect(modelFile!.score).toBeGreaterThan(testFile!.score);
      expect(controllerFile!.score).toBeGreaterThan(testFile!.score);
    });
  });
});
