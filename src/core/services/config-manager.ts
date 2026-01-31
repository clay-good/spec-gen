/**
 * Configuration management service
 *
 * Handles reading/writing .spec-gen/config.json and openspec/config.yaml
 */

import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import YAML from 'yaml';
import type { ProjectType, SpecGenConfig } from '../../types/index.js';

/**
 * OpenSpec config.yaml structure
 */
export interface OpenSpecConfig {
  schema?: string;
  context?: string;
  'spec-gen'?: {
    generatedAt?: string;
    domains?: string[];
    confidence?: number;
    sourceProject?: string;
  };
  [key: string]: unknown;
}

/**
 * Check if a file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure directory exists, creating it if necessary
 */
async function ensureDir(dirPath: string): Promise<void> {
  try {
    await mkdir(dirPath, { recursive: true });
  } catch (error) {
    // Ignore if directory already exists
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error;
    }
  }
}

/**
 * Get default spec-gen configuration
 */
export function getDefaultConfig(projectType: ProjectType, openspecPath: string): SpecGenConfig {
  return {
    version: '1.0.0',
    projectType,
    openspecPath,
    analysis: {
      maxFiles: 500,
      includePatterns: [],
      excludePatterns: [],
    },
    generation: {
      model: 'claude-sonnet-4-20250514',
      domains: 'auto',
    },
    createdAt: new Date().toISOString(),
    lastRun: null,
  };
}

/**
 * Read spec-gen configuration from .spec-gen/config.json
 */
export async function readSpecGenConfig(rootPath: string): Promise<SpecGenConfig | null> {
  const configPath = join(rootPath, '.spec-gen', 'config.json');
  try {
    const content = await readFile(configPath, 'utf-8');
    return JSON.parse(content) as SpecGenConfig;
  } catch {
    return null;
  }
}

/**
 * Write spec-gen configuration to .spec-gen/config.json
 */
export async function writeSpecGenConfig(
  rootPath: string,
  config: SpecGenConfig
): Promise<void> {
  const configDir = join(rootPath, '.spec-gen');
  const configPath = join(configDir, 'config.json');

  await ensureDir(configDir);
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

/**
 * Check if spec-gen config already exists
 */
export async function specGenConfigExists(rootPath: string): Promise<boolean> {
  return fileExists(join(rootPath, '.spec-gen', 'config.json'));
}

/**
 * Read OpenSpec config.yaml if it exists
 */
export async function readOpenSpecConfig(openspecPath: string): Promise<OpenSpecConfig | null> {
  const configPath = join(openspecPath, 'config.yaml');
  try {
    const content = await readFile(configPath, 'utf-8');
    return YAML.parse(content) as OpenSpecConfig;
  } catch {
    return null;
  }
}

/**
 * Write OpenSpec config.yaml
 */
export async function writeOpenSpecConfig(
  openspecPath: string,
  config: OpenSpecConfig
): Promise<void> {
  const configPath = join(openspecPath, 'config.yaml');

  await ensureDir(openspecPath);
  await writeFile(configPath, YAML.stringify(config), 'utf-8');
}

/**
 * Check if openspec directory exists
 */
export async function openspecDirExists(openspecPath: string): Promise<boolean> {
  return fileExists(openspecPath);
}

/**
 * Check if openspec/config.yaml exists
 */
export async function openspecConfigExists(openspecPath: string): Promise<boolean> {
  return fileExists(join(openspecPath, 'config.yaml'));
}

/**
 * Create minimal OpenSpec directory structure
 */
export async function createOpenSpecStructure(openspecPath: string): Promise<void> {
  await ensureDir(openspecPath);
  await ensureDir(join(openspecPath, 'specs'));
}

/**
 * Merge existing OpenSpec config with spec-gen metadata
 */
export function mergeOpenSpecConfig(
  existing: OpenSpecConfig | null,
  specGenMeta: OpenSpecConfig['spec-gen']
): OpenSpecConfig {
  if (existing) {
    return {
      ...existing,
      'spec-gen': {
        ...existing['spec-gen'],
        ...specGenMeta,
      },
    };
  }

  return {
    schema: 'spec-driven',
    context: '',
    'spec-gen': specGenMeta,
  };
}
