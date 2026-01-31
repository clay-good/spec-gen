# spec-gen

> Reverse-engineer OpenSpec specifications from existing codebases.

**"Archaeology over Creativity"** — Extract the truth of what your code does, grounded in static analysis.

## The Problem

[OpenSpec](https://github.com/Fission-AI/OpenSpec) is great for spec-driven development, but what about existing codebases?

- `openspec init` creates empty scaffolding
- Manually writing specs for thousands of lines is tedious
- The documented flow expects you to "populate your project context" manually

**spec-gen automates the reverse-engineering process.**

## Quick Start

```bash
# Clone and build
git clone https://github.com/clay-good/spec-gen
cd spec-gen
npm install
npm run build
npm link

# Navigate to your project
cd /path/to/your-project

# Run spec-gen
spec-gen init      # Initialize configuration
spec-gen analyze   # Run static analysis (no API key needed)
spec-gen generate  # Generate specs (requires API key)
spec-gen verify    # Verify accuracy
```

## Requirements

- **Node.js 20+**
- **API Key** (for generate/verify commands):
  ```bash
  export ANTHROPIC_API_KEY=sk-ant-...
  # or
  export OPENAI_API_KEY=sk-...
  ```

## What It Does

1. **Analyzes** your codebase (files, imports, exports, patterns)
2. **Extracts** business logic using LLM (Claude or GPT)
3. **Generates** OpenSpec-format specifications
4. **Verifies** generated specs against actual code

## Output

spec-gen writes directly to OpenSpec's structure:

```
openspec/
├── config.yaml              # Updated with detected context
└── specs/
    ├── overview/spec.md     # System overview
    ├── user/spec.md         # Domain: User management
    ├── order/spec.md        # Domain: Order processing
    ├── auth/spec.md         # Domain: Authentication
    ├── architecture/spec.md # System architecture
    └── api/spec.md          # API specification
```

Each spec follows OpenSpec conventions:
- Requirements with RFC 2119 keywords (SHALL, MUST, SHOULD)
- Scenarios in Given/When/Then format
- Technical notes linking to implementation files

## Example Output

We ran spec-gen against the OpenSpec CLI itself. See [examples/openspec-analysis/](examples/openspec-analysis/) for the full output including the dependency graph, LLM context, and analysis summary.

```bash
$ spec-gen analyze

Analysis Complete

  Repository Structure:
    ├─ Files analyzed: 221 of 231
    ├─ High-significance files: 15
    ├─ Languages: TypeScript (78%), Markdown (12%), JSON (3%)

  Detected Domains:
    ├─ completions (16 files)
    ├─ command-generation (26 files)
    ├─ artifact-graph (7 files)
    ├─ schemas (9 files)
    ├─ validation (3 files)
    ├─ commands (14 files)
    ├─ parsers (3 files)
    └─ templates (2 files)
```

## Commands

| Command | Description |
|---------|-------------|
| `spec-gen` | Full pipeline: init → analyze → generate |
| `spec-gen init` | Initialize configuration |
| `spec-gen analyze` | Run static analysis only (no LLM) |
| `spec-gen generate` | Generate specs from analysis |
| `spec-gen verify` | Test spec accuracy |

### Command Options

**Full Pipeline:**
```bash
spec-gen [options]
  --force        # Reinitialize even if config exists
  --reanalyze    # Force fresh analysis
  --model <name> # LLM model (default: claude-sonnet-4-20250514)
  --dry-run      # Show what would be done
  -y, --yes      # Skip confirmation prompts
```

**Analyze:**
```bash
spec-gen analyze [options]
  --output <path>   # Output directory (default: .spec-gen/analysis/)
  --max-files <n>   # Maximum files to analyze (default: 500)
  --include <glob>  # Additional patterns to include
  --exclude <glob>  # Additional patterns to exclude
```

**Generate:**
```bash
spec-gen generate [options]
  --model <name>     # LLM model to use
  --dry-run          # Preview without writing
  --domains <list>   # Only generate specific domains
  --merge            # Merge with existing specs
  --no-overwrite     # Skip existing files
```

**Verify:**
```bash
spec-gen verify [options]
  --samples <n>      # Number of files to verify (default: 5)
  --threshold <0-1>  # Minimum score to pass (default: 0.7)
  --verbose          # Show detailed comparison
  --json             # Output as JSON
```

## How It Works

### 1. Static Analysis (No API Key Required)

- **File Discovery**: Walks the directory tree, respecting .gitignore
- **Significance Scoring**: Ranks files by importance (schemas, services, routes)
- **Import/Export Parsing**: Builds a dependency graph
- **Cluster Detection**: Groups related files into domains

### 2. LLM Generation

Using the analysis, spec-gen queries an LLM to extract specifications:

- **Stage 1**: Project Survey - Quick categorization
- **Stage 2**: Entity Extraction - Core data models
- **Stage 3**: Service Analysis - Business logic
- **Stage 4**: API Extraction - HTTP endpoints
- **Stage 5**: Architecture Synthesis - Overall structure

### 3. Verification

Tests generated specs by predicting file contents from specs alone:

- Selects files NOT used in generation
- LLM predicts what each file should contain
- Compares predictions to actual code
- Reports accuracy score and identifies gaps

## Configuration

spec-gen creates `.spec-gen/config.json`:

```json
{
  "version": "1.0.0",
  "projectType": "nodejs",
  "openspecPath": "./openspec",
  "analysis": {
    "maxFiles": 500,
    "includePatterns": [],
    "excludePatterns": []
  },
  "generation": {
    "model": "claude-sonnet-4-20250514",
    "domains": "auto"
  }
}
```

## Output Files

### Analysis Artifacts (.spec-gen/analysis/)

| File | Description |
|------|-------------|
| `repo-structure.json` | Project structure and metadata |
| `dependency-graph.json` | Import/export relationships |
| `llm-context.json` | Context prepared for LLM |
| `dependencies.mermaid` | Visual dependency graph |
| `SUMMARY.md` | Human-readable analysis |

## Supported Languages

| Language | Support Level |
|----------|---------------|
| JavaScript/TypeScript | Full |
| Python | Basic |
| Go | Basic |

The tool works best with TypeScript projects due to richer type information.

## Usage Options

spec-gen provides 4 ways to reverse-engineer specifications:

### Option 1: CLI Tool (Recommended)

The full-featured command-line tool with static analysis, LLM generation, and verification.

```bash
spec-gen init && spec-gen analyze && spec-gen generate
```

### Option 2: Claude Code Skill

For Claude Code users, copy `skills/claude-spec-gen.md` to your project:

You'll need to save the claude-spec-gen.md to `.claude/skills`

Then use natural language:
```
"Run spec-gen on this codebase"
"Generate OpenSpec specifications for the user domain"
```

### Option 3: OpenSpec Native Skill

For OpenSpec's built-in skill system, use `skills/openspec-skill.md`:

```bash
cp skills/openspec-skill.md /path/to/openspec/skills/
```

### Option 4: Direct LLM Prompting

Copy `AGENTS.md` as a system prompt for any LLM (ChatGPT, Claude, etc.):

```
# In ChatGPT/Claude web interface:
1. Paste contents of AGENTS.md
2. Ask: "Analyze this codebase and generate OpenSpec specs"
3. Provide file contents or let it explore
```

## Examples

| Example | Description |
|---------|-------------|
| [examples/openspec-analysis/](examples/openspec-analysis/) | Static analysis output from running `spec-gen analyze` on the OpenSpec CLI |
| [examples/openspec-cli/](examples/openspec-cli/) | Full OpenSpec specifications generated with `spec-gen generate` |

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Run tests
npm test

# Build
npm run build

# Type check
npm run typecheck
```

## Links

- [OpenSpec](https://github.com/Fission-AI/OpenSpec) - The spec-driven development framework
- [AGENTS.md](AGENTS.md) - LLM system prompt for direct prompting
- [Architecture](docs/ARCHITECTURE.md) - Internal design and module organization
- [Algorithms](docs/ALGORITHMS.md) - Analysis algorithms explained
