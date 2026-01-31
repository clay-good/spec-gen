/**
 * Progress indicators for spec-gen CLI
 * Uses ora for spinners with meaningful status messages
 */

import ora, { Ora } from 'ora';

export interface ProgressOptions {
  /** Whether to show the spinner (false for non-TTY) */
  enabled?: boolean;
  /** Prefix for log messages */
  prefix?: string;
}

export interface FileDiscoveryProgress {
  found: number;
  directories: number;
  currentFile?: string;
}

export interface AnalysisProgress {
  phase: 'imports' | 'scoring' | 'graph' | 'clustering';
  current?: string;
  processed?: number;
  total?: number;
}

export interface GenerationProgress {
  stage: number;
  totalStages: number;
  stageName: string;
  tokensUsed?: number;
}

export interface WritingProgress {
  current: number;
  total: number;
  currentFile?: string;
}

/**
 * Progress manager for CLI operations
 */
export class ProgressIndicator {
  private spinner: Ora | null = null;
  private enabled: boolean;
  private prefix: string;
  private verbose: boolean;
  private logs: string[] = [];

  constructor(options: ProgressOptions & { verbose?: boolean } = {}) {
    this.enabled = options.enabled ?? process.stdout.isTTY ?? false;
    this.prefix = options.prefix ?? '';
    this.verbose = options.verbose ?? false;
  }

  /**
   * Start a new spinner with a message
   */
  start(message: string): void {
    if (this.enabled) {
      this.spinner = ora({
        text: this.formatMessage(message),
        prefixText: this.prefix,
      }).start();
    } else {
      this.log(message);
    }
  }

  /**
   * Update the spinner text
   */
  update(message: string): void {
    if (this.spinner && this.enabled) {
      this.spinner.text = this.formatMessage(message);
    } else if (!this.enabled) {
      this.log(message);
    }
  }

  /**
   * Mark the current task as successful
   */
  succeed(message?: string): void {
    if (this.spinner && this.enabled) {
      this.spinner.succeed(message ? this.formatMessage(message) : undefined);
      this.spinner = null;
    } else if (message) {
      this.log(`✓ ${message}`);
    }
  }

  /**
   * Mark the current task as failed
   */
  fail(message?: string): void {
    if (this.spinner && this.enabled) {
      this.spinner.fail(message ? this.formatMessage(message) : undefined);
      this.spinner = null;
    } else if (message) {
      this.log(`✗ ${message}`);
    }
  }

  /**
   * Show a warning
   */
  warn(message: string): void {
    if (this.spinner && this.enabled) {
      this.spinner.warn(this.formatMessage(message));
      this.spinner = null;
    } else {
      this.log(`⚠ ${message}`);
    }
  }

  /**
   * Show an info message (pauses spinner)
   */
  info(message: string): void {
    if (this.spinner && this.enabled) {
      this.spinner.info(this.formatMessage(message));
      this.spinner = null;
    } else {
      this.log(`ℹ ${message}`);
    }
  }

  /**
   * Stop the spinner without a status
   */
  stop(): void {
    if (this.spinner) {
      this.spinner.stop();
      this.spinner = null;
    }
  }

  /**
   * Update file discovery progress
   */
  updateFileDiscovery(progress: FileDiscoveryProgress): void {
    const details = progress.currentFile
      ? ` (${progress.currentFile})`
      : '';
    this.update(
      `Discovering files... (${progress.found} found, ${progress.directories} directories)${details}`
    );
  }

  /**
   * Update analysis progress
   */
  updateAnalysis(progress: AnalysisProgress): void {
    const phases: Record<AnalysisProgress['phase'], string> = {
      imports: 'Analyzing imports',
      scoring: 'Calculating significance scores',
      graph: 'Building dependency graph',
      clustering: 'Detecting domain clusters',
    };

    let message = `${phases[progress.phase]}...`;

    if (progress.current) {
      message += ` (${progress.current})`;
    }

    if (progress.processed !== undefined && progress.total !== undefined) {
      message += ` [${progress.processed}/${progress.total}]`;
    }

    this.update(message);
  }

  /**
   * Update generation progress
   */
  updateGeneration(progress: GenerationProgress): void {
    let message = `Querying LLM... (stage ${progress.stage}/${progress.totalStages}: ${progress.stageName})`;

    if (progress.tokensUsed !== undefined) {
      message += ` [${progress.tokensUsed} tokens]`;
    }

    this.update(message);
  }

  /**
   * Update file writing progress
   */
  updateWriting(progress: WritingProgress): void {
    let message = `Writing specs... (${progress.current}/${progress.total} files)`;

    if (progress.currentFile) {
      message += ` [${progress.currentFile}]`;
    }

    this.update(message);
  }

  /**
   * Log a verbose message (only shown in verbose mode)
   */
  verbose_log(message: string): void {
    if (this.verbose) {
      this.logs.push(message);
      if (this.spinner && this.enabled) {
        // Pause spinner, log, resume
        this.spinner.stop();
        console.log(`  [verbose] ${message}`);
        this.spinner.start();
      } else {
        console.log(`  [verbose] ${message}`);
      }
    }
  }

  /**
   * Get all logs for saving
   */
  getLogs(): string[] {
    return [...this.logs];
  }

  private formatMessage(message: string): string {
    return message;
  }

  private log(message: string): void {
    console.log(message);
  }
}

/**
 * Create a progress indicator for CLI operations
 */
export function createProgress(
  options?: ProgressOptions & { verbose?: boolean }
): ProgressIndicator {
  return new ProgressIndicator(options);
}

/**
 * Show post-run suggestions for next steps
 */
export function showNextSteps(options: {
  generated?: boolean;
  verified?: boolean;
  analyzed?: boolean;
}): void {
  console.log('');
  console.log('Next steps:');

  if (options.analyzed && !options.generated) {
    console.log('1. spec-gen generate     # Generate specs from analysis');
    console.log('2. openspec list --specs # Review generated specs');
  } else if (options.generated && !options.verified) {
    console.log('1. openspec list --specs   # Review generated specs');
    console.log('2. openspec validate --all # Validate structure');
    console.log('3. spec-gen verify         # Test accuracy');
    console.log('4. openspec change <name>  # Start spec-driven development');
  } else if (options.verified) {
    console.log('1. openspec list --specs   # Review specs');
    console.log('2. openspec change <name>  # Start spec-driven development');
    console.log('3. spec-gen generate       # Re-generate if needed');
  } else {
    console.log('1. spec-gen                # Run full pipeline');
    console.log('2. spec-gen analyze        # Analyze codebase');
    console.log('3. spec-gen --help         # See all options');
  }

  console.log('');
}

/**
 * Show success message after generation
 */
export function showGenerationSuccess(options: {
  specsCount: number;
  outputPath: string;
  tokensUsed?: number;
}): void {
  console.log('');
  console.log('✅ Generation complete!');
  console.log('');
  console.log(`   📁 ${options.specsCount} spec files written to ${options.outputPath}`);

  if (options.tokensUsed) {
    console.log(`   🔤 ${options.tokensUsed.toLocaleString()} tokens used`);
  }

  showNextSteps({ generated: true });
}

/**
 * Show success message after analysis
 */
export function showAnalysisSuccess(options: {
  filesAnalyzed: number;
  outputPath: string;
  domains?: number;
}): void {
  console.log('');
  console.log('✅ Analysis complete!');
  console.log('');
  console.log(`   📁 ${options.filesAnalyzed} files analyzed`);
  console.log(`   📊 Results saved to ${options.outputPath}`);

  if (options.domains) {
    console.log(`   🏷️  ${options.domains} domain clusters detected`);
  }

  showNextSteps({ analyzed: true });
}

/**
 * Show success message after verification
 */
export function showVerificationSuccess(options: {
  score: number;
  filesVerified: number;
  passed: boolean;
}): void {
  console.log('');

  if (options.passed) {
    console.log('✅ Verification passed!');
  } else {
    console.log('⚠️  Verification completed with warnings');
  }

  console.log('');
  console.log(`   📊 Accuracy score: ${(options.score * 100).toFixed(1)}%`);
  console.log(`   📁 ${options.filesVerified} files verified`);

  showNextSteps({ verified: true });
}
