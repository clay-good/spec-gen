# Example: OpenSpec CLI Analysis

This directory contains the output of running `spec-gen analyze` against the OpenSpec CLI codebase itself.

## How This Was Generated

```bash
cd /path/to/OpenSpec-main
spec-gen init
spec-gen analyze
```

## Output Files

| File | Description |
|------|-------------|
| `config.json` | spec-gen configuration for the project |
| `SUMMARY.md` | Human-readable analysis summary |
| `repo-structure.json` | Complete file metadata and significance scores |
| `dependency-graph.json` | Import/export relationships between files |
| `llm-context.json` | Optimized context for LLM generation |
| `dependencies.mermaid` | Visual dependency graph |

## Key Findings

From analyzing the OpenSpec CLI:

- **221 files analyzed** (TypeScript, Markdown, JSON)
- **50 high-value files** identified for spec generation
- **37 domain clusters** detected

### Detected Domains

1. **completions** - Shell completion providers (16 files)
2. **command-generation** - IDE command generation (26 files)
3. **artifact-graph** - Artifact dependency resolution (7 files)
4. **schemas** - Configuration schemas (9 files)
5. **validation** - Spec validation (3 files)
6. **commands** - CLI commands (14 files)
7. **parsers** - Markdown/requirement parsing (3 files)

### Top Significant Files

1. `src/core/completions/types.ts` (score: 65)
2. `src/core/command-generation/types.ts` (score: 65)
3. `src/core/artifact-graph/types.ts` (score: 65)
4. `src/core/config-schema.ts` (score: 65)
5. `src/core/schemas/change.schema.ts` (score: 60)

## Next Steps

To generate full specifications, run:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
spec-gen generate
```

This will create OpenSpec-format specifications in `openspec/specs/`.
