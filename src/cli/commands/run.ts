/**
 * spec-gen run command (default pipeline)
 *
 * Runs the full pipeline: init → analyze → generate in sequence.
 * Smart defaults skip unnecessary steps and detect existing setups.
 */

import { Command } from 'commander';
import { access, stat, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { confirm } from '@inquirer/prompts';
import { logger } from '../../utils/logger.js';
import type { ProjectType } from '../../types/index.js';
import {
  detectProjectType,
  getProjectTypeName,
} from '../../core/services/project-detector.js';
import {
  getDefaultConfig,
  readSpecGenConfig,
  writeSpecGenConfig,
  specGenConfigExists,
  openspecDirExists,
  createOpenSpecStructure,
  readOpenSpecConfig,
} from '../../core/services/config-manager.js';
import {
  gitignoreExists,
  isInGitignore,
  addToGitignore,
} from '../../core/services/gitignore-manager.js';
import { runAnalysis } from './analyze.js';
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
} from '../../core/generator/openspec-format-generator.js';
import {
  OpenSpecWriter,
  type GenerationReport,
} from '../../core/generator/openspec-writer.js';
import type { RepoStructure, LLMContext } from '../../core/analyzer/artifact-generator.js';
import type { DependencyGraphResult } from '../../core/analyzer/dependency-graph.js';

// ============================================================================
// TYPES
// ============================================================================

interface RunOptions {
  force: boolean;
  reanalyze: boolean;
  model: string;
  dryRun: boolean;
  yes: boolean;
  maxFiles: number;
}

interface RunMetadata {
  version: string;
  timestamp: string;
  duration: number;
  steps: {
    init: { status: 'skipped' | 'completed'; reason?: string };
    analyze: { status: 'skipped' | 'completed'; reason?: string; filesAnalyzed?: number };
    generate: { status: 'skipped' | 'completed'; reason?: string; specsGenerated?: number };
  };
  result: 'success' | 'failure';
  error?: string;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

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
 * Get analysis age if it exists
 */
async function getAnalysisAge(analysisPath: string): Promise<number | null> {
  try {
    const repoStructurePath = join(analysisPath, 'repo-structure.json');
    if (!(await fileExists(repoStructurePath))) {
      return null;
    }
    const stats = await stat(repoStructurePath);
    return Date.now() - stats.mtime.getTime();
  } catch {
    return null;
  }
}

/**
 * Load analysis data from disk
 */
async function loadAnalysis(analysisPath: string): Promise<{
  repoStructure: RepoStructure;
  llmContext: LLMContext;
  depGraph?: DependencyGraphResult;
  age: number;
} | null> {
  try {
    const repoStructurePath = join(analysisPath, 'repo-structure.json');
    const llmContextPath = join(analysisPath, 'llm-context.json');
    const depGraphPath = join(analysisPath, 'dependency-graph.json');

    if (!(await fileExists(repoStructurePath))) {
      return null;
    }

    const repoStructureContent = await readFile(repoStructurePath, 'utf-8');
    const repoStructure = JSON.parse(repoStructureContent) as RepoStructure;

    let llmContext: LLMContext;
    if (await fileExists(llmContextPath)) {
      const llmContextContent = await readFile(llmContextPath, 'utf-8');
      llmContext = JSON.parse(llmContextContent) as LLMContext;
    } else {
      llmContext = {
        phase1_survey: { purpose: 'Initial survey', files: [], estimatedTokens: 0 },
        phase2_deep: { purpose: 'Deep analysis', files: [], totalTokens: 0 },
        phase3_validation: { purpose: 'Validation', files: [], totalTokens: 0 },
      };
    }

    let depGraph: DependencyGraphResult | undefined;
    if (await fileExists(depGraphPath)) {
      const depGraphContent = await readFile(depGraphPath, 'utf-8');
      depGraph = JSON.parse(depGraphContent) as DependencyGraphResult;
    }

    const stats = await stat(repoStructurePath);
    const age = Date.now() - stats.mtime.getTime();

    return { repoStructure, llmContext, depGraph, age };
  } catch {
    return null;
  }
}

/**
 * Estimate cost for generation
 */
function estimateCost(llmContext: LLMContext, model: string): { tokens: number; cost: number } {
  let totalTokens = 0;
  totalTokens += llmContext.phase1_survey.estimatedTokens ?? 2000;
  for (const file of llmContext.phase2_deep.files) {
    totalTokens += file.tokens;
  }
  const outputTokens = Math.ceil(totalTokens * 0.3);
  totalTokens += outputTokens;

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
 * Save run metadata
 */
async function saveRunMetadata(rootPath: string, metadata: RunMetadata): Promise<void> {
  const runsDir = join(rootPath, '.spec-gen', 'runs');
  await mkdir(runsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${timestamp}.json`;

  await writeFile(
    join(runsDir, filename),
    JSON.stringify(metadata, null, 2)
  );
}

/**
 * Display the pipeline banner
 */
function displayBanner(projectName: string, projectType: string, rootPath: string): void {
  console.log('');
  console.log('╭─────────────────────────────────────────────────────╮');
  console.log('│  spec-gen v1.0.0 — OpenSpec Reverse Engineering Tool │');
  console.log('╰─────────────────────────────────────────────────────╯');
  console.log('');
  console.log(`  Project: ${projectName}`);
  console.log(`  Type: ${projectType}`);
  console.log(`  Path: ${rootPath}`);
  console.log('');
}

/**
 * Display the completion banner
 */
function displayCompletionBanner(): void {
  console.log('');
  console.log('╭─────────────────────────────────────────────────────╮');
  console.log('│  Specifications generated successfully!              │');
  console.log('│                                                      │');
  console.log('│  Review your specs:  openspec list --specs          │');
  console.log('│  Validate structure: openspec validate --all        │');
  console.log('│  Test accuracy:      spec-gen verify                │');
  console.log('│  Start a change:     openspec change my-feature     │');
  console.log('╰─────────────────────────────────────────────────────╯');
  console.log('');
}

// ============================================================================
// COMMAND
// ============================================================================

export const runCommand = new Command('run')
  .description('Run the full spec-gen pipeline (init → analyze → generate)')
  .option(
    '--force',
    'Reinitialize even if config exists',
    false
  )
  .option(
    '--reanalyze',
    'Force fresh analysis even if recent exists',
    false
  )
  .option(
    '--model <name>',
    'LLM model to use for generation',
    'claude-sonnet-4-20250514'
  )
  .option(
    '--dry-run',
    'Show what would be done without making changes',
    false
  )
  .option(
    '-y, --yes',
    'Skip all confirmation prompts',
    false
  )
  .option(
    '--max-files <n>',
    'Maximum files to analyze',
    '500'
  )
  .addHelpText(
    'after',
    `
Examples:
  $ spec-gen run                     Run full pipeline with smart defaults
  $ spec-gen run --force             Reinitialize and re-analyze
  $ spec-gen run --reanalyze         Force fresh analysis
  $ spec-gen run --model claude-opus-4-20250514
                                     Use a different model
  $ spec-gen run --dry-run           Preview what would happen
  $ spec-gen run -y                  Skip all prompts

Smart Defaults:
  - Skips init if .spec-gen/config.json exists
  - Skips analyze if recent analysis exists (< 1 hour old)
  - Always runs generate (the main purpose)
  - Detects and works with existing openspec/ setup

The pipeline saves run metadata to .spec-gen/runs/ for tracking.
`
  )
  .action(async (options: Partial<RunOptions>) => {
    const startTime = Date.now();
    const rootPath = process.cwd();

    const opts: RunOptions = {
      force: options.force ?? false,
      reanalyze: options.reanalyze ?? false,
      model: options.model ?? 'claude-sonnet-4-20250514',
      dryRun: options.dryRun ?? false,
      yes: options.yes ?? false,
      maxFiles: typeof options.maxFiles === 'string'
        ? parseInt(options.maxFiles, 10)
        : options.maxFiles ?? 500,
    };

    const metadata: RunMetadata = {
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      duration: 0,
      steps: {
        init: { status: 'skipped' },
        analyze: { status: 'skipped' },
        generate: { status: 'skipped' },
      },
      result: 'success',
    };

    try {
      // ========================================================================
      // PRE-FLIGHT: DETECT PROJECT
      // ========================================================================
      const detection = await detectProjectType(rootPath);
      const projectName = basename(rootPath);
      const projectTypeName = getProjectTypeName(detection.projectType);

      displayBanner(projectName, projectTypeName, rootPath);

      if (opts.dryRun) {
        logger.discovery('DRY RUN - No changes will be made');
        console.log('');
      }

      // ========================================================================
      // STEP 1/3: INITIALIZATION
      // ========================================================================
      console.log('[Step 1/3] Initialization');

      const configExists = await specGenConfigExists(rootPath);
      let specGenConfig = configExists ? await readSpecGenConfig(rootPath) : null;

      if (configExists && !opts.force) {
        console.log('   ✓ Configuration exists (.spec-gen/config.json)');
        metadata.steps.init = { status: 'skipped', reason: 'Config exists' };
      } else {
        if (opts.dryRun) {
          console.log('   → Would create .spec-gen/config.json');
          console.log(`   → Would detect project type: ${projectTypeName}`);
        } else {
          // Create config
          const openspecPath = './openspec';
          specGenConfig = getDefaultConfig(detection.projectType, openspecPath);
          await writeSpecGenConfig(rootPath, specGenConfig);
          console.log('   ✓ Created .spec-gen/config.json');

          // Create openspec directory if needed
          const fullOpenspecPath = join(rootPath, openspecPath);
          if (!(await openspecDirExists(fullOpenspecPath))) {
            await createOpenSpecStructure(fullOpenspecPath);
            console.log('   ✓ Created openspec/ directory');
          } else {
            console.log('   ✓ OpenSpec directory exists (./openspec)');
          }

          // Update gitignore
          const hasGitignore = await gitignoreExists(rootPath);
          if (hasGitignore) {
            const alreadyIgnored = await isInGitignore(rootPath, '.spec-gen/');
            if (!alreadyIgnored) {
              await addToGitignore(rootPath, '.spec-gen/', 'spec-gen analysis artifacts');
              console.log('   ✓ Added .spec-gen/ to .gitignore');
            }
          }

          metadata.steps.init = { status: 'completed' };
        }
      }

      // Ensure we have config
      if (!specGenConfig && !opts.dryRun) {
        specGenConfig = await readSpecGenConfig(rootPath);
        if (!specGenConfig) {
          throw new Error('Failed to load configuration');
        }
      }

      // Check openspec directory
      const openspecPath = specGenConfig?.openspecPath ?? './openspec';
      const fullOpenspecPath = join(rootPath, openspecPath);
      if (await openspecDirExists(fullOpenspecPath)) {
        console.log(`   ✓ OpenSpec directory exists (${openspecPath})`);
      }

      console.log('');

      // ========================================================================
      // STEP 2/3: ANALYSIS
      // ========================================================================
      console.log('[Step 2/3] Analysis');

      const analysisPath = join(rootPath, '.spec-gen', 'analysis');
      const analysisAge = await getAnalysisAge(analysisPath);
      const oneHour = 60 * 60 * 1000;

      let analysisData: {
        repoStructure: RepoStructure;
        llmContext: LLMContext;
        depGraph?: DependencyGraphResult;
        age: number;
      } | null = null;

      if (analysisAge !== null && analysisAge < oneHour && !opts.reanalyze && !opts.force) {
        // Use existing analysis
        console.log(`   ✓ Recent analysis found (${formatAge(analysisAge)})`);

        analysisData = await loadAnalysis(analysisPath);
        if (analysisData) {
          const { repoStructure } = analysisData;
          console.log(`   Using existing analysis: ${repoStructure.statistics.analyzedFiles} files, ${repoStructure.domains.length} domains`);
          console.log(`   Detected domains: ${repoStructure.domains.map(d => d.name).join(', ') || 'None'}`);
          metadata.steps.analyze = {
            status: 'skipped',
            reason: `Recent analysis (${formatAge(analysisAge)})`,
            filesAnalyzed: repoStructure.statistics.analyzedFiles,
          };
        }
      }

      if (!analysisData) {
        if (opts.dryRun) {
          console.log('   → Would scan codebase for files');
          console.log('   → Would build dependency graph');
          console.log('   → Would generate analysis artifacts');
        } else {
          console.log('   Running analysis...');

          await mkdir(analysisPath, { recursive: true });

          const result = await runAnalysis(rootPath, analysisPath, {
            maxFiles: opts.maxFiles,
            include: [],
            exclude: [],
          });

          analysisData = {
            repoStructure: result.artifacts.repoStructure,
            llmContext: result.artifacts.llmContext,
            depGraph: result.depGraph,
            age: 0,
          };

          console.log(`   ✓ Analyzed ${result.repoMap.summary.analyzedFiles} files`);
          console.log(`   ✓ Found ${result.depGraph.statistics.clusterCount} clusters`);
          console.log(`   Detected domains: ${result.artifacts.repoStructure.domains.map(d => d.name).join(', ') || 'None'}`);

          metadata.steps.analyze = {
            status: 'completed',
            filesAnalyzed: result.repoMap.summary.analyzedFiles,
          };
        }
      }

      console.log('');

      // ========================================================================
      // STEP 3/3: GENERATION
      // ========================================================================
      console.log('[Step 3/3] Generation');

      if (!analysisData && !opts.dryRun) {
        throw new Error('No analysis data available for generation');
      }

      // Check for API key
      const anthropicKey = process.env.ANTHROPIC_API_KEY;
      const openaiKey = process.env.OPENAI_API_KEY;

      if (!anthropicKey && !openaiKey) {
        console.log('   ✗ No LLM API key found');
        console.log('');
        logger.error('Set ANTHROPIC_API_KEY or OPENAI_API_KEY environment variable.');
        logger.discovery('To get an API key:');
        logger.discovery('  Anthropic: https://console.anthropic.com/');
        logger.discovery('  OpenAI: https://platform.openai.com/');
        metadata.result = 'failure';
        metadata.error = 'No LLM API key';
        process.exitCode = 1;
        return;
      }

      // Estimate cost
      if (analysisData) {
        const estimate = estimateCost(analysisData.llmContext, opts.model);
        console.log(`   Estimated cost: ~$${estimate.cost.toFixed(2)}`);

        // Confirmation prompt
        if (!opts.dryRun && !opts.yes && estimate.cost > 0.1) {
          if (process.stdin.isTTY) {
            const shouldContinue = await confirm({
              message: `Estimated cost: ~$${estimate.cost.toFixed(2)}. Continue?`,
              default: true,
            });
            if (!shouldContinue) {
              console.log('   Cancelled by user');
              metadata.result = 'failure';
              metadata.error = 'Cancelled by user';
              return;
            }
          }
        }
      }

      if (opts.dryRun) {
        console.log('');
        console.log('   → Would run LLM generation pipeline:');
        console.log('   ├─ Project Survey');
        console.log('   ├─ Entity Extraction');
        console.log('   ├─ Service Analysis');
        console.log('   ├─ API Extraction');
        console.log('   └─ Architecture Synthesis');
        console.log('');
        console.log('   → Would write specifications:');
        console.log(`   ├─ ${openspecPath}/specs/overview/spec.md`);
        console.log(`   ├─ ${openspecPath}/specs/architecture/spec.md`);
        if (analysisData) {
          for (const domain of analysisData.repoStructure.domains.slice(0, 5)) {
            console.log(`   ├─ ${openspecPath}/specs/${domain.name}/spec.md`);
          }
        }
        console.log(`   └─ ${openspecPath}/specs/api/spec.md (if applicable)`);
        console.log('');
        console.log('DRY RUN COMPLETE - No changes were made');
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
        throw new Error(`Failed to create LLM service: ${(error as Error).message}`);
      }

      console.log('');
      console.log('   Generating specifications...');

      // Run generation pipeline
      const pipeline = new SpecGenerationPipeline(llm, {
        outputDir: join(rootPath, '.spec-gen', 'generation'),
        saveIntermediate: true,
      });

      let pipelineResult: PipelineResult;
      try {
        pipelineResult = await pipeline.run(
          analysisData!.repoStructure,
          analysisData!.llmContext,
          analysisData!.depGraph
        );
      } catch (error) {
        await llm.saveLogs().catch(() => {});
        throw new Error(`Pipeline failed: ${(error as Error).message}`);
      }

      console.log('   ├─ Project Survey ✓');
      console.log('   ├─ Entity Extraction ✓');
      console.log('   ├─ Service Analysis ✓');
      console.log('   ├─ API Extraction ✓');
      console.log('   └─ Architecture Synthesis ✓');
      console.log('');

      // Format and write specs
      console.log('   Writing OpenSpec specifications...');

      const formatGenerator = new OpenSpecFormatGenerator({
        version: specGenConfig?.version ?? '1.0.0',
        includeConfidence: true,
        includeTechnicalNotes: true,
      });

      const generatedSpecs = formatGenerator.generateSpecs(pipelineResult);

      const writer = new OpenSpecWriter({
        rootPath,
        writeMode: 'replace',
        version: specGenConfig?.version ?? '1.0.0',
        createBackups: true,
        updateConfig: true,
        validateBeforeWrite: true,
      });

      let report: GenerationReport;
      try {
        report = await writer.writeSpecs(generatedSpecs, pipelineResult.survey);
      } catch (error) {
        throw new Error(`Failed to write specs: ${(error as Error).message}`);
      }

      // Display written files
      for (let i = 0; i < report.filesWritten.length; i++) {
        const file = report.filesWritten[i];
        const isLast = i === report.filesWritten.length - 1;
        const prefix = isLast ? '└─' : '├─';
        console.log(`   ${prefix} ${file} ✓`);
      }

      // Save LLM logs
      await llm.saveLogs().catch(() => {});

      metadata.steps.generate = {
        status: 'completed',
        specsGenerated: report.filesWritten.length,
      };

      // ========================================================================
      // COMPLETION
      // ========================================================================
      displayCompletionBanner();

      const duration = Date.now() - startTime;
      metadata.duration = duration;

      console.log(`   Full report: .spec-gen/outputs/generation-report.json`);
      console.log(`   Total time: ${formatDuration(duration)}`);
      console.log('');

      // Save run metadata
      await saveRunMetadata(rootPath, metadata);

    } catch (error) {
      const duration = Date.now() - startTime;
      metadata.duration = duration;
      metadata.result = 'failure';
      metadata.error = (error as Error).message;

      await saveRunMetadata(rootPath, metadata).catch(() => {});

      logger.error(`Pipeline failed: ${(error as Error).message}`);
      if (process.env.DEBUG) {
        console.error(error);
      }
      process.exitCode = 1;
    }
  });

/**
 * Create the default action for spec-gen (no subcommand)
 * This wraps runCommand to be used as the default action
 */
export async function runDefaultPipeline(path: string, options: Partial<RunOptions>): Promise<void> {
  // Change to the specified path if provided and different from cwd
  if (path && path !== '.') {
    process.chdir(path);
  }

  // Invoke the run command action
  await runCommand.parseAsync(['node', 'spec-gen', 'run', ...(options.yes ? ['-y'] : [])], { from: 'user' });
}
