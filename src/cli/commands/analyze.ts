/**
 * spec-gen analyze command
 *
 * Runs static analysis on the codebase without LLM involvement.
 * Outputs repository map, dependency graph, and file significance scores.
 */

import { Command } from 'commander';
import { access, stat, writeFile, mkdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { logger } from '../../utils/logger.js';
import type { AnalyzeOptions } from '../../types/index.js';
import { readSpecGenConfig } from '../../core/services/config-manager.js';
import { RepositoryMapper, type RepositoryMap } from '../../core/analyzer/repository-mapper.js';
import {
  DependencyGraphBuilder,
  type DependencyGraphResult,
} from '../../core/analyzer/dependency-graph.js';
import {
  AnalysisArtifactGenerator,
  type AnalysisArtifacts,
} from '../../core/analyzer/artifact-generator.js';

// ============================================================================
// TYPES
// ============================================================================

interface ExtendedAnalyzeOptions extends AnalyzeOptions {
  force?: boolean;
}

interface AnalysisResult {
  repoMap: RepositoryMap;
  depGraph: DependencyGraphResult;
  artifacts: AnalysisArtifacts;
  duration: number;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Collect multiple values for repeatable options
 */
function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

/**
 * Check if a file exists
 */
async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Format time duration for display
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/**
 * Format age in human-readable form
 */
function formatAge(ms: number): string {
  if (ms < 60000) return 'just now';
  if (ms < 3600000) return `${Math.floor(ms / 60000)} minutes ago`;
  if (ms < 86400000) return `${Math.floor(ms / 3600000)} hours ago`;
  return `${Math.floor(ms / 86400000)} days ago`;
}

/**
 * Check if analysis exists and return its age
 */
async function getAnalysisAge(outputPath: string): Promise<number | null> {
  try {
    const repoStructurePath = join(outputPath, 'repo-structure.json');
    if (!(await fileExists(repoStructurePath))) {
      return null;
    }
    const stats = await stat(repoStructurePath);
    return Date.now() - stats.mtime.getTime();
  } catch {
    return null;
  }
}

// ============================================================================
// CORE ANALYSIS FUNCTION
// ============================================================================

/**
 * Run the complete analysis pipeline
 */
export async function runAnalysis(
  rootPath: string,
  outputPath: string,
  options: {
    maxFiles: number;
    include: string[];
    exclude: string[];
  }
): Promise<AnalysisResult> {
  const startTime = Date.now();

  // Load config
  const config = await readSpecGenConfig(rootPath);
  const projectType = config?.projectType ?? 'unknown';

  // Phase 1: Repository Mapping
  logger.analysis('Scanning directory structure...');

  const mapper = new RepositoryMapper(rootPath, {
    maxFiles: options.maxFiles,
    excludePatterns: options.exclude.length > 0 ? options.exclude : undefined,
  });

  const repoMap = await mapper.map();

  logger.info('Files found', repoMap.summary.totalFiles);
  logger.info('Files analyzed', repoMap.summary.analyzedFiles);
  logger.info('Files skipped', repoMap.summary.skippedFiles);
  logger.blank();

  // Phase 2: Dependency Graph
  logger.analysis('Building dependency graph...');

  const graphBuilder = new DependencyGraphBuilder({
    rootDir: rootPath,
  });

  const depGraph = await graphBuilder.build(repoMap.allFiles);

  logger.info('Nodes', depGraph.statistics.nodeCount);
  logger.info('Edges', depGraph.statistics.edgeCount);
  logger.info('Clusters', depGraph.statistics.clusterCount);
  if (depGraph.statistics.cycleCount > 0) {
    logger.warning(`Circular dependencies: ${depGraph.statistics.cycleCount}`);
  }
  logger.blank();

  // Phase 3: Generate Artifacts
  logger.analysis('Generating analysis artifacts...');

  const artifactGenerator = new AnalysisArtifactGenerator({
    rootDir: rootPath,
    outputDir: outputPath,
    maxDeepAnalysisFiles: Math.min(20, Math.ceil(repoMap.highValueFiles.length * 0.3)),
    maxValidationFiles: 5,
  });

  const artifacts = await artifactGenerator.generateAndSave(repoMap, depGraph);

  // Also save the raw dependency graph
  await writeFile(
    join(outputPath, 'dependency-graph.json'),
    JSON.stringify(depGraph, null, 2)
  );

  const duration = Date.now() - startTime;

  return { repoMap, depGraph, artifacts, duration };
}

// ============================================================================
// COMMAND
// ============================================================================

export const analyzeCommand = new Command('analyze')
  .description('Run static analysis on the codebase (no LLM required)')
  .option(
    '--output <path>',
    'Directory to write analysis results',
    '.spec-gen/analysis/'
  )
  .option(
    '--max-files <n>',
    'Maximum number of files to analyze',
    '500'
  )
  .option(
    '--include <glob>',
    'Additional glob patterns to include (repeatable)',
    collect,
    []
  )
  .option(
    '--exclude <glob>',
    'Additional glob patterns to exclude (repeatable)',
    collect,
    []
  )
  .option(
    '--force',
    'Force re-analysis even if recent analysis exists',
    false
  )
  .addHelpText(
    'after',
    `
Examples:
  $ spec-gen analyze                 Analyze with defaults
  $ spec-gen analyze --max-files 1000
                                     Analyze more files
  $ spec-gen analyze --include "*.graphql" --include "*.prisma"
                                     Include additional file types
  $ spec-gen analyze --exclude "legacy/**"
                                     Exclude specific directories
  $ spec-gen analyze --output ./my-analysis
                                     Custom output location
  $ spec-gen analyze --force         Force re-analysis

Output files:
  .spec-gen/analysis/
  ├── repo-structure.json    Repository structure and metadata
  ├── dependency-graph.json  Import/export relationships
  ├── llm-context.json       Optimized context for LLM
  ├── dependencies.mermaid   Visual dependency diagram
  └── SUMMARY.md             Human-readable analysis summary

After analysis, run 'spec-gen generate' to create OpenSpec files.
`
  )
  .action(async (options: Partial<ExtendedAnalyzeOptions>) => {
    const startTime = Date.now();
    const rootPath = process.cwd();

    const opts: ExtendedAnalyzeOptions = {
      output: options.output ?? '.spec-gen/analysis/',
      maxFiles: typeof options.maxFiles === 'string'
        ? parseInt(options.maxFiles, 10)
        : options.maxFiles ?? 500,
      include: options.include ?? [],
      exclude: options.exclude ?? [],
      force: options.force ?? false,
      quiet: false,
      verbose: false,
      noColor: false,
      config: '.spec-gen/config.json',
    };

    try {
      // ========================================================================
      // PHASE 1: VALIDATION
      // ========================================================================
      logger.section('Analyzing Codebase');

      // Check for spec-gen config
      const specGenConfig = await readSpecGenConfig(rootPath);
      if (!specGenConfig) {
        logger.error('No spec-gen configuration found. Run "spec-gen init" first.');
        process.exitCode = 1;
        return;
      }

      logger.info('Project', specGenConfig.projectType);
      logger.info('Output', opts.output);
      logger.info('Max files', opts.maxFiles);
      if (opts.include.length > 0) {
        logger.info('Include patterns', opts.include.join(', '));
      }
      if (opts.exclude.length > 0) {
        logger.info('Exclude patterns', opts.exclude.join(', '));
      }
      logger.blank();

      // ========================================================================
      // PHASE 2: CHECK EXISTING ANALYSIS
      // ========================================================================
      const outputPath = join(rootPath, opts.output);
      const analysisAge = await getAnalysisAge(outputPath);

      if (analysisAge !== null && !opts.force) {
        // Analysis exists - check if recent (< 1 hour)
        const oneHour = 60 * 60 * 1000;
        if (analysisAge < oneHour) {
          logger.discovery(`Recent analysis exists (${formatAge(analysisAge)})`);
          logger.info('Tip', 'Use --force to re-analyze');
          logger.blank();

          // Show existing analysis stats
          try {
            const repoStructurePath = join(outputPath, 'repo-structure.json');
            const content = await import('node:fs/promises').then(fs =>
              fs.readFile(repoStructurePath, 'utf-8')
            );
            const repoStructure = JSON.parse(content);

            logger.success('Analysis Summary');
            logger.info('Files analyzed', repoStructure.statistics.analyzedFiles);
            logger.info('Domains detected', repoStructure.domains.map((d: { name: string }) => d.name).join(', ') || 'None');
            logger.info('Architecture', repoStructure.architecture.pattern);
            logger.blank();
            logger.info('Next step', "Run 'spec-gen generate' to create OpenSpec files");
            return;
          } catch {
            // Continue with fresh analysis if we can't read existing
          }
        } else {
          logger.discovery(`Existing analysis is ${formatAge(analysisAge)} old, re-analyzing...`);
          logger.blank();
        }
      }

      // ========================================================================
      // PHASE 3: RUN ANALYSIS
      // ========================================================================
      // Ensure output directory exists
      await mkdir(outputPath, { recursive: true });

      const result = await runAnalysis(rootPath, outputPath, {
        maxFiles: opts.maxFiles,
        include: opts.include,
        exclude: opts.exclude,
      });

      // ========================================================================
      // PHASE 4: DISPLAY RESULTS
      // ========================================================================
      logger.blank();
      logger.section('Analysis Complete');

      const { repoMap, depGraph, artifacts, duration } = result;

      // Summary
      console.log('');
      console.log('  Repository Structure:');
      console.log(`    ├─ Files analyzed: ${repoMap.summary.analyzedFiles}`);
      console.log(`    ├─ High-value files: ${repoMap.highValueFiles.length}`);
      console.log(`    ├─ Languages: ${repoMap.summary.languages.slice(0, 3).map(l => l.language).join(', ')}`);
      console.log(`    └─ Architecture: ${artifacts.repoStructure.architecture.pattern}`);
      console.log('');

      console.log('  Dependency Graph:');
      console.log(`    ├─ Nodes: ${depGraph.statistics.nodeCount}`);
      console.log(`    ├─ Edges: ${depGraph.statistics.edgeCount}`);
      console.log(`    ├─ Clusters: ${depGraph.statistics.clusterCount}`);
      if (depGraph.statistics.cycleCount > 0) {
        console.log(`    ├─ ⚠ Circular dependencies: ${depGraph.statistics.cycleCount}`);
      }
      console.log(`    └─ Average degree: ${depGraph.statistics.avgDegree.toFixed(1)}`);
      console.log('');

      // Detected domains
      if (artifacts.repoStructure.domains.length > 0) {
        console.log('  Detected Domains:');
        for (let i = 0; i < Math.min(artifacts.repoStructure.domains.length, 6); i++) {
          const domain = artifacts.repoStructure.domains[i];
          const isLast = i === Math.min(artifacts.repoStructure.domains.length, 6) - 1;
          const prefix = isLast ? '└─' : '├─';
          console.log(`    ${prefix} ${domain.name} (${domain.files.length} files)`);
        }
        if (artifacts.repoStructure.domains.length > 6) {
          console.log(`       ... and ${artifacts.repoStructure.domains.length - 6} more`);
        }
        console.log('');
      }

      // Files generated
      console.log('  Output Files:');
      console.log(`    ├─ ${opts.output}repo-structure.json`);
      console.log(`    ├─ ${opts.output}dependency-graph.json`);
      console.log(`    ├─ ${opts.output}llm-context.json`);
      console.log(`    ├─ ${opts.output}dependencies.mermaid`);
      console.log(`    └─ ${opts.output}SUMMARY.md`);
      console.log('');

      // Duration
      const totalDuration = Date.now() - startTime;
      console.log(`  Total time: ${formatDuration(totalDuration)}`);
      console.log('');

      logger.success('Ready for generation!');
      logger.blank();
      logger.info('Next step', "Run 'spec-gen generate' to create OpenSpec files");

    } catch (error) {
      logger.error(`Analysis failed: ${(error as Error).message}`);
      if (process.env.DEBUG) {
        console.error(error);
      }
      process.exitCode = 1;
    }
  });
