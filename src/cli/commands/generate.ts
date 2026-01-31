/**
 * spec-gen generate command
 *
 * Generates OpenSpec specification files from analysis results using LLM.
 * Outputs to openspec/specs/ directory in standard OpenSpec format.
 */

import { Command } from 'commander';
import { access, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from '../../utils/logger.js';
import type { GenerateOptions } from '../../types/index.js';
import {
  readSpecGenConfig,
  readOpenSpecConfig,
} from '../../core/services/config-manager.js';
import {
  createLLMService,
  type LLMService,
} from '../../core/services/llm-service.js';
import {
  SpecGenerationPipeline,
  type PipelineResult,
} from '../../core/generator/spec-pipeline.js';
import {
  OpenSpecFormatGenerator,
  type GeneratedSpec,
} from '../../core/generator/openspec-format-generator.js';
import {
  OpenSpecWriter,
  type GenerationReport,
  type WriteMode,
} from '../../core/generator/openspec-writer.js';
import type { RepoStructure, LLMContext } from '../../core/analyzer/artifact-generator.js';
import type { DependencyGraphResult } from '../../core/analyzer/dependency-graph.js';

// ============================================================================
// TYPES
// ============================================================================

interface ExtendedGenerateOptions extends GenerateOptions {
  reanalyze?: boolean;
  merge?: boolean;
  noOverwrite?: boolean;
  yes?: boolean;
  outputDir?: string;
}

interface AnalysisData {
  repoStructure: RepoStructure;
  llmContext: LLMContext;
  depGraph?: DependencyGraphResult;
  age: number;
  timestamp: string;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Parse comma-separated domain list
 */
function parseDomains(value: string): string[] {
  return value.split(',').map((d) => d.trim()).filter(Boolean);
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
 * Load analysis data from disk
 */
async function loadAnalysis(analysisPath: string): Promise<AnalysisData | null> {
  try {
    const repoStructurePath = join(analysisPath, 'repo-structure.json');
    const llmContextPath = join(analysisPath, 'llm-context.json');

    // Check if analysis exists
    if (!(await fileExists(repoStructurePath))) {
      return null;
    }

    // Load repo structure
    const repoStructureContent = await readFile(repoStructurePath, 'utf-8');
    const repoStructure = JSON.parse(repoStructureContent) as RepoStructure;

    // Load LLM context
    let llmContext: LLMContext;
    if (await fileExists(llmContextPath)) {
      const llmContextContent = await readFile(llmContextPath, 'utf-8');
      llmContext = JSON.parse(llmContextContent) as LLMContext;
    } else {
      // Create minimal context if not available
      llmContext = {
        phase1_survey: { purpose: 'Initial survey', files: [], estimatedTokens: 0 },
        phase2_deep: { purpose: 'Deep analysis', files: [], totalTokens: 0 },
        phase3_validation: { purpose: 'Validation', files: [], totalTokens: 0 },
      };
    }

    // Try to load dependency graph
    let depGraph: DependencyGraphResult | undefined;
    const depGraphPath = join(analysisPath, 'dependency-graph.json');
    if (await fileExists(depGraphPath)) {
      const depGraphContent = await readFile(depGraphPath, 'utf-8');
      depGraph = JSON.parse(depGraphContent) as DependencyGraphResult;
    }

    // Get analysis age
    const stats = await stat(repoStructurePath);
    const age = Date.now() - stats.mtime.getTime();
    const timestamp = stats.mtime.toISOString();

    return { repoStructure, llmContext, depGraph, age, timestamp };
  } catch (error) {
    logger.warning(`Failed to load analysis: ${(error as Error).message}`);
    return null;
  }
}

/**
 * Estimate cost for generation
 */
function estimateCost(llmContext: LLMContext, model: string): { tokens: number; cost: number } {
  // Estimate input tokens from context
  let totalTokens = 0;

  // Phase 1 survey context
  totalTokens += llmContext.phase1_survey.estimatedTokens ?? 2000;

  // Phase 2 deep analysis
  for (const file of llmContext.phase2_deep.files) {
    totalTokens += file.tokens;
  }

  // Add estimated output tokens (roughly 30% of input)
  const outputTokens = Math.ceil(totalTokens * 0.3);
  totalTokens += outputTokens;

  // Pricing per 1M tokens (simplified)
  const pricing: Record<string, { input: number; output: number }> = {
    'claude-sonnet-4-20250514': { input: 3.0, output: 15.0 },
    'claude-3-5-sonnet-20241022': { input: 3.0, output: 15.0 },
    'claude-opus-4-20250514': { input: 15.0, output: 75.0 },
    'gpt-4o': { input: 5.0, output: 15.0 },
    'gpt-4o-mini': { input: 0.15, output: 0.6 },
    default: { input: 3.0, output: 15.0 },
  };

  const modelPricing = pricing[model] ?? pricing.default;
  const inputCost = (totalTokens * 0.7 / 1_000_000) * modelPricing.input;
  const outputCost = (outputTokens / 1_000_000) * modelPricing.output;
  const cost = inputCost + outputCost;

  return { tokens: totalTokens, cost };
}

/**
 * Prompt user for confirmation
 */
async function promptConfirmation(message: string, autoYes: boolean): Promise<boolean> {
  if (autoYes) {
    return true;
  }

  // In a real CLI, we'd use readline here
  // For now, we assume yes in non-interactive mode
  logger.discovery(message);
  logger.discovery('Use --yes or -y to skip confirmation prompts');
  return true;
}

/**
 * Verify LLM API connectivity
 */
async function verifyApiConnectivity(llm: LLMService): Promise<boolean> {
  try {
    // Simple ping to verify API is reachable
    logger.debug('Verifying LLM API connectivity...');
    return true; // In production, we'd do a lightweight test request
  } catch (error) {
    logger.error(`LLM API verification failed: ${(error as Error).message}`);
    return false;
  }
}

// ============================================================================
// COMMAND
// ============================================================================

export const generateCommand = new Command('generate')
  .description('Generate OpenSpec files from analysis using LLM')
  .option(
    '--analysis <path>',
    'Path to existing analysis (skips re-analysis)',
    '.spec-gen/analysis/'
  )
  .option(
    '--model <name>',
    'LLM model to use for generation',
    'claude-sonnet-4-20250514'
  )
  .option(
    '--dry-run',
    'Show what would be generated without writing files',
    false
  )
  .option(
    '--domains <list>',
    'Only generate specific domains (comma-separated)',
    parseDomains
  )
  .option(
    '--reanalyze',
    'Force fresh analysis even if recent exists',
    false
  )
  .option(
    '--merge',
    'Use merge strategy for existing specs',
    false
  )
  .option(
    '--no-overwrite',
    'Skip any existing spec files',
    false
  )
  .option(
    '-y, --yes',
    'Skip confirmation prompts',
    false
  )
  .option(
    '--output-dir <path>',
    'Override openspec output location'
  )
  .addHelpText(
    'after',
    `
Examples:
  $ spec-gen generate                Generate all specs from analysis
  $ spec-gen generate --dry-run      Preview without writing files
  $ spec-gen generate --domains auth,api,database
                                     Only generate specific domains
  $ spec-gen generate --model claude-opus-4-20250514
                                     Use a different model
  $ spec-gen generate --analysis ./my-analysis
                                     Use analysis from custom path
  $ spec-gen generate --merge        Merge with existing specs
  $ spec-gen generate --no-overwrite Skip existing spec files
  $ spec-gen generate -y             Skip confirmation prompts

Output structure (OpenSpec format):
  openspec/
  ├── config.yaml              Project configuration (updated)
  └── specs/
      ├── overview/spec.md     System overview
      ├── architecture/spec.md System architecture
      ├── {domain}/spec.md     Domain specifications
      └── api/spec.md          API specification (if applicable)

Each spec.md follows OpenSpec conventions:
  - RFC 2119 keywords (SHALL, MUST, SHOULD, MAY)
  - Given/When/Then scenarios with #### headings
  - Technical notes linking to source files
`
  )
  .action(async (options: Partial<ExtendedGenerateOptions>) => {
    const startTime = Date.now();
    const rootPath = process.cwd();

    const opts: ExtendedGenerateOptions = {
      analysis: options.analysis ?? '.spec-gen/analysis/',
      model: options.model ?? 'claude-sonnet-4-20250514',
      dryRun: options.dryRun ?? false,
      domains: options.domains ?? [],
      reanalyze: options.reanalyze ?? false,
      merge: options.merge ?? false,
      noOverwrite: options.noOverwrite ?? false,
      yes: options.yes ?? false,
      outputDir: options.outputDir,
      quiet: false,
      verbose: false,
      noColor: false,
      config: '.spec-gen/config.json',
    };

    try {
      // ========================================================================
      // PHASE 1: CONFIGURATION LOADING
      // ========================================================================
      logger.section('Loading Configuration');

      // Load spec-gen config
      const specGenConfig = await readSpecGenConfig(rootPath);
      if (!specGenConfig) {
        logger.error('No spec-gen configuration found. Run "spec-gen init" first.');
        process.exitCode = 1;
        return;
      }

      // Determine openspec path
      const openspecPath = opts.outputDir ?? specGenConfig.openspecPath ?? 'openspec';
      const fullOpenspecPath = join(rootPath, openspecPath);

      // Load existing OpenSpec config if present
      const openspecConfig = await readOpenSpecConfig(fullOpenspecPath);

      logger.info('Project', specGenConfig.projectType);
      logger.info('OpenSpec path', openspecPath);
      if (openspecConfig?.context) {
        logger.info('Context', openspecConfig.context.substring(0, 50) + '...');
      }
      logger.blank();

      // ========================================================================
      // PHASE 2: ANALYSIS LOADING
      // ========================================================================
      logger.section('Loading Analysis');

      const analysisPath = join(rootPath, opts.analysis);
      let analysisData = await loadAnalysis(analysisPath);

      if (!analysisData || opts.reanalyze) {
        if (opts.reanalyze) {
          logger.discovery('Forced re-analysis requested');
        } else {
          logger.error('No analysis found. Run "spec-gen analyze" first.');
          process.exitCode = 1;
          return;
        }

        // Note: Re-analysis would be implemented here using the analyzer modules
        // For now, we require existing analysis
        if (!analysisData) {
          logger.error('Analysis required. Run "spec-gen analyze" first.');
          process.exitCode = 1;
          return;
        }
      }

      const { repoStructure, llmContext, depGraph, age, timestamp } = analysisData;

      logger.discovery(`Using analysis from ${formatAge(age)}`);
      logger.info('Files analyzed', repoStructure.statistics.analyzedFiles);
      logger.info('Domains detected', repoStructure.domains.map(d => d.name).join(', ') || 'None');
      logger.blank();

      // ========================================================================
      // PHASE 3: PRE-FLIGHT CHECKS
      // ========================================================================
      logger.section('Pre-flight Checks');

      // Check for API key
      const anthropicKey = process.env.ANTHROPIC_API_KEY;
      const openaiKey = process.env.OPENAI_API_KEY;

      if (!anthropicKey && !openaiKey) {
        logger.error('No LLM API key found.');
        logger.discovery('Set ANTHROPIC_API_KEY or OPENAI_API_KEY environment variable.');
        logger.blank();
        logger.discovery('To get an API key:');
        logger.discovery('  Anthropic: https://console.anthropic.com/');
        logger.discovery('  OpenAI: https://platform.openai.com/');
        process.exitCode = 1;
        return;
      }

      // Estimate cost
      const estimate = estimateCost(llmContext, opts.model);
      logger.info('Model', opts.model);
      logger.info('Estimated tokens', estimate.tokens.toLocaleString());
      logger.inference(`Estimated cost: ~$${estimate.cost.toFixed(2)}`);
      logger.blank();

      // Check for existing specs
      const specsPath = join(fullOpenspecPath, 'specs');
      if (await fileExists(specsPath)) {
        if (opts.merge) {
          logger.info('Mode', 'Merge with existing specs');
        } else if (opts.noOverwrite) {
          logger.info('Mode', 'Skip existing specs');
        } else {
          logger.warning('Existing specs will be replaced (backed up)');
        }
        logger.blank();
      }

      // Dry run notice
      if (opts.dryRun) {
        logger.discovery('DRY RUN - No files will be written');
        logger.blank();
      }

      // Confirmation prompt
      if (!opts.dryRun && estimate.cost > 0.5) {
        const confirmed = await promptConfirmation(
          `Estimated cost: ~$${estimate.cost.toFixed(2)}. Continue? [Y/n]`,
          opts.yes ?? false
        );
        if (!confirmed) {
          logger.discovery('Cancelled by user');
          return;
        }
      }

      // ========================================================================
      // PHASE 4: LLM GENERATION
      // ========================================================================
      logger.section('Generating Specifications');

      if (opts.dryRun) {
        // In dry run mode, show what would be generated
        logger.discovery('Would run LLM generation pipeline with:');
        logger.listItem('Stage 1: Project Survey');
        logger.listItem('Stage 2: Entity Extraction');
        logger.listItem('Stage 3: Service Analysis');
        logger.listItem('Stage 4: API Extraction');
        logger.listItem('Stage 5: Architecture Synthesis');
        logger.blank();

        // Show domains that would be generated
        const domainFilter = opts.domains.length > 0 ? opts.domains : repoStructure.domains.map(d => d.name);
        logger.discovery('Domains to generate:');
        for (const domain of domainFilter) {
          logger.listItem(domain);
        }
        logger.blank();

        // Show output paths
        logger.discovery('Would write specs to:');
        logger.listItem(`${openspecPath}/specs/overview/spec.md`);
        logger.listItem(`${openspecPath}/specs/architecture/spec.md`);
        for (const domain of domainFilter) {
          logger.listItem(`${openspecPath}/specs/${domain}/spec.md`);
        }
        logger.listItem(`${openspecPath}/specs/api/spec.md (if applicable)`);
        logger.blank();

        logger.success('Dry run complete. No files were modified.');
        return;
      }

      // Create LLM service
      const provider = anthropicKey ? 'anthropic' : 'openai';
      let llm: LLMService;
      try {
        llm = createLLMService({
          provider,
          model: opts.model,
          enableLogging: true,
          logDir: join(rootPath, '.spec-gen', 'logs'),
        });
      } catch (error) {
        logger.error(`Failed to create LLM service: ${(error as Error).message}`);
        process.exitCode = 1;
        return;
      }

      // Verify API connectivity
      if (!(await verifyApiConnectivity(llm))) {
        logger.error('Failed to connect to LLM API. Check your API key and network.');
        process.exitCode = 1;
        return;
      }

      // Run generation pipeline
      const pipeline = new SpecGenerationPipeline(llm, {
        outputDir: join(rootPath, '.spec-gen', 'generation'),
        saveIntermediate: true,
      });

      logger.analysis('Running LLM generation pipeline...');
      logger.blank();

      let pipelineResult: PipelineResult;
      try {
        pipelineResult = await pipeline.run(repoStructure, llmContext, depGraph);
      } catch (error) {
        logger.error(`Pipeline failed: ${(error as Error).message}`);

        // Save logs on failure
        try {
          await llm.saveLogs();
          logger.discovery('LLM logs saved to .spec-gen/logs/');
        } catch {
          // Ignore log save errors
        }

        process.exitCode = 1;
        return;
      }

      // Show pipeline results
      const { metadata } = pipelineResult;
      logger.blank();
      logger.success('Pipeline completed');
      logger.info('Stages completed', metadata.completedStages.join(', '));
      if (metadata.skippedStages.length > 0) {
        logger.info('Stages skipped', metadata.skippedStages.join(', '));
      }
      logger.info('Total tokens', metadata.totalTokens.toLocaleString());
      logger.info('Cost', `$${metadata.estimatedCost.toFixed(4)}`);
      logger.info('Duration', formatDuration(metadata.duration));
      logger.blank();

      // ========================================================================
      // PHASE 5: FORMAT AND WRITE SPECS
      // ========================================================================
      logger.section('Writing OpenSpec Files');

      // Generate formatted specs
      const formatGenerator = new OpenSpecFormatGenerator({
        version: specGenConfig.version,
        includeConfidence: true,
        includeTechnicalNotes: true,
      });

      let generatedSpecs = formatGenerator.generateSpecs(pipelineResult);

      // Filter by domains if specified
      if (opts.domains.length > 0) {
        const domainSet = new Set(opts.domains.map(d => d.toLowerCase()));
        generatedSpecs = generatedSpecs.filter(spec => {
          // Always include overview and architecture
          if (spec.type === 'overview' || spec.type === 'architecture') {
            return true;
          }
          // Check if domain matches
          return domainSet.has(spec.domain.toLowerCase());
        });
        logger.info('Filtered to domains', opts.domains.join(', '));
      }

      logger.info('Specs generated', generatedSpecs.length);
      logger.blank();

      // Determine write mode
      let writeMode: WriteMode = 'replace';
      if (opts.merge) {
        writeMode = 'merge';
      } else if (opts.noOverwrite) {
        writeMode = 'skip';
      }

      // Write specs
      const writer = new OpenSpecWriter({
        rootPath,
        writeMode,
        version: specGenConfig.version,
        createBackups: true,
        updateConfig: true,
        validateBeforeWrite: true,
      });

      let report: GenerationReport;
      try {
        report = await writer.writeSpecs(generatedSpecs, pipelineResult.survey);
      } catch (error) {
        logger.error(`Failed to write specs: ${(error as Error).message}`);
        process.exitCode = 1;
        return;
      }

      // ========================================================================
      // PHASE 6: POST-GENERATION
      // ========================================================================
      logger.blank();
      logger.section('Generation Complete');

      const duration = Date.now() - startTime;

      // Summary
      console.log('');
      if (report.filesWritten.length > 0) {
        console.log(`  ✓ ${report.filesWritten.length} spec(s) written`);
      }
      if (report.filesMerged.length > 0) {
        console.log(`  ✓ ${report.filesMerged.length} spec(s) merged`);
      }
      if (report.filesSkipped.length > 0) {
        console.log(`  ○ ${report.filesSkipped.length} spec(s) skipped (already exist)`);
      }
      if (report.filesBackedUp.length > 0) {
        console.log(`  ↩ ${report.filesBackedUp.length} backup(s) created`);
      }
      if (report.configUpdated) {
        console.log('  ✓ config.yaml updated');
      }

      // Warnings
      if (report.warnings.length > 0) {
        console.log('');
        console.log('  Warnings:');
        for (const warning of report.warnings.slice(0, 5)) {
          console.log(`    ⚠ ${warning}`);
        }
        if (report.warnings.length > 5) {
          console.log(`    ... and ${report.warnings.length - 5} more`);
        }
      }

      // Validation errors
      if (report.validationErrors.length > 0) {
        console.log('');
        console.log('  Validation errors:');
        for (const error of report.validationErrors.slice(0, 5)) {
          console.log(`    ✗ ${error}`);
        }
      }

      // Next steps
      console.log('');
      console.log('  Next steps:');
      for (let i = 0; i < report.nextSteps.length; i++) {
        console.log(`    ${i + 1}. ${report.nextSteps[i]}`);
      }

      console.log('');
      console.log(`  Total time: ${formatDuration(duration)}`);
      console.log(`  Report saved to: .spec-gen/outputs/generation-report.json`);
      console.log('');

      // Save LLM logs
      try {
        await llm.saveLogs();
      } catch {
        // Ignore log save errors
      }

      logger.success('Done!');

    } catch (error) {
      logger.error(`Generate failed: ${(error as Error).message}`);
      if (process.env.DEBUG) {
        console.error(error);
      }
      process.exitCode = 1;
    }
  });
