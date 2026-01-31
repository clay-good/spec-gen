/**
 * Core type definitions for spec-gen
 */

// Project detection types
export type ProjectType =
  | 'nodejs'
  | 'python'
  | 'rust'
  | 'go'
  | 'java'
  | 'ruby'
  | 'php'
  | 'unknown';

// Configuration types
export interface SpecGenConfig {
  version: string;
  projectType: ProjectType;
  openspecPath: string;
  analysis: AnalysisConfig;
  generation: GenerationConfig;
  createdAt: string;
  lastRun: string | null;
}

export interface AnalysisConfig {
  maxFiles: number;
  includePatterns: string[];
  excludePatterns: string[];
}

export interface GenerationConfig {
  model: string;
  domains: string | string[];
}

// File metadata types
export interface FileMetadata {
  path: string;
  absolutePath: string;
  name: string;
  extension: string;
  size: number;
  lines: number;
  depth: number;
  directory: string;
  isEntryPoint: boolean;
  isConfig: boolean;
  isTest: boolean;
  isGenerated: boolean;
}

export interface ScoredFile extends FileMetadata {
  score: number;
  scoreBreakdown: {
    name: number;
    path: number;
    structure: number;
    connectivity: number;
  };
  tags: string[];
}

export interface FileWalkerResult {
  files: FileMetadata[];
  summary: {
    totalFiles: number;
    totalDirectories: number;
    byExtension: Record<string, number>;
    byDirectory: Record<string, number>;
    skippedCount: number;
    skippedReasons: Record<string, number>;
  };
  rootPath: string;
  timestamp: string;
}

// CLI option types
export interface GlobalOptions {
  quiet: boolean;
  verbose: boolean;
  noColor: boolean;
  config: string;
}

export interface InitOptions extends GlobalOptions {
  force: boolean;
  openspecPath: string;
}

export interface AnalyzeOptions extends GlobalOptions {
  output: string;
  maxFiles: number;
  include: string[];
  exclude: string[];
}

export interface GenerateOptions extends GlobalOptions {
  analysis: string;
  model: string;
  dryRun: boolean;
  domains: string[];
}

export interface VerifyOptions extends GlobalOptions {
  samples: number;
  threshold: number;
}

// Analysis result types
export interface AnalysisResult {
  repositoryMap: RepositoryMap;
  dependencyGraph: DependencyGraph;
  summary: AnalysisSummary;
  timestamp: string;
}

export interface RepositoryMap {
  root: string;
  files: ScoredFile[];
  directories: DirectoryInfo[];
  projectType: ProjectType;
}

export interface DirectoryInfo {
  path: string;
  fileCount: number;
  purpose: string;
}

export interface DependencyGraph {
  nodes: DependencyNode[];
  edges: DependencyEdge[];
}

export interface DependencyNode {
  id: string;
  path: string;
  type: 'file' | 'module' | 'package';
}

export interface DependencyEdge {
  from: string;
  to: string;
  type: 'import' | 'export' | 'extends' | 'implements';
}

export interface AnalysisSummary {
  totalFiles: number;
  analyzedFiles: number;
  skippedFiles: number;
  detectedDomains: string[];
  entryPoints: string[];
  confidence: number;
}

// OpenSpec output types
export interface OpenSpecDomain {
  name: string;
  path: string;
  requirements: OpenSpecRequirement[];
  entities: OpenSpecEntity[];
  sourceFiles: string[];
  confidence: number;
}

export interface OpenSpecRequirement {
  name: string;
  description: string;
  keyword: 'SHALL' | 'MUST' | 'SHOULD' | 'MAY';
  scenarios: OpenSpecScenario[];
}

export interface OpenSpecScenario {
  name: string;
  given: string;
  when: string;
  then: string;
  and?: string[];
}

export interface OpenSpecEntity {
  name: string;
  properties: EntityProperty[];
  sourceFile: string;
}

export interface EntityProperty {
  name: string;
  type: string;
  description: string;
  required: boolean;
}
