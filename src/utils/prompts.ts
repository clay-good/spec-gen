/**
 * Interactive prompts for spec-gen CLI
 * Uses @inquirer/prompts (same as OpenSpec)
 */

import { select, confirm, input } from '@inquirer/prompts';

export type OverwriteChoice =
  | 'backup-replace'
  | 'merge'
  | 'skip'
  | 'skip-all';

/**
 * Prompt for handling existing spec files
 */
export async function promptOverwrite(
  filePath: string
): Promise<OverwriteChoice> {
  return select<OverwriteChoice>({
    message: `${filePath} already exists. What would you like to do?`,
    choices: [
      {
        value: 'backup-replace' as const,
        name: 'Backup and replace (recommended)',
        description: 'Backup existing file and write new content',
      },
      {
        value: 'merge' as const,
        name: 'Merge (append generated content)',
        description: 'Add generated content to end of existing file',
      },
      {
        value: 'skip' as const,
        name: 'Skip this file',
        description: 'Keep existing file unchanged',
      },
      {
        value: 'skip-all' as const,
        name: 'Skip all existing files',
        description: 'Keep all existing files unchanged',
      },
    ],
  });
}

/**
 * Confirm before overwriting multiple files
 */
export async function confirmOverwriteAll(count: number): Promise<boolean> {
  return confirm({
    message: `This will overwrite ${count} existing spec files. Continue?`,
    default: false,
  });
}

/**
 * Confirm before running analysis that will take a while
 */
export async function confirmLongAnalysis(
  fileCount: number
): Promise<boolean> {
  return confirm({
    message: `About to analyze ${fileCount} files. This may take a while. Continue?`,
    default: true,
  });
}

/**
 * Confirm before making API calls
 */
export async function confirmGeneration(options: {
  model: string;
  estimatedTokens?: number;
}): Promise<boolean> {
  let message = `Ready to generate specs using ${options.model}.`;

  if (options.estimatedTokens) {
    message += ` Estimated ${options.estimatedTokens.toLocaleString()} tokens.`;
  }

  message += ' Continue?';

  return confirm({
    message,
    default: true,
  });
}

/**
 * Prompt for API key when not found in environment
 */
export async function promptApiKey(provider: 'anthropic' | 'openai'): Promise<string> {
  const envVar = provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY';
  const url = provider === 'anthropic'
    ? 'https://console.anthropic.com/'
    : 'https://platform.openai.com/api-keys';

  console.log(`\nNo ${envVar} found in environment.`);
  console.log(`Get an API key at: ${url}\n`);

  return input({
    message: `Enter your ${provider} API key:`,
    validate: (value) => {
      if (!value.trim()) {
        return 'API key is required';
      }
      if (provider === 'anthropic' && !value.startsWith('sk-ant-')) {
        return 'Anthropic API keys should start with sk-ant-';
      }
      if (provider === 'openai' && !value.startsWith('sk-')) {
        return 'OpenAI API keys should start with sk-';
      }
      return true;
    },
  });
}

/**
 * Select LLM provider when multiple are available
 */
export async function selectProvider(): Promise<'anthropic' | 'openai'> {
  return select<'anthropic' | 'openai'>({
    message: 'Multiple API keys found. Which provider would you like to use?',
    choices: [
      {
        value: 'anthropic' as const,
        name: 'Anthropic (Claude)',
        description: 'Recommended for best results',
      },
      {
        value: 'openai' as const,
        name: 'OpenAI (GPT-4)',
        description: 'Alternative provider',
      },
    ],
  });
}

/**
 * Select verification sample count
 */
export async function selectSampleCount(): Promise<number> {
  const answer = await select<string>({
    message: 'How many files would you like to verify?',
    choices: [
      { value: '3', name: '3 files (quick check)' },
      { value: '5', name: '5 files (recommended)' },
      { value: '10', name: '10 files (thorough)' },
      { value: 'custom', name: 'Custom number' },
    ],
  });

  if (answer === 'custom') {
    const customAnswer = await input({
      message: 'Enter number of files to verify:',
      validate: (value) => {
        const num = parseInt(value, 10);
        if (isNaN(num) || num < 1) {
          return 'Please enter a positive number';
        }
        if (num > 50) {
          return 'Maximum is 50 files';
        }
        return true;
      },
    });
    return parseInt(customAnswer, 10);
  }

  return parseInt(answer, 10);
}

/**
 * Prompt to continue after partial failure
 */
export async function promptContinueAfterError(
  stage: string,
  error: string
): Promise<boolean> {
  console.log(`\n⚠️  ${stage} encountered an error: ${error}\n`);

  return confirm({
    message: 'Would you like to continue with partial results?',
    default: true,
  });
}

/**
 * Select domains to generate
 */
export async function selectDomains(
  availableDomains: string[]
): Promise<string[]> {
  // Use a simple confirm + input approach since inquirer checkbox is complex
  const selectAll = await confirm({
    message: `Found ${availableDomains.length} domains. Generate specs for all?`,
    default: true,
  });

  if (selectAll) {
    return availableDomains;
  }

  const selected = await input({
    message: `Enter domains to include (comma-separated):\nAvailable: ${availableDomains.join(', ')}\n`,
    validate: (value) => {
      if (!value.trim()) {
        return 'Please enter at least one domain';
      }
      const domains = value.split(',').map((d) => d.trim());
      const invalid = domains.filter((d) => !availableDomains.includes(d));
      if (invalid.length > 0) {
        return `Unknown domains: ${invalid.join(', ')}`;
      }
      return true;
    },
  });

  return selected.split(',').map((d) => d.trim());
}

/**
 * Interactive mode flag - can be disabled for CI/non-interactive environments
 */
let interactiveMode = process.stdin.isTTY ?? false;

/**
 * Check if we're in interactive mode
 */
export function isInteractive(): boolean {
  return interactiveMode;
}

/**
 * Enable/disable interactive mode
 */
export function setInteractiveMode(enabled: boolean): void {
  interactiveMode = enabled;
}
