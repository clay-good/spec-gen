# spec-gen Algorithms

This document describes the key algorithms used in spec-gen for code analysis and specification generation.

## 1. File Significance Scoring

Files are scored to prioritize high-value code for LLM context. The algorithm considers multiple factors:

### Scoring Formula

```
TotalScore = NameScore + PathScore + StructureScore + ConnectivityScore
```

Where:
- **NameScore** (0-30): Based on file name patterns
- **PathScore** (0-25): Based on directory location
- **StructureScore** (0-25): Based on code content
- **ConnectivityScore** (0-20): Based on import/export relationships

### Name Scoring Rules

| Pattern | Score |
|---------|-------|
| `schema`, `model`, `entity` | 30 |
| `service`, `controller`, `handler` | 28 |
| `api`, `route`, `endpoint` | 25 |
| `store`, `reducer`, `action` | 22 |
| `util`, `helper`, `constant` | 10 |
| `test`, `spec`, `mock` | 5 |
| `index` | 15 |

### Path Scoring Rules

| Directory Pattern | Score |
|-------------------|-------|
| `src/models`, `src/entities` | 25 |
| `src/services`, `src/core` | 23 |
| `src/api`, `src/routes` | 20 |
| `src/components` | 18 |
| `lib/`, `packages/` | 15 |
| `test/`, `__tests__/` | 5 |

### Structure Scoring

Analyzes code content for:
- Class definitions (+5 each, max 15)
- Interface/type exports (+3 each, max 12)
- Function exports (+2 each, max 10)
- Import count (high import count indicates core module)

## 2. Dependency Graph Analysis

### Graph Construction

1. Parse all source files for imports/exports
2. Resolve import paths to actual files
3. Create directed edges from importer → imported
4. Handle various module systems (ESM, CommonJS, TypeScript)

### Metrics Calculated

#### In-Degree / Out-Degree
- **In-degree**: Number of files that import this file
- **Out-degree**: Number of files this file imports
- High in-degree = widely used module
- High out-degree = integration/orchestration module

#### PageRank-Style Importance

Iterative algorithm:
```
PR(A) = (1-d) + d × Σ(PR(T) / OutDegree(T))
```

Where:
- `d` = damping factor (0.85)
- `T` = files that link to A
- Converges after ~20 iterations

#### Betweenness Centrality

Measures how often a node appears on shortest paths between other nodes:
- High betweenness = bridge between modules
- Indicates architectural importance

## 3. Domain Clustering

### Louvain-Style Community Detection

Modified for code structure:

1. **Initialize**: Each file in its own community
2. **Optimize**: Move files between communities to maximize modularity
3. **Aggregate**: Merge communities and repeat

### Modularity Function

```
Q = (1/2m) × Σ[(Aij - kikj/2m) × δ(ci, cj)]
```

Where:
- `Aij` = edge weight between i and j
- `ki`, `kj` = degree of nodes
- `m` = total edges
- `δ` = 1 if same community, 0 otherwise

### Heuristics for Code

- Files in same directory get affinity bonus
- Shared naming patterns increase affinity
- Bidirectional imports strongly indicate same domain

## 4. LLM Context Prioritization

### Context Window Management

Given token limit `L` and files sorted by significance:

```python
def select_files(files, limit):
    selected = []
    tokens = 0
    for file in sorted(files, key=lambda f: -f.score):
        file_tokens = count_tokens(file.content)
        if tokens + file_tokens <= limit:
            selected.append(file)
            tokens += file_tokens
    return selected
```

### Truncation Strategy

For files that don't fit entirely:
1. Keep imports/exports (essential for understanding)
2. Keep class/function signatures
3. Truncate implementation bodies
4. Add `// ... implementation ...` markers

## 5. Specification Generation Pipeline

### Stage 1: Project Survey (~200 tokens)

Quick categorization prompt:
- Project type (web app, API, library, CLI)
- Primary language/framework
- Architecture style (monolith, microservices, serverless)

### Stage 2: Entity Extraction (~1000 tokens)

Extract core data models:
- Input: High-significance model/schema files
- Output: Entity names, fields, relationships

### Stage 3: Service Analysis (~800 tokens)

Map business logic:
- Input: Service files + extracted entities
- Output: Operations, business rules, dependencies

### Stage 4: API Extraction (~800 tokens)

Document external interfaces:
- Input: Route/controller files
- Output: Endpoints, methods, request/response schemas

### Stage 5: Architecture Synthesis (~1200 tokens)

Create system overview:
- Input: All previous stage outputs
- Output: Component diagram, data flow, key decisions

## 6. Verification Scoring

### Prediction-Based Verification

1. Select N files NOT used in generation
2. For each file:
   - LLM predicts content from specs only
   - Compare prediction to actual code
   - Score similarity

### Similarity Metrics

#### Structural Similarity
- Same imports predicted: +20%
- Same exports predicted: +20%
- Same function names: +15%
- Same class names: +15%

#### Semantic Similarity
- Business logic correctly described: +15%
- Data transformations accurate: +15%

#### Final Score
```
Score = (StructuralMatch × 0.5) + (SemanticMatch × 0.5)
```

### Thresholds

| Score | Interpretation |
|-------|----------------|
| ≥ 0.8 | Excellent - specs capture system well |
| 0.6-0.8 | Good - minor gaps in coverage |
| 0.4-0.6 | Fair - significant gaps |
| < 0.4 | Poor - specs need revision |

## 7. Cycle Detection

### Tarjan's Algorithm

Used to detect circular dependencies:

```python
def tarjan_scc(graph):
    index = 0
    stack = []
    lowlinks = {}
    indices = {}
    on_stack = set()
    sccs = []

    def strongconnect(v):
        nonlocal index
        indices[v] = index
        lowlinks[v] = index
        index += 1
        stack.append(v)
        on_stack.add(v)

        for w in graph[v]:
            if w not in indices:
                strongconnect(w)
                lowlinks[v] = min(lowlinks[v], lowlinks[w])
            elif w in on_stack:
                lowlinks[v] = min(lowlinks[v], indices[w])

        if lowlinks[v] == indices[v]:
            scc = []
            while True:
                w = stack.pop()
                on_stack.remove(w)
                scc.append(w)
                if w == v:
                    break
            sccs.append(scc)

    for v in graph:
        if v not in indices:
            strongconnect(v)

    return sccs
```

### Cycle Reporting

Cycles with > 1 node indicate circular dependencies:
- Report in analysis artifacts
- Flag as potential architectural issue
- Include in LLM context for spec generation

## Performance Considerations

### Time Complexity

| Operation | Complexity |
|-----------|------------|
| File walking | O(n) where n = files |
| Import parsing | O(n × m) where m = avg file size |
| Graph building | O(e) where e = edges |
| PageRank | O(k × (n + e)) where k = iterations |
| Clustering | O(n × log n) average case |

### Space Complexity

| Data Structure | Size |
|----------------|------|
| File metadata | O(n) |
| Dependency graph | O(n + e) |
| Parsed ASTs | O(n × m) - transient |
| LLM context | Bounded by token limit |

### Optimization Strategies

1. **Lazy AST parsing**: Only parse files when needed
2. **Parallel file reading**: Use async I/O with concurrency limit
3. **Early filtering**: Skip excluded patterns before reading
4. **Incremental updates**: Cache analysis, only re-analyze changed files
