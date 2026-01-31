/**
 * File Significance Scorer
 *
 * Ranks files by their likely importance to understanding system architecture.
 * This determines what gets sent to the LLM and what gets skipped.
 *
 * Scoring algorithm: 0-100 points per file
 * - Name-based scoring: 0-30 points
 * - Path-based scoring: 0-25 points
 * - Structure-based scoring: 0-25 points
 * - Connectivity scoring: 0-20 points
 */

import { readFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import type { FileMetadata, ScoredFile } from '../../types/index.js';

/**
 * Configuration for custom scoring rules
 */
export interface ScoringConfig {
  /** Custom high-value name patterns with scores */
  highValueNames?: Record<string, number>;
  /** Custom negative name patterns with scores */
  negativeNames?: Record<string, number>;
  /** Custom high-value path patterns with scores */
  highValuePaths?: Record<string, number>;
  /** Minimum score to include in results */
  minScore?: number;
}

/**
 * Import/export relationship for connectivity scoring
 */
export interface FileRelationship {
  filePath: string;
  imports: string[];
  importedBy: string[];
}

// ============================================================================
// NAME-BASED SCORING (0-30 points)
// ============================================================================

const HIGH_VALUE_NAMES: Record<string, number> = {
  // Schema/model files (+25)
  schema: 25,
  model: 25,
  entity: 25,
  types: 25,
  interfaces: 25,
  // Auth files (+25)
  auth: 25,
  authentication: 25,
  authorization: 25,
  // API files (+25)
  api: 25,
  routes: 25,
  endpoints: 25,
  controller: 25,
  controllers: 25,
  // Database files (+25)
  database: 25,
  db: 25,
  repository: 25,
  store: 25,
  // Config files (+20)
  config: 20,
  configuration: 20,
  settings: 20,
  // Middleware (+20)
  middleware: 20,
  interceptor: 20,
  guard: 20,
  // Services (+15)
  service: 15,
  provider: 15,
  manager: 15,
  // Utilities (+5)
  utils: 5,
  util: 5,
  helpers: 5,
  helper: 5,
  common: 5,
};

const NEGATIVE_NAMES: Record<string, number> = {
  // Test files (-10)
  test: -10,
  spec: -10,
  mock: -10,
  stub: -10,
  fake: -10,
  // Fixtures (-10)
  fixture: -10,
  fixtures: -10,
  snapshot: -10,
  snapshots: -10,
  // Examples (-5)
  example: -5,
  examples: -5,
  sample: -5,
  samples: -5,
  demo: -5,
  // Deprecated (-15)
  backup: -15,
  old: -15,
  deprecated: -15,
  legacy: -15,
};

/**
 * Calculate name-based score for a file
 */
function calculateNameScore(fileName: string, config?: ScoringConfig): number {
  const nameLower = fileName.toLowerCase();
  const nameWithoutExt = basename(nameLower, nameLower.substring(nameLower.lastIndexOf('.')));

  let score = 0;

  // Check high-value names
  const highValueNames = { ...HIGH_VALUE_NAMES, ...config?.highValueNames };
  for (const [pattern, points] of Object.entries(highValueNames)) {
    if (nameWithoutExt.includes(pattern)) {
      score = Math.max(score, points);
    }
  }

  // Check negative names
  const negativeNames = { ...NEGATIVE_NAMES, ...config?.negativeNames };
  for (const [pattern, points] of Object.entries(negativeNames)) {
    if (nameWithoutExt.includes(pattern)) {
      score += points; // Negative values
    }
  }

  // Clamp to valid range
  return Math.max(0, Math.min(30, score));
}

// ============================================================================
// PATH-BASED SCORING (0-25 points)
// ============================================================================

const HIGH_VALUE_PATHS: Record<string, number> = {
  'src/': 10,
  'lib/': 10,
  'core/': 15,
  'domain/': 15,
  'models/': 15,
  'api/': 15,
  'routes/': 15,
  'controllers/': 15,
  'config/': 10,
  'configs/': 10,
  'services/': 10,
  'schemas/': 15,
};

/**
 * Calculate path-based score for a file
 */
function calculatePathScore(
  relativePath: string,
  depth: number,
  config?: ScoringConfig
): number {
  let score = 0;

  // Root directory bonus
  if (depth === 0) {
    score += 15;
  }

  // Check high-value paths
  const highValuePaths = { ...HIGH_VALUE_PATHS, ...config?.highValuePaths };
  for (const [pattern, points] of Object.entries(highValuePaths)) {
    if (relativePath.startsWith(pattern) || relativePath.includes('/' + pattern)) {
      score = Math.max(score, points);
    }
  }

  // Penalty for deeply nested files
  if (depth > 5) {
    score -= 10;
  }

  // Penalty for deeply nested utils/helpers
  const pathLower = relativePath.toLowerCase();
  if ((pathLower.includes('utils/') || pathLower.includes('helpers/')) && depth > 3) {
    score -= 5;
  }

  // Clamp to valid range
  return Math.max(0, Math.min(25, score));
}

// ============================================================================
// STRUCTURE-BASED SCORING (0-25 points)
// ============================================================================

/**
 * Quick content analysis patterns
 */
const STRUCTURE_PATTERNS = {
  hasClass: /\bclass\s+\w+/,
  hasInterface: /\b(interface|type)\s+\w+\s*[={<]/,
  hasExport: /\bexport\s+(default\s+)?(class|function|const|let|var|interface|type|enum)/,
  hasDecorator: /@\w+\s*\(/,
  importStatement: /\bimport\s+.*from\s+['"][^'"]+['"]/g,
};

/**
 * Calculate structure-based score from file content
 */
async function calculateStructureScore(
  absolutePath: string,
  lines: number
): Promise<number> {
  let score = 0;

  try {
    const content = await readFile(absolutePath, 'utf-8');

    // Has class definitions (+10)
    if (STRUCTURE_PATTERNS.hasClass.test(content)) {
      score += 10;
    }

    // Has interface/type definitions (+15)
    if (STRUCTURE_PATTERNS.hasInterface.test(content)) {
      score += 15;
    }

    // Has export statements (+5)
    if (STRUCTURE_PATTERNS.hasExport.test(content)) {
      score += 5;
    }

    // Has decorators (+15)
    if (STRUCTURE_PATTERNS.hasDecorator.test(content)) {
      score += 15;
    }

    // Count import statements
    const imports = content.match(STRUCTURE_PATTERNS.importStatement);
    if (imports && imports.length > 10) {
      score += 10; // Many imports = integration point
    }

    // File size scoring
    if (lines >= 50 && lines <= 500) {
      score += 5; // Sweet spot
    } else if (lines > 1000) {
      score -= 5; // Probably generated or data file
    }
  } catch {
    // File read error, return 0 for structure score
    return 0;
  }

  // Clamp to valid range
  return Math.max(0, Math.min(25, score));
}

// ============================================================================
// CONNECTIVITY SCORING (0-20 points)
// ============================================================================

/**
 * Build file relationships from import analysis
 */
export function buildFileRelationships(files: FileMetadata[]): Map<string, FileRelationship> {
  const relationships = new Map<string, FileRelationship>();

  // Initialize all files
  for (const file of files) {
    relationships.set(file.path, {
      filePath: file.path,
      imports: [],
      importedBy: [],
    });
  }

  return relationships;
}

/**
 * Calculate connectivity score based on import relationships
 */
function calculateConnectivityScore(
  filePath: string,
  relationships: Map<string, FileRelationship>
): number {
  const rel = relationships.get(filePath);
  if (!rel) {
    return 0;
  }

  let score = 0;

  // Imported by many files
  const importedByCount = rel.importedBy.length;
  if (importedByCount >= 5) {
    score += 20;
  } else if (importedByCount >= 2) {
    score += 10;
  }

  // Imports many local files
  const importsCount = rel.imports.length;
  if (importsCount >= 5) {
    score += 10;
  }

  // Orphan penalty
  if (importsCount === 0 && importedByCount === 0) {
    score -= 10;
  }

  // Clamp to valid range
  return Math.max(0, Math.min(20, score));
}

// ============================================================================
// TAGGING
// ============================================================================

/**
 * Generate tags for a scored file
 */
function generateTags(
  file: FileMetadata,
  scoreBreakdown: ScoredFile['scoreBreakdown']
): string[] {
  const tags: string[] = [];

  // Entry point tag
  if (file.isEntryPoint) {
    tags.push('entry-point');
  }

  // Config tag
  if (file.isConfig) {
    tags.push('config');
  }

  // Test tag
  if (file.isTest) {
    tags.push('test');
  }

  // Generated tag
  if (file.isGenerated) {
    tags.push('generated');
  }

  // Schema/model tag
  const nameLower = file.name.toLowerCase();
  if (
    nameLower.includes('schema') ||
    nameLower.includes('model') ||
    nameLower.includes('entity')
  ) {
    tags.push('schema');
  }

  // API/route tag
  if (
    nameLower.includes('api') ||
    nameLower.includes('route') ||
    nameLower.includes('controller')
  ) {
    tags.push('api');
  }

  // Service tag
  if (nameLower.includes('service') || nameLower.includes('provider')) {
    tags.push('service');
  }

  // High name score tag
  if (scoreBreakdown.name >= 20) {
    tags.push('high-value-name');
  }

  // High connectivity tag
  if (scoreBreakdown.connectivity >= 15) {
    tags.push('high-connectivity');
  }

  return tags;
}

// ============================================================================
// MAIN SCORER CLASS
// ============================================================================

/**
 * File Significance Scorer
 */
export class SignificanceScorer {
  private config: ScoringConfig;
  private relationships: Map<string, FileRelationship>;

  constructor(config: ScoringConfig = {}) {
    this.config = config;
    this.relationships = new Map();
  }

  /**
   * Set file relationships for connectivity scoring
   */
  setRelationships(relationships: Map<string, FileRelationship>): void {
    this.relationships = relationships;
  }

  /**
   * Score a single file
   */
  async scoreFile(file: FileMetadata): Promise<ScoredFile> {
    const nameScore = calculateNameScore(file.name, this.config);
    const pathScore = calculatePathScore(file.path, file.depth, this.config);
    const structureScore = await calculateStructureScore(file.absolutePath, file.lines);
    const connectivityScore = calculateConnectivityScore(file.path, this.relationships);

    const totalScore = nameScore + pathScore + structureScore + connectivityScore;

    const scoreBreakdown = {
      name: nameScore,
      path: pathScore,
      structure: structureScore,
      connectivity: connectivityScore,
    };

    const tags = generateTags(file, scoreBreakdown);

    return {
      ...file,
      score: Math.max(0, Math.min(100, totalScore)),
      scoreBreakdown,
      tags,
    };
  }

  /**
   * Score all files
   */
  async scoreFiles(files: FileMetadata[]): Promise<ScoredFile[]> {
    const scoredFiles: ScoredFile[] = [];

    for (const file of files) {
      const scored = await this.scoreFile(file);

      // Apply minimum score filter if configured
      if (this.config.minScore === undefined || scored.score >= this.config.minScore) {
        scoredFiles.push(scored);
      }
    }

    // Sort by score descending
    scoredFiles.sort((a, b) => b.score - a.score);

    return scoredFiles;
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get top N files by score
 */
export function getTopFiles(files: ScoredFile[], n: number): ScoredFile[] {
  return [...files].sort((a, b) => b.score - a.score).slice(0, n);
}

/**
 * Get files matching a specific tag
 */
export function getFilesByTag(files: ScoredFile[], tag: string): ScoredFile[] {
  return files.filter((file) => file.tags.includes(tag));
}

/**
 * Get files with score above threshold
 */
export function getFilesAboveThreshold(files: ScoredFile[], threshold: number): ScoredFile[] {
  return files.filter((file) => file.score >= threshold);
}

/**
 * Group files by tag
 */
export function groupFilesByTag(files: ScoredFile[]): Map<string, ScoredFile[]> {
  const groups = new Map<string, ScoredFile[]>();

  for (const file of files) {
    for (const tag of file.tags) {
      const group = groups.get(tag) ?? [];
      group.push(file);
      groups.set(tag, group);
    }
  }

  return groups;
}

/**
 * Convenience function to score files
 */
export async function scoreFiles(
  files: FileMetadata[],
  config?: ScoringConfig
): Promise<ScoredFile[]> {
  const scorer = new SignificanceScorer(config);
  return scorer.scoreFiles(files);
}
