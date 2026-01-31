#!/usr/bin/env node

/**
 * spec-gen CLI entry point
 *
 * Reverse-engineer OpenSpec specifications from existing codebases.
 * Philosophy: "Archaeology over Creativity" — Extract the truth of what code does.
 */

import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { analyzeCommand } from './commands/analyze.js';
import { generateCommand } from './commands/generate.js';
import { verifyCommand } from './commands/verify.js';
import { runCommand } from './commands/run.js';
import { configureLogger, logger } from '../utils/logger.js';

const program = new Command();

// Hook to configure logger before any command runs
program.hook('preAction', (thisCommand) => {
  const opts = thisCommand.opts();
  configureLogger({
    quiet: opts.quiet ?? false,
    verbose: opts.verbose ?? false,
    noColor: opts.color === false,
    timestamps: process.env.CI === 'true' || opts.color === false,
  });
});

program
  .name('spec-gen')
  .description(
    'Reverse-engineer OpenSpec specifications from existing codebases.\n\n' +
    'Philosophy: "Archaeology over Creativity" — We extract the truth of what\n' +
    'code does, grounded in static analysis, not LLM hallucinations.'
  )
  .version('1.0.0')
  .option('-q, --quiet', 'Minimal output (errors only)', false)
  .option('-v, --verbose', 'Show debug information', false)
  .option('--no-color', 'Disable colored output (also enables timestamps)')
  .option('--config <path>', 'Path to config file', '.spec-gen/config.json')
  .addHelpText(
    'after',
    `
Workflow:
  1. spec-gen init      Detect project type, create config
  2. spec-gen analyze   Scan codebase, build dependency graph
  3. spec-gen generate  Create OpenSpec files using LLM
  4. spec-gen verify    Validate specs against source code

Quick start:
  $ cd your-project
  $ spec-gen init
  $ spec-gen analyze
  $ spec-gen generate

Or run the full pipeline at once:
  $ spec-gen run
  $ spec-gen .            (shorthand for spec-gen run)

Output integrates with OpenSpec ecosystem:
  openspec/
  ├── config.yaml
  └── specs/
      ├── overview/spec.md
      ├── architecture/spec.md
      └── {domain}/spec.md

Learn more: https://github.com/Fission-AI/OpenSpec
`
  );

// Register subcommands
program.addCommand(initCommand);
program.addCommand(analyzeCommand);
program.addCommand(generateCommand);
program.addCommand(verifyCommand);
program.addCommand(runCommand);

// Default command: run full pipeline when path argument is given
program
  .argument('[path]', 'Path to project to analyze (runs full pipeline)', '.')
  .option('--force', 'Reinitialize even if config exists', false)
  .option('--reanalyze', 'Force fresh analysis', false)
  .option('--model <name>', 'LLM model to use', 'claude-sonnet-4-20250514')
  .option('--dry-run', 'Show what would be done', false)
  .option('-y, --yes', 'Skip all prompts', false)
  .option('--max-files <n>', 'Maximum files to analyze', '500')
  .action(async (path: string, options) => {
    // If path is "." or a directory, run the full pipeline
    // This makes "spec-gen" and "spec-gen ." equivalent to "spec-gen run"

    // Change to the specified path if needed
    if (path && path !== '.') {
      try {
        process.chdir(path);
      } catch (error) {
        logger.error(`Cannot access path: ${path}`);
        process.exitCode = 1;
        return;
      }
    }

    // Simulate running the run command with collected options
    const runArgs = ['node', 'spec-gen', 'run'];
    if (options.force) runArgs.push('--force');
    if (options.reanalyze) runArgs.push('--reanalyze');
    if (options.model !== 'claude-sonnet-4-20250514') runArgs.push('--model', options.model);
    if (options.dryRun) runArgs.push('--dry-run');
    if (options.yes) runArgs.push('-y');
    if (options.maxFiles !== '500') runArgs.push('--max-files', options.maxFiles);

    await runCommand.parseAsync(runArgs, { from: 'user' });
  });

program.parse();
