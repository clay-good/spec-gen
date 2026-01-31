/**
 * Import/Export Parser
 *
 * Parses source files to extract imports and exports.
 * Uses regex-based parsing for speed and simplicity.
 * Supports JavaScript/TypeScript and Python.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join, resolve, extname, basename } from 'node:path';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Information about an import statement
 */
export interface ImportInfo {
  source: string;
  isRelative: boolean;
  isPackage: boolean;
  isBuiltin: boolean;
  importedNames: string[];
  hasDefault: boolean;
  hasNamespace: boolean;
  isTypeOnly: boolean;
  isDynamic: boolean;
  line: number;
}

/**
 * Information about an export statement
 */
export interface ExportInfo {
  name: string;
  isDefault: boolean;
  isType: boolean;
  isReExport: boolean;
  reExportSource?: string;
  kind: 'function' | 'class' | 'variable' | 'type' | 'interface' | 'enum' | 'unknown';
  line: number;
}

/**
 * Complete analysis of a file's imports and exports
 */
export interface FileAnalysis {
  filePath: string;
  imports: ImportInfo[];
  exports: ExportInfo[];
  localImports: string[];
  externalImports: string[];
  parseErrors: string[];
}

/**
 * Options for import resolution
 */
export interface ResolveOptions {
  /** Base directory for resolving relative imports */
  baseDir: string;
  /** TypeScript paths aliases (from tsconfig) */
  pathAliases?: Record<string, string[]>;
  /** File extensions to try when resolving */
  extensions?: string[];
}

// ============================================================================
// NODE.JS BUILTINS
// ============================================================================

const NODE_BUILTINS = new Set([
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console',
  'constants', 'crypto', 'dgram', 'diagnostics_channel', 'dns', 'domain',
  'events', 'fs', 'http', 'http2', 'https', 'inspector', 'module', 'net',
  'os', 'path', 'perf_hooks', 'process', 'punycode', 'querystring', 'readline',
  'repl', 'stream', 'string_decoder', 'timers', 'tls', 'trace_events', 'tty',
  'url', 'util', 'v8', 'vm', 'wasi', 'worker_threads', 'zlib',
  // Node.js prefixed versions
  'node:assert', 'node:async_hooks', 'node:buffer', 'node:child_process',
  'node:cluster', 'node:console', 'node:constants', 'node:crypto', 'node:dgram',
  'node:diagnostics_channel', 'node:dns', 'node:domain', 'node:events',
  'node:fs', 'node:http', 'node:http2', 'node:https', 'node:inspector',
  'node:module', 'node:net', 'node:os', 'node:path', 'node:perf_hooks',
  'node:process', 'node:punycode', 'node:querystring', 'node:readline',
  'node:repl', 'node:stream', 'node:string_decoder', 'node:timers', 'node:tls',
  'node:trace_events', 'node:tty', 'node:url', 'node:util', 'node:v8',
  'node:vm', 'node:wasi', 'node:worker_threads', 'node:zlib',
  // fs/promises and other submodules
  'fs/promises', 'node:fs/promises', 'stream/promises', 'node:stream/promises',
  'timers/promises', 'node:timers/promises', 'util/types', 'node:util/types',
]);

// ============================================================================
// JAVASCRIPT/TYPESCRIPT IMPORT PATTERNS
// ============================================================================

// ES Module imports
const ES_IMPORT_PATTERNS = [
  // import X from 'module'
  /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g,
  // import { X, Y } from 'module' or import { X as Z } from 'module'
  /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g,
  // import * as X from 'module'
  /import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g,
  // import 'module' (side effect)
  /import\s+['"]([^'"]+)['"]/g,
  // import type { X } from 'module'
  /import\s+type\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g,
  // import type X from 'module'
  /import\s+type\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g,
];

// CommonJS require
const REQUIRE_PATTERN = /(?:const|let|var)\s+(?:(\w+)|(\{[^}]+\}))\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

// Dynamic import
const DYNAMIC_IMPORT_PATTERN = /(?:await\s+)?import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

// ============================================================================
// JAVASCRIPT/TYPESCRIPT EXPORT PATTERNS
// ============================================================================

// export default X
const EXPORT_DEFAULT_PATTERN = /export\s+default\s+(?:(class|function)\s+(\w+)|(\w+))/g;

// export { X, Y } or export { X as Y }
const EXPORT_NAMED_PATTERN = /export\s+\{([^}]+)\}(?:\s+from\s+['"]([^'"]+)['"])?/g;

// export const/let/var X
const EXPORT_VARIABLE_PATTERN = /export\s+(?:const|let|var)\s+(\w+)/g;

// export function X
const EXPORT_FUNCTION_PATTERN = /export\s+function\s+(\w+)/g;

// export class X
const EXPORT_CLASS_PATTERN = /export\s+class\s+(\w+)/g;

// export type X
const EXPORT_TYPE_PATTERN = /export\s+type\s+(\w+)/g;

// export interface X
const EXPORT_INTERFACE_PATTERN = /export\s+interface\s+(\w+)/g;

// export enum X
const EXPORT_ENUM_PATTERN = /export\s+enum\s+(\w+)/g;

// export * from 'module'
const EXPORT_ALL_PATTERN = /export\s+\*\s+(?:as\s+\w+\s+)?from\s+['"]([^'"]+)['"]/g;

// module.exports = X
const CJS_MODULE_EXPORTS_PATTERN = /module\.exports\s*=\s*(\w+|{[^}]+})/g;

// exports.X = Y
const CJS_EXPORTS_PATTERN = /exports\.(\w+)\s*=/g;

// ============================================================================
// PYTHON IMPORT PATTERNS
// ============================================================================

// import X or import X, Y
const PY_IMPORT_PATTERN = /^import\s+([\w,\s.]+)$/gm;

// from X import Y or from X import Y, Z
const PY_FROM_IMPORT_PATTERN = /^from\s+([\w.]+)\s+import\s+(.+)$/gm;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Check if a module path is a relative import
 */
function isRelativeImport(source: string): boolean {
  return source.startsWith('.') || source.startsWith('/');
}

/**
 * Check if a module is a Node.js builtin
 */
function isBuiltinModule(source: string): boolean {
  return NODE_BUILTINS.has(source) || NODE_BUILTINS.has(source.split('/')[0]);
}

/**
 * Get line number for a match position in content
 */
function getLineNumber(content: string, position: number): number {
  return content.substring(0, position).split('\n').length;
}

/**
 * Parse named imports from a string like "X, Y as Z, W"
 */
function parseNamedImports(namesStr: string): string[] {
  return namesStr
    .split(',')
    .map(name => {
      const trimmed = name.trim();
      // Handle "X as Y" - we want the local name Y
      const asMatch = trimmed.match(/(\w+)\s+as\s+(\w+)/);
      if (asMatch) {
        return asMatch[2];
      }
      // Handle type imports like "type X"
      if (trimmed.startsWith('type ')) {
        return trimmed.slice(5).trim();
      }
      return trimmed;
    })
    .filter(name => name && !name.includes(' '));
}

// ============================================================================
// JAVASCRIPT/TYPESCRIPT PARSER
// ============================================================================

/**
 * Parse imports from JavaScript/TypeScript content
 */
function parseJSImports(content: string): ImportInfo[] {
  const imports: ImportInfo[] = [];

  // Remove comments to avoid false matches
  const cleanContent = content
    .replace(/\/\*[\s\S]*?\*\//g, '') // Block comments
    .replace(/\/\/.*$/gm, '');        // Line comments

  // ES Module: import X from 'module'
  let match: RegExpExecArray | null;
  const defaultImportRegex = /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g;
  while ((match = defaultImportRegex.exec(cleanContent)) !== null) {
    const source = match[2];
    imports.push({
      source,
      isRelative: isRelativeImport(source),
      isPackage: !isRelativeImport(source) && !isBuiltinModule(source),
      isBuiltin: isBuiltinModule(source),
      importedNames: [match[1]],
      hasDefault: true,
      hasNamespace: false,
      isTypeOnly: false,
      isDynamic: false,
      line: getLineNumber(content, match.index),
    });
  }

  // ES Module: import X, { Y, Z } from 'module' (mixed import - default + named)
  const mixedImportRegex = /import\s+(\w+)\s*,\s*\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;
  while ((match = mixedImportRegex.exec(cleanContent)) !== null) {
    const source = match[3];
    const names = [match[1], ...parseNamedImports(match[2])];
    imports.push({
      source,
      isRelative: isRelativeImport(source),
      isPackage: !isRelativeImport(source) && !isBuiltinModule(source),
      isBuiltin: isBuiltinModule(source),
      importedNames: names,
      hasDefault: true,
      hasNamespace: false,
      isTypeOnly: false,
      isDynamic: false,
      line: getLineNumber(content, match.index),
    });
  }

  // ES Module: import { X, Y } from 'module'
  const namedImportRegex = /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;
  while ((match = namedImportRegex.exec(cleanContent)) !== null) {
    const source = match[2];
    const names = parseNamedImports(match[1]);
    imports.push({
      source,
      isRelative: isRelativeImport(source),
      isPackage: !isRelativeImport(source) && !isBuiltinModule(source),
      isBuiltin: isBuiltinModule(source),
      importedNames: names,
      hasDefault: false,
      hasNamespace: false,
      isTypeOnly: false,
      isDynamic: false,
      line: getLineNumber(content, match.index),
    });
  }

  // ES Module: import * as X from 'module'
  const namespaceImportRegex = /import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g;
  while ((match = namespaceImportRegex.exec(cleanContent)) !== null) {
    const source = match[2];
    imports.push({
      source,
      isRelative: isRelativeImport(source),
      isPackage: !isRelativeImport(source) && !isBuiltinModule(source),
      isBuiltin: isBuiltinModule(source),
      importedNames: [match[1]],
      hasDefault: false,
      hasNamespace: true,
      isTypeOnly: false,
      isDynamic: false,
      line: getLineNumber(content, match.index),
    });
  }

  // ES Module: import 'module' (side effect)
  const sideEffectRegex = /import\s+['"]([^'"]+)['"](?!\s*from)/g;
  while ((match = sideEffectRegex.exec(cleanContent)) !== null) {
    const source = match[1];
    imports.push({
      source,
      isRelative: isRelativeImport(source),
      isPackage: !isRelativeImport(source) && !isBuiltinModule(source),
      isBuiltin: isBuiltinModule(source),
      importedNames: [],
      hasDefault: false,
      hasNamespace: false,
      isTypeOnly: false,
      isDynamic: false,
      line: getLineNumber(content, match.index),
    });
  }

  // Type-only imports: import type { X } from 'module'
  const typeImportRegex = /import\s+type\s+(?:\{([^}]+)\}|(\w+))\s+from\s+['"]([^'"]+)['"]/g;
  while ((match = typeImportRegex.exec(cleanContent)) !== null) {
    const source = match[3];
    const names = match[1] ? parseNamedImports(match[1]) : [match[2]];
    imports.push({
      source,
      isRelative: isRelativeImport(source),
      isPackage: !isRelativeImport(source) && !isBuiltinModule(source),
      isBuiltin: isBuiltinModule(source),
      importedNames: names,
      hasDefault: !!match[2],
      hasNamespace: false,
      isTypeOnly: true,
      isDynamic: false,
      line: getLineNumber(content, match.index),
    });
  }

  // CommonJS: require('module')
  const requireRegex = /(?:const|let|var)\s+(?:(\w+)|\{([^}]+)\})\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = requireRegex.exec(cleanContent)) !== null) {
    const source = match[3];
    const names = match[1] ? [match[1]] : parseNamedImports(match[2]);
    imports.push({
      source,
      isRelative: isRelativeImport(source),
      isPackage: !isRelativeImport(source) && !isBuiltinModule(source),
      isBuiltin: isBuiltinModule(source),
      importedNames: names,
      hasDefault: !!match[1],
      hasNamespace: false,
      isTypeOnly: false,
      isDynamic: false,
      line: getLineNumber(content, match.index),
    });
  }

  // Dynamic import: import('module')
  const dynamicImportRegex = /(?:await\s+)?import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = dynamicImportRegex.exec(cleanContent)) !== null) {
    const source = match[1];
    imports.push({
      source,
      isRelative: isRelativeImport(source),
      isPackage: !isRelativeImport(source) && !isBuiltinModule(source),
      isBuiltin: isBuiltinModule(source),
      importedNames: [],
      hasDefault: false,
      hasNamespace: false,
      isTypeOnly: false,
      isDynamic: true,
      line: getLineNumber(content, match.index),
    });
  }

  return imports;
}

/**
 * Parse exports from JavaScript/TypeScript content
 */
function parseJSExports(content: string): ExportInfo[] {
  const exports: ExportInfo[] = [];

  // Remove comments
  const cleanContent = content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  let match: RegExpExecArray | null;

  // export default
  const defaultExportRegex = /export\s+default\s+(?:(class|function)\s+(\w+)|(\w+))/g;
  while ((match = defaultExportRegex.exec(cleanContent)) !== null) {
    const kind = match[1] as 'class' | 'function' | undefined;
    const name = match[2] || match[3] || 'default';
    exports.push({
      name,
      isDefault: true,
      isType: false,
      isReExport: false,
      kind: kind || 'unknown',
      line: getLineNumber(content, match.index),
    });
  }

  // export { X, Y } or export { X } from 'module'
  const namedExportRegex = /export\s+\{([^}]+)\}(?:\s+from\s+['"]([^'"]+)['"])?/g;
  while ((match = namedExportRegex.exec(cleanContent)) !== null) {
    const names = parseNamedImports(match[1]);
    const reExportSource = match[2];
    for (const name of names) {
      exports.push({
        name,
        isDefault: false,
        isType: false,
        isReExport: !!reExportSource,
        reExportSource,
        kind: 'unknown',
        line: getLineNumber(content, match.index),
      });
    }
  }

  // export const/let/var
  const varExportRegex = /export\s+(?:const|let|var)\s+(\w+)/g;
  while ((match = varExportRegex.exec(cleanContent)) !== null) {
    exports.push({
      name: match[1],
      isDefault: false,
      isType: false,
      isReExport: false,
      kind: 'variable',
      line: getLineNumber(content, match.index),
    });
  }

  // export function
  const funcExportRegex = /export\s+function\s+(\w+)/g;
  while ((match = funcExportRegex.exec(cleanContent)) !== null) {
    exports.push({
      name: match[1],
      isDefault: false,
      isType: false,
      isReExport: false,
      kind: 'function',
      line: getLineNumber(content, match.index),
    });
  }

  // export class
  const classExportRegex = /export\s+class\s+(\w+)/g;
  while ((match = classExportRegex.exec(cleanContent)) !== null) {
    exports.push({
      name: match[1],
      isDefault: false,
      isType: false,
      isReExport: false,
      kind: 'class',
      line: getLineNumber(content, match.index),
    });
  }

  // export type
  const typeExportRegex = /export\s+type\s+(\w+)/g;
  while ((match = typeExportRegex.exec(cleanContent)) !== null) {
    exports.push({
      name: match[1],
      isDefault: false,
      isType: true,
      isReExport: false,
      kind: 'type',
      line: getLineNumber(content, match.index),
    });
  }

  // export interface
  const interfaceExportRegex = /export\s+interface\s+(\w+)/g;
  while ((match = interfaceExportRegex.exec(cleanContent)) !== null) {
    exports.push({
      name: match[1],
      isDefault: false,
      isType: true,
      isReExport: false,
      kind: 'interface',
      line: getLineNumber(content, match.index),
    });
  }

  // export enum
  const enumExportRegex = /export\s+enum\s+(\w+)/g;
  while ((match = enumExportRegex.exec(cleanContent)) !== null) {
    exports.push({
      name: match[1],
      isDefault: false,
      isType: false,
      isReExport: false,
      kind: 'enum',
      line: getLineNumber(content, match.index),
    });
  }

  // export * from 'module'
  const reExportAllRegex = /export\s+\*\s+(?:as\s+(\w+)\s+)?from\s+['"]([^'"]+)['"]/g;
  while ((match = reExportAllRegex.exec(cleanContent)) !== null) {
    exports.push({
      name: match[1] || '*',
      isDefault: false,
      isType: false,
      isReExport: true,
      reExportSource: match[2],
      kind: 'unknown',
      line: getLineNumber(content, match.index),
    });
  }

  // module.exports
  const moduleExportsRegex = /module\.exports\s*=\s*(\w+)/g;
  while ((match = moduleExportsRegex.exec(cleanContent)) !== null) {
    exports.push({
      name: match[1],
      isDefault: true,
      isType: false,
      isReExport: false,
      kind: 'unknown',
      line: getLineNumber(content, match.index),
    });
  }

  // exports.X
  const exportsRegex = /exports\.(\w+)\s*=/g;
  while ((match = exportsRegex.exec(cleanContent)) !== null) {
    exports.push({
      name: match[1],
      isDefault: false,
      isType: false,
      isReExport: false,
      kind: 'unknown',
      line: getLineNumber(content, match.index),
    });
  }

  return exports;
}

// ============================================================================
// PYTHON PARSER
// ============================================================================

/**
 * Parse imports from Python content
 */
function parsePythonImports(content: string): ImportInfo[] {
  const imports: ImportInfo[] = [];

  // Remove comments
  const cleanContent = content.replace(/#.*$/gm, '');

  let match: RegExpExecArray | null;

  // import X or import X, Y or import X.Y
  // Use [^\n\r]+ to match until end of line only
  const importRegex = /^import[ \t]+([^\n\r]+)$/gm;
  while ((match = importRegex.exec(cleanContent)) !== null) {
    const modules = match[1].split(',').map(m => m.trim()).filter(Boolean);
    for (const mod of modules) {
      const source = mod.split(' as ')[0].trim();
      imports.push({
        source,
        isRelative: source.startsWith('.'),
        isPackage: !source.startsWith('.'),
        isBuiltin: false, // Would need Python stdlib list
        importedNames: [mod.includes(' as ') ? mod.split(' as ')[1].trim() : source.split('.').pop()!],
        hasDefault: false,
        hasNamespace: true,
        isTypeOnly: false,
        isDynamic: false,
        line: getLineNumber(content, match.index),
      });
    }
  }

  // from X import Y or from X import Y, Z
  const fromImportRegex = /^from\s+([\w.]+)\s+import\s+(.+)$/gm;
  while ((match = fromImportRegex.exec(cleanContent)) !== null) {
    const source = match[1];
    const importsPart = match[2].trim();

    // Handle "import *"
    if (importsPart === '*') {
      imports.push({
        source,
        isRelative: source.startsWith('.'),
        isPackage: !source.startsWith('.'),
        isBuiltin: false,
        importedNames: ['*'],
        hasDefault: false,
        hasNamespace: true,
        isTypeOnly: false,
        isDynamic: false,
        line: getLineNumber(content, match.index),
      });
    } else {
      const names = importsPart.split(',').map(n => {
        const trimmed = n.trim();
        return trimmed.includes(' as ') ? trimmed.split(' as ')[1].trim() : trimmed;
      }).filter(Boolean);

      imports.push({
        source,
        isRelative: source.startsWith('.'),
        isPackage: !source.startsWith('.'),
        isBuiltin: false,
        importedNames: names,
        hasDefault: false,
        hasNamespace: false,
        isTypeOnly: false,
        isDynamic: false,
        line: getLineNumber(content, match.index),
      });
    }
  }

  return imports;
}

/**
 * Parse exports from Python content (module-level definitions)
 */
function parsePythonExports(content: string): ExportInfo[] {
  const exports: ExportInfo[] = [];

  // Remove comments
  const cleanContent = content.replace(/#.*$/gm, '');

  let match: RegExpExecArray | null;

  // Check for __all__ definition
  const allMatch = cleanContent.match(/__all__\s*=\s*\[([^\]]+)\]/);
  if (allMatch) {
    const names = allMatch[1].match(/['"](\w+)['"]/g);
    if (names) {
      for (const name of names) {
        const cleanName = name.replace(/['"]/g, '');
        exports.push({
          name: cleanName,
          isDefault: false,
          isType: false,
          isReExport: false,
          kind: 'unknown',
          line: getLineNumber(content, allMatch.index ?? 0),
        });
      }
    }
  }

  // Class definitions at module level (no indentation)
  const classRegex = /^class\s+(\w+)/gm;
  while ((match = classRegex.exec(cleanContent)) !== null) {
    exports.push({
      name: match[1],
      isDefault: false,
      isType: false,
      isReExport: false,
      kind: 'class',
      line: getLineNumber(content, match.index),
    });
  }

  // Function definitions at module level (no indentation)
  const funcRegex = /^def\s+(\w+)/gm;
  while ((match = funcRegex.exec(cleanContent)) !== null) {
    // Skip private functions
    if (!match[1].startsWith('_')) {
      exports.push({
        name: match[1],
        isDefault: false,
        isType: false,
        isReExport: false,
        kind: 'function',
        line: getLineNumber(content, match.index),
      });
    }
  }

  // Module-level variables (UPPER_CASE constants)
  const constRegex = /^([A-Z][A-Z0-9_]*)\s*=/gm;
  while ((match = constRegex.exec(cleanContent)) !== null) {
    exports.push({
      name: match[1],
      isDefault: false,
      isType: false,
      isReExport: false,
      kind: 'variable',
      line: getLineNumber(content, match.index),
    });
  }

  return exports;
}

// ============================================================================
// IMPORT RESOLUTION
// ============================================================================

/**
 * Resolve a relative import to an absolute file path
 */
export async function resolveImport(
  importSource: string,
  fromFile: string,
  options: ResolveOptions
): Promise<string | null> {
  // External package - return null
  if (!isRelativeImport(importSource)) {
    return null;
  }

  const fromDir = dirname(fromFile);
  const extensions = options.extensions ?? ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

  // Try resolving with different extensions
  const basePath = resolve(fromDir, importSource);

  // Try exact path first
  for (const ext of ['', ...extensions]) {
    const tryPath = basePath + ext;
    try {
      await readFile(tryPath);
      return tryPath;
    } catch {
      // File doesn't exist, try next
    }
  }

  // Try as directory with index file
  for (const ext of extensions) {
    const indexPath = join(basePath, `index${ext}`);
    try {
      await readFile(indexPath);
      return indexPath;
    } catch {
      // File doesn't exist, try next
    }
  }

  return null;
}

// ============================================================================
// MAIN PARSER CLASS
// ============================================================================

/**
 * Import/Export Parser
 */
export class ImportExportParser {
  private cache: Map<string, FileAnalysis> = new Map();

  /**
   * Clear the parse cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get file extension type
   */
  private getFileType(filePath: string): 'js' | 'ts' | 'python' | 'unknown' {
    const ext = extname(filePath).toLowerCase();

    if (['.ts', '.tsx', '.mts', '.cts'].includes(ext)) return 'ts';
    if (['.js', '.jsx', '.mjs', '.cjs'].includes(ext)) return 'js';
    if (['.py', '.pyw'].includes(ext)) return 'python';

    return 'unknown';
  }

  /**
   * Parse a file and extract imports/exports
   */
  async parseFile(filePath: string): Promise<FileAnalysis> {
    // Check cache
    const cached = this.cache.get(filePath);
    if (cached) {
      return cached;
    }

    const analysis: FileAnalysis = {
      filePath,
      imports: [],
      exports: [],
      localImports: [],
      externalImports: [],
      parseErrors: [],
    };

    try {
      const content = await readFile(filePath, 'utf-8');
      const fileType = this.getFileType(filePath);

      if (fileType === 'js' || fileType === 'ts') {
        analysis.imports = parseJSImports(content);
        analysis.exports = parseJSExports(content);
      } else if (fileType === 'python') {
        analysis.imports = parsePythonImports(content);
        analysis.exports = parsePythonExports(content);
      } else {
        analysis.parseErrors.push(`Unsupported file type: ${extname(filePath)}`);
      }

      // Categorize imports
      for (const imp of analysis.imports) {
        if (imp.isRelative) {
          analysis.localImports.push(imp.source);
        } else if (imp.isPackage) {
          // Extract package name (first part of path)
          const pkgName = imp.source.startsWith('@')
            ? imp.source.split('/').slice(0, 2).join('/')
            : imp.source.split('/')[0];
          if (!analysis.externalImports.includes(pkgName)) {
            analysis.externalImports.push(pkgName);
          }
        }
      }
    } catch (error) {
      analysis.parseErrors.push(`Failed to read file: ${(error as Error).message}`);
    }

    // Cache the result
    this.cache.set(filePath, analysis);

    return analysis;
  }

  /**
   * Parse multiple files
   */
  async parseFiles(filePaths: string[]): Promise<Map<string, FileAnalysis>> {
    const results = new Map<string, FileAnalysis>();

    for (const filePath of filePaths) {
      const analysis = await this.parseFile(filePath);
      results.set(filePath, analysis);
    }

    return results;
  }
}

/**
 * Convenience function to parse a single file
 */
export async function parseFile(filePath: string): Promise<FileAnalysis> {
  const parser = new ImportExportParser();
  return parser.parseFile(filePath);
}

/**
 * Convenience function to parse multiple files
 */
export async function parseFiles(filePaths: string[]): Promise<Map<string, FileAnalysis>> {
  const parser = new ImportExportParser();
  return parser.parseFiles(filePaths);
}
