# spec-gen Architecture

This document describes the internal architecture of spec-gen.

## Overview

spec-gen is a CLI tool that reverse-engineers OpenSpec specifications from existing codebases. It follows a pipeline architecture with four main phases:

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│    Init     │ ──▶ │   Analyze   │ ──▶ │  Generate   │ ──▶ │   Verify    │
│             │     │             │     │             │     │             │
│ Project     │     │ Static      │     │ LLM-based   │     │ Accuracy    │
│ Detection   │     │ Analysis    │     │ Extraction  │     │ Testing     │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
```

## Module Organization

### CLI Layer (`src/cli/`)

The CLI layer handles user interaction and command-line parsing. It uses Commander.js for argument parsing and delegates all business logic to the core layer.

```
src/cli/
├── index.ts           # Main entry point, command registration
└── commands/
    ├── init.ts        # Initialize configuration
    ├── analyze.ts     # Run static analysis
    ├── generate.ts    # Generate specs with LLM
    ├── verify.ts      # Verify spec accuracy
    └── run.ts         # Full pipeline orchestration
```

**Design Principles:**
- Commands are thin wrappers that call core modules
- No business logic in CLI layer
- Consistent option naming across commands
- User-friendly error messages and progress indicators

### Core Layer (`src/core/`)

The core layer contains all business logic, organized by function:

#### Analyzer (`src/core/analyzer/`)

Static analysis modules that examine the codebase without LLM involvement:

```
analyzer/
├── file-walker.ts          # Directory traversal, ignore patterns
├── significance-scorer.ts  # File importance ranking
├── import-parser.ts        # Import/export extraction
├── dependency-graph.ts     # Graph building, metrics
├── repository-mapper.ts    # Orchestration, clustering
└── artifact-generator.ts   # Output file generation
```

**Data Flow:**
```
FileWalker ──▶ SignificanceScorer ──▶ ImportParser ──▶ DependencyGraph
                                                              │
RepositoryMapper ◀────────────────────────────────────────────┘
      │
      ▼
ArtifactGenerator ──▶ .spec-gen/analysis/
```

#### Generator (`src/core/generator/`)

LLM-powered specification generation:

```
generator/
├── spec-pipeline.ts            # Multi-stage LLM orchestration
├── openspec-format-generator.ts # OpenSpec markdown formatting
├── openspec-compat.ts          # OpenSpec validation
└── openspec-writer.ts          # File writing with backups
```

**Pipeline Stages:**
1. **Project Survey** - Quick categorization (~200 tokens)
2. **Entity Extraction** - Core data models (~1000 tokens)
3. **Service Analysis** - Business logic (~800 tokens)
4. **API Extraction** - HTTP endpoints (~800 tokens)
5. **Architecture Synthesis** - Overall structure (~1200 tokens)

#### Verifier (`src/core/verifier/`)

Accuracy testing for generated specifications:

```
verifier/
└── verification-engine.ts  # Prediction and comparison
```

**Verification Process:**
1. Select files NOT used in generation
2. LLM predicts file contents from specs only
3. Compare predictions to actual code
4. Calculate accuracy scores

#### Services (`src/core/services/`)

Shared services used across modules:

```
services/
├── llm-service.ts         # LLM provider abstraction
├── config-manager.ts      # Configuration loading/saving
├── project-detector.ts    # Language/framework detection
└── gitignore-manager.ts   # Gitignore handling
```

### Types (`src/types/`)

Centralized TypeScript type definitions:

```typescript
// Core types
interface FileMetadata { ... }
interface ScoredFile extends FileMetadata { ... }
interface DependencyNode { ... }
interface DependencyEdge { ... }

// Options types
interface GlobalOptions { ... }
interface InitOptions extends GlobalOptions { ... }
interface AnalyzeOptions extends GlobalOptions { ... }
interface GenerateOptions extends GlobalOptions { ... }
interface VerifyOptions extends GlobalOptions { ... }
```

### Utils (`src/utils/`)

Pure utility functions:

```
utils/
└── logger.ts  # Semantic logging with colors
```

## Key Design Decisions

### 1. Separation of Analysis and Generation

**Rationale:** Keep static analysis separate from LLM-based generation to:
- Allow analysis without API costs
- Cache and reuse analysis results
- Enable offline analysis
- Make testing easier

### 2. Multi-Stage LLM Pipeline

**Rationale:** Break LLM generation into stages to:
- Keep context focused per stage
- Allow partial results on failure
- Enable stage-specific prompts
- Control token usage

### 3. Significance Scoring

**Rationale:** Rank files by importance to:
- Prioritize high-value files for LLM context
- Stay within token limits
- Focus on business logic over utilities
- Identify domain boundaries

**Scoring Formula:**
```
Score = NameScore (0-30) + PathScore (0-25) +
        StructureScore (0-25) + ConnectivityScore (0-20)
```

### 4. Dependency Graph Analysis

**Rationale:** Build import graph to:
- Detect natural domain clusters
- Identify core vs peripheral code
- Find integration points
- Guide LLM analysis order

**Metrics Calculated:**
- In-degree / Out-degree
- PageRank-style importance
- Betweenness centrality
- Cluster cohesion/coupling

### 5. OpenSpec Compatibility Layer

**Rationale:** Dedicated compatibility module to:
- Validate output format
- Ensure RFC 2119 compliance
- Handle config.yaml merging
- Support existing OpenSpec setups

## Data Flow

### Full Pipeline

```
User runs: spec-gen

  ┌─────────────────────────────────────────────────────────────┐
  │                      INITIALIZATION                          │
  │                                                              │
  │  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
  │  │  Project    │ ──▶│   Config    │ ──▶│  OpenSpec   │     │
  │  │  Detector   │    │   Writer    │    │   Setup     │     │
  │  └─────────────┘    └─────────────┘    └─────────────┘     │
  └─────────────────────────────────────────────────────────────┘
                                │
                                ▼
  ┌─────────────────────────────────────────────────────────────┐
  │                        ANALYSIS                              │
  │                                                              │
  │  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
  │  │    File     │ ──▶│ Significance│ ──▶│   Import    │     │
  │  │   Walker    │    │   Scorer    │    │   Parser    │     │
  │  └─────────────┘    └─────────────┘    └─────────────┘     │
  │                                               │              │
  │  ┌─────────────┐    ┌─────────────┐          │              │
  │  │  Artifact   │ ◀──│ Repository  │ ◀────────┘              │
  │  │  Generator  │    │   Mapper    │                         │
  │  └─────────────┘    └─────────────┘                         │
  │         │                 │                                  │
  │         ▼                 ▼                                  │
  │  .spec-gen/         Dependency                               │
  │  analysis/          Graph                                    │
  └─────────────────────────────────────────────────────────────┘
                                │
                                ▼
  ┌─────────────────────────────────────────────────────────────┐
  │                       GENERATION                             │
  │                                                              │
  │  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
  │  │    Spec     │ ──▶│  OpenSpec   │ ──▶│  OpenSpec   │     │
  │  │  Pipeline   │    │  Formatter  │    │   Writer    │     │
  │  └─────────────┘    └─────────────┘    └─────────────┘     │
  │         │                                     │              │
  │         ▼                                     ▼              │
  │    LLM Service                          openspec/            │
  │    (Claude/GPT)                         specs/               │
  └─────────────────────────────────────────────────────────────┘
                                │
                                ▼
  ┌─────────────────────────────────────────────────────────────┐
  │                      VERIFICATION                            │
  │                                                              │
  │  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
  │  │   Candidate │ ──▶│  Prediction │ ──▶│  Comparison │     │
  │  │  Selection  │    │    (LLM)    │    │   Scoring   │     │
  │  └─────────────┘    └─────────────┘    └─────────────┘     │
  │                                               │              │
  │                                               ▼              │
  │                                        Verification          │
  │                                        Report                │
  └─────────────────────────────────────────────────────────────┘
```

## LLM Service Architecture

```typescript
interface LLMProvider {
  name: string;
  generateCompletion(request: CompletionRequest): Promise<CompletionResponse>;
  countTokens(text: string): number;
  maxContextTokens: number;
  maxOutputTokens: number;
}
```

**Supported Providers:**
- Anthropic Claude (primary)
- OpenAI GPT (fallback)

**Features:**
- Automatic retry with exponential backoff
- Token counting and context management
- JSON response extraction
- Request/response logging
- Cost tracking

## Error Handling Strategy

### Graceful Degradation

- If analysis fails for one file, continue with others
- If one LLM stage fails, save partial results
- If verification fails, still report what succeeded

### Error Categories

```typescript
class SpecGenError extends Error {
  code: string;        // Machine-readable code
  suggestion?: string; // User-friendly fix
}
```

**Common Errors:**
- `NO_API_KEY` - Missing LLM credentials
- `NOT_A_REPOSITORY` - Not in a git repo
- `ANALYSIS_FAILED` - Static analysis error
- `LLM_RATE_LIMIT` - API rate limiting
- `OPENSPEC_INVALID` - Output validation failure

## Performance Considerations

### File Walking

- Async directory traversal
- Parallel file reading with concurrency limit
- Early filtering before content analysis
- Progress callbacks for UI updates

### Dependency Graph

- O(n + e) graph construction
- Tarjan's algorithm for cycle detection
- PageRank iteration with convergence check
- Lazy metric calculation

### LLM Optimization

- Context truncation for token limits
- Prioritize high-score files
- Cache parsed ASTs during analysis
- Batch related prompts where possible

## Testing Strategy

### Unit Tests

- Every core module has corresponding tests
- Mock file system and LLM responses
- Test edge cases (empty files, circular deps)

### Integration Tests

- Full pipeline with mock LLM
- OpenSpec CLI compatibility
- Real file system operations

### E2E Tests (Manual)

- Test against real open-source projects
- Verify generated specs with openspec validate
- Check cost estimates accuracy

## Future Considerations

### Planned Enhancements

1. **More Languages** - Python, Go, Java support
2. **Incremental Analysis** - Only re-analyze changed files
3. **Custom Prompts** - User-provided LLM prompts
4. **Spec Diffing** - Show changes between generations

### Extension Points

- Custom significance scorers
- Language-specific parsers
- Alternative LLM providers
- Output format plugins
