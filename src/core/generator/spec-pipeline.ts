/**
 * Spec Generation Pipeline
 *
 * Orchestrates the multi-step LLM process to generate accurate specifications
 * in OpenSpec format from code analysis.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import logger from '../../utils/logger.js';
import type { LLMService, CompletionResponse } from '../services/llm-service.js';
import type { RepoStructure, LLMContext } from '../analyzer/artifact-generator.js';
import type { DependencyGraphResult } from '../analyzer/dependency-graph.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Project category from Stage 1
 */
export type ProjectCategory =
  | 'web-frontend'
  | 'web-backend'
  | 'api-service'
  | 'cli-tool'
  | 'library'
  | 'mobile-app'
  | 'desktop-app'
  | 'data-pipeline'
  | 'ml-service'
  | 'monorepo'
  | 'other';

/**
 * Architecture pattern
 */
export type ArchitecturePattern =
  | 'layered'
  | 'hexagonal'
  | 'microservices'
  | 'monolith'
  | 'serverless'
  | 'event-driven'
  | 'mvc'
  | 'other';

/**
 * Stage 1 output: Project Survey
 */
export interface ProjectSurveyResult {
  projectCategory: ProjectCategory;
  primaryLanguage: string;
  frameworks: string[];
  architecturePattern: ArchitecturePattern;
  domainSummary: string;
  suggestedDomains: string[];
  confidence: number;
}

/**
 * Entity property
 */
export interface EntityProperty {
  name: string;
  type: string;
  description?: string;
  required?: boolean;
}

/**
 * Entity relationship
 */
export interface EntityRelationship {
  targetEntity: string;
  type: 'one-to-one' | 'one-to-many' | 'many-to-many' | 'belongs-to';
  description?: string;
}

/**
 * Scenario in Given/When/Then format
 */
export interface Scenario {
  name: string;
  given: string;
  when: string;
  then: string;
  and?: string[];
}

/**
 * Stage 2 output: Entity
 */
export interface ExtractedEntity {
  name: string;
  description: string;
  properties: EntityProperty[];
  relationships: EntityRelationship[];
  validations: string[];
  scenarios: Scenario[];
  location: string;
}

/**
 * Service operation
 */
export interface ServiceOperation {
  name: string;
  description: string;
  inputs?: string[];
  outputs?: string[];
  scenarios: Scenario[];
}

/**
 * Stage 3 output: Service
 */
export interface ExtractedService {
  name: string;
  purpose: string;
  operations: ServiceOperation[];
  dependencies: string[];
  sideEffects: string[];
  domain: string;
}

/**
 * Stage 4 output: API Endpoint
 */
export interface ExtractedEndpoint {
  method: string;
  path: string;
  purpose: string;
  authentication?: string;
  requestSchema?: Record<string, unknown>;
  responseSchema?: Record<string, unknown>;
  scenarios: Scenario[];
  relatedEntity?: string;
}

/**
 * Layer in the architecture
 */
export interface ArchitectureLayer {
  name: string;
  purpose: string;
  components: string[];
}

/**
 * Stage 5 output: Architecture Synthesis
 */
export interface ArchitectureSynthesis {
  systemPurpose: string;
  architectureStyle: string;
  layerMap: ArchitectureLayer[];
  dataFlow: string;
  integrations: string[];
  securityModel: string;
  keyDecisions: string[];
}

/**
 * Complete pipeline result
 */
export interface PipelineResult {
  survey: ProjectSurveyResult;
  entities: ExtractedEntity[];
  services: ExtractedService[];
  endpoints: ExtractedEndpoint[];
  architecture: ArchitectureSynthesis;
  metadata: {
    totalTokens: number;
    estimatedCost: number;
    duration: number;
    completedStages: string[];
    skippedStages: string[];
  };
}

/**
 * Stage result for intermediate storage
 */
export interface StageResult<T> {
  stage: string;
  success: boolean;
  data?: T;
  error?: string;
  tokens: number;
  duration: number;
}

/**
 * Pipeline options
 */
export interface PipelineOptions {
  /** Output directory for intermediate results */
  outputDir: string;
  /** Skip specific stages */
  skipStages?: string[];
  /** Resume from a specific stage */
  resumeFrom?: string;
  /** Maximum retries per stage */
  maxRetries?: number;
  /** Save intermediate results */
  saveIntermediate?: boolean;
}

// ============================================================================
// SYSTEM PROMPTS
// ============================================================================

const PROMPTS = {
  stage1_survey: `You are a senior software architect performing a codebase audit.
Your task is to categorize this project based on the analysis data provided.

Respond with a JSON object containing:
- projectCategory: One of ["web-frontend", "web-backend", "api-service", "cli-tool", "library", "mobile-app", "desktop-app", "data-pipeline", "ml-service", "monorepo", "other"]
- primaryLanguage: The main language
- frameworks: Array of detected frameworks
- architecturePattern: One of ["layered", "hexagonal", "microservices", "monolith", "serverless", "event-driven", "mvc", "other"]
- domainSummary: One sentence describing what this system does
- suggestedDomains: Array of domain names for OpenSpec specs (e.g., ["user", "order", "auth", "api"])
- confidence: 0-1 score of how confident you are

Respond ONLY with valid JSON.`,

  stage2_entities: (projectCategory: string, frameworks: string[]) => `You are analyzing the core data models of a ${projectCategory} built with ${frameworks.join(', ')}.

For each entity you identify, extract in OpenSpec format:
- name: The entity name (e.g., "User", "Order")
- description: What this entity represents in the business domain
- properties: Array of {name, type, description, required}
- relationships: Array of {targetEntity, type, description}
- validations: Array of validation rules as strings (these become Requirements)
- scenarios: Array of {name, given, when, then, and?} - observable behaviors in Given/When/Then format
- location: File path where defined

Focus on BUSINESS entities, not framework internals.
Be precise - only include what you can verify from the code.

Respond with a JSON array of entities. Respond ONLY with valid JSON.`,

  stage3_services: (projectCategory: string, entities: string[]) => `You are analyzing the business logic layer of a ${projectCategory}.

Known entities: ${entities.join(', ')}

For each service/module, identify:
- name: Service name
- purpose: What business capability it provides
- operations: Array of {name, description, inputs, outputs, scenarios} - key operations/methods that become Requirements with Scenarios
- dependencies: Array of other services/repositories it uses
- sideEffects: Array of external interactions (email, payments, etc.)
- domain: Which domain this belongs to

Focus on WHAT the service does, not HOW it's implemented.
Express operations as requirements (SHALL/MUST/SHOULD) with testable scenarios.

Respond with a JSON array of services. Respond ONLY with valid JSON.`,

  stage4_api: `Extract the public API surface of this application.

For each endpoint/interface, structure as:
- method: HTTP method or interface type
- path: Route path or interface signature
- purpose: What it does (becomes requirement description)
- authentication: Required auth (if detectable)
- requestSchema: Expected input as JSON object
- responseSchema: Expected output as JSON object
- scenarios: Array of {name, given, when, then, and?} - example request/response flows
- relatedEntity: Which domain entity it operates on

Respond with a JSON array of endpoints. Respond ONLY with valid JSON.`,

  stage5_architecture: (survey: ProjectSurveyResult) => `Based on the analysis data, synthesize a complete architecture overview for OpenSpec.

Project context: ${survey.domainSummary}
Architecture pattern: ${survey.architecturePattern}
Domains: ${survey.suggestedDomains.join(', ')}

Include:
- systemPurpose: 2-3 sentences on what this system does and why
- architectureStyle: The overall architecture pattern with justification
- layerMap: Array of {name, purpose, components} - how code is organized
- dataFlow: How data moves through the system (entry to persistence) as a string
- integrations: Array of external systems this interacts with
- securityModel: Authentication/authorization approach as a string
- keyDecisions: Array of observable architectural decisions as strings

Express each key architectural aspect clearly.
Base all conclusions on the code evidence provided.
Where uncertain, say so explicitly.

Respond with a JSON object. Respond ONLY with valid JSON.`,
};

// ============================================================================
// SPEC GENERATION PIPELINE
// ============================================================================

/**
 * Spec Generation Pipeline
 */
export class SpecGenerationPipeline {
  private llm: LLMService;
  private options: Required<PipelineOptions>;
  private stageResults: Map<string, StageResult<unknown>> = new Map();

  constructor(llm: LLMService, options: PipelineOptions) {
    this.llm = llm;
    this.options = {
      outputDir: options.outputDir,
      skipStages: options.skipStages ?? [],
      resumeFrom: options.resumeFrom ?? '',
      maxRetries: options.maxRetries ?? 2,
      saveIntermediate: options.saveIntermediate ?? true,
    };
  }

  /**
   * Run the complete pipeline
   */
  async run(
    repoStructure: RepoStructure,
    llmContext: LLMContext,
    depGraph?: DependencyGraphResult
  ): Promise<PipelineResult> {
    const startTime = Date.now();
    let totalTokens = 0;
    const completedStages: string[] = [];
    const skippedStages: string[] = [];

    // Ensure output directory exists
    if (this.options.saveIntermediate) {
      await mkdir(this.options.outputDir, { recursive: true });
    }

    // Stage 1: Project Survey
    let survey: ProjectSurveyResult;
    if (this.shouldRunStage('survey')) {
      logger.analysis('Running Stage 1: Project Survey');
      const result = await this.runStage1(repoStructure);
      if (result.success && result.data) {
        survey = result.data;
        totalTokens += result.tokens;
        completedStages.push('survey');
      } else {
        logger.warning('Survey stage failed, using defaults');
        survey = this.getDefaultSurvey(repoStructure);
        skippedStages.push('survey');
      }
    } else {
      skippedStages.push('survey');
      survey = this.getDefaultSurvey(repoStructure);
    }

    // Stage 2: Entity Extraction
    let entities: ExtractedEntity[] = [];
    if (this.shouldRunStage('entities')) {
      logger.analysis('Running Stage 2: Entity Extraction');
      const schemaFiles = this.getSchemaFiles(llmContext);
      if (schemaFiles.length > 0) {
        const result = await this.runStage2(survey, schemaFiles);
        entities = result.data ?? [];
        totalTokens += result.tokens;
        completedStages.push('entities');
      } else {
        logger.warning('No schema files found, skipping entity extraction');
        skippedStages.push('entities');
      }
    } else {
      skippedStages.push('entities');
    }

    // Stage 3: Service Analysis
    let services: ExtractedService[] = [];
    if (this.shouldRunStage('services')) {
      logger.analysis('Running Stage 3: Service Analysis');
      const serviceFiles = this.getServiceFiles(llmContext);
      if (serviceFiles.length > 0) {
        const result = await this.runStage3(survey, entities, serviceFiles);
        services = result.data ?? [];
        totalTokens += result.tokens;
        completedStages.push('services');
      } else {
        logger.warning('No service files found, skipping service analysis');
        skippedStages.push('services');
      }
    } else {
      skippedStages.push('services');
    }

    // Stage 4: API Extraction
    let endpoints: ExtractedEndpoint[] = [];
    if (this.shouldRunStage('api')) {
      logger.analysis('Running Stage 4: API Extraction');
      const apiFiles = this.getApiFiles(llmContext);
      if (apiFiles.length > 0) {
        const result = await this.runStage4(apiFiles);
        endpoints = result.data ?? [];
        totalTokens += result.tokens;
        completedStages.push('api');
      } else {
        logger.warning('No API files found, skipping API extraction');
        skippedStages.push('api');
      }
    } else {
      skippedStages.push('api');
    }

    // Stage 5: Architecture Synthesis
    let architecture: ArchitectureSynthesis;
    if (this.shouldRunStage('architecture')) {
      logger.analysis('Running Stage 5: Architecture Synthesis');
      const result = await this.runStage5(survey, entities, services, endpoints, depGraph);
      if (result.success && result.data) {
        architecture = result.data;
        totalTokens += result.tokens;
        completedStages.push('architecture');
      } else {
        logger.warning('Architecture stage failed, using defaults');
        architecture = this.getDefaultArchitecture(survey);
        skippedStages.push('architecture');
      }
    } else {
      skippedStages.push('architecture');
      architecture = this.getDefaultArchitecture(survey);
    }

    const duration = Date.now() - startTime;
    const costTracking = this.llm.getCostTracking();

    const pipelineResult: PipelineResult = {
      survey,
      entities,
      services,
      endpoints,
      architecture,
      metadata: {
        totalTokens,
        estimatedCost: costTracking.estimatedCost,
        duration,
        completedStages,
        skippedStages,
      },
    };

    // Save final result
    if (this.options.saveIntermediate) {
      await this.saveResult('pipeline-result', pipelineResult);
    }

    logger.success(`Pipeline completed in ${(duration / 1000).toFixed(1)}s, ${totalTokens} tokens used`);

    return pipelineResult;
  }

  /**
   * Check if a stage should run
   */
  private shouldRunStage(stage: string): boolean {
    if (this.options.skipStages.includes(stage)) {
      return false;
    }

    if (this.options.resumeFrom) {
      const stages = ['survey', 'entities', 'services', 'api', 'architecture'];
      const resumeIndex = stages.indexOf(this.options.resumeFrom);
      const currentIndex = stages.indexOf(stage);
      return currentIndex >= resumeIndex;
    }

    return true;
  }

  /**
   * Stage 1: Project Survey
   */
  private async runStage1(repoStructure: RepoStructure): Promise<StageResult<ProjectSurveyResult>> {
    const startTime = Date.now();

    const userPrompt = `Analyze this project structure:

Project Name: ${repoStructure.projectName}
Project Type: ${repoStructure.projectType}
Frameworks: ${repoStructure.frameworks.join(', ')}
Architecture Pattern: ${repoStructure.architecture.pattern}

Layers:
${repoStructure.architecture.layers.map(l => `- ${l.name}: ${l.purpose} (${l.files.length} files)`).join('\n')}

Detected Domains:
${repoStructure.domains.map(d => `- ${d.name}: ${d.files.length} files, entities: ${d.entities.join(', ')}`).join('\n')}

Statistics:
- Total files: ${repoStructure.statistics.totalFiles}
- Analyzed files: ${repoStructure.statistics.analyzedFiles}
- Node count: ${repoStructure.statistics.nodeCount}
- Edge count: ${repoStructure.statistics.edgeCount}
- Clusters: ${repoStructure.statistics.clusterCount}`;

    try {
      const result = await this.llm.completeJSON<ProjectSurveyResult>({
        systemPrompt: PROMPTS.stage1_survey,
        userPrompt,
        temperature: 0.3,
        maxTokens: 500,
      });

      const stageResult: StageResult<ProjectSurveyResult> = {
        stage: 'survey',
        success: true,
        data: result,
        tokens: this.llm.getTokenUsage().totalTokens,
        duration: Date.now() - startTime,
      };

      if (this.options.saveIntermediate) {
        await this.saveResult('stage1-survey', stageResult);
      }

      return stageResult;
    } catch (error) {
      return {
        stage: 'survey',
        success: false,
        error: (error as Error).message,
        tokens: 0,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Stage 2: Entity Extraction
   */
  private async runStage2(
    survey: ProjectSurveyResult,
    schemaFiles: Array<{ path: string; content: string }>
  ): Promise<StageResult<ExtractedEntity[]>> {
    const startTime = Date.now();

    const filesContent = schemaFiles
      .slice(0, 10)
      .map(f => `=== ${f.path} ===\n${f.content}`)
      .join('\n\n');

    const userPrompt = `Analyze these schema/model files and extract entities:

${filesContent}`;

    try {
      const result = await this.llm.completeJSON<ExtractedEntity[]>({
        systemPrompt: PROMPTS.stage2_entities(survey.projectCategory, survey.frameworks),
        userPrompt,
        temperature: 0.3,
        maxTokens: 2000,
      });

      const stageResult: StageResult<ExtractedEntity[]> = {
        stage: 'entities',
        success: true,
        data: Array.isArray(result) ? result : [],
        tokens: this.llm.getTokenUsage().totalTokens,
        duration: Date.now() - startTime,
      };

      if (this.options.saveIntermediate) {
        await this.saveResult('stage2-entities', stageResult);
      }

      return stageResult;
    } catch (error) {
      return {
        stage: 'entities',
        success: false,
        error: (error as Error).message,
        data: [],
        tokens: 0,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Stage 3: Service Analysis
   */
  private async runStage3(
    survey: ProjectSurveyResult,
    entities: ExtractedEntity[],
    serviceFiles: Array<{ path: string; content: string }>
  ): Promise<StageResult<ExtractedService[]>> {
    const startTime = Date.now();

    const entityNames = entities.map(e => e.name);
    const filesContent = serviceFiles
      .slice(0, 10)
      .map(f => `=== ${f.path} ===\n${f.content}`)
      .join('\n\n');

    const userPrompt = `Analyze these service/business-logic files:

${filesContent}`;

    try {
      const result = await this.llm.completeJSON<ExtractedService[]>({
        systemPrompt: PROMPTS.stage3_services(survey.projectCategory, entityNames),
        userPrompt,
        temperature: 0.3,
        maxTokens: 2000,
      });

      const stageResult: StageResult<ExtractedService[]> = {
        stage: 'services',
        success: true,
        data: Array.isArray(result) ? result : [],
        tokens: this.llm.getTokenUsage().totalTokens,
        duration: Date.now() - startTime,
      };

      if (this.options.saveIntermediate) {
        await this.saveResult('stage3-services', stageResult);
      }

      return stageResult;
    } catch (error) {
      return {
        stage: 'services',
        success: false,
        error: (error as Error).message,
        data: [],
        tokens: 0,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Stage 4: API Extraction
   */
  private async runStage4(
    apiFiles: Array<{ path: string; content: string }>
  ): Promise<StageResult<ExtractedEndpoint[]>> {
    const startTime = Date.now();

    const filesContent = apiFiles
      .slice(0, 10)
      .map(f => `=== ${f.path} ===\n${f.content}`)
      .join('\n\n');

    const userPrompt = `Analyze these API/route files and extract endpoints:

${filesContent}`;

    try {
      const result = await this.llm.completeJSON<ExtractedEndpoint[]>({
        systemPrompt: PROMPTS.stage4_api,
        userPrompt,
        temperature: 0.3,
        maxTokens: 2000,
      });

      const stageResult: StageResult<ExtractedEndpoint[]> = {
        stage: 'api',
        success: true,
        data: Array.isArray(result) ? result : [],
        tokens: this.llm.getTokenUsage().totalTokens,
        duration: Date.now() - startTime,
      };

      if (this.options.saveIntermediate) {
        await this.saveResult('stage4-api', stageResult);
      }

      return stageResult;
    } catch (error) {
      return {
        stage: 'api',
        success: false,
        error: (error as Error).message,
        data: [],
        tokens: 0,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Stage 5: Architecture Synthesis
   */
  private async runStage5(
    survey: ProjectSurveyResult,
    entities: ExtractedEntity[],
    services: ExtractedService[],
    endpoints: ExtractedEndpoint[],
    depGraph?: DependencyGraphResult
  ): Promise<StageResult<ArchitectureSynthesis>> {
    const startTime = Date.now();

    const userPrompt = `Synthesize the architecture from this analysis:

Entities (${entities.length}):
${entities.map(e => `- ${e.name}: ${e.description}`).join('\n')}

Services (${services.length}):
${services.map(s => `- ${s.name}: ${s.purpose}`).join('\n')}

Endpoints (${endpoints.length}):
${endpoints.map(e => `- ${e.method} ${e.path}: ${e.purpose}`).join('\n')}

${depGraph ? `Dependency Graph:
- Nodes: ${depGraph.statistics.nodeCount}
- Edges: ${depGraph.statistics.edgeCount}
- Clusters: ${depGraph.statistics.clusterCount}
- Cycles: ${depGraph.statistics.cycleCount}` : ''}`;

    try {
      const result = await this.llm.completeJSON<ArchitectureSynthesis>({
        systemPrompt: PROMPTS.stage5_architecture(survey),
        userPrompt,
        temperature: 0.3,
        maxTokens: 2000,
      });

      const stageResult: StageResult<ArchitectureSynthesis> = {
        stage: 'architecture',
        success: true,
        data: result,
        tokens: this.llm.getTokenUsage().totalTokens,
        duration: Date.now() - startTime,
      };

      if (this.options.saveIntermediate) {
        await this.saveResult('stage5-architecture', stageResult);
      }

      return stageResult;
    } catch (error) {
      return {
        stage: 'architecture',
        success: false,
        error: (error as Error).message,
        tokens: 0,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Get schema files from LLM context
   */
  private getSchemaFiles(context: LLMContext): Array<{ path: string; content: string }> {
    return context.phase2_deep.files
      .filter(f => {
        const name = f.path.toLowerCase();
        return (
          name.includes('model') ||
          name.includes('schema') ||
          name.includes('entity') ||
          name.includes('types') ||
          name.includes('interface')
        );
      })
      .map(f => ({ path: f.path, content: f.content ?? '' }))
      .filter(f => f.content.length > 0);
  }

  /**
   * Get service files from LLM context
   */
  private getServiceFiles(context: LLMContext): Array<{ path: string; content: string }> {
    return context.phase2_deep.files
      .filter(f => {
        const name = f.path.toLowerCase();
        return (
          name.includes('service') ||
          name.includes('manager') ||
          name.includes('handler') ||
          name.includes('controller') ||
          name.includes('use-case') ||
          name.includes('usecase')
        );
      })
      .map(f => ({ path: f.path, content: f.content ?? '' }))
      .filter(f => f.content.length > 0);
  }

  /**
   * Get API files from LLM context
   */
  private getApiFiles(context: LLMContext): Array<{ path: string; content: string }> {
    return context.phase2_deep.files
      .filter(f => {
        const name = f.path.toLowerCase();
        return (
          name.includes('route') ||
          name.includes('api') ||
          name.includes('endpoint') ||
          name.includes('controller') ||
          name.includes('rest')
        );
      })
      .map(f => ({ path: f.path, content: f.content ?? '' }))
      .filter(f => f.content.length > 0);
  }

  /**
   * Get default survey when stage is skipped
   */
  private getDefaultSurvey(repoStructure: RepoStructure): ProjectSurveyResult {
    return {
      projectCategory: 'other',
      primaryLanguage: repoStructure.projectType,
      frameworks: repoStructure.frameworks,
      architecturePattern: repoStructure.architecture.pattern as ArchitecturePattern,
      domainSummary: `A ${repoStructure.projectType} project`,
      suggestedDomains: repoStructure.domains.map(d => d.name),
      confidence: 0.5,
    };
  }

  /**
   * Get default architecture when stage is skipped
   */
  private getDefaultArchitecture(survey: ProjectSurveyResult): ArchitectureSynthesis {
    return {
      systemPurpose: survey.domainSummary,
      architectureStyle: survey.architecturePattern,
      layerMap: [],
      dataFlow: 'Unknown',
      integrations: [],
      securityModel: 'Unknown',
      keyDecisions: [],
    };
  }

  /**
   * Save intermediate result
   */
  private async saveResult(name: string, data: unknown): Promise<void> {
    const filepath = join(this.options.outputDir, `${name}.json`);
    await writeFile(filepath, JSON.stringify(data, null, 2));
    logger.debug(`Saved ${name} to ${filepath}`);
  }

  /**
   * Load previous stage result (for resume)
   */
  async loadStageResult<T>(stage: string): Promise<StageResult<T> | null> {
    try {
      const filepath = join(this.options.outputDir, `stage-${stage}.json`);
      const content = await readFile(filepath, 'utf-8');
      return JSON.parse(content) as StageResult<T>;
    } catch {
      return null;
    }
  }
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Run the spec generation pipeline
 */
export async function runSpecGenerationPipeline(
  llm: LLMService,
  repoStructure: RepoStructure,
  llmContext: LLMContext,
  options: PipelineOptions,
  depGraph?: DependencyGraphResult
): Promise<PipelineResult> {
  const pipeline = new SpecGenerationPipeline(llm, options);
  return pipeline.run(repoStructure, llmContext, depGraph);
}
