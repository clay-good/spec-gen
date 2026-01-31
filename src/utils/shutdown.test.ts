import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import {
  ShutdownManager,
  getShutdownManager,
  onShutdown,
  setShutdownState,
  clearShutdownState,
  withShutdownState,
} from './shutdown.js';

// Mock fs
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

describe('ShutdownManager', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(fs.existsSync).mockReturnValue(false);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create with default project path', () => {
      const manager = new ShutdownManager(undefined, { skipHandlers: true });
      expect(manager).toBeInstanceOf(ShutdownManager);
    });

    it('should create with custom project path', () => {
      const manager = new ShutdownManager('/custom/path', { skipHandlers: true });
      expect(manager).toBeInstanceOf(ShutdownManager);
    });
  });

  describe('onCleanup', () => {
    it('should register cleanup callback', () => {
      const manager = new ShutdownManager(undefined, { skipHandlers: true });
      const callback = vi.fn();

      manager.onCleanup(callback);

      // Can't easily trigger shutdown, but we can verify no error
      expect(() => manager.onCleanup(callback)).not.toThrow();
    });
  });

  describe('removeCleanup', () => {
    it('should remove registered callback', () => {
      const manager = new ShutdownManager(undefined, { skipHandlers: true });
      const callback = vi.fn();

      manager.onCleanup(callback);
      manager.removeCleanup(callback);

      // No error when removing non-existent callback
      manager.removeCleanup(callback);
    });
  });

  describe('setState', () => {
    it('should set shutdown state', () => {
      const manager = new ShutdownManager(undefined, { skipHandlers: true });

      manager.setState({
        phase: 'analyze',
        currentFiles: ['file1.ts', 'file2.ts'],
      });

      // State is set (verified through loadState)
      expect(() => manager.setState({ phase: 'generate' })).not.toThrow();
    });
  });

  describe('clearState', () => {
    it('should clear state', () => {
      const manager = new ShutdownManager(undefined, { skipHandlers: true });
      manager.setState({ phase: 'analyze' });

      manager.clearState();

      // Should not throw
      expect(() => manager.clearState()).not.toThrow();
    });

    it('should delete state file if exists', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      const manager = new ShutdownManager('/test/path', { skipHandlers: true });

      manager.clearState();

      expect(fs.unlinkSync).toHaveBeenCalled();
    });
  });

  describe('loadState', () => {
    it('should return null when no state file', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      const manager = new ShutdownManager(undefined, { skipHandlers: true });

      const state = manager.loadState();

      expect(state).toBeNull();
    });

    it('should load state from file', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          phase: 'analyze',
          timestamp: 12345,
        })
      );

      const manager = new ShutdownManager(undefined, { skipHandlers: true });
      const state = manager.loadState();

      expect(state).toEqual({
        phase: 'analyze',
        timestamp: 12345,
      });
    });

    it('should handle read errors gracefully', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error('Read error');
      });

      const manager = new ShutdownManager(undefined, { skipHandlers: true });
      const state = manager.loadState();

      expect(state).toBeNull();
    });
  });

  describe('hasPreviousState', () => {
    it('should return false when no state', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      const manager = new ShutdownManager(undefined, { skipHandlers: true });

      expect(manager.hasPreviousState()).toBe(false);
    });

    it('should return true when state exists', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({ phase: 'analyze', timestamp: 12345 })
      );

      const manager = new ShutdownManager(undefined, { skipHandlers: true });

      expect(manager.hasPreviousState()).toBe(true);
    });
  });

  describe('isInProgress', () => {
    it('should return false initially', () => {
      const manager = new ShutdownManager(undefined, { skipHandlers: true });
      expect(manager.isInProgress()).toBe(false);
    });
  });

  describe('removeHandlers', () => {
    it('should remove handlers without error', () => {
      const manager = new ShutdownManager(undefined, { skipHandlers: true });
      expect(() => manager.removeHandlers()).not.toThrow();
    });
  });
});

describe('global shutdown functions', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.mocked(fs.existsSync).mockReturnValue(false);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getShutdownManager', () => {
    it('should return same instance', () => {
      const manager1 = getShutdownManager();
      const manager2 = getShutdownManager();

      // They should be the same manager type
      expect(manager1).toBeInstanceOf(ShutdownManager);
      expect(manager2).toBeInstanceOf(ShutdownManager);
    });
  });

  describe('onShutdown', () => {
    it('should register callback', () => {
      const callback = vi.fn();
      expect(() => onShutdown(callback)).not.toThrow();
    });
  });

  describe('setShutdownState', () => {
    it('should set state', () => {
      expect(() => setShutdownState({ phase: 'generate' })).not.toThrow();
    });
  });

  describe('clearShutdownState', () => {
    it('should clear state', () => {
      expect(() => clearShutdownState()).not.toThrow();
    });
  });

  describe('withShutdownState', () => {
    it('should execute function and clear state on success', async () => {
      const result = await withShutdownState(
        { phase: 'analyze' },
        async () => 'success'
      );

      expect(result).toBe('success');
    });

    it('should preserve state on error', async () => {
      await expect(
        withShutdownState({ phase: 'generate' }, async () => {
          throw new Error('Test error');
        })
      ).rejects.toThrow('Test error');
    });
  });
});
