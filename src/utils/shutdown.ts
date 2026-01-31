/**
 * Graceful shutdown handling for spec-gen CLI
 */

import * as fs from 'fs';
import * as path from 'path';

export interface ShutdownState {
  /** Current phase when interrupted */
  phase: 'init' | 'analyze' | 'generate' | 'verify';
  /** Files that were being processed */
  currentFiles?: string[];
  /** Partial results that were saved */
  savedResults?: string;
  /** Timestamp of interruption */
  timestamp: number;
}

type CleanupCallback = () => void | Promise<void>;

/**
 * Manages graceful shutdown with cleanup callbacks
 */
export class ShutdownManager {
  private callbacks: CleanupCallback[] = [];
  private isShuttingDown = false;
  private state: ShutdownState | null = null;
  private stateFile: string;
  private handlers: Map<string, (...args: unknown[]) => void> = new Map();
  private handlersAttached = false;

  constructor(projectPath: string = process.cwd(), options?: { skipHandlers?: boolean }) {
    this.stateFile = path.join(projectPath, '.spec-gen', 'shutdown-state.json');
    // Skip handlers in test environment or when explicitly disabled
    if (!options?.skipHandlers && process.env.NODE_ENV !== 'test') {
      this.setupHandlers();
    }
  }

  private setupHandlers(): void {
    if (this.handlersAttached) return;
    this.handlersAttached = true;

    const sigintHandler = () => this.handleShutdown('SIGINT');
    const sigtermHandler = () => this.handleShutdown('SIGTERM');
    const exceptionHandler = (error: Error) => {
      console.error('\n❌ Uncaught exception:', error.message);
      this.handleShutdown('uncaughtException');
    };
    const rejectionHandler = (reason: unknown) => {
      console.error('\n❌ Unhandled rejection:', reason);
      this.handleShutdown('unhandledRejection');
    };

    // Store handlers for potential cleanup
    this.handlers.set('SIGINT', sigintHandler);
    this.handlers.set('SIGTERM', sigtermHandler);
    this.handlers.set('uncaughtException', exceptionHandler as (...args: unknown[]) => void);
    this.handlers.set('unhandledRejection', rejectionHandler as (...args: unknown[]) => void);

    // Handle Ctrl+C
    process.on('SIGINT', sigintHandler);

    // Handle termination signal
    process.on('SIGTERM', sigtermHandler);

    // Handle uncaught exceptions
    process.on('uncaughtException', exceptionHandler);

    // Handle unhandled promise rejections
    process.on('unhandledRejection', rejectionHandler);
  }

  /**
   * Remove all registered signal handlers (for testing)
   */
  removeHandlers(): void {
    for (const [event, handler] of this.handlers) {
      process.removeListener(event, handler);
    }
    this.handlers.clear();
    this.handlersAttached = false;
  }

  private async handleShutdown(signal: string): Promise<void> {
    if (this.isShuttingDown) {
      console.log('\n⚠️  Force quitting...');
      process.exit(1);
    }

    this.isShuttingDown = true;
    console.log('\n\n🛑 Interrupted! Cleaning up...');

    // Save state if we have one
    if (this.state) {
      await this.saveState();
    }

    // Run cleanup callbacks in reverse order
    for (const callback of this.callbacks.reverse()) {
      try {
        await callback();
      } catch (error) {
        console.error('Cleanup error:', error);
      }
    }

    // Show resume suggestion
    this.showResumeSuggestion();

    process.exit(signal === 'SIGINT' ? 130 : 1);
  }

  /**
   * Register a cleanup callback to run on shutdown
   */
  onCleanup(callback: CleanupCallback): void {
    this.callbacks.push(callback);
  }

  /**
   * Remove a cleanup callback
   */
  removeCleanup(callback: CleanupCallback): void {
    const index = this.callbacks.indexOf(callback);
    if (index !== -1) {
      this.callbacks.splice(index, 1);
    }
  }

  /**
   * Set the current state for potential resume
   */
  setState(state: Partial<ShutdownState>): void {
    this.state = {
      phase: state.phase ?? 'init',
      currentFiles: state.currentFiles,
      savedResults: state.savedResults,
      timestamp: Date.now(),
    };
  }

  /**
   * Clear state (call on successful completion)
   */
  clearState(): void {
    this.state = null;
    // Remove state file if it exists
    try {
      if (fs.existsSync(this.stateFile)) {
        fs.unlinkSync(this.stateFile);
      }
    } catch {
      // Ignore errors
    }
  }

  /**
   * Save state to file for potential resume
   */
  private async saveState(): Promise<void> {
    if (!this.state) return;

    try {
      const dir = path.dirname(this.stateFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2));
      console.log(`📝 State saved to ${this.stateFile}`);
    } catch (error) {
      console.error('Failed to save state:', error);
    }
  }

  /**
   * Load previous shutdown state
   */
  loadState(): ShutdownState | null {
    try {
      if (fs.existsSync(this.stateFile)) {
        const content = fs.readFileSync(this.stateFile, 'utf-8');
        return JSON.parse(content);
      }
    } catch {
      // Ignore errors
    }
    return null;
  }

  /**
   * Check if there's a previous interrupted session
   */
  hasPreviousState(): boolean {
    return this.loadState() !== null;
  }

  private showResumeSuggestion(): void {
    if (!this.state) return;

    console.log('\n📋 To resume from where you left off:');

    switch (this.state.phase) {
      case 'init':
        console.log('   Run: spec-gen init');
        break;
      case 'analyze':
        console.log('   Run: spec-gen analyze');
        if (this.state.savedResults) {
          console.log(`   Partial analysis saved to: ${this.state.savedResults}`);
        }
        break;
      case 'generate':
        console.log('   Run: spec-gen generate');
        if (this.state.savedResults) {
          console.log(`   Partial specs saved to: ${this.state.savedResults}`);
        }
        break;
      case 'verify':
        console.log('   Run: spec-gen verify');
        break;
    }

    console.log('');
  }

  /**
   * Check if shutdown is in progress
   */
  isInProgress(): boolean {
    return this.isShuttingDown;
  }
}

// Global shutdown manager instance
let globalManager: ShutdownManager | null = null;

/**
 * Get or create the global shutdown manager
 */
export function getShutdownManager(projectPath?: string): ShutdownManager {
  if (!globalManager) {
    globalManager = new ShutdownManager(projectPath);
  }
  return globalManager;
}

/**
 * Register a cleanup callback with the global manager
 */
export function onShutdown(callback: CleanupCallback): void {
  getShutdownManager().onCleanup(callback);
}

/**
 * Set current state for potential resume
 */
export function setShutdownState(state: Partial<ShutdownState>): void {
  getShutdownManager().setState(state);
}

/**
 * Clear shutdown state (call on successful completion)
 */
export function clearShutdownState(): void {
  getShutdownManager().clearState();
}

/**
 * Create a scope that sets/clears state automatically
 */
export async function withShutdownState<T>(
  state: Partial<ShutdownState>,
  fn: () => Promise<T>
): Promise<T> {
  const manager = getShutdownManager();
  manager.setState(state);

  try {
    const result = await fn();
    manager.clearState();
    return result;
  } catch (error) {
    // State is preserved for potential resume
    throw error;
  }
}
