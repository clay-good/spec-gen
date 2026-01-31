# Example: OpenSpec CLI Specifications

This example demonstrates spec-gen output by reverse-engineering the OpenSpec CLI tool itself.

## Source Project

- **Project**: OpenSpec CLI
- **Version**: 1.1.0
- **Repository**: https://github.com/Fission-AI/OpenSpec
- **Tech Stack**: Node.js, TypeScript, Commander.js, Zod

## Generated Specifications

```
openspec/
├── config.yaml                    # Project configuration with detected context
└── specs/
    ├── overview/spec.md           # System overview and capabilities
    ├── validation/spec.md         # Schema validation and RFC 2119 rules
    ├── parsing/spec.md            # Markdown parsing and extraction
    ├── cli/spec.md                # Command-line interface
    ├── artifact-graph/spec.md     # Dependency resolution
    └── architecture/spec.md       # System architecture
```

## Domains Identified

| Domain | Description | Requirements |
|--------|-------------|--------------|
| Overview | System capabilities and initialization | 3 |
| Validation | Schema validation, RFC 2119 keywords, delta limits | 5 |
| Parsing | Markdown parsing, requirement extraction, delta blocks | 5 |
| CLI | Commands, interactive prompts, output formats | 6 |
| Artifact Graph | Schema resolution, dependency validation, instruction loading | 6 |
| Architecture | Layer separation, adapter pattern, design decisions | 5 |

## Key Patterns Documented

1. **Zod Schema-First Design** - All data structures defined as Zod schemas
2. **Multi-Location Resolution** - Project > User > Package precedence
3. **Adapter Pattern** - Support for multiple AI tools
4. **Layered Architecture** - CLI → Commands → Core → Utils

## Verification

These specs were generated following OpenSpec conventions:

- ✅ Requirements use RFC 2119 keywords (SHALL, MUST, SHOULD, MAY)
- ✅ Scenarios use `####` heading level
- ✅ Scenarios follow Given/When/Then format
- ✅ Technical notes link to source files
- ✅ config.yaml includes detected context

## Usage

To validate these specs (requires OpenSpec CLI):

```bash
cd openspec-cli
openspec validate --all
```

To view a specific spec:

```bash
openspec show specs/validation
```
