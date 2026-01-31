/**
 * Dependency Graph Service
 *
 * Builds a complete graph of how files relate to each other through imports.
 * Provides metrics like in-degree, out-degree, betweenness centrality, and PageRank.
 * Detects clusters, cycles, and special nodes (centers, leaves, bridges, orphans).
 */

import { ImportExportParser, resolveImport, type ExportInfo, type FileAnalysis } from './import-parser.js';
import type { ScoredFile } from '../../types/index.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Node in the dependency graph
 */
export interface DependencyNode {
  id: string;
  file: ScoredFile;
  exports: ExportInfo[];
  metrics: {
    inDegree: number;
    outDegree: number;
    betweenness: number;
    pageRank: number;
  };
}

/**
 * Edge in the dependency graph
 */
export interface DependencyEdge {
  source: string;
  target: string;
  importedNames: string[];
  isTypeOnly: boolean;
  weight: number;
}

/**
 * Cluster of related files
 */
export interface FileCluster {
  id: string;
  name: string;
  files: string[];
  internalEdges: number;
  externalEdges: number;
  cohesion: number;
  coupling: number;
  suggestedDomain: string;
}

/**
 * Complete dependency graph result
 */
export interface DependencyGraphResult {
  nodes: DependencyNode[];
  edges: DependencyEdge[];
  clusters: FileCluster[];
  rankings: {
    byImportance: string[];
    byConnectivity: string[];
    clusterCenters: string[];
    leafNodes: string[];
    bridgeNodes: string[];
    orphanNodes: string[];
  };
  cycles: string[][];
  statistics: {
    nodeCount: number;
    edgeCount: number;
    avgDegree: number;
    density: number;
    clusterCount: number;
    cycleCount: number;
  };
}

/**
 * Options for building the dependency graph
 */
export interface DependencyGraphOptions {
  /** Root directory of the project */
  rootDir: string;
  /** File extensions to consider for import resolution */
  extensions?: string[];
  /** Minimum cluster size to report */
  minClusterSize?: number;
  /** PageRank damping factor */
  dampingFactor?: number;
  /** Maximum PageRank iterations */
  maxIterations?: number;
}

// ============================================================================
// DEPENDENCY GRAPH BUILDER
// ============================================================================

/**
 * Builds and analyzes a dependency graph from scored files
 */
export class DependencyGraphBuilder {
  private nodes: Map<string, DependencyNode> = new Map();
  private edges: DependencyEdge[] = [];
  private adjacencyList: Map<string, Set<string>> = new Map();
  private reverseAdjacencyList: Map<string, Set<string>> = new Map();
  private parser: ImportExportParser;
  private options: Required<DependencyGraphOptions>;

  constructor(options: DependencyGraphOptions) {
    this.parser = new ImportExportParser();
    this.options = {
      rootDir: options.rootDir,
      extensions: options.extensions ?? ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
      minClusterSize: options.minClusterSize ?? 2,
      dampingFactor: options.dampingFactor ?? 0.85,
      maxIterations: options.maxIterations ?? 100,
    };
  }

  /**
   * Build the dependency graph from scored files
   */
  async build(files: ScoredFile[]): Promise<DependencyGraphResult> {
    // Clear any previous state
    this.nodes.clear();
    this.edges = [];
    this.adjacencyList.clear();
    this.reverseAdjacencyList.clear();

    // Parse all files and create nodes
    const analyses = await this.parseFiles(files);

    // Create nodes for each file
    for (const file of files) {
      const analysis = analyses.get(file.absolutePath);
      this.nodes.set(file.absolutePath, {
        id: file.absolutePath,
        file,
        exports: analysis?.exports ?? [],
        metrics: {
          inDegree: 0,
          outDegree: 0,
          betweenness: 0,
          pageRank: 1 / files.length,
        },
      });
      this.adjacencyList.set(file.absolutePath, new Set());
      this.reverseAdjacencyList.set(file.absolutePath, new Set());
    }

    // Create edges from imports
    await this.buildEdges(files, analyses);

    // Calculate metrics
    this.calculateDegrees();
    this.calculateBetweenness();
    this.calculatePageRank();

    // Detect clusters
    const clusters = this.detectClusters();

    // Detect cycles
    const cycles = this.detectCycles();

    // Generate rankings
    const rankings = this.generateRankings(clusters);

    // Calculate statistics
    const statistics = this.calculateStatistics(clusters, cycles);

    return {
      nodes: Array.from(this.nodes.values()),
      edges: this.edges,
      clusters,
      rankings,
      cycles,
      statistics,
    };
  }

  /**
   * Parse all files to extract imports/exports
   */
  private async parseFiles(files: ScoredFile[]): Promise<Map<string, FileAnalysis>> {
    const analyses = new Map<string, FileAnalysis>();

    for (const file of files) {
      try {
        const analysis = await this.parser.parseFile(file.absolutePath);
        analyses.set(file.absolutePath, analysis);
      } catch {
        // File couldn't be parsed, skip it
      }
    }

    return analyses;
  }

  /**
   * Build edges from import relationships
   */
  private async buildEdges(
    files: ScoredFile[],
    analyses: Map<string, FileAnalysis>
  ): Promise<void> {
    const fileSet = new Set(files.map(f => f.absolutePath));

    for (const file of files) {
      const analysis = analyses.get(file.absolutePath);
      if (!analysis) continue;

      for (const imp of analysis.imports) {
        // Skip non-relative imports (packages, builtins)
        if (!imp.isRelative) continue;

        // Resolve the import to an absolute path
        const resolvedPath = await resolveImport(imp.source, file.absolutePath, {
          baseDir: this.options.rootDir,
          extensions: this.options.extensions,
        });

        // Skip if not resolved or not in our file set
        if (!resolvedPath || !fileSet.has(resolvedPath)) continue;

        // Create edge
        const edge: DependencyEdge = {
          source: file.absolutePath,
          target: resolvedPath,
          importedNames: imp.importedNames,
          isTypeOnly: imp.isTypeOnly,
          weight: imp.isTypeOnly ? 0.5 : 1,
        };

        this.edges.push(edge);

        // Update adjacency lists
        this.adjacencyList.get(file.absolutePath)?.add(resolvedPath);
        this.reverseAdjacencyList.get(resolvedPath)?.add(file.absolutePath);
      }
    }
  }

  /**
   * Calculate in-degree and out-degree for each node
   */
  private calculateDegrees(): void {
    for (const [nodeId, node] of this.nodes) {
      node.metrics.outDegree = this.adjacencyList.get(nodeId)?.size ?? 0;
      node.metrics.inDegree = this.reverseAdjacencyList.get(nodeId)?.size ?? 0;
    }
  }

  /**
   * Calculate betweenness centrality using Brandes' algorithm
   */
  private calculateBetweenness(): void {
    const nodeIds = Array.from(this.nodes.keys());
    const betweenness = new Map<string, number>();

    // Initialize betweenness to 0
    for (const id of nodeIds) {
      betweenness.set(id, 0);
    }

    // Brandes' algorithm
    for (const source of nodeIds) {
      const stack: string[] = [];
      const predecessors = new Map<string, string[]>();
      const sigma = new Map<string, number>();
      const distance = new Map<string, number>();
      const delta = new Map<string, number>();

      // Initialize
      for (const v of nodeIds) {
        predecessors.set(v, []);
        sigma.set(v, 0);
        distance.set(v, -1);
        delta.set(v, 0);
      }

      sigma.set(source, 1);
      distance.set(source, 0);

      // BFS
      const queue: string[] = [source];
      while (queue.length > 0) {
        const v = queue.shift()!;
        stack.push(v);

        const neighbors = this.adjacencyList.get(v) ?? new Set();
        for (const w of neighbors) {
          // First visit?
          if (distance.get(w)! < 0) {
            queue.push(w);
            distance.set(w, distance.get(v)! + 1);
          }
          // Shortest path to w via v?
          if (distance.get(w) === distance.get(v)! + 1) {
            sigma.set(w, sigma.get(w)! + sigma.get(v)!);
            predecessors.get(w)!.push(v);
          }
        }
      }

      // Back-propagation
      while (stack.length > 0) {
        const w = stack.pop()!;
        for (const v of predecessors.get(w)!) {
          delta.set(
            v,
            delta.get(v)! + (sigma.get(v)! / sigma.get(w)!) * (1 + delta.get(w)!)
          );
        }
        if (w !== source) {
          betweenness.set(w, betweenness.get(w)! + delta.get(w)!);
        }
      }
    }

    // Normalize and update nodes
    const maxBetweenness = Math.max(...Array.from(betweenness.values()), 1);
    for (const [nodeId, node] of this.nodes) {
      node.metrics.betweenness = betweenness.get(nodeId)! / maxBetweenness;
    }
  }

  /**
   * Calculate PageRank-style importance scores
   */
  private calculatePageRank(): void {
    const nodeIds = Array.from(this.nodes.keys());
    const n = nodeIds.length;
    if (n === 0) return;

    const d = this.options.dampingFactor;
    let pageRank = new Map<string, number>();
    let newPageRank = new Map<string, number>();

    // Initialize
    for (const id of nodeIds) {
      pageRank.set(id, 1 / n);
    }

    // Iterate until convergence
    for (let iter = 0; iter < this.options.maxIterations; iter++) {
      let maxDiff = 0;

      for (const id of nodeIds) {
        // Sum contributions from nodes that link to this one
        let sum = 0;
        const incomingNodes = this.reverseAdjacencyList.get(id) ?? new Set();
        for (const source of incomingNodes) {
          const outDegree = this.adjacencyList.get(source)?.size ?? 1;
          sum += pageRank.get(source)! / outDegree;
        }

        const newRank = (1 - d) / n + d * sum;
        newPageRank.set(id, newRank);
        maxDiff = Math.max(maxDiff, Math.abs(newRank - pageRank.get(id)!));
      }

      // Swap
      [pageRank, newPageRank] = [newPageRank, pageRank];

      // Check convergence
      if (maxDiff < 1e-6) break;
    }

    // Normalize and update nodes
    const maxPageRank = Math.max(...Array.from(pageRank.values()), 0.001);
    for (const [nodeId, node] of this.nodes) {
      node.metrics.pageRank = pageRank.get(nodeId)! / maxPageRank;
    }
  }

  /**
   * Detect clusters using a simple community detection approach
   * Groups files by their common directory prefix and connectivity
   */
  private detectClusters(): FileCluster[] {
    const clusters: FileCluster[] = [];
    const nodeIds = Array.from(this.nodes.keys());

    // Group by directory
    const dirGroups = new Map<string, string[]>();
    for (const nodeId of nodeIds) {
      const node = this.nodes.get(nodeId)!;
      const dir = node.file.directory || '(root)';

      if (!dirGroups.has(dir)) {
        dirGroups.set(dir, []);
      }
      dirGroups.get(dir)!.push(nodeId);
    }

    // Create clusters from directory groups
    let clusterId = 0;
    for (const [dir, files] of dirGroups) {
      if (files.length < this.options.minClusterSize) continue;

      // Calculate internal and external edges
      let internalEdges = 0;
      let externalEdges = 0;
      const fileSet = new Set(files);

      for (const edge of this.edges) {
        const sourceInCluster = fileSet.has(edge.source);
        const targetInCluster = fileSet.has(edge.target);

        if (sourceInCluster && targetInCluster) {
          internalEdges++;
        } else if (sourceInCluster || targetInCluster) {
          externalEdges++;
        }
      }

      // Calculate cohesion (internal density)
      const possibleInternalEdges = files.length * (files.length - 1);
      const cohesion = possibleInternalEdges > 0 ? internalEdges / possibleInternalEdges : 0;

      // Calculate coupling (external connections)
      const totalEdges = internalEdges + externalEdges;
      const coupling = totalEdges > 0 ? externalEdges / totalEdges : 0;

      // Generate suggested domain name
      const suggestedDomain = this.suggestDomainName(dir, files);

      clusters.push({
        id: `cluster-${clusterId++}`,
        name: dir,
        files,
        internalEdges,
        externalEdges,
        cohesion,
        coupling,
        suggestedDomain,
      });
    }

    return clusters;
  }

  /**
   * Suggest a domain name based on directory and file contents
   */
  private suggestDomainName(dir: string, files: string[]): string {
    // Extract meaningful name from directory
    const parts = dir.split('/').filter(p => p && p !== '(root)');

    // Common patterns to convert
    const patterns: [RegExp, string][] = [
      [/^src$/i, ''],
      [/^lib$/i, ''],
      [/^app$/i, ''],
      [/^(api|routes|endpoints?)$/i, 'api'],
      [/^(models?|entities|schemas?)$/i, 'domain'],
      [/^(services?)$/i, 'services'],
      [/^(controllers?)$/i, 'controllers'],
      [/^(utils?|helpers?|common)$/i, 'utilities'],
      [/^(components?)$/i, 'components'],
      [/^(hooks?)$/i, 'hooks'],
      [/^(auth|authentication)$/i, 'authentication'],
      [/^(users?)$/i, 'users'],
      [/^(products?)$/i, 'products'],
      [/^(orders?)$/i, 'orders'],
      [/^(payments?)$/i, 'payments'],
      [/^(core)$/i, 'core'],
    ];

    // Try to find a meaningful name
    for (const part of parts.reverse()) {
      for (const [pattern, replacement] of patterns) {
        if (pattern.test(part)) {
          return replacement || part.toLowerCase();
        }
      }
      // If no pattern matches, use the part as-is
      if (!/^(src|lib|app)$/i.test(part)) {
        return part.toLowerCase().replace(/[^a-z0-9]/g, '-');
      }
    }

    // Fallback: use first file's name pattern
    if (files.length > 0) {
      const firstFile = this.nodes.get(files[0])?.file.name ?? 'unknown';
      return firstFile.replace(/\.(ts|js|tsx|jsx|py)x?$/, '').toLowerCase();
    }

    return 'misc';
  }

  /**
   * Detect cycles in the dependency graph using DFS
   */
  private detectCycles(): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const path: string[] = [];

    const dfs = (node: string): void => {
      visited.add(node);
      recursionStack.add(node);
      path.push(node);

      const neighbors = this.adjacencyList.get(node) ?? new Set();
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          dfs(neighbor);
        } else if (recursionStack.has(neighbor)) {
          // Found a cycle
          const cycleStart = path.indexOf(neighbor);
          const cycle = path.slice(cycleStart);
          cycle.push(neighbor); // Complete the cycle

          // Check if this cycle is not a duplicate (or rotation of existing)
          if (!this.isDuplicateCycle(cycles, cycle)) {
            cycles.push(cycle);
          }
        }
      }

      path.pop();
      recursionStack.delete(node);
    };

    for (const nodeId of this.nodes.keys()) {
      if (!visited.has(nodeId)) {
        dfs(nodeId);
      }
    }

    return cycles;
  }

  /**
   * Check if a cycle is a duplicate or rotation of an existing cycle
   */
  private isDuplicateCycle(existingCycles: string[][], newCycle: string[]): boolean {
    const normalizedNew = this.normalizeCycle(newCycle);

    for (const existing of existingCycles) {
      const normalizedExisting = this.normalizeCycle(existing);
      if (normalizedNew === normalizedExisting) {
        return true;
      }
    }

    return false;
  }

  /**
   * Normalize a cycle for comparison (smallest element first, then compare)
   */
  private normalizeCycle(cycle: string[]): string {
    // Remove the duplicate closing element
    const clean = cycle.slice(0, -1);
    if (clean.length === 0) return '';

    // Find the smallest element
    const minIdx = clean.indexOf(
      clean.reduce((min, curr) => (curr < min ? curr : min))
    );

    // Rotate so smallest is first
    const rotated = [...clean.slice(minIdx), ...clean.slice(0, minIdx)];
    return rotated.join('|');
  }

  /**
   * Generate various rankings of nodes
   */
  private generateRankings(clusters: FileCluster[]): DependencyGraphResult['rankings'] {
    const nodes = Array.from(this.nodes.values());

    // By PageRank importance
    const byImportance = nodes
      .sort((a, b) => b.metrics.pageRank - a.metrics.pageRank)
      .map(n => n.id);

    // By total connectivity (in + out degree)
    const byConnectivity = nodes
      .sort((a, b) =>
        (b.metrics.inDegree + b.metrics.outDegree) -
        (a.metrics.inDegree + a.metrics.outDegree)
      )
      .map(n => n.id);

    // Cluster centers (highest in-degree within each cluster)
    const clusterCenters: string[] = [];
    for (const cluster of clusters) {
      const clusterNodes = cluster.files
        .map(f => this.nodes.get(f))
        .filter((n): n is DependencyNode => n !== undefined);

      if (clusterNodes.length > 0) {
        const center = clusterNodes.reduce((max, n) =>
          n.metrics.inDegree > max.metrics.inDegree ? n : max
        );
        clusterCenters.push(center.id);
      }
    }

    // Leaf nodes (high out-degree, low in-degree)
    const leafNodes = nodes
      .filter(n => n.metrics.outDegree > 0 && n.metrics.inDegree === 0)
      .sort((a, b) => b.metrics.outDegree - a.metrics.outDegree)
      .map(n => n.id);

    // Bridge nodes (high betweenness)
    const bridgeNodes = nodes
      .filter(n => n.metrics.betweenness > 0.1)
      .sort((a, b) => b.metrics.betweenness - a.metrics.betweenness)
      .map(n => n.id);

    // Orphan nodes (no connections)
    const orphanNodes = nodes
      .filter(n => n.metrics.inDegree === 0 && n.metrics.outDegree === 0)
      .map(n => n.id);

    return {
      byImportance,
      byConnectivity,
      clusterCenters,
      leafNodes,
      bridgeNodes,
      orphanNodes,
    };
  }

  /**
   * Calculate overall statistics
   */
  private calculateStatistics(
    clusters: FileCluster[],
    cycles: string[][]
  ): DependencyGraphResult['statistics'] {
    const nodeCount = this.nodes.size;
    const edgeCount = this.edges.length;

    // Average degree
    let totalDegree = 0;
    for (const node of this.nodes.values()) {
      totalDegree += node.metrics.inDegree + node.metrics.outDegree;
    }
    const avgDegree = nodeCount > 0 ? totalDegree / nodeCount : 0;

    // Density: actual edges / possible edges
    const possibleEdges = nodeCount * (nodeCount - 1);
    const density = possibleEdges > 0 ? edgeCount / possibleEdges : 0;

    return {
      nodeCount,
      edgeCount,
      avgDegree,
      density,
      clusterCount: clusters.length,
      cycleCount: cycles.length,
    };
  }
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Build a dependency graph from scored files
 */
export async function buildDependencyGraph(
  files: ScoredFile[],
  options: DependencyGraphOptions
): Promise<DependencyGraphResult> {
  const builder = new DependencyGraphBuilder(options);
  return builder.build(files);
}

// ============================================================================
// EXPORT FORMATS
// ============================================================================

/**
 * Convert graph to D3.js force graph format
 */
export function toD3Format(result: DependencyGraphResult): {
  nodes: Array<{ id: string; group: number; score: number }>;
  links: Array<{ source: string; target: string; value: number }>;
} {
  // Create cluster index map
  const clusterIndex = new Map<string, number>();
  result.clusters.forEach((cluster, idx) => {
    for (const file of cluster.files) {
      clusterIndex.set(file, idx);
    }
  });

  return {
    nodes: result.nodes.map(n => ({
      id: n.file.path,
      group: clusterIndex.get(n.id) ?? -1,
      score: n.metrics.pageRank,
    })),
    links: result.edges.map(e => ({
      source: result.nodes.find(n => n.id === e.source)?.file.path ?? e.source,
      target: result.nodes.find(n => n.id === e.target)?.file.path ?? e.target,
      value: e.weight,
    })),
  };
}

/**
 * Convert graph to Mermaid diagram syntax
 */
export function toMermaidFormat(result: DependencyGraphResult, maxNodes = 50): string {
  const lines: string[] = ['graph TD'];

  // Take top nodes by importance
  const topNodes = result.rankings.byImportance.slice(0, maxNodes);
  const nodeSet = new Set(topNodes);

  // Create node labels
  const nodeLabels = new Map<string, string>();
  result.nodes
    .filter(n => nodeSet.has(n.id))
    .forEach((n, idx) => {
      const label = `N${idx}`;
      nodeLabels.set(n.id, label);
      const name = n.file.name.replace(/["\[\]]/g, '');
      lines.push(`    ${label}["${name}"]`);
    });

  // Create edges
  for (const edge of result.edges) {
    const sourceLabel = nodeLabels.get(edge.source);
    const targetLabel = nodeLabels.get(edge.target);
    if (sourceLabel && targetLabel) {
      const style = edge.isTypeOnly ? '-.->' : '-->';
      lines.push(`    ${sourceLabel} ${style} ${targetLabel}`);
    }
  }

  return lines.join('\n');
}

/**
 * Convert graph to DOT format (Graphviz)
 */
export function toDotFormat(result: DependencyGraphResult): string {
  const lines: string[] = ['digraph Dependencies {'];
  lines.push('    rankdir=LR;');
  lines.push('    node [shape=box];');

  // Create node definitions with labels
  for (const node of result.nodes) {
    const name = node.file.name.replace(/"/g, '\\"');
    const color = node.metrics.pageRank > 0.5 ? 'lightblue' : 'white';
    lines.push(`    "${node.id}" [label="${name}" fillcolor="${color}" style="filled"];`);
  }

  // Create edges
  for (const edge of result.edges) {
    const style = edge.isTypeOnly ? 'dashed' : 'solid';
    lines.push(`    "${edge.source}" -> "${edge.target}" [style="${style}"];`);
  }

  lines.push('}');
  return lines.join('\n');
}
