/**
 * Gitignore management service
 *
 * Handles adding entries to .gitignore
 */

import { access, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Check if a file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if .gitignore exists
 */
export async function gitignoreExists(rootPath: string): Promise<boolean> {
  return fileExists(join(rootPath, '.gitignore'));
}

/**
 * Read .gitignore content
 */
export async function readGitignore(rootPath: string): Promise<string | null> {
  const gitignorePath = join(rootPath, '.gitignore');
  try {
    return await readFile(gitignorePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Check if an entry is already in .gitignore
 */
export async function isInGitignore(rootPath: string, entry: string): Promise<boolean> {
  const content = await readGitignore(rootPath);
  if (!content) {
    return false;
  }

  // Normalize entry (remove leading/trailing slashes for comparison)
  const normalizedEntry = entry.replace(/^\/+|\/+$/g, '');

  // Check each line
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    // Skip comments and empty lines
    if (trimmed.startsWith('#') || trimmed === '') {
      continue;
    }
    // Normalize the line for comparison
    const normalizedLine = trimmed.replace(/^\/+|\/+$/g, '');
    if (normalizedLine === normalizedEntry) {
      return true;
    }
  }

  return false;
}

/**
 * Add an entry to .gitignore
 */
export async function addToGitignore(
  rootPath: string,
  entry: string,
  comment?: string
): Promise<boolean> {
  const gitignorePath = join(rootPath, '.gitignore');

  // Check if already present
  if (await isInGitignore(rootPath, entry)) {
    return false; // Already exists
  }

  // Read existing content or start fresh
  let content = (await readGitignore(rootPath)) ?? '';

  // Ensure file ends with newline before adding
  if (content.length > 0 && !content.endsWith('\n')) {
    content += '\n';
  }

  // Add comment if provided
  if (comment) {
    content += `\n# ${comment}\n`;
  } else if (content.length > 0) {
    content += '\n';
  }

  // Add the entry
  content += `${entry}\n`;

  // Write back
  await writeFile(gitignorePath, content, 'utf-8');
  return true;
}

/**
 * Create .gitignore with initial entries
 */
export async function createGitignore(
  rootPath: string,
  entries: { entry: string; comment?: string }[]
): Promise<void> {
  let content = '';

  for (const { entry, comment } of entries) {
    if (comment) {
      content += `# ${comment}\n`;
    }
    content += `${entry}\n`;
  }

  const gitignorePath = join(rootPath, '.gitignore');
  await writeFile(gitignorePath, content, 'utf-8');
}
