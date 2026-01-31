/**
 * OpenSpec Writer
 *
 * Takes generated specifications and writes them to the OpenSpec directory structure.
 * Handles initialization, merging with existing specs, and output tracking.
 */

import { readFile, writeFile, mkdir, access, readdir, copyFile, stat } from 'node:fs/promises';
import { join, dirname, relative } from 'node:path';
import logger from '../../utils/logger.js';
import {
  OpenSpecConfigManager,
  buildDetectedContext,
  normalizeDomainName,
  validateFullSpec,
  type SpecGenMetadata,
} from './openspec-compat.js';
import type { GeneratedSpec } from './openspec-format-generator.js';
import type { ProjectSurveyResult } from './spec-pipeline.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Write mode for handling existing specs
 */
export type WriteMode = 'replace' | 'merge' | 'skip';

/**
 * Options for OpenSpec writer
 */
export interface OpenSpecWriterOptions {
  /** Root path of the project */
  rootPath: string;
  /** How to handle existing specs */
  writeMode?: WriteMode;
  /** Version string for generated specs */
  version?: string;
  /** Whether to create backups */
  createBackups?: boolean;
  /** Whether to update config.yaml */
  updateConfig?: boolean;
  /** Whether to validate specs before writing */
  validateBeforeWrite?: boolean;
}

/**
 * Result of writing a single spec
 */
export interface WriteResult {
  path: string;
  action: 'written' | 'skipped' | 'merged' | 'backed_up';
  success: boolean;
  error?: string;
  backupPath?: string;
}

/**
 * Generation report
 */
export interface GenerationReport {
  timestamp: string;
  openspecVersion: string;
  specGenVersion: string;
  filesWritten: string[];
  filesSkipped: string[];
  filesBackedUp: string[];
  filesMerged: string[];
  configUpdated: boolean;
  validationErrors: string[];
  warnings: string[];
  nextSteps: string[];
}

// ============================================================================
// OPENSPEC WRITER
// ============================================================================

/**
 * OpenSpec Writer - writes generated specs to the OpenSpec directory structure
 */
export class OpenSpecWriter {
  private rootPath: string;
  private openspecRoot: string;
  private specGenRoot: string;
  private options: Required<OpenSpecWriterOptions>;
  private configManager: OpenSpecConfigManager;

  constructor(options: OpenSpecWriterOptions) {
    this.rootPath = options.rootPath;
    this.openspecRoot = join(options.rootPath, 'openspec');
    this.specGenRoot = join(options.rootPath, '.spec-gen');
    this.options = {
      rootPath: options.rootPath,
      writeMode: options.writeMode ?? 'replace',
      version: options.version ?? '1.0.0',
      createBackups: options.createBackups ?? true,
      updateConfig: options.updateConfig ?? true,
      validateBeforeWrite: options.validateBeforeWrite ?? true,
    };
    this.configManager = new OpenSpecConfigManager(options.rootPath);
  }

  /**
   * Initialize OpenSpec directory structure
   */
  async initialize(): Promise<void> {
    // Create openspec directory structure
    await mkdir(join(this.openspecRoot, 'specs'), { recursive: true });
    await mkdir(join(this.openspecRoot, 'changes', 'archive'), { recursive: true });

    // Create .spec-gen directory structure
    await mkdir(join(this.specGenRoot, 'analysis'), { recursive: true });
    await mkdir(join(this.specGenRoot, 'backups'), { recursive: true });
    await mkdir(join(this.specGenRoot, 'outputs'), { recursive: true });
    await mkdir(join(this.specGenRoot, 'logs'), { recursive: true });

    logger.success('Initialized OpenSpec directory structure');
  }

  /**
   * Write all generated specs
   */
  async writeSpecs(
    specs: GeneratedSpec[],
    survey: ProjectSurveyResult
  ): Promise<GenerationReport> {
    const report: GenerationReport = {
      timestamp: new Date().toISOString(),
      openspecVersion: await this.detectOpenSpecVersion(),
      specGenVersion: this.options.version,
      filesWritten: [],
      filesSkipped: [],
      filesBackedUp: [],
      filesMerged: [],
      configUpdated: false,
      validationErrors: [],
      warnings: [],
      nextSteps: [],
    };

    // Ensure directories exist
    await this.initialize();

    // Write each spec
    for (const spec of specs) {
      const result = await this.writeSpec(spec);

      if (result.success) {
        switch (result.action) {
          case 'written':
            report.filesWritten.push(result.path);
            break;
          case 'skipped':
            report.filesSkipped.push(result.path);
            break;
          case 'merged':
            report.filesMerged.push(result.path);
            break;
          case 'backed_up':
            if (result.backupPath) {
              report.filesBackedUp.push(result.backupPath);
            }
            report.filesWritten.push(result.path);
            break;
        }
      } else {
        report.warnings.push(`Failed to write ${result.path}: ${result.error}`);
      }
    }

    // Update config.yaml
    if (this.options.updateConfig) {
      try {
        await this.updateConfig(specs, survey);
        report.configUpdated = true;
      } catch (error) {
        report.warnings.push(`Failed to update config.yaml: ${(error as Error).message}`);
      }
    }

    // Generate next steps
    report.nextSteps = this.generateNextSteps(report);

    // Save generation report
    await this.saveReport(report);

    // Log summary
    this.logSummary(report);

    return report;
  }

  /**
   * Write a single spec file
   */
  private async writeSpec(spec: GeneratedSpec): Promise<WriteResult> {
    const fullPath = join(this.rootPath, spec.path);
    const relativePath = spec.path;

    try {
      // Check if file exists
      const exists = await this.fileExists(fullPath);

      if (exists) {
        switch (this.options.writeMode) {
          case 'skip':
            logger.discovery(`Skipping existing spec: ${relativePath}`);
            return { path: relativePath, action: 'skipped', success: true };

          case 'merge':
            return await this.mergeSpec(spec, fullPath);

          case 'replace':
          default:
            // Backup if enabled
            if (this.options.createBackups) {
              const backupPath = await this.backupFile(fullPath, relativePath);
              // Validate before write
              if (this.options.validateBeforeWrite) {
                const validation = validateFullSpec(spec.content);
                if (!validation.valid) {
                  logger.warning(`Validation warnings for ${relativePath}: ${validation.errors.join(', ')}`);
                }
              }
              await this.ensureDir(fullPath);
              await writeFile(fullPath, spec.content, 'utf-8');
              logger.success(`Wrote ${relativePath} (backed up existing)`);
              return { path: relativePath, action: 'backed_up', success: true, backupPath };
            }
        }
      }

      // Validate before write
      if (this.options.validateBeforeWrite) {
        const validation = validateFullSpec(spec.content);
        if (!validation.valid) {
          logger.warning(`Validation warnings for ${relativePath}: ${validation.errors.join(', ')}`);
        }
      }

      // Write new file
      await this.ensureDir(fullPath);
      await writeFile(fullPath, spec.content, 'utf-8');
      logger.success(`Wrote ${relativePath}`);
      return { path: relativePath, action: 'written', success: true };
    } catch (error) {
      return {
        path: relativePath,
        action: 'written',
        success: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Merge spec with existing content
   */
  private async mergeSpec(spec: GeneratedSpec, fullPath: string): Promise<WriteResult> {
    const relativePath = relative(this.rootPath, fullPath);

    try {
      const existingContent = await readFile(fullPath, 'utf-8');

      // Check if already has generated section
      const generatedMarker = '## Generated Analysis';
      if (existingContent.includes(generatedMarker)) {
        // Replace the generated section
        const parts = existingContent.split(generatedMarker);
        const humanContent = parts[0].trimEnd();
        const mergedContent = `${humanContent}\n\n${generatedMarker}\n\n${this.extractGeneratedSection(spec.content)}`;
        await writeFile(fullPath, mergedContent, 'utf-8');
      } else {
        // Append generated section
        const mergedContent = `${existingContent.trimEnd()}\n\n${generatedMarker}\n\n${this.extractGeneratedSection(spec.content)}`;
        await writeFile(fullPath, mergedContent, 'utf-8');
      }

      logger.success(`Merged ${relativePath}`);
      return { path: relativePath, action: 'merged', success: true };
    } catch (error) {
      return {
        path: relativePath,
        action: 'merged',
        success: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Extract generated content for merge (skip headers)
   */
  private extractGeneratedSection(content: string): string {
    // Skip the title and generated header lines
    const lines = content.split('\n');
    let startIndex = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Skip title, blank lines, and metadata comments
      if (line.startsWith('#') && !line.startsWith('##')) continue;
      if (line.startsWith('>')) continue;
      if (line.trim() === '') continue;
      startIndex = i;
      break;
    }

    return lines.slice(startIndex).join('\n').trim();
  }

  /**
   * Backup an existing file
   */
  private async backupFile(fullPath: string, relativePath: string): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = join(this.specGenRoot, 'backups', timestamp);
    const backupPath = join(backupDir, relativePath);

    await mkdir(dirname(backupPath), { recursive: true });
    await copyFile(fullPath, backupPath);

    logger.discovery(`Backed up ${relativePath} to ${relative(this.rootPath, backupPath)}`);
    return relative(this.rootPath, backupPath);
  }

  /**
   * Update config.yaml with spec-gen metadata
   */
  private async updateConfig(specs: GeneratedSpec[], survey: ProjectSurveyResult): Promise<void> {
    const domains = specs
      .filter(s => s.type === 'domain')
      .map(s => normalizeDomainName(s.domain));

    const metadata: SpecGenMetadata = {
      version: this.options.version,
      generatedAt: new Date().toISOString(),
      domains,
      confidence: survey.confidence,
    };

    const detectedContext = buildDetectedContext(survey);

    await this.configManager.updateWithSpecGenMetadata(metadata, detectedContext, {
      preserveUserContext: true,
      appendDetectedInfo: true,
      version: this.options.version,
    });
  }

  /**
   * Detect OpenSpec version if installed
   */
  private async detectOpenSpecVersion(): Promise<string> {
    try {
      // Try to read from package.json or openspec cli
      const packageJsonPath = join(this.rootPath, 'node_modules', 'openspec', 'package.json');
      const content = await readFile(packageJsonPath, 'utf-8');
      const pkg = JSON.parse(content);
      return pkg.version || 'unknown';
    } catch {
      return 'unknown';
    }
  }

  /**
   * Generate next steps based on results
   */
  private generateNextSteps(report: GenerationReport): string[] {
    const steps: string[] = [];

    if (report.filesWritten.length > 0 || report.filesMerged.length > 0) {
      steps.push("Review generated specs: openspec list --specs");
      steps.push("Validate structure: openspec validate --all");
      steps.push("Test accuracy: spec-gen verify");
    }

    if (report.filesSkipped.length > 0) {
      steps.push(`Review skipped files (${report.filesSkipped.length} existing specs preserved)`);
    }

    if (report.validationErrors.length > 0) {
      steps.push("Fix validation errors before using specs");
    }

    steps.push("Create a change proposal: openspec change my-feature");

    return steps;
  }

  /**
   * Save generation report to .spec-gen/outputs/
   */
  private async saveReport(report: GenerationReport): Promise<void> {
    const reportPath = join(this.specGenRoot, 'outputs', 'generation-report.json');
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf-8');
    logger.discovery(`Saved generation report to ${relative(this.rootPath, reportPath)}`);
  }

  /**
   * Log summary to console
   */
  private logSummary(report: GenerationReport): void {
    console.log('');
    logger.success('=== Generation Complete ===');
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

    if (report.warnings.length > 0) {
      console.log('');
      console.log('  Warnings:');
      for (const warning of report.warnings) {
        console.log(`    ⚠ ${warning}`);
      }
    }

    console.log('');
    console.log('  Next steps:');
    for (let i = 0; i < report.nextSteps.length; i++) {
      console.log(`    ${i + 1}. ${report.nextSteps[i]}`);
    }
    console.log('');
  }

  /**
   * Check if file exists
   */
  private async fileExists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Ensure directory exists for file
   */
  private async ensureDir(filePath: string): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true });
  }

  /**
   * Get list of existing spec domains
   */
  async getExistingDomains(): Promise<string[]> {
    return this.configManager.getExistingDomains();
  }
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Write generated specs to OpenSpec directory
 */
export async function writeOpenSpecs(
  specs: GeneratedSpec[],
  survey: ProjectSurveyResult,
  options: OpenSpecWriterOptions
): Promise<GenerationReport> {
  const writer = new OpenSpecWriter(options);
  return writer.writeSpecs(specs, survey);
}

/**
 * Initialize OpenSpec directory structure without writing specs
 */
export async function initializeOpenSpec(rootPath: string): Promise<void> {
  const writer = new OpenSpecWriter({ rootPath });
  await writer.initialize();
}
