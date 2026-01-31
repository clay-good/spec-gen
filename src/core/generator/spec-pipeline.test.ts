/**
 * Spec Generation Pipeline Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  SpecGenerationPipeline,
  runSpecGenerationPipeline,
  type PipelineResult,
  type ProjectSurveyResult,
  type ExtractedEntity,
  type ExtractedService,
  type ExtractedEndpoint,
  type ArchitectureSynthesis,
} from './spec-pipeline.js';
import { createMockLLMService } from '../services/llm-service.js';
import type { RepoStructure, LLMContext } from '../analyzer/artifact-generator.js';
import type { DependencyGraphResult } from '../analyzer/dependency-graph.js';

// ============================================================================
// TEST HELPERS
// ============================================================================

async function createTempDir(): Promise<string> {
  const dir = join(tmpdir(), `spec-pipeline-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

function createMockRepoStructure(): RepoStructure {
  return {
    projectName: 'test-project',
    projectType: 'node-typescript',
    frameworks: ['Express', 'TypeORM'],
    architecture: {
      pattern: 'layered',
      layers: [
        { name: 'API', purpose: 'Request handling', files: ['routes/user.ts'], representativeFile: 'routes/user.ts' },
        { name: 'Service', purpose: 'Business logic', files: ['services/user-service.ts'], representativeFile: 'services/user-service.ts' },
        { name: 'Data', purpose: 'Data access', files: ['models/user.ts'], representativeFile: 'models/user.ts' },
      ],
    },
    domains: [
      { name: 'user', suggestedSpecPath: 'openspec/specs/user/spec.md', files: ['user.ts'], entities: ['User'], keyFile: 'user.ts' },
      { name: 'auth', suggestedSpecPath: 'openspec/specs/auth/spec.md', files: ['auth.ts'], entities: ['Session'], keyFile: 'auth.ts' },
    ],
    entryPoints: [{ file: 'index.ts', type: 'application-entry', initializes: ['express'] }],
    dataFlow: { sources: ['routes/'], sinks: ['repositories/'], transformers: ['services/'] },
    keyFiles: {
      schemas: ['models/user.ts'],
      config: ['config.ts'],
      auth: ['auth.ts'],
      database: ['db.ts'],
      routes: ['routes/user.ts'],
      services: ['services/user-service.ts'],
    },
    statistics: {
      totalFiles: 50,
      analyzedFiles: 40,
      skippedFiles: 10,
      avgFileScore: 55,
      nodeCount: 40,
      edgeCount: 60,
      cycleCount: 0,
      clusterCount: 3,
    },
  };
}

function createMockLLMContext(): LLMContext {
  return {
    phase1_survey: {
      purpose: 'Survey',
      files: [{ path: 'repo-structure.json', tokens: 500 }],
      estimatedTokens: 500,
    },
    phase2_deep: {
      purpose: 'Deep analysis',
      files: [
        { path: 'models/user.ts', content: 'export interface User { id: string; name: string; email: string; }', tokens: 50 },
        { path: 'models/post.ts', content: 'export interface Post { id: string; title: string; authorId: string; }', tokens: 50 },
        { path: 'services/user-service.ts', content: 'export class UserService { getUser(id: string) {} createUser(data: User) {} }', tokens: 60 },
        { path: 'routes/user.ts', content: 'router.get("/users/:id", getUser); router.post("/users", createUser);', tokens: 40 },
        { path: 'routes/api.ts', content: 'router.get("/api/health", healthCheck);', tokens: 30 },
      ],
      totalTokens: 230,
    },
    phase3_validation: {
      purpose: 'Validation',
      files: [{ path: 'test.ts', content: 'describe("test", () => {});', tokens: 20 }],
      totalTokens: 20,
    },
  };
}

function createMockDepGraph(): DependencyGraphResult {
  return {
    nodes: [],
    edges: [],
    clusters: [],
    rankings: {
      byImportance: [],
      byConnectivity: [],
      clusterCenters: [],
      leafNodes: [],
      bridgeNodes: [],
      orphanNodes: [],
    },
    cycles: [],
    statistics: {
      nodeCount: 40,
      edgeCount: 60,
      avgDegree: 3,
      density: 0.1,
      clusterCount: 3,
      cycleCount: 0,
    },
  };
}

// Mock LLM responses
const MOCK_RESPONSES = {
  survey: JSON.stringify({
    projectCategory: 'web-backend',
    primaryLanguage: 'TypeScript',
    frameworks: ['Express', 'TypeORM'],
    architecturePattern: 'layered',
    domainSummary: 'A user management API service',
    suggestedDomains: ['user', 'auth', 'api'],
    confidence: 0.85,
  }),
  entities: JSON.stringify([
    {
      name: 'User',
      description: 'Represents a user in the system',
      properties: [
        { name: 'id', type: 'string', required: true },
        { name: 'name', type: 'string', required: true },
        { name: 'email', type: 'string', required: true },
      ],
      relationships: [],
      validations: ['Email must be unique', 'Name is required'],
      scenarios: [
        { name: 'Create User', given: 'valid user data', when: 'createUser is called', then: 'user is created' },
      ],
      location: 'models/user.ts',
    },
  ]),
  services: JSON.stringify([
    {
      name: 'UserService',
      purpose: 'Handles user-related business logic',
      operations: [
        {
          name: 'getUser',
          description: 'Retrieves a user by ID',
          inputs: ['id: string'],
          outputs: ['User | null'],
          scenarios: [
            { name: 'Get existing user', given: 'user exists', when: 'getUser is called', then: 'user is returned' },
          ],
        },
      ],
      dependencies: ['UserRepository'],
      sideEffects: [],
      domain: 'user',
    },
  ]),
  api: JSON.stringify([
    {
      method: 'GET',
      path: '/users/:id',
      purpose: 'Get user by ID',
      authentication: 'Bearer token',
      requestSchema: {},
      responseSchema: { id: 'string', name: 'string' },
      scenarios: [
        { name: 'Get user success', given: 'valid token', when: 'GET /users/123', then: 'return user' },
      ],
      relatedEntity: 'User',
    },
  ]),
  architecture: JSON.stringify({
    systemPurpose: 'A user management API that handles user CRUD operations and authentication.',
    architectureStyle: 'Layered architecture with clear separation of concerns.',
    layerMap: [
      { name: 'API', purpose: 'HTTP request handling', components: ['routes/'] },
      { name: 'Service', purpose: 'Business logic', components: ['services/'] },
      { name: 'Data', purpose: 'Database access', components: ['models/'] },
    ],
    dataFlow: 'Request -> Routes -> Services -> Repositories -> Database',
    integrations: [],
    securityModel: 'JWT-based authentication',
    keyDecisions: ['Use TypeORM for database access', 'Express for HTTP routing'],
  }),
};

// ============================================================================
// TESTS
// ============================================================================

describe('SpecGenerationPipeline', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('Full Pipeline', () => {
    it('should run all stages successfully', async () => {
      const { service, provider } = createMockLLMService();

      // Set up mock responses
      provider.setResponse('categorize', MOCK_RESPONSES.survey);
      provider.setResponse('schema/model', MOCK_RESPONSES.entities);
      provider.setResponse('service/business', MOCK_RESPONSES.services);
      provider.setResponse('API/route', MOCK_RESPONSES.api);
      provider.setResponse('Synthesize', MOCK_RESPONSES.architecture);
      provider.setDefaultResponse(MOCK_RESPONSES.survey);

      const pipeline = new SpecGenerationPipeline(service, {
        outputDir: tempDir,
        saveIntermediate: true,
      });

      const result = await pipeline.run(
        createMockRepoStructure(),
        createMockLLMContext(),
        createMockDepGraph()
      );

      expect(result.survey).toBeDefined();
      expect(result.survey.projectCategory).toBe('web-backend');
      expect(result.metadata.completedStages.length).toBeGreaterThan(0);
    });

    it('should save intermediate results', async () => {
      const { service, provider } = createMockLLMService();
      provider.setDefaultResponse(MOCK_RESPONSES.survey);

      const pipeline = new SpecGenerationPipeline(service, {
        outputDir: tempDir,
        saveIntermediate: true,
      });

      await pipeline.run(
        createMockRepoStructure(),
        createMockLLMContext()
      );

      const files = await readdir(tempDir);
      expect(files.some(f => f.includes('stage1'))).toBe(true);
      expect(files.some(f => f.includes('pipeline-result'))).toBe(true);
    });

    it('should track token usage', async () => {
      const { service, provider } = createMockLLMService();
      provider.setDefaultResponse(MOCK_RESPONSES.survey);

      const pipeline = new SpecGenerationPipeline(service, {
        outputDir: tempDir,
      });

      const result = await pipeline.run(
        createMockRepoStructure(),
        createMockLLMContext()
      );

      expect(result.metadata.totalTokens).toBeGreaterThan(0);
    });
  });

  describe('Stage 1: Project Survey', () => {
    it('should extract project category', async () => {
      const { service, provider } = createMockLLMService();
      provider.setDefaultResponse(MOCK_RESPONSES.survey);

      const pipeline = new SpecGenerationPipeline(service, {
        outputDir: tempDir,
        skipStages: ['entities', 'services', 'api', 'architecture'],
      });

      const result = await pipeline.run(
        createMockRepoStructure(),
        createMockLLMContext()
      );

      expect(result.survey.projectCategory).toBe('web-backend');
      expect(result.survey.primaryLanguage).toBe('TypeScript');
      expect(result.survey.frameworks).toContain('Express');
      expect(result.survey.confidence).toBeGreaterThan(0);
    });

    it('should include suggested domains', async () => {
      const { service, provider } = createMockLLMService();
      provider.setDefaultResponse(MOCK_RESPONSES.survey);

      const pipeline = new SpecGenerationPipeline(service, {
        outputDir: tempDir,
        skipStages: ['entities', 'services', 'api', 'architecture'],
      });

      const result = await pipeline.run(
        createMockRepoStructure(),
        createMockLLMContext()
      );

      expect(result.survey.suggestedDomains).toContain('user');
      expect(result.survey.suggestedDomains).toContain('auth');
    });
  });

  describe('Stage 2: Entity Extraction', () => {
    it('should extract entities from schema files', async () => {
      const { service, provider } = createMockLLMService();
      provider.setResponse('categorize', MOCK_RESPONSES.survey);
      provider.setResponse('schema/model', MOCK_RESPONSES.entities);
      provider.setDefaultResponse(MOCK_RESPONSES.architecture);

      const pipeline = new SpecGenerationPipeline(service, {
        outputDir: tempDir,
        skipStages: ['services', 'api', 'architecture'],
      });

      const result = await pipeline.run(
        createMockRepoStructure(),
        createMockLLMContext()
      );

      expect(result.entities.length).toBeGreaterThan(0);
      expect(result.entities[0].name).toBe('User');
      expect(result.entities[0].properties.length).toBeGreaterThan(0);
    });

    it('should include entity scenarios', async () => {
      const { service, provider } = createMockLLMService();
      provider.setResponse('categorize', MOCK_RESPONSES.survey);
      provider.setResponse('schema/model', MOCK_RESPONSES.entities);
      provider.setDefaultResponse(MOCK_RESPONSES.architecture);

      const pipeline = new SpecGenerationPipeline(service, {
        outputDir: tempDir,
        skipStages: ['services', 'api', 'architecture'],
      });

      const result = await pipeline.run(
        createMockRepoStructure(),
        createMockLLMContext()
      );

      expect(result.entities[0].scenarios.length).toBeGreaterThan(0);
      expect(result.entities[0].scenarios[0].given).toBeDefined();
      expect(result.entities[0].scenarios[0].when).toBeDefined();
      expect(result.entities[0].scenarios[0].then).toBeDefined();
    });
  });

  describe('Stage 3: Service Analysis', () => {
    it('should extract services', async () => {
      const { service, provider } = createMockLLMService();
      provider.setResponse('categorize', MOCK_RESPONSES.survey);
      provider.setResponse('schema/model', MOCK_RESPONSES.entities);
      provider.setResponse('service/business', MOCK_RESPONSES.services);
      provider.setDefaultResponse(MOCK_RESPONSES.architecture);

      const pipeline = new SpecGenerationPipeline(service, {
        outputDir: tempDir,
        skipStages: ['api', 'architecture'],
      });

      const result = await pipeline.run(
        createMockRepoStructure(),
        createMockLLMContext()
      );

      expect(result.services.length).toBeGreaterThan(0);
      expect(result.services[0].name).toBe('UserService');
      expect(result.services[0].operations.length).toBeGreaterThan(0);
    });

    it('should include service dependencies', async () => {
      const { service, provider } = createMockLLMService();
      provider.setResponse('categorize', MOCK_RESPONSES.survey);
      provider.setResponse('schema/model', MOCK_RESPONSES.entities);
      provider.setResponse('service/business', MOCK_RESPONSES.services);
      provider.setDefaultResponse(MOCK_RESPONSES.architecture);

      const pipeline = new SpecGenerationPipeline(service, {
        outputDir: tempDir,
        skipStages: ['api', 'architecture'],
      });

      const result = await pipeline.run(
        createMockRepoStructure(),
        createMockLLMContext()
      );

      expect(result.services[0].dependencies).toContain('UserRepository');
    });
  });

  describe('Stage 4: API Extraction', () => {
    it('should extract API endpoints', async () => {
      const { service, provider } = createMockLLMService();
      provider.setResponse('categorize', MOCK_RESPONSES.survey);
      provider.setResponse('schema/model', MOCK_RESPONSES.entities);
      provider.setResponse('service/business', MOCK_RESPONSES.services);
      provider.setResponse('API/route', MOCK_RESPONSES.api);
      provider.setDefaultResponse(MOCK_RESPONSES.architecture);

      const pipeline = new SpecGenerationPipeline(service, {
        outputDir: tempDir,
        skipStages: ['architecture'],
      });

      const result = await pipeline.run(
        createMockRepoStructure(),
        createMockLLMContext()
      );

      expect(result.endpoints.length).toBeGreaterThan(0);
      expect(result.endpoints[0].method).toBe('GET');
      expect(result.endpoints[0].path).toBe('/users/:id');
    });

    it('should include endpoint scenarios', async () => {
      const { service, provider } = createMockLLMService();
      provider.setResponse('categorize', MOCK_RESPONSES.survey);
      provider.setResponse('API/route', MOCK_RESPONSES.api);
      provider.setDefaultResponse(MOCK_RESPONSES.survey);

      const pipeline = new SpecGenerationPipeline(service, {
        outputDir: tempDir,
        skipStages: ['entities', 'services', 'architecture'],
      });

      const result = await pipeline.run(
        createMockRepoStructure(),
        createMockLLMContext()
      );

      expect(result.endpoints[0].scenarios.length).toBeGreaterThan(0);
    });
  });

  describe('Stage 5: Architecture Synthesis', () => {
    it('should synthesize architecture', async () => {
      const { service, provider } = createMockLLMService();
      // Survey runs first, architecture runs second
      provider.setResponse('categorize', MOCK_RESPONSES.survey);
      provider.setResponse('Synthesize', MOCK_RESPONSES.architecture);
      provider.setDefaultResponse(MOCK_RESPONSES.survey);

      const pipeline = new SpecGenerationPipeline(service, {
        outputDir: tempDir,
        skipStages: ['entities', 'services', 'api'],
      });

      const result = await pipeline.run(
        createMockRepoStructure(),
        createMockLLMContext(),
        createMockDepGraph()
      );

      expect(result.architecture.systemPurpose).toBeDefined();
      expect(result.architecture.architectureStyle).toBeDefined();
      expect(result.architecture.layerMap.length).toBeGreaterThan(0);
    });

    it('should include data flow', async () => {
      const { service, provider } = createMockLLMService();
      // Survey runs first, architecture runs second
      provider.setResponse('categorize', MOCK_RESPONSES.survey);
      provider.setResponse('Synthesize', MOCK_RESPONSES.architecture);
      provider.setDefaultResponse(MOCK_RESPONSES.survey);

      const pipeline = new SpecGenerationPipeline(service, {
        outputDir: tempDir,
        skipStages: ['entities', 'services', 'api'],
      });

      const result = await pipeline.run(
        createMockRepoStructure(),
        createMockLLMContext()
      );

      expect(result.architecture.dataFlow).toContain('->');
    });
  });

  describe('Stage Skipping', () => {
    it('should skip specified stages', async () => {
      const { service, provider } = createMockLLMService();
      provider.setDefaultResponse(MOCK_RESPONSES.survey);

      const pipeline = new SpecGenerationPipeline(service, {
        outputDir: tempDir,
        skipStages: ['entities', 'services', 'api'],
      });

      const result = await pipeline.run(
        createMockRepoStructure(),
        createMockLLMContext()
      );

      expect(result.metadata.skippedStages).toContain('entities');
      expect(result.metadata.skippedStages).toContain('services');
      expect(result.metadata.skippedStages).toContain('api');
      expect(result.entities).toHaveLength(0);
      expect(result.services).toHaveLength(0);
      expect(result.endpoints).toHaveLength(0);
    });

    it('should use default values when stages are skipped', async () => {
      const { service, provider } = createMockLLMService();
      provider.setDefaultResponse(MOCK_RESPONSES.survey);

      const repoStructure = createMockRepoStructure();
      const pipeline = new SpecGenerationPipeline(service, {
        outputDir: tempDir,
        skipStages: ['survey', 'entities', 'services', 'api', 'architecture'],
      });

      const result = await pipeline.run(repoStructure, createMockLLMContext());

      // Should use default survey from repo structure
      expect(result.survey.frameworks).toEqual(repoStructure.frameworks);
      expect(result.metadata.skippedStages).toContain('survey');
    });
  });

  describe('Resume from Stage', () => {
    it('should resume from specified stage', async () => {
      const { service, provider } = createMockLLMService();
      provider.setDefaultResponse(MOCK_RESPONSES.architecture);

      const pipeline = new SpecGenerationPipeline(service, {
        outputDir: tempDir,
        resumeFrom: 'architecture',
      });

      const result = await pipeline.run(
        createMockRepoStructure(),
        createMockLLMContext()
      );

      // Earlier stages should be skipped
      expect(result.metadata.skippedStages).toContain('survey');
      expect(result.metadata.skippedStages).toContain('entities');
      expect(result.metadata.completedStages).toContain('architecture');
    });
  });

  describe('Error Handling', () => {
    it('should handle LLM failures gracefully', async () => {
      const { service, provider } = createMockLLMService();

      // Make provider return invalid JSON to simulate failure
      provider.setDefaultResponse('not valid json');

      const pipeline = new SpecGenerationPipeline(service, {
        outputDir: tempDir,
        skipStages: ['entities', 'services', 'api', 'architecture'],
      });

      // Should not throw, but survey will fail and use defaults
      const result = await pipeline.run(
        createMockRepoStructure(),
        createMockLLMContext()
      );

      // Pipeline should still complete with some results
      expect(result).toBeDefined();
    });

    it('should skip stages when no relevant files found', async () => {
      const { service, provider } = createMockLLMService();
      provider.setDefaultResponse(MOCK_RESPONSES.survey);

      // Create context with no schema files
      const emptyContext: LLMContext = {
        phase1_survey: { purpose: 'Survey', files: [], estimatedTokens: 0 },
        phase2_deep: { purpose: 'Deep', files: [], totalTokens: 0 },
        phase3_validation: { purpose: 'Validation', files: [], totalTokens: 0 },
      };

      const pipeline = new SpecGenerationPipeline(service, {
        outputDir: tempDir,
      });

      const result = await pipeline.run(
        createMockRepoStructure(),
        emptyContext
      );

      expect(result.metadata.skippedStages).toContain('entities');
      expect(result.metadata.skippedStages).toContain('services');
      expect(result.metadata.skippedStages).toContain('api');
    });
  });

  describe('Convenience Function', () => {
    it('should run pipeline via convenience function', async () => {
      const { service, provider } = createMockLLMService();
      provider.setDefaultResponse(MOCK_RESPONSES.survey);

      const result = await runSpecGenerationPipeline(
        service,
        createMockRepoStructure(),
        createMockLLMContext(),
        { outputDir: tempDir, skipStages: ['entities', 'services', 'api', 'architecture'] }
      );

      expect(result.survey).toBeDefined();
      expect(result.metadata).toBeDefined();
    });
  });

  describe('Metadata', () => {
    it('should track pipeline duration', async () => {
      const { service, provider } = createMockLLMService();
      provider.setDefaultResponse(MOCK_RESPONSES.survey);

      const pipeline = new SpecGenerationPipeline(service, {
        outputDir: tempDir,
        skipStages: ['entities', 'services', 'api', 'architecture'],
      });

      const result = await pipeline.run(
        createMockRepoStructure(),
        createMockLLMContext()
      );

      // Duration is a non-negative number (may be 0 in fast test runs)
      expect(result.metadata.duration).toBeGreaterThanOrEqual(0);
      expect(typeof result.metadata.duration).toBe('number');
    });

    it('should list completed and skipped stages', async () => {
      const { service, provider } = createMockLLMService();
      provider.setDefaultResponse(MOCK_RESPONSES.survey);

      const pipeline = new SpecGenerationPipeline(service, {
        outputDir: tempDir,
        skipStages: ['api'],
      });

      const result = await pipeline.run(
        createMockRepoStructure(),
        createMockLLMContext()
      );

      expect(result.metadata.completedStages).toContain('survey');
      expect(result.metadata.skippedStages).toContain('api');
    });
  });
});
