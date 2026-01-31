/**
 * Custom error classes for spec-gen with helpful user-facing messages
 */

export type ErrorCode =
  | 'NO_API_KEY'
  | 'NOT_A_REPOSITORY'
  | 'OPENSPEC_EXISTS'
  | 'ANALYSIS_TOO_OLD'
  | 'NO_HIGH_VALUE_FILES'
  | 'LLM_RATE_LIMIT'
  | 'OPENSPEC_VALIDATION_FAILED'
  | 'ANALYSIS_FAILED'
  | 'GENERATION_FAILED'
  | 'VERIFICATION_FAILED'
  | 'CONFIG_NOT_FOUND'
  | 'INVALID_CONFIG'
  | 'FILE_WRITE_ERROR'
  | 'FILE_READ_ERROR'
  | 'UNKNOWN_ERROR';

/**
 * Base error class for spec-gen with code and suggestion
 */
export class SpecGenError extends Error {
  constructor(
    message: string,
    public code: ErrorCode,
    public suggestion?: string
  ) {
    super(message);
    this.name = 'SpecGenError';
    // Maintains proper stack trace for where error was thrown
    Error.captureStackTrace?.(this, this.constructor);
  }

  /**
   * Format error for CLI display with color support
   */
  format(useColor = true): string {
    const red = useColor ? '\x1b[31m' : '';
    const yellow = useColor ? '\x1b[33m' : '';
    const reset = useColor ? '\x1b[0m' : '';
    const dim = useColor ? '\x1b[2m' : '';

    let output = `${red}Error [${this.code}]:${reset} ${this.message}`;

    if (this.suggestion) {
      output += `\n\n${yellow}Suggestion:${reset} ${this.suggestion}`;
    }

    output += `\n\n${dim}For more help, see: https://github.com/clay-good/spec-gen#readme${reset}`;

    return output;
  }
}

/**
 * Error factory functions with predefined messages and suggestions
 */
export const errors = {
  noApiKey(): SpecGenError {
    return new SpecGenError(
      'No API key found for LLM provider',
      'NO_API_KEY',
      `Set ANTHROPIC_API_KEY or OPENAI_API_KEY environment variable.
Get an API key at https://console.anthropic.com/ or https://platform.openai.com/`
    );
  },

  notARepository(): SpecGenError {
    return new SpecGenError(
      'No .git directory found',
      'NOT_A_REPOSITORY',
      `spec-gen works best in git repositories.
Run 'git init' or use --force to continue anyway.`
    );
  },

  openspecExists(path: string): SpecGenError {
    return new SpecGenError(
      `openspec/specs/ already contains specifications at ${path}`,
      'OPENSPEC_EXISTS',
      `Use --merge to add to existing specs, or --force to overwrite.
Existing specs will be backed up to .spec-gen/backups/`
    );
  },

  analysisTooOld(ageHours: number): SpecGenError {
    return new SpecGenError(
      `Existing analysis is ${ageHours.toFixed(1)} hours old`,
      'ANALYSIS_TOO_OLD',
      `Run 'spec-gen analyze' to refresh, or use --reanalyze flag.`
    );
  },

  noHighValueFiles(): SpecGenError {
    return new SpecGenError(
      'Could not identify any high-value files to analyze',
      'NO_HIGH_VALUE_FILES',
      `This might happen with unusual project structures.
Try adjusting scoring in .spec-gen/config.json or use --include patterns.`
    );
  },

  llmRateLimit(attempt: number, maxAttempts: number): SpecGenError {
    return new SpecGenError(
      'API rate limit exceeded',
      'LLM_RATE_LIMIT',
      `Waiting and retrying... (attempt ${attempt} of ${maxAttempts})
If this persists, try a different model or wait a few minutes.`
    );
  },

  openspecValidationFailed(details?: string): SpecGenError {
    return new SpecGenError(
      `Generated specs failed OpenSpec validation${details ? `: ${details}` : ''}`,
      'OPENSPEC_VALIDATION_FAILED',
      `Check .spec-gen/logs/ for details.
This may indicate a generation bug - please report it at https://github.com/clay-good/spec-gen/issues`
    );
  },

  analysisFailed(reason: string): SpecGenError {
    return new SpecGenError(
      `Static analysis failed: ${reason}`,
      'ANALYSIS_FAILED',
      `Check that the project directory is accessible and contains source files.
Try running with --verbose for more details.`
    );
  },

  generationFailed(reason: string): SpecGenError {
    return new SpecGenError(
      `Spec generation failed: ${reason}`,
      'GENERATION_FAILED',
      `This could be due to API issues or invalid analysis data.
Try running 'spec-gen analyze' first, then 'spec-gen generate'.`
    );
  },

  verificationFailed(reason: string): SpecGenError {
    return new SpecGenError(
      `Verification failed: ${reason}`,
      'VERIFICATION_FAILED',
      `Ensure specs exist in openspec/specs/ directory.
Run 'spec-gen generate' first if you haven't already.`
    );
  },

  configNotFound(path: string): SpecGenError {
    return new SpecGenError(
      `Configuration file not found at ${path}`,
      'CONFIG_NOT_FOUND',
      `Run 'spec-gen init' to create a configuration file.`
    );
  },

  invalidConfig(path: string, details?: string): SpecGenError {
    return new SpecGenError(
      `Invalid configuration file at ${path}${details ? `: ${details}` : ''}`,
      'INVALID_CONFIG',
      `Check the configuration file format. You may need to delete it and run 'spec-gen init' again.`
    );
  },

  fileWriteError(path: string, reason?: string): SpecGenError {
    return new SpecGenError(
      `Failed to write file ${path}${reason ? `: ${reason}` : ''}`,
      'FILE_WRITE_ERROR',
      `Check that you have write permissions for the directory.`
    );
  },

  fileReadError(path: string, reason?: string): SpecGenError {
    return new SpecGenError(
      `Failed to read file ${path}${reason ? `: ${reason}` : ''}`,
      'FILE_READ_ERROR',
      `Check that the file exists and you have read permissions.`
    );
  },

  unknown(error: unknown): SpecGenError {
    const message = error instanceof Error ? error.message : String(error);
    return new SpecGenError(
      `An unexpected error occurred: ${message}`,
      'UNKNOWN_ERROR',
      `Please report this issue at https://github.com/clay-good/spec-gen/issues`
    );
  },
};

/**
 * Type guard to check if an error is a SpecGenError
 */
export function isSpecGenError(error: unknown): error is SpecGenError {
  return error instanceof SpecGenError;
}

/**
 * Format any error for CLI display
 */
export function formatError(error: unknown, useColor = true): string {
  if (isSpecGenError(error)) {
    return error.format(useColor);
  }

  if (error instanceof Error) {
    return errors.unknown(error).format(useColor);
  }

  return errors.unknown(String(error)).format(useColor);
}

/**
 * Handle errors in CLI commands by formatting and logging them
 */
export function handleError(error: unknown, exit = true): never | void {
  console.error(formatError(error, process.stdout.isTTY));

  if (exit) {
    process.exit(1);
  }
}
