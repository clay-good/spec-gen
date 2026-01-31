/**
 * Analysis Artifact Generator
 *
 * Takes all analysis results and generates structured output files
 * that will be consumed by the LLM generation phase and optionally by humans.
 */

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { join, dirname, basename, relative } from 'node:path';
import type { ScoredFile, ProjectType } from '../../types/index.js';
import type { RepositoryMap, DetectedFramework, DirectoryStats } from './repository-mapper.js';
import type { DependencyGraphResult, FileCluster } from './dependency-graph.js';
import { toMermaidFormat } from './dependency-graph.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Architecture layer information
 */
export interface ArchitectureLayer {
  name: string;
  purpose: string;
  files: string[];
  representativeFile: string | null;
}

/**
 * Detected domain (maps to OpenSpec spec)
 */
export interface DetectedDomain {
  name: string;
  suggestedSpecPath: string;
  files: string[];
  entities: string[];
  keyFile: string | null;
}

/**
 * Entry point information
 */
export interface EntryPointInfo {
  file: string;
  type: 'application-entry' | 'api-entry' | 'test-entry' | 'build-entry';
  initializes: string[];
}

/**
 * Data flow information
 */
export interface DataFlowInfo {
  sources: string[];
  sinks: string[];
  transformers: string[];
}

/**
 * Key files by category
 */
export interface KeyFiles {
  schemas: string[];
  config: string[];
  auth: string[];
  database: string[];
  routes: string[];
  services: string[];
}

/**
 * Repository structure (JSON artifact)
 */
export interface RepoStructure {
  projectName: string;
  projectType: string;
  frameworks: string[];
  architecture: {
    pattern: 'layered' | 'modular' | 'microservices' | 'monolith' | 'unknown';
    layers: ArchitectureLayer[];
  };
  domains: DetectedDomain[];
  entryPoints: EntryPointInfo[];
  dataFlow: DataFlowInfo;
  keyFiles: KeyFiles;
  statistics: {
    totalFiles: number;
    analyzedFiles: number;
    skippedFiles: number;
    avgFileScore: number;
    nodeCount: number;
    edgeCount: number;
    cycleCount: number;
    clusterCount: number;
  };
}

/**
 * LLM context phase
 */
export interface LLMContextPhase {
  purpose: string;
  files: Array<{
    path: string;
    content?: string;
    tokens: number;
  }>;
  totalTokens?: number;
  estimatedTokens?: number;
}

/**
 * LLM context preparation
 */
export interface LLMContext {
  phase1_survey: LLMContextPhase;
  phase2_deep: LLMContextPhase;
  phase3_validation: LLMContextPhase;
}

/**
 * All generated artifacts
 */
export interface AnalysisArtifacts {
  repoStructure: RepoStructure;
  summaryMarkdown: string;
  dependencyDiagram: string;
  llmContext: LLMContext;
}

/**
 * Options for artifact generation
 */
export interface ArtifactGeneratorOptions {
  /** Root directory of the project */
  rootDir: string;
  /** Output directory for artifacts */
  outputDir: string;
  /** Maximum files to include in LLM deep analysis */
  maxDeepAnalysisFiles?: number;
  /** Maximum files for validation phase */
  maxValidationFiles?: number;
  /** Approximate tokens per character for estimation */
  tokensPerChar?: number;
}

// ============================================================================
// ARTIFACT GENERATOR
// ============================================================================

/**
 * Generates analysis artifacts from repository map and dependency graph
 */
export class AnalysisArtifactGenerator {
  private options: Required<ArtifactGeneratorOptions>;

  constructor(options: ArtifactGeneratorOptions) {
    this.options = {
      rootDir: options.rootDir,
      outputDir: options.outputDir,
      maxDeepAnalysisFiles: options.maxDeepAnalysisFiles ?? 20,
      maxValidationFiles: options.maxValidationFiles ?? 5,
      tokensPerChar: options.tokensPerChar ?? 0.25, // ~4 chars per token
    };
  }

  /**
   * Generate all artifacts
   */
  async generate(
    repoMap: RepositoryMap,
    depGraph: DependencyGraphResult
  ): Promise<AnalysisArtifacts> {
    // Generate each artifact
    const repoStructure = this.generateRepoStructure(repoMap, depGraph);
    const summaryMarkdown = this.generateSummaryMarkdown(repoMap, depGraph, repoStructure);
    const dependencyDiagram = this.generateDependencyDiagram(depGraph);
    const llmContext = await this.generateLLMContext(repoMap, depGraph);

    return {
      repoStructure,
      summaryMarkdown,
      dependencyDiagram,
      llmContext,
    };
  }

  /**
   * Generate and save all artifacts to disk
   */
  async generateAndSave(
    repoMap: RepositoryMap,
    depGraph: DependencyGraphResult
  ): Promise<AnalysisArtifacts> {
    const artifacts = await this.generate(repoMap, depGraph);

    // Ensure output directory exists
    await mkdir(this.options.outputDir, { recursive: true });

    // Save each artifact
    await Promise.all([
      writeFile(
        join(this.options.outputDir, 'repo-structure.json'),
        JSON.stringify(artifacts.repoStructure, null, 2)
      ),
      writeFile(
        join(this.options.outputDir, 'SUMMARY.md'),
        artifacts.summaryMarkdown
      ),
      writeFile(
        join(this.options.outputDir, 'dependencies.mermaid'),
        artifacts.dependencyDiagram
      ),
      writeFile(
        join(this.options.outputDir, 'llm-context.json'),
        JSON.stringify(artifacts.llmContext, null, 2)
      ),
    ]);

    return artifacts;
  }

  /**
   * Generate repo-structure.json
   */
  private generateRepoStructure(
    repoMap: RepositoryMap,
    depGraph: DependencyGraphResult
  ): RepoStructure {
    // Detect architecture pattern
    const architecturePattern = this.detectArchitecturePattern(repoMap, depGraph);

    // Generate layers
    const layers = this.generateArchitectureLayers(repoMap);

    // Generate domains from clusters
    const domains = this.generateDomains(repoMap, depGraph);

    // Generate entry points
    const entryPoints = this.generateEntryPoints(repoMap);

    // Generate data flow
    const dataFlow = this.generateDataFlow(repoMap);

    // Generate key files
    const keyFiles = this.generateKeyFiles(repoMap);

    // Calculate statistics
    const avgScore = repoMap.allFiles.length > 0
      ? repoMap.allFiles.reduce((sum, f) => sum + f.score, 0) / repoMap.allFiles.length
      : 0;

    return {
      projectName: repoMap.metadata.projectName,
      projectType: this.formatProjectType(repoMap.metadata.projectType),
      frameworks: repoMap.summary.frameworks.map(f => f.name),
      architecture: {
        pattern: architecturePattern,
        layers,
      },
      domains,
      entryPoints,
      dataFlow,
      keyFiles,
      statistics: {
        totalFiles: repoMap.summary.totalFiles,
        analyzedFiles: repoMap.summary.analyzedFiles,
        skippedFiles: repoMap.summary.skippedFiles,
        avgFileScore: Math.round(avgScore * 10) / 10,
        nodeCount: depGraph.statistics.nodeCount,
        edgeCount: depGraph.statistics.edgeCount,
        cycleCount: depGraph.statistics.cycleCount,
        clusterCount: depGraph.statistics.clusterCount,
      },
    };
  }

  /**
   * Format project type for display
   */
  private formatProjectType(type: ProjectType): string {
    const mapping: Record<ProjectType, string> = {
      nodejs: 'node-typescript',
      python: 'python',
      rust: 'rust',
      go: 'go',
      java: 'java',
      ruby: 'ruby',
      php: 'php',
      unknown: 'unknown',
    };
    return mapping[type] ?? type;
  }

  /**
   * Detect architecture pattern from code structure
   */
  private detectArchitecturePattern(
    repoMap: RepositoryMap,
    depGraph: DependencyGraphResult
  ): 'layered' | 'modular' | 'microservices' | 'monolith' | 'unknown' {
    const dirs = repoMap.summary.directories;
    const dirNames = dirs.map(d => basename(d.path).toLowerCase());

    // Check for layered architecture indicators
    const layeredIndicators = ['controllers', 'services', 'repositories', 'routes', 'models', 'views'];
    const hasLayeredStructure = layeredIndicators.filter(i => dirNames.some(d => d.includes(i))).length >= 3;

    // Check for modular/domain-driven indicators
    const moduleIndicators = ['modules', 'features', 'domains'];
    const hasModularStructure = moduleIndicators.some(i => dirNames.includes(i));

    // Check for microservices indicators
    const hasMultiplePackageJson = repoMap.configFiles.filter(f => f.name === 'package.json').length > 1;
    const hasDockerCompose = repoMap.configFiles.some(f => f.name.includes('docker-compose'));

    // Determine pattern
    if (hasMultiplePackageJson && hasDockerCompose) {
      return 'microservices';
    }
    if (hasModularStructure) {
      return 'modular';
    }
    if (hasLayeredStructure) {
      return 'layered';
    }
    if (repoMap.summary.totalFiles < 50) {
      return 'monolith';
    }

    return 'unknown';
  }

  /**
   * Generate architecture layers
   */
  private generateArchitectureLayers(repoMap: RepositoryMap): ArchitectureLayer[] {
    const layers: ArchitectureLayer[] = [];

    // API/Routes layer
    const apiFiles = repoMap.allFiles.filter(f =>
      f.directory.includes('routes') ||
      f.directory.includes('controllers') ||
      f.directory.includes('api') ||
      f.name.includes('route') ||
      f.name.includes('controller')
    );
    if (apiFiles.length > 0) {
      layers.push({
        name: 'API Layer',
        purpose: 'HTTP request handling and routing',
        files: apiFiles.map(f => f.path),
        representativeFile: apiFiles[0]?.path ?? null,
      });
    }

    // Service/Business layer
    const serviceFiles = repoMap.allFiles.filter(f =>
      f.directory.includes('services') ||
      f.directory.includes('business') ||
      f.directory.includes('domain') ||
      f.name.includes('service') ||
      f.name.includes('manager')
    );
    if (serviceFiles.length > 0) {
      layers.push({
        name: 'Service Layer',
        purpose: 'Business logic and domain operations',
        files: serviceFiles.map(f => f.path),
        representativeFile: serviceFiles[0]?.path ?? null,
      });
    }

    // Data/Repository layer
    const dataFiles = repoMap.allFiles.filter(f =>
      f.directory.includes('repositories') ||
      f.directory.includes('data') ||
      f.directory.includes('database') ||
      f.directory.includes('models') ||
      f.name.includes('repository') ||
      f.name.includes('model')
    );
    if (dataFiles.length > 0) {
      layers.push({
        name: 'Data Layer',
        purpose: 'Data access and persistence',
        files: dataFiles.map(f => f.path),
        representativeFile: dataFiles[0]?.path ?? null,
      });
    }

    // Infrastructure layer
    const infraFiles = repoMap.allFiles.filter(f =>
      f.directory.includes('infrastructure') ||
      f.directory.includes('config') ||
      f.directory.includes('middleware') ||
      f.directory.includes('utils') ||
      f.isConfig
    );
    if (infraFiles.length > 0) {
      layers.push({
        name: 'Infrastructure Layer',
        purpose: 'Configuration, middleware, and utilities',
        files: infraFiles.map(f => f.path),
        representativeFile: infraFiles[0]?.path ?? null,
      });
    }

    return layers;
  }

  /**
   * Generate domains from clusters
   */
  private generateDomains(
    repoMap: RepositoryMap,
    depGraph: DependencyGraphResult
  ): DetectedDomain[] {
    const domains: DetectedDomain[] = [];

    // Use directory-based clusters from repo map
    for (const [dirName, files] of Object.entries(repoMap.clusters.byDomain)) {
      if (files.length === 0) continue;

      // Skip infrastructure directories
      const skipDirs = ['utils', 'helpers', 'common', 'shared', 'config', 'middleware'];
      if (skipDirs.includes(dirName.toLowerCase())) continue;

      // Extract potential entities from file names
      const entities = this.extractEntities(files);

      // Find the key file (highest score in domain)
      const keyFile = files.sort((a, b) => b.score - a.score)[0];

      // Generate suggested spec path
      const domainName = this.normalizeDomainName(dirName);

      domains.push({
        name: domainName,
        suggestedSpecPath: `openspec/specs/${domainName}/spec.md`,
        files: files.map(f => f.path),
        entities,
        keyFile: keyFile?.path ?? null,
      });
    }

    // Also consider clusters from dependency graph
    for (const cluster of depGraph.clusters) {
      const clusterName = this.normalizeDomainName(cluster.suggestedDomain);

      // Skip if already covered
      if (domains.some(d => d.name === clusterName)) continue;

      // Skip small clusters
      if (cluster.files.length < 2) continue;

      // Get file details
      const files = cluster.files
        .map(id => depGraph.nodes.find(n => n.id === id)?.file)
        .filter((f): f is ScoredFile => f !== undefined);

      if (files.length === 0) continue;

      const entities = this.extractEntities(files);
      const keyFile = files.sort((a, b) => b.score - a.score)[0];

      domains.push({
        name: clusterName,
        suggestedSpecPath: `openspec/specs/${clusterName}/spec.md`,
        files: files.map(f => f.path),
        entities,
        keyFile: keyFile?.path ?? null,
      });
    }

    return domains;
  }

  /**
   * Normalize domain name for OpenSpec path
   */
  private normalizeDomainName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'misc';
  }

  /**
   * Extract potential entity names from files
   */
  private extractEntities(files: ScoredFile[]): string[] {
    const entities: Set<string> = new Set();

    for (const file of files) {
      // Extract from file name
      const name = file.name.replace(/\.(ts|js|tsx|jsx|py)$/, '');

      // Convert to PascalCase as potential entity name
      const entityName = name
        .split(/[-_.]/)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join('');

      // Skip generic names
      const skipNames = ['Index', 'Types', 'Utils', 'Helpers', 'Constants', 'Test', 'Spec'];
      if (!skipNames.includes(entityName) && entityName.length > 2) {
        entities.add(entityName);
      }
    }

    return Array.from(entities).slice(0, 5); // Limit to top 5
  }

  /**
   * Generate entry points information
   */
  private generateEntryPoints(repoMap: RepositoryMap): EntryPointInfo[] {
    return repoMap.entryPoints.map(file => {
      // Determine entry point type
      let type: EntryPointInfo['type'] = 'application-entry';
      if (file.name.includes('test') || file.name.includes('spec')) {
        type = 'test-entry';
      } else if (file.name.includes('route') || file.name.includes('api')) {
        type = 'api-entry';
      } else if (file.name.includes('build') || file.name.includes('webpack')) {
        type = 'build-entry';
      }

      // Infer what gets initialized (simplified)
      const initializes: string[] = [];
      if (file.name.includes('app') || file.name === 'index.ts') {
        initializes.push('application');
      }
      if (file.directory.includes('database')) {
        initializes.push('database');
      }

      return {
        file: file.path,
        type,
        initializes,
      };
    });
  }

  /**
   * Generate data flow information
   */
  private generateDataFlow(repoMap: RepositoryMap): DataFlowInfo {
    const sources: string[] = [];
    const sinks: string[] = [];
    const transformers: string[] = [];

    for (const file of repoMap.allFiles) {
      const dir = file.directory.toLowerCase();
      const name = file.name.toLowerCase();

      // Sources: routes, controllers, APIs
      if (dir.includes('routes') || dir.includes('controllers') || dir.includes('api')) {
        sources.push(file.path);
      }
      // Sinks: repositories, database, storage
      else if (dir.includes('repositories') || dir.includes('database') || dir.includes('storage')) {
        sinks.push(file.path);
      }
      // Transformers: services, middleware
      else if (dir.includes('services') || dir.includes('middleware') || name.includes('service')) {
        transformers.push(file.path);
      }
    }

    return { sources, sinks, transformers };
  }

  /**
   * Generate key files by category
   */
  private generateKeyFiles(repoMap: RepositoryMap): KeyFiles {
    const keyFiles: KeyFiles = {
      schemas: [],
      config: [],
      auth: [],
      database: [],
      routes: [],
      services: [],
    };

    for (const file of repoMap.allFiles) {
      const dir = file.directory.toLowerCase();
      const name = file.name.toLowerCase();

      if (dir.includes('models') || dir.includes('schemas') || name.includes('schema')) {
        keyFiles.schemas.push(file.path);
      }
      if (file.isConfig || dir.includes('config')) {
        keyFiles.config.push(file.path);
      }
      if (dir.includes('auth') || name.includes('auth')) {
        keyFiles.auth.push(file.path);
      }
      if (dir.includes('database') || dir.includes('db') || name.includes('database')) {
        keyFiles.database.push(file.path);
      }
      if (dir.includes('routes') || name.includes('route')) {
        keyFiles.routes.push(file.path);
      }
      if (dir.includes('services') || name.includes('service')) {
        keyFiles.services.push(file.path);
      }
    }

    return keyFiles;
  }

  /**
   * Generate SUMMARY.md
   */
  private generateSummaryMarkdown(
    repoMap: RepositoryMap,
    depGraph: DependencyGraphResult,
    repoStructure: RepoStructure
  ): string {
    const lines: string[] = [];

    // Header
    lines.push(`# Repository Analysis: ${repoMap.metadata.projectName}`);
    lines.push('');

    // Overview
    lines.push('## Overview');
    lines.push(`- **Type**: ${this.formatProjectTypeReadable(repoMap.metadata.projectType)}`);
    if (repoMap.summary.frameworks.length > 0) {
      lines.push(`- **Frameworks**: ${repoMap.summary.frameworks.map(f => f.name).join(', ')}`);
    }
    lines.push(`- **Files Analyzed**: ${repoMap.summary.analyzedFiles} of ${repoMap.summary.totalFiles} (${repoMap.summary.skippedFiles} skipped)`);
    lines.push(`- **Analysis Date**: ${repoMap.metadata.analyzedAt}`);
    lines.push('');

    // Architecture
    lines.push('## Architecture Pattern');
    lines.push(`This appears to be a **${repoStructure.architecture.pattern}** architecture.`);
    if (repoStructure.architecture.layers.length > 0) {
      lines.push('');
      lines.push('**Detected Layers:**');
      for (const layer of repoStructure.architecture.layers) {
        lines.push(`- ${layer.name}: ${layer.purpose} (${layer.files.length} files)`);
      }
    }
    lines.push('');

    // Languages
    if (repoMap.summary.languages.length > 0) {
      lines.push('## Language Breakdown');
      lines.push('| Language | Files | Percentage |');
      lines.push('|----------|-------|------------|');
      for (const lang of repoMap.summary.languages.slice(0, 5)) {
        lines.push(`| ${lang.language} | ${lang.fileCount} | ${lang.percentage.toFixed(1)}% |`);
      }
      lines.push('');
    }

    // Domains
    if (repoStructure.domains.length > 0) {
      lines.push('## Detected Domains');
      lines.push('These domains will become OpenSpec specifications:');
      lines.push('');
      lines.push('| Domain | Files | Key Entities | Spec Path |');
      lines.push('|--------|-------|--------------|-----------|');
      for (const domain of repoStructure.domains.slice(0, 10)) {
        const entities = domain.entities.slice(0, 3).join(', ') || '-';
        lines.push(`| ${domain.name} | ${domain.files.length} | ${entities} | \`${domain.suggestedSpecPath}\` |`);
      }
      lines.push('');
    }

    // Dependency insights
    lines.push('## Dependency Insights');

    // Most connected
    const topConnected = depGraph.rankings.byConnectivity.slice(0, 3);
    if (topConnected.length > 0) {
      lines.push('');
      lines.push('**Most Connected Files:**');
      for (const nodeId of topConnected) {
        const node = depGraph.nodes.find(n => n.id === nodeId);
        if (node) {
          const totalDegree = node.metrics.inDegree + node.metrics.outDegree;
          lines.push(`- \`${node.file.path}\` (${totalDegree} connections)`);
        }
      }
    }

    // Cycles
    if (depGraph.cycles.length > 0) {
      lines.push('');
      lines.push(`**Circular Dependencies**: ${depGraph.cycles.length} cycle(s) detected`);
      for (const cycle of depGraph.cycles.slice(0, 3)) {
        const cycleFiles = cycle.map(id => {
          const node = depGraph.nodes.find(n => n.id === id);
          return node ? basename(node.file.path) : basename(id);
        });
        lines.push(`- ${cycleFiles.join(' → ')}`);
      }
    }

    // Orphans
    if (depGraph.rankings.orphanNodes.length > 0) {
      lines.push('');
      lines.push(`**Orphan Files**: ${depGraph.rankings.orphanNodes.length} file(s) with no imports or exports`);
    }
    lines.push('');

    // Top files
    lines.push('## Files Selected for Deep Analysis');
    lines.push('The following files were selected as most significant:');
    lines.push('');
    const topFiles = repoMap.highValueFiles.slice(0, 15);
    for (let i = 0; i < topFiles.length; i++) {
      const file = topFiles[i];
      const tags = file.tags.length > 0 ? ` - ${file.tags.join(', ')}` : '';
      lines.push(`${i + 1}. \`${file.path}\` (score: ${file.score})${tags}`);
    }
    lines.push('');

    // Recommendations
    lines.push('## Recommendations');
    const recommendations: string[] = [];

    if (depGraph.cycles.length > 0) {
      recommendations.push(`- Consider breaking the ${depGraph.cycles.length} circular dependency cycle(s)`);
    }
    if (depGraph.rankings.orphanNodes.length > 0) {
      recommendations.push(`- Review ${depGraph.rankings.orphanNodes.length} orphan file(s) that may be unused`);
    }
    if (depGraph.rankings.bridgeNodes.length > 0) {
      recommendations.push(`- The following files are critical bridges: ${depGraph.rankings.bridgeNodes.slice(0, 3).map(id => {
        const node = depGraph.nodes.find(n => n.id === id);
        return node ? `\`${basename(node.file.path)}\`` : '';
      }).filter(Boolean).join(', ')}`);
    }

    if (recommendations.length === 0) {
      recommendations.push('- No immediate architectural concerns detected');
    }

    for (const rec of recommendations) {
      lines.push(rec);
    }
    lines.push('');

    // Footer
    lines.push('---');
    lines.push(`*Generated by spec-gen v${repoMap.metadata.version}*`);

    return lines.join('\n');
  }

  /**
   * Format project type for human reading
   */
  private formatProjectTypeReadable(type: ProjectType): string {
    const mapping: Record<ProjectType, string> = {
      nodejs: 'Node.js/TypeScript',
      python: 'Python',
      rust: 'Rust',
      go: 'Go',
      java: 'Java',
      ruby: 'Ruby',
      php: 'PHP',
      unknown: 'Unknown',
    };
    return mapping[type] ?? type;
  }

  /**
   * Generate dependency diagram in Mermaid format
   */
  private generateDependencyDiagram(depGraph: DependencyGraphResult): string {
    // Use the built-in Mermaid converter with clustering
    const lines: string[] = ['```mermaid'];

    // Generate diagram with top 30 files
    const mermaid = toMermaidFormat(depGraph, 30);
    lines.push(mermaid);

    lines.push('```');

    return lines.join('\n');
  }

  /**
   * Generate LLM context preparation
   */
  private async generateLLMContext(
    repoMap: RepositoryMap,
    depGraph: DependencyGraphResult
  ): Promise<LLMContext> {
    // Phase 1: Survey (repo structure summary)
    const phase1: LLMContextPhase = {
      purpose: 'Initial project categorization',
      files: [
        {
          path: 'repo-structure.json',
          tokens: 2000, // Estimate
        },
      ],
      estimatedTokens: 2000,
    };

    // Phase 2: Deep analysis (top files by importance)
    const phase2Files: LLMContextPhase['files'] = [];
    const topFiles = repoMap.highValueFiles.slice(0, this.options.maxDeepAnalysisFiles);

    for (const file of topFiles) {
      try {
        const content = await readFile(file.absolutePath, 'utf-8');
        const tokens = Math.ceil(content.length * this.options.tokensPerChar);
        phase2Files.push({
          path: file.path,
          content: content.slice(0, 10000), // Limit content size
          tokens,
        });
      } catch {
        // File couldn't be read, skip
      }
    }

    const phase2: LLMContextPhase = {
      purpose: 'Core entity and logic extraction',
      files: phase2Files,
      totalTokens: phase2Files.reduce((sum, f) => sum + f.tokens, 0),
    };

    // Phase 3: Validation (random leaf nodes not in phase 2)
    const phase2Paths = new Set(phase2Files.map(f => f.path));
    const leafFiles = depGraph.rankings.leafNodes
      .map(id => depGraph.nodes.find(n => n.id === id)?.file)
      .filter((f): f is ScoredFile => f !== undefined)
      .filter(f => !phase2Paths.has(f.path));

    // Shuffle and take random samples
    const shuffled = leafFiles.sort(() => Math.random() - 0.5);
    const validationFiles = shuffled.slice(0, this.options.maxValidationFiles);

    const phase3Files: LLMContextPhase['files'] = [];
    for (const file of validationFiles) {
      try {
        const content = await readFile(file.absolutePath, 'utf-8');
        const tokens = Math.ceil(content.length * this.options.tokensPerChar);
        phase3Files.push({
          path: file.path,
          content: content.slice(0, 5000),
          tokens,
        });
      } catch {
        // File couldn't be read, skip
      }
    }

    const phase3: LLMContextPhase = {
      purpose: 'Verification samples',
      files: phase3Files,
      totalTokens: phase3Files.reduce((sum, f) => sum + f.tokens, 0),
    };

    return {
      phase1_survey: phase1,
      phase2_deep: phase2,
      phase3_validation: phase3,
    };
  }
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Generate all artifacts
 */
export async function generateArtifacts(
  repoMap: RepositoryMap,
  depGraph: DependencyGraphResult,
  options: ArtifactGeneratorOptions
): Promise<AnalysisArtifacts> {
  const generator = new AnalysisArtifactGenerator(options);
  return generator.generate(repoMap, depGraph);
}

/**
 * Generate and save all artifacts
 */
export async function generateAndSaveArtifacts(
  repoMap: RepositoryMap,
  depGraph: DependencyGraphResult,
  options: ArtifactGeneratorOptions
): Promise<AnalysisArtifacts> {
  const generator = new AnalysisArtifactGenerator(options);
  return generator.generateAndSave(repoMap, depGraph);
}
