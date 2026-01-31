/**
 * Tests for gitignore-manager service
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  gitignoreExists,
  readGitignore,
  isInGitignore,
  addToGitignore,
  createGitignore,
} from './gitignore-manager.js';

describe('gitignore-manager', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `spec-gen-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('gitignoreExists', () => {
    it('should return false when .gitignore does not exist', async () => {
      const result = await gitignoreExists(testDir);
      expect(result).toBe(false);
    });

    it('should return true when .gitignore exists', async () => {
      await writeFile(join(testDir, '.gitignore'), '');

      const result = await gitignoreExists(testDir);
      expect(result).toBe(true);
    });
  });

  describe('readGitignore', () => {
    it('should return null when .gitignore does not exist', async () => {
      const result = await readGitignore(testDir);
      expect(result).toBe(null);
    });

    it('should return content when .gitignore exists', async () => {
      await writeFile(join(testDir, '.gitignore'), 'node_modules/\n.env\n');

      const result = await readGitignore(testDir);
      expect(result).toBe('node_modules/\n.env\n');
    });
  });

  describe('isInGitignore', () => {
    it('should return false when .gitignore does not exist', async () => {
      const result = await isInGitignore(testDir, 'node_modules/');
      expect(result).toBe(false);
    });

    it('should return true when entry exists', async () => {
      await writeFile(join(testDir, '.gitignore'), 'node_modules/\n.env\n');

      const result = await isInGitignore(testDir, 'node_modules/');
      expect(result).toBe(true);
    });

    it('should return false when entry does not exist', async () => {
      await writeFile(join(testDir, '.gitignore'), 'node_modules/\n.env\n');

      const result = await isInGitignore(testDir, '.spec-gen/');
      expect(result).toBe(false);
    });

    it('should match entries with different trailing slashes', async () => {
      await writeFile(join(testDir, '.gitignore'), 'node_modules\n');

      // Should match even with trailing slash
      const result = await isInGitignore(testDir, 'node_modules/');
      expect(result).toBe(true);
    });

    it('should ignore comments', async () => {
      await writeFile(join(testDir, '.gitignore'), '# node_modules/\n.env\n');

      const result = await isInGitignore(testDir, 'node_modules/');
      expect(result).toBe(false);
    });

    it('should ignore empty lines', async () => {
      await writeFile(join(testDir, '.gitignore'), '\n\nnode_modules/\n\n');

      const result = await isInGitignore(testDir, 'node_modules/');
      expect(result).toBe(true);
    });
  });

  describe('addToGitignore', () => {
    it('should add entry to existing .gitignore', async () => {
      await writeFile(join(testDir, '.gitignore'), 'node_modules/\n');

      const result = await addToGitignore(testDir, '.spec-gen/');
      expect(result).toBe(true);

      const content = await readFile(join(testDir, '.gitignore'), 'utf-8');
      expect(content).toContain('.spec-gen/');
      expect(content).toContain('node_modules/');
    });

    it('should add entry with comment', async () => {
      await writeFile(join(testDir, '.gitignore'), 'node_modules/\n');

      await addToGitignore(testDir, '.spec-gen/', 'spec-gen analysis artifacts');

      const content = await readFile(join(testDir, '.gitignore'), 'utf-8');
      expect(content).toContain('# spec-gen analysis artifacts');
      expect(content).toContain('.spec-gen/');
    });

    it('should return false if entry already exists', async () => {
      await writeFile(join(testDir, '.gitignore'), '.spec-gen/\n');

      const result = await addToGitignore(testDir, '.spec-gen/');
      expect(result).toBe(false);
    });

    it('should create .gitignore if it does not exist', async () => {
      const result = await addToGitignore(testDir, '.spec-gen/');
      expect(result).toBe(true);

      const content = await readFile(join(testDir, '.gitignore'), 'utf-8');
      expect(content).toContain('.spec-gen/');
    });

    it('should ensure newline before adding entry', async () => {
      await writeFile(join(testDir, '.gitignore'), 'node_modules/'); // No trailing newline

      await addToGitignore(testDir, '.spec-gen/');

      const content = await readFile(join(testDir, '.gitignore'), 'utf-8');
      expect(content).toContain('node_modules/\n');
      expect(content).toContain('.spec-gen/\n');
    });
  });

  describe('createGitignore', () => {
    it('should create .gitignore with entries', async () => {
      await createGitignore(testDir, [
        { entry: 'node_modules/', comment: 'Dependencies' },
        { entry: '.env' },
        { entry: 'dist/', comment: 'Build output' },
      ]);

      const content = await readFile(join(testDir, '.gitignore'), 'utf-8');
      expect(content).toContain('# Dependencies');
      expect(content).toContain('node_modules/');
      expect(content).toContain('.env');
      expect(content).toContain('# Build output');
      expect(content).toContain('dist/');
    });

    it('should create empty .gitignore with no entries', async () => {
      await createGitignore(testDir, []);

      const content = await readFile(join(testDir, '.gitignore'), 'utf-8');
      expect(content).toBe('');
    });
  });
});
