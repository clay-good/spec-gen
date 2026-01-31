/**
 * Spec Verification Engine
 *
 * Tests whether generated specs accurately describe the codebase by using
 * the specs to predict code behavior and comparing against actual files.
 */

import { readFile, writeFile, mkdir, access, readdir } from 'node:fs/promises';
import { join, dirname, basename, relative } from 'node:path';
import logger from '../../utils/logger.js';
import type { LLMService } from '../services/llm-service.js';
import type { DependencyGraphResult, DependencyNode } from '../analyzer/dependency-graph.js';
import type { ScoredFile } from '../../types/index.js';
import { ImportExportParser, type FileAnalysis, type ExportInfo } from '../analyzer/import-parser.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Verification candidate file
 */
export interface VerificationCandidate {
  path: string;
  absolutePath: string;
  domain: string;
  usedInGeneration: boolean;
  complexity: number;
  lines: number;
  imports: number;
  exports: number;
}

/**
 * LLM prediction for a file
 */
export interface FilePrediction {
  predictedPurpose: string;
  predictedImports: string[];
  predictedExports: string[];
  predictedLogic: string[];
  relatedRequirements: string[];
  confidence: number;
  reasoning: string;
}

/**
 * Match result for purpose
 */
export interface PurposeMatch {
  predicted: string;
  actual: string;
  similarity: number;
}

/**
 * Match result for imports/exports
 */
export interface SetMatch {
  predicted: string[];
  actual: string[];
  precision: number;
  recall: number;
  f1Score: number;
}

/**
 * Requirement coverage analysis
 */
export interface RequirementCoverage {
  relatedRequirements: string[];
  actuallyImplements: string[];
  coverage: number;
}

/**
 * Result for a single file verification
 */
export interface VerificationResult {
  filePath: string;
  domain: string;
  purposeMatch: PurposeMatch;
  importMatch: SetMatch;
  exportMatch: SetMatch;
  requirementCoverage: RequirementCoverage;
  overallScore: number;
  llmConfidence: number;
  feedback: string[];
}

/**
 * Domain breakdown in report
 */
export interface DomainBreakdown {
  domain: string;
  specPath: string;
  filesVerified: number;
  averageScore: number;
  weakestArea: string;
}

/**
 * Suggested improvement
 */
export interface SuggestedImprovement {
  domain: string;
  issue: string;
  suggestion: string;
}

/**
 * Complete verification report
 */
export interface VerificationReport {
  timestamp: string;
  specVersion: string;
  sampledFiles: number;
  passedFiles: number;
  overallConfidence: number;
  domainBreakdown: DomainBreakdown[];
  commonGaps: string[];
  recommendation: 'ready' | 'needs-review' | 'regenerate';
  suggestedImprovements: SuggestedImprovement[];
  results: VerificationResult[];
}

/**
 * Engine options
 */
export interface VerificationEngineOptions {
  /** Root directory of the project */
  rootPath: string;
  /** Path to openspec directory */
  openspecPath: string;
  /** Output directory for reports */
  outputDir: string;
  /** Minimum complexity (lines) for candidate files */
  minComplexity?: number;
  /** Maximum complexity (lines) for candidate files */
  maxComplexity?: number;
  /** Number of files to sample per domain */
  filesPerDomain?: number;
  /** Passing threshold for overall score */
  passThreshold?: number;
  /** Files used in generation (to exclude) */
  generationContext?: string[];
}

/**
 * Loaded spec content
 */
interface LoadedSpec {
  domain: string;
  path: string;
  content: string;
}

// ============================================================================
// SYSTEM PROMPTS
// ============================================================================

const PREDICTION_SYSTEM_PROMPT = `You are testing the accuracy of OpenSpec specifications.

You will be given:
1. A set of specifications describing a software system (in OpenSpec format)
2. A file path within that system

Your task: Based ONLY on the specifications, predict:
- What this file likely does (purpose)
- What modules/files it probably imports
- What it probably exports (functions, classes, etc.)
- Key logic patterns you'd expect to see based on the spec requirements

Be specific. If the specs don't provide enough info, say so.

Respond with valid JSON only.`;

// ============================================================================
// VERIFICATION ENGINE
// ============================================================================

/**
 * Spec Verification Engine
 */
export class SpecVerificationEngine {
  private llm: LLMService;
  private options: Required<VerificationEngineOptions>;
  private specs: LoadedSpec[] = [];
  private parser: ImportExportParser;

  constructor(llm: LLMService, options: VerificationEngineOptions) {
    this.llm = llm;
    this.parser = new ImportExportParser();
    this.options = {
      rootPath: options.rootPath,
      openspecPath: options.openspecPath,
      outputDir: options.outputDir,
      minComplexity: options.minComplexity ?? 50,
      maxComplexity: options.maxComplexity ?? 500,
      filesPerDomain: options.filesPerDomain ?? 3,
      passThreshold: options.passThreshold ?? 0.6,
      generationContext: options.generationContext ?? [],
    };
  }

  /**
   * Run full verification
   */
  async verify(
    depGraph: DependencyGraphResult,
    specVersion: string
  ): Promise<VerificationReport> {
    const startTime = Date.now();

    // Load all specs
    await this.loadSpecs();

    if (this.specs.length === 0) {
      throw new Error('No specs found to verify against');
    }

    logger.analysis(`Loaded ${this.specs.length} spec(s) for verification`);

    // Select verification candidates
    const candidates = this.selectCandidates(depGraph);
    logger.discovery(`Selected ${candidates.length} candidate file(s) for verification`);

    if (candidates.length === 0) {
      throw new Error('No suitable verification candidates found');
    }

    // Run verification for each candidate
    const results: VerificationResult[] = [];
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      logger.analysis(`Verifying ${i + 1}/${candidates.length}: ${candidate.path}`);

      try {
        const result = await this.verifyFile(candidate);
        results.push(result);
      } catch (error) {
        logger.warning(`Failed to verify ${candidate.path}: ${(error as Error).message}`);
      }
    }

    // Generate report
    const report = this.generateReport(results, specVersion);

    // Save report
    await this.saveReport(report);

    const duration = Date.now() - startTime;
    logger.success(`Verification complete in ${(duration / 1000).toFixed(1)}s`);

    return report;
  }

  /**
   * Load all specs from openspec directory
   */
  private async loadSpecs(): Promise<void> {
    this.specs = [];
    const specsDir = join(this.options.openspecPath, 'specs');

    try {
      await access(specsDir);
    } catch {
      return;
    }

    const entries = await readdir(specsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const specPath = join(specsDir, entry.name, 'spec.md');
      try {
        const content = await readFile(specPath, 'utf-8');
        this.specs.push({
          domain: entry.name,
          path: relative(this.options.rootPath, specPath),
          content,
        });
      } catch {
        // Spec doesn't exist for this domain
      }
    }
  }

  /**
   * Select verification candidate files
   */
  selectCandidates(depGraph: DependencyGraphResult): VerificationCandidate[] {
    const candidates: VerificationCandidate[] = [];
    const usedPaths = new Set(this.options.generationContext);

    // Group files by domain
    const filesByDomain = new Map<string, DependencyNode[]>();

    for (const node of depGraph.nodes) {
      // Skip files used in generation
      if (usedPaths.has(node.file.path)) continue;

      // Skip test files
      if (node.file.isTest) continue;

      // Skip generated files
      if (node.file.isGenerated) continue;

      // Skip files outside complexity range
      if (node.file.lines < this.options.minComplexity) continue;
      if (node.file.lines > this.options.maxComplexity) continue;

      // Determine domain from path
      const domain = this.inferDomain(node.file.path);

      if (!filesByDomain.has(domain)) {
        filesByDomain.set(domain, []);
      }
      filesByDomain.get(domain)!.push(node);
    }

    // Select files from each domain
    for (const [domain, nodes] of filesByDomain) {
      // Prefer leaf nodes (low connectivity)
      const sorted = nodes.sort((a, b) => {
        const aConnectivity = a.metrics.inDegree + a.metrics.outDegree;
        const bConnectivity = b.metrics.inDegree + b.metrics.outDegree;
        return aConnectivity - bConnectivity;
      });

      // Take up to filesPerDomain
      const selected = sorted.slice(0, this.options.filesPerDomain);

      for (const node of selected) {
        candidates.push({
          path: node.file.path,
          absolutePath: node.file.absolutePath,
          domain,
          usedInGeneration: false,
          complexity: node.file.lines,
          lines: node.file.lines,
          imports: node.metrics.outDegree,
          exports: node.exports.length,
        });
      }
    }

    return candidates;
  }

  /**
   * Infer domain from file path
   */
  private inferDomain(filePath: string): string {
    const parts = filePath.split('/');

    // Look for known domain indicators
    for (const part of parts) {
      const lower = part.toLowerCase();
      // Skip common non-domain directories
      if (['src', 'lib', 'app', 'core', 'utils', 'helpers', 'common', 'shared'].includes(lower)) {
        continue;
      }
      // Return first meaningful directory
      if (part.length > 1 && !part.startsWith('.')) {
        return lower;
      }
    }

    return 'misc';
  }

  /**
   * Verify a single file
   */
  async verifyFile(candidate: VerificationCandidate): Promise<VerificationResult> {
    // Get prediction from LLM
    const prediction = await this.getPrediction(candidate);

    // Analyze actual file
    const fileContent = await readFile(candidate.absolutePath, 'utf-8');
    const fileAnalysis = await this.parser.parseFile(candidate.absolutePath);

    // Compare prediction to actual
    const purposeMatch = this.comparePurpose(prediction.predictedPurpose, fileContent);
    const importMatch = this.compareImports(prediction.predictedImports, fileAnalysis.imports.map(i => i.source));
    const exportMatch = this.compareExports(prediction.predictedExports, fileAnalysis.exports.map(e => e.name));
    const requirementCoverage = this.analyzeRequirementCoverage(prediction.relatedRequirements, fileContent);

    // Calculate overall score
    const overallScore = this.calculateOverallScore(purposeMatch, importMatch, exportMatch, requirementCoverage);

    // Generate feedback
    const feedback = this.generateFeedback(candidate, prediction, purposeMatch, importMatch, exportMatch, requirementCoverage);

    return {
      filePath: candidate.path,
      domain: candidate.domain,
      purposeMatch,
      importMatch,
      exportMatch,
      requirementCoverage,
      overallScore,
      llmConfidence: prediction.confidence,
      feedback,
    };
  }

  /**
   * Get prediction from LLM
   */
  private async getPrediction(candidate: VerificationCandidate): Promise<FilePrediction> {
    // Build specs context
    const specsContent = this.specs
      .map(s => `=== ${s.domain} (${s.path}) ===\n${s.content}`)
      .join('\n\n');

    const userPrompt = `Here are the specifications:

${specsContent}

Predict the contents of: ${candidate.path}

Respond in JSON:
{
  "predictedPurpose": "...",
  "predictedImports": ["...", "..."],
  "predictedExports": ["...", "..."],
  "predictedLogic": ["...", "..."],
  "relatedRequirements": ["RequirementName1", "RequirementName2"],
  "confidence": 0.0-1.0,
  "reasoning": "..."
}`;

    try {
      const prediction = await this.llm.completeJSON<FilePrediction>({
        systemPrompt: PREDICTION_SYSTEM_PROMPT,
        userPrompt,
        temperature: 0.3,
        maxTokens: 1000,
      });

      return {
        predictedPurpose: prediction.predictedPurpose ?? '',
        predictedImports: prediction.predictedImports ?? [],
        predictedExports: prediction.predictedExports ?? [],
        predictedLogic: prediction.predictedLogic ?? [],
        relatedRequirements: prediction.relatedRequirements ?? [],
        confidence: prediction.confidence ?? 0.5,
        reasoning: prediction.reasoning ?? '',
      };
    } catch (error) {
      logger.warning(`Prediction failed for ${candidate.path}: ${(error as Error).message}`);
      return {
        predictedPurpose: '',
        predictedImports: [],
        predictedExports: [],
        predictedLogic: [],
        relatedRequirements: [],
        confidence: 0,
        reasoning: 'Prediction failed',
      };
    }
  }

  /**
   * Compare predicted purpose to actual file content
   */
  private comparePurpose(predicted: string, fileContent: string): PurposeMatch {
    // Extract actual purpose from file comments
    const actual = this.extractPurpose(fileContent);

    // Calculate similarity using keyword overlap
    const similarity = this.calculateSimilarity(predicted, actual);

    return { predicted, actual, similarity };
  }

  /**
   * Extract purpose from file content (comments, docstrings)
   */
  private extractPurpose(content: string): string {
    const lines = content.split('\n');
    const purposeLines: string[] = [];

    // Look for JSDoc/TSDoc comment at top of file
    let inBlockComment = false;
    for (const line of lines.slice(0, 30)) {
      const trimmed = line.trim();

      if (trimmed.startsWith('/**')) {
        inBlockComment = true;
        continue;
      }
      if (trimmed.startsWith('*/') || trimmed.endsWith('*/')) {
        inBlockComment = false;
        break;
      }
      if (inBlockComment) {
        const comment = trimmed.replace(/^\*\s*/, '').trim();
        if (comment && !comment.startsWith('@')) {
          purposeLines.push(comment);
        }
      }
      // Single line comments at top
      if (trimmed.startsWith('//') && !inBlockComment && purposeLines.length < 3) {
        purposeLines.push(trimmed.replace(/^\/\/\s*/, ''));
      }
    }

    return purposeLines.join(' ').slice(0, 500);
  }

  /**
   * Calculate text similarity using keyword overlap
   */
  private calculateSimilarity(text1: string, text2: string): number {
    if (!text1 || !text2) return 0;

    const words1 = this.extractKeywords(text1);
    const words2 = this.extractKeywords(text2);

    if (words1.size === 0 || words2.size === 0) return 0;

    let matches = 0;
    for (const word of words1) {
      if (words2.has(word)) matches++;
    }

    // Jaccard similarity
    const union = new Set([...words1, ...words2]);
    return matches / union.size;
  }

  /**
   * Extract keywords from text
   */
  private extractKeywords(text: string): Set<string> {
    const words = text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2);

    // Filter out common words
    const stopwords = new Set(['the', 'and', 'for', 'this', 'that', 'with', 'are', 'from', 'has', 'have', 'will', 'can', 'all', 'each', 'which', 'when', 'there', 'been', 'being', 'their', 'would', 'could', 'should']);

    return new Set(words.filter(w => !stopwords.has(w)));
  }

  /**
   * Compare predicted imports to actual
   */
  private compareImports(predicted: string[], actual: string[]): SetMatch {
    return this.calculateSetMatch(
      predicted.map(p => this.normalizeImport(p)),
      actual.map(a => this.normalizeImport(a))
    );
  }

  /**
   * Normalize import path for comparison
   */
  private normalizeImport(importPath: string): string {
    // Remove extensions
    let normalized = importPath
      .replace(/\.(js|ts|jsx|tsx|mjs|cjs)$/, '')
      .replace(/^\.\//, '')
      .replace(/^\.\.\//, '');

    // Extract module name from path
    const parts = normalized.split('/');
    return parts[parts.length - 1].toLowerCase();
  }

  /**
   * Compare predicted exports to actual
   */
  private compareExports(predicted: string[], actual: string[]): SetMatch {
    return this.calculateSetMatch(
      predicted.map(p => p.toLowerCase()),
      actual.map(a => a.toLowerCase())
    );
  }

  /**
   * Calculate precision, recall, F1 for set comparison
   */
  private calculateSetMatch(predicted: string[], actual: string[]): SetMatch {
    const predictedSet = new Set(predicted);
    const actualSet = new Set(actual);

    let truePositives = 0;
    for (const p of predictedSet) {
      if (actualSet.has(p)) truePositives++;
    }

    const precision = predictedSet.size > 0 ? truePositives / predictedSet.size : 0;
    const recall = actualSet.size > 0 ? truePositives / actualSet.size : 0;
    const f1Score = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

    return {
      predicted,
      actual,
      precision,
      recall,
      f1Score,
    };
  }

  /**
   * Analyze requirement coverage
   */
  private analyzeRequirementCoverage(relatedRequirements: string[], fileContent: string): RequirementCoverage {
    const actuallyImplements: string[] = [];
    const contentLower = fileContent.toLowerCase();

    for (const req of relatedRequirements) {
      // Check if requirement keywords appear in the file
      const reqWords = req.toLowerCase().split(/[\s-_]+/);
      const matches = reqWords.filter(w => w.length > 3 && contentLower.includes(w));
      if (matches.length >= Math.min(2, reqWords.length)) {
        actuallyImplements.push(req);
      }
    }

    const coverage = relatedRequirements.length > 0
      ? actuallyImplements.length / relatedRequirements.length
      : 0;

    return {
      relatedRequirements,
      actuallyImplements,
      coverage,
    };
  }

  /**
   * Calculate overall score (weighted combination)
   */
  private calculateOverallScore(
    purposeMatch: PurposeMatch,
    importMatch: SetMatch,
    exportMatch: SetMatch,
    requirementCoverage: RequirementCoverage
  ): number {
    // Weights from spec:
    // - Purpose: 25%
    // - Imports: 30%
    // - Exports: 30%
    // - Requirements: 15%
    return (
      purposeMatch.similarity * 0.25 +
      importMatch.f1Score * 0.30 +
      exportMatch.f1Score * 0.30 +
      requirementCoverage.coverage * 0.15
    );
  }

  /**
   * Generate feedback for gaps
   */
  private generateFeedback(
    candidate: VerificationCandidate,
    prediction: FilePrediction,
    purposeMatch: PurposeMatch,
    importMatch: SetMatch,
    exportMatch: SetMatch,
    requirementCoverage: RequirementCoverage
  ): string[] {
    const feedback: string[] = [];

    // Low purpose match
    if (purposeMatch.similarity < 0.3) {
      feedback.push(`Purpose mismatch: specs don't clearly describe what ${basename(candidate.path)} does`);
    }

    // Missing imports
    const missingImports = importMatch.actual.filter(a => !importMatch.predicted.includes(a));
    if (missingImports.length > 0) {
      feedback.push(`Missing dependencies: specs don't mention ${missingImports.slice(0, 3).join(', ')}`);
    }

    // Missing exports
    const missingExports = exportMatch.actual.filter(a => !exportMatch.predicted.includes(a));
    if (missingExports.length > 0) {
      feedback.push(`Undocumented exports: ${missingExports.slice(0, 3).join(', ')} not described in specs`);
    }

    // Low requirement coverage
    if (requirementCoverage.coverage < 0.5 && prediction.relatedRequirements.length > 0) {
      const missing = prediction.relatedRequirements.filter(r => !requirementCoverage.actuallyImplements.includes(r));
      if (missing.length > 0) {
        feedback.push(`Requirements ${missing.slice(0, 2).join(', ')} don't appear to be implemented in this file`);
      }
    }

    // Low confidence from LLM
    if (prediction.confidence < 0.5) {
      feedback.push(`LLM had low confidence: "${prediction.reasoning}"`);
    }

    return feedback;
  }

  /**
   * Generate verification report
   */
  private generateReport(results: VerificationResult[], specVersion: string): VerificationReport {
    const passedFiles = results.filter(r => r.overallScore >= this.options.passThreshold).length;
    const overallConfidence = results.length > 0
      ? results.reduce((sum, r) => sum + r.overallScore, 0) / results.length
      : 0;

    // Domain breakdown
    const domainResults = new Map<string, VerificationResult[]>();
    for (const result of results) {
      if (!domainResults.has(result.domain)) {
        domainResults.set(result.domain, []);
      }
      domainResults.get(result.domain)!.push(result);
    }

    const domainBreakdown: DomainBreakdown[] = [];
    for (const [domain, domainRes] of domainResults) {
      const avgScore = domainRes.reduce((sum, r) => sum + r.overallScore, 0) / domainRes.length;

      // Find weakest area
      const avgPurpose = domainRes.reduce((sum, r) => sum + r.purposeMatch.similarity, 0) / domainRes.length;
      const avgImport = domainRes.reduce((sum, r) => sum + r.importMatch.f1Score, 0) / domainRes.length;
      const avgExport = domainRes.reduce((sum, r) => sum + r.exportMatch.f1Score, 0) / domainRes.length;
      const avgReq = domainRes.reduce((sum, r) => sum + r.requirementCoverage.coverage, 0) / domainRes.length;

      const areas = [
        { name: 'purpose', score: avgPurpose },
        { name: 'imports', score: avgImport },
        { name: 'exports', score: avgExport },
        { name: 'requirements', score: avgReq },
      ];
      const weakest = areas.sort((a, b) => a.score - b.score)[0];

      domainBreakdown.push({
        domain,
        specPath: `openspec/specs/${domain}/spec.md`,
        filesVerified: domainRes.length,
        averageScore: avgScore,
        weakestArea: weakest.name,
      });
    }

    // Common gaps
    const allFeedback = results.flatMap(r => r.feedback);
    const feedbackCounts = new Map<string, number>();
    for (const fb of allFeedback) {
      // Normalize feedback for grouping
      const key = fb.split(':')[0];
      feedbackCounts.set(key, (feedbackCounts.get(key) ?? 0) + 1);
    }
    const commonGaps = Array.from(feedbackCounts.entries())
      .filter(([_, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([gap, _]) => gap);

    // Suggested improvements
    const suggestedImprovements: SuggestedImprovement[] = [];
    for (const breakdown of domainBreakdown) {
      if (breakdown.averageScore < 0.7) {
        suggestedImprovements.push({
          domain: breakdown.domain,
          issue: `Low verification score (${(breakdown.averageScore * 100).toFixed(0)}%)`,
          suggestion: `Review and enhance ${breakdown.specPath}, especially ${breakdown.weakestArea} descriptions`,
        });
      }
    }

    // Recommendation
    let recommendation: 'ready' | 'needs-review' | 'regenerate';
    if (overallConfidence >= 0.75) {
      recommendation = 'ready';
    } else if (overallConfidence >= 0.5) {
      recommendation = 'needs-review';
    } else {
      recommendation = 'regenerate';
    }

    return {
      timestamp: new Date().toISOString(),
      specVersion,
      sampledFiles: results.length,
      passedFiles,
      overallConfidence,
      domainBreakdown,
      commonGaps,
      recommendation,
      suggestedImprovements,
      results,
    };
  }

  /**
   * Save verification report
   */
  private async saveReport(report: VerificationReport): Promise<void> {
    await mkdir(this.options.outputDir, { recursive: true });

    // Save JSON report
    const jsonPath = join(this.options.outputDir, 'report.json');
    await writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf-8');
    logger.discovery(`Saved JSON report to ${relative(this.options.rootPath, jsonPath)}`);

    // Save Markdown report
    const mdPath = join(this.options.outputDir, 'REPORT.md');
    const markdown = this.generateMarkdownReport(report);
    await writeFile(mdPath, markdown, 'utf-8');
    logger.discovery(`Saved Markdown report to ${relative(this.options.rootPath, mdPath)}`);
  }

  /**
   * Generate markdown report
   */
  private generateMarkdownReport(report: VerificationReport): string {
    const lines: string[] = [];

    lines.push('# Spec Verification Report');
    lines.push('');
    lines.push(`Generated: ${report.timestamp}`);
    lines.push(`Spec Version: ${report.specVersion}`);
    lines.push('');

    // Summary
    lines.push('## Summary');
    lines.push('');
    lines.push(`| Metric | Value |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Files Verified | ${report.sampledFiles} |`);
    lines.push(`| Files Passed | ${report.passedFiles} (${((report.passedFiles / report.sampledFiles) * 100).toFixed(0)}%) |`);
    lines.push(`| Overall Confidence | ${(report.overallConfidence * 100).toFixed(1)}% |`);
    lines.push(`| Recommendation | **${report.recommendation}** |`);
    lines.push('');

    // Recommendation explanation
    lines.push('### Recommendation');
    if (report.recommendation === 'ready') {
      lines.push('✅ Specs accurately describe the codebase and are ready for use.');
    } else if (report.recommendation === 'needs-review') {
      lines.push('⚠️ Specs need review. Some gaps were identified that should be addressed.');
    } else {
      lines.push('❌ Specs have significant gaps. Consider regenerating with improved context.');
    }
    lines.push('');

    // Domain breakdown
    lines.push('## Domain Breakdown');
    lines.push('');
    lines.push('| Domain | Spec Path | Files | Avg Score | Weakest Area |');
    lines.push('|--------|-----------|-------|-----------|--------------|');
    for (const domain of report.domainBreakdown) {
      const scorePercent = (domain.averageScore * 100).toFixed(0);
      lines.push(`| ${domain.domain} | ${domain.specPath} | ${domain.filesVerified} | ${scorePercent}% | ${domain.weakestArea} |`);
    }
    lines.push('');

    // Common gaps
    if (report.commonGaps.length > 0) {
      lines.push('## Common Gaps');
      lines.push('');
      for (const gap of report.commonGaps) {
        lines.push(`- ${gap}`);
      }
      lines.push('');
    }

    // Suggested improvements
    if (report.suggestedImprovements.length > 0) {
      lines.push('## Suggested Improvements');
      lines.push('');
      for (const improvement of report.suggestedImprovements) {
        lines.push(`### ${improvement.domain}`);
        lines.push(`- **Issue**: ${improvement.issue}`);
        lines.push(`- **Suggestion**: ${improvement.suggestion}`);
        lines.push('');
      }
    }

    // Detailed results
    lines.push('## Detailed Results');
    lines.push('');
    for (const result of report.results) {
      const scorePercent = (result.overallScore * 100).toFixed(0);
      const status = result.overallScore >= 0.6 ? '✅' : '❌';
      lines.push(`### ${status} ${result.filePath}`);
      lines.push('');
      lines.push(`- **Domain**: ${result.domain}`);
      lines.push(`- **Overall Score**: ${scorePercent}%`);
      lines.push(`- **LLM Confidence**: ${(result.llmConfidence * 100).toFixed(0)}%`);
      lines.push('');
      lines.push('| Category | Score |');
      lines.push('|----------|-------|');
      lines.push(`| Purpose Match | ${(result.purposeMatch.similarity * 100).toFixed(0)}% |`);
      lines.push(`| Import Match (F1) | ${(result.importMatch.f1Score * 100).toFixed(0)}% |`);
      lines.push(`| Export Match (F1) | ${(result.exportMatch.f1Score * 100).toFixed(0)}% |`);
      lines.push(`| Requirement Coverage | ${(result.requirementCoverage.coverage * 100).toFixed(0)}% |`);
      lines.push('');

      if (result.feedback.length > 0) {
        lines.push('**Feedback:**');
        for (const fb of result.feedback) {
          lines.push(`- ${fb}`);
        }
        lines.push('');
      }
    }

    lines.push('---');
    lines.push('*Generated by spec-gen verify*');

    return lines.join('\n');
  }

  /**
   * Get list of domains
   */
  getDomains(): string[] {
    return this.specs.map(s => s.domain);
  }
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Run verification on a project
 */
export async function verifySpecs(
  llm: LLMService,
  depGraph: DependencyGraphResult,
  options: VerificationEngineOptions,
  specVersion: string
): Promise<VerificationReport> {
  const engine = new SpecVerificationEngine(llm, options);
  return engine.verify(depGraph, specVersion);
}
