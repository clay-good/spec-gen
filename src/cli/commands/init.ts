/**
 * spec-gen init command
 *
 * Verifies we're in a valid project and creates .spec-gen configuration.
 * Detects project type, existing OpenSpec setup, and prepares for analysis.
 */

import { Command } from 'commander';
import { resolve } from 'node:path';
import { confirm } from '@inquirer/prompts';
import { logger } from '../../utils/logger.js';
import {
  detectProjectType,
  getProjectTypeName,
  detectGitRepository,
} from '../../core/services/project-detector.js';
import {
  getDefaultConfig,
  readSpecGenConfig,
  writeSpecGenConfig,
  specGenConfigExists,
  readOpenSpecConfig,
  openspecDirExists,
  openspecConfigExists,
  createOpenSpecStructure,
} from '../../core/services/config-manager.js';
import {
  gitignoreExists,
  isInGitignore,
  addToGitignore,
} from '../../core/services/gitignore-manager.js';
import type { InitOptions } from '../../types/index.js';

export const initCommand = new Command('init')
  .description('Initialize spec-gen in the current project')
  .option('--force', 'Overwrite existing configuration', false)
  .option(
    '--openspec-path <path>',
    'Custom path for openspec/ output directory',
    './openspec'
  )
  .addHelpText(
    'after',
    `
Examples:
  $ spec-gen init                    Initialize with defaults
  $ spec-gen init --force            Overwrite existing config
  $ spec-gen init --openspec-path ./docs/specs
                                     Use custom output path

What this command does:
  1. Detects project type (Node.js, Python, Rust, Go, etc.)
  2. Checks for existing OpenSpec setup
  3. Creates .spec-gen/config.json configuration file
  4. Updates .gitignore to exclude .spec-gen/
  5. Prepares project for analysis

After initialization, run 'spec-gen analyze' to scan your codebase.
`
  )
  .action(async (options: Partial<InitOptions>) => {
    const rootPath = process.cwd();
    const openspecPath = resolve(rootPath, options.openspecPath ?? './openspec');
    const force = options.force ?? false;

    logger.section('Initializing spec-gen');

    // Step 1: Project Detection
    logger.discovery('Detecting project type...');

    const detection = await detectProjectType(rootPath);

    if (!detection.hasGit) {
      logger.warning('No .git directory found. This may not be a repository root.');
      logger.debug('Continuing anyway - spec-gen works without git');
    } else {
      logger.debug('Git repository detected');
    }

    if (detection.projectType === 'unknown') {
      logger.warning('Could not detect project type. No known manifest files found.');
      logger.info('Supported', 'package.json, pyproject.toml, Cargo.toml, go.mod, pom.xml, Gemfile, composer.json');
    } else {
      logger.success(`Detected ${getProjectTypeName(detection.projectType)} project`);
      if (detection.manifestFile) {
        logger.debug(`Found manifest: ${detection.manifestFile}`);
      }
      if (detection.confidence !== 'high') {
        logger.debug(`Detection confidence: ${detection.confidence}`);
      }
    }

    logger.blank();

    // Step 2: Check for existing configurations
    logger.discovery('Checking for existing configurations...');

    const existingSpecGenConfig = await specGenConfigExists(rootPath);
    const existingOpenspecDir = await openspecDirExists(openspecPath);
    const existingOpenspecConfig = await openspecConfigExists(openspecPath);

    if (existingSpecGenConfig && !force) {
      logger.warning('.spec-gen/config.json already exists');

      const existingConfig = await readSpecGenConfig(rootPath);
      if (existingConfig) {
        logger.info('Existing project type', getProjectTypeName(existingConfig.projectType));
        logger.info('Created', existingConfig.createdAt);
        if (existingConfig.lastRun) {
          logger.info('Last run', existingConfig.lastRun);
        }
      }

      logger.blank();

      // Check if running in TTY for interactive prompt
      if (process.stdin.isTTY) {
        const overwrite = await confirm({
          message: 'Overwrite existing configuration?',
          default: false,
        });

        if (!overwrite) {
          logger.info('Aborted', 'Use --force to overwrite without prompting');
          return;
        }
      } else {
        logger.error('Configuration exists. Use --force to overwrite in non-interactive mode.');
        process.exit(1);
      }
    }

    if (existingOpenspecDir) {
      logger.success('Found existing openspec/ directory');
      if (existingOpenspecConfig) {
        const openspecConfig = await readOpenSpecConfig(openspecPath);
        if (openspecConfig?.context) {
          logger.info('Existing context', 'Will preserve during generation');
        }
        logger.debug('Will integrate with existing OpenSpec setup');
      }
    } else {
      logger.debug('No existing openspec/ directory');
    }

    logger.blank();

    // Step 3: Create configuration
    logger.analysis('Creating configuration...');

    const config = getDefaultConfig(detection.projectType, options.openspecPath ?? './openspec');

    await writeSpecGenConfig(rootPath, config);
    logger.success('Created .spec-gen/config.json');

    // Step 4: Create OpenSpec structure if needed
    if (!existingOpenspecDir) {
      await createOpenSpecStructure(openspecPath);
      logger.success(`Created ${options.openspecPath ?? './openspec'}/ directory structure`);
    }

    // Step 5: Update .gitignore
    logger.blank();
    logger.discovery('Checking .gitignore...');

    const hasGitignore = await gitignoreExists(rootPath);
    const alreadyIgnored = hasGitignore && (await isInGitignore(rootPath, '.spec-gen/'));

    if (alreadyIgnored) {
      logger.debug('.spec-gen/ already in .gitignore');
    } else if (hasGitignore) {
      // Check if running in TTY for interactive prompt
      let shouldAdd = true;

      if (process.stdin.isTTY) {
        shouldAdd = await confirm({
          message: 'Add .spec-gen/ to .gitignore? (recommended)',
          default: true,
        });
      }

      if (shouldAdd) {
        await addToGitignore(rootPath, '.spec-gen/', 'spec-gen analysis artifacts');
        logger.success('Added .spec-gen/ to .gitignore');
      } else {
        logger.warning('.spec-gen/ not added to .gitignore');
        logger.debug('Analysis artifacts may be committed to version control');
      }
    } else {
      logger.debug('No .gitignore file found');
      logger.debug('Consider creating one to exclude .spec-gen/');
    }

    // Step 6: Output summary
    logger.blank();
    logger.section('Initialization Complete');

    logger.info('Project type', getProjectTypeName(detection.projectType));
    logger.info('Config file', '.spec-gen/config.json');
    logger.info('Output path', options.openspecPath ?? './openspec');

    if (existingOpenspecDir) {
      logger.info('Integration', 'Will add to existing OpenSpec setup');
    }

    logger.blank();
    logger.success('Ready for analysis!');
    logger.blank();
    logger.info('Next step', "Run 'spec-gen analyze' to scan your codebase");
  });
