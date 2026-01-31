/**
 * Project type detection service
 *
 * Detects the project type by checking for language-specific manifest files.
 */

import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProjectType } from '../../types/index.js';

/**
 * Project detection result
 */
export interface ProjectDetectionResult {
  projectType: ProjectType;
  manifestFile: string | null;
  hasGit: boolean;
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Manifest file to project type mapping
 */
const MANIFEST_MAP: { file: string; type: ProjectType; priority: number }[] = [
  { file: 'package.json', type: 'nodejs', priority: 1 },
  { file: 'pyproject.toml', type: 'python', priority: 1 },
  { file: 'setup.py', type: 'python', priority: 2 },
  { file: 'requirements.txt', type: 'python', priority: 3 },
  { file: 'Cargo.toml', type: 'rust', priority: 1 },
  { file: 'go.mod', type: 'go', priority: 1 },
  { file: 'pom.xml', type: 'java', priority: 1 },
  { file: 'build.gradle', type: 'java', priority: 2 },
  { file: 'build.gradle.kts', type: 'java', priority: 2 },
  { file: 'Gemfile', type: 'ruby', priority: 1 },
  { file: 'composer.json', type: 'php', priority: 1 },
];

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
 * Detect if the directory is a git repository
 */
export async function detectGitRepository(rootPath: string): Promise<boolean> {
  return fileExists(join(rootPath, '.git'));
}

/**
 * Detect the project type based on manifest files
 */
export async function detectProjectType(rootPath: string): Promise<ProjectDetectionResult> {
  const hasGit = await detectGitRepository(rootPath);

  // Check each manifest file
  const detectedManifests: { file: string; type: ProjectType; priority: number }[] = [];

  for (const manifest of MANIFEST_MAP) {
    if (await fileExists(join(rootPath, manifest.file))) {
      detectedManifests.push(manifest);
    }
  }

  // No manifests found
  if (detectedManifests.length === 0) {
    return {
      projectType: 'unknown',
      manifestFile: null,
      hasGit,
      confidence: 'low',
    };
  }

  // Sort by priority (lower is better) and pick the first
  detectedManifests.sort((a, b) => a.priority - b.priority);
  const primary = detectedManifests[0];

  // Determine confidence based on detection
  let confidence: 'high' | 'medium' | 'low' = 'high';
  if (detectedManifests.length > 1) {
    // Multiple project types detected
    const uniqueTypes = new Set(detectedManifests.map((m) => m.type));
    if (uniqueTypes.size > 1) {
      confidence = 'medium';
    }
  }

  return {
    projectType: primary.type,
    manifestFile: primary.file,
    hasGit,
    confidence,
  };
}

/**
 * Get a human-readable project type name
 */
export function getProjectTypeName(type: ProjectType): string {
  const names: Record<ProjectType, string> = {
    nodejs: 'Node.js/TypeScript',
    python: 'Python',
    rust: 'Rust',
    go: 'Go',
    java: 'Java',
    ruby: 'Ruby',
    php: 'PHP',
    unknown: 'Unknown',
  };
  return names[type];
}

/**
 * Read and parse package.json if it exists
 */
export async function readPackageJson(
  rootPath: string
): Promise<Record<string, unknown> | null> {
  const packagePath = join(rootPath, 'package.json');
  try {
    const content = await readFile(packagePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}
