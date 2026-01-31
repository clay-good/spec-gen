import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ProgressIndicator,
  createProgress,
  showNextSteps,
  showGenerationSuccess,
  showAnalysisSuccess,
  showVerificationSuccess,
} from './progress.js';

// Mock ora
vi.mock('ora', () => ({
  default: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    warn: vi.fn().mockReturnThis(),
    info: vi.fn().mockReturnThis(),
    text: '',
  })),
}));

describe('ProgressIndicator', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe('constructor', () => {
    it('should create with default options', () => {
      const progress = new ProgressIndicator();
      expect(progress).toBeInstanceOf(ProgressIndicator);
    });

    it('should respect enabled option', () => {
      const progress = new ProgressIndicator({ enabled: false });
      progress.start('Test');
      expect(consoleSpy).toHaveBeenCalled();
    });
  });

  describe('start', () => {
    it('should log message when disabled', () => {
      const progress = new ProgressIndicator({ enabled: false });
      progress.start('Starting task');
      expect(consoleSpy).toHaveBeenCalledWith('Starting task');
    });
  });

  describe('succeed', () => {
    it('should log success message when disabled', () => {
      const progress = new ProgressIndicator({ enabled: false });
      progress.succeed('Task completed');
      expect(consoleSpy).toHaveBeenCalledWith('✓ Task completed');
    });
  });

  describe('fail', () => {
    it('should log failure message when disabled', () => {
      const progress = new ProgressIndicator({ enabled: false });
      progress.fail('Task failed');
      expect(consoleSpy).toHaveBeenCalledWith('✗ Task failed');
    });
  });

  describe('warn', () => {
    it('should log warning message when disabled', () => {
      const progress = new ProgressIndicator({ enabled: false });
      progress.warn('Warning message');
      expect(consoleSpy).toHaveBeenCalledWith('⚠ Warning message');
    });
  });

  describe('info', () => {
    it('should log info message when disabled', () => {
      const progress = new ProgressIndicator({ enabled: false });
      progress.info('Info message');
      expect(consoleSpy).toHaveBeenCalledWith('ℹ Info message');
    });
  });

  describe('updateFileDiscovery', () => {
    it('should format file discovery progress', () => {
      const progress = new ProgressIndicator({ enabled: false });
      progress.updateFileDiscovery({
        found: 100,
        directories: 10,
        currentFile: 'src/index.ts',
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        'Discovering files... (100 found, 10 directories) (src/index.ts)'
      );
    });

    it('should work without current file', () => {
      const progress = new ProgressIndicator({ enabled: false });
      progress.updateFileDiscovery({
        found: 50,
        directories: 5,
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        'Discovering files... (50 found, 5 directories)'
      );
    });
  });

  describe('updateAnalysis', () => {
    it('should format imports phase', () => {
      const progress = new ProgressIndicator({ enabled: false });
      progress.updateAnalysis({
        phase: 'imports',
        current: 'src/index.ts',
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        'Analyzing imports... (src/index.ts)'
      );
    });

    it('should format scoring phase with counts', () => {
      const progress = new ProgressIndicator({ enabled: false });
      progress.updateAnalysis({
        phase: 'scoring',
        processed: 10,
        total: 50,
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        'Calculating significance scores... [10/50]'
      );
    });

    it('should format graph phase', () => {
      const progress = new ProgressIndicator({ enabled: false });
      progress.updateAnalysis({ phase: 'graph' });
      expect(consoleSpy).toHaveBeenCalledWith(
        'Building dependency graph...'
      );
    });

    it('should format clustering phase', () => {
      const progress = new ProgressIndicator({ enabled: false });
      progress.updateAnalysis({ phase: 'clustering' });
      expect(consoleSpy).toHaveBeenCalledWith(
        'Detecting domain clusters...'
      );
    });
  });

  describe('updateGeneration', () => {
    it('should format generation progress', () => {
      const progress = new ProgressIndicator({ enabled: false });
      progress.updateGeneration({
        stage: 2,
        totalStages: 5,
        stageName: 'Entity Extraction',
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        'Querying LLM... (stage 2/5: Entity Extraction)'
      );
    });

    it('should include token count when provided', () => {
      const progress = new ProgressIndicator({ enabled: false });
      progress.updateGeneration({
        stage: 3,
        totalStages: 5,
        stageName: 'Service Analysis',
        tokensUsed: 1500,
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        'Querying LLM... (stage 3/5: Service Analysis) [1500 tokens]'
      );
    });
  });

  describe('updateWriting', () => {
    it('should format writing progress', () => {
      const progress = new ProgressIndicator({ enabled: false });
      progress.updateWriting({
        current: 3,
        total: 6,
        currentFile: 'user/spec.md',
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        'Writing specs... (3/6 files) [user/spec.md]'
      );
    });
  });

  describe('verbose_log', () => {
    it('should not log when verbose is false', () => {
      const progress = new ProgressIndicator({ enabled: false, verbose: false });
      progress.verbose_log('Debug message');
      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('should log when verbose is true', () => {
      const progress = new ProgressIndicator({ enabled: false, verbose: true });
      progress.verbose_log('Debug message');
      expect(consoleSpy).toHaveBeenCalledWith('  [verbose] Debug message');
    });

    it('should collect logs', () => {
      const progress = new ProgressIndicator({ verbose: true, enabled: false });
      progress.verbose_log('Log 1');
      progress.verbose_log('Log 2');
      expect(progress.getLogs()).toEqual(['Log 1', 'Log 2']);
    });
  });
});

describe('createProgress', () => {
  it('should create a ProgressIndicator', () => {
    const progress = createProgress();
    expect(progress).toBeInstanceOf(ProgressIndicator);
  });

  it('should pass options', () => {
    const progress = createProgress({ enabled: false, verbose: true });
    expect(progress).toBeInstanceOf(ProgressIndicator);
  });
});

describe('showNextSteps', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('should show steps after analysis', () => {
    showNextSteps({ analyzed: true });
    const output = consoleSpy.mock.calls.flat().join('\n');
    expect(output).toContain('spec-gen generate');
  });

  it('should show steps after generation', () => {
    showNextSteps({ generated: true });
    const output = consoleSpy.mock.calls.flat().join('\n');
    expect(output).toContain('spec-gen verify');
    expect(output).toContain('openspec validate');
  });

  it('should show steps after verification', () => {
    showNextSteps({ verified: true });
    const output = consoleSpy.mock.calls.flat().join('\n');
    expect(output).toContain('openspec change');
  });

  it('should show default steps', () => {
    showNextSteps({});
    const output = consoleSpy.mock.calls.flat().join('\n');
    expect(output).toContain('spec-gen');
    expect(output).toContain('--help');
  });
});

describe('showGenerationSuccess', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('should show success message', () => {
    showGenerationSuccess({
      specsCount: 5,
      outputPath: 'openspec/specs/',
    });
    const output = consoleSpy.mock.calls.flat().join('\n');
    expect(output).toContain('Generation complete');
    expect(output).toContain('5 spec files');
    expect(output).toContain('openspec/specs/');
  });

  it('should show token count when provided', () => {
    showGenerationSuccess({
      specsCount: 3,
      outputPath: 'openspec/specs/',
      tokensUsed: 5000,
    });
    const output = consoleSpy.mock.calls.flat().join('\n');
    expect(output).toContain('5,000 tokens');
  });
});

describe('showAnalysisSuccess', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('should show success message', () => {
    showAnalysisSuccess({
      filesAnalyzed: 100,
      outputPath: '.spec-gen/analysis/',
    });
    const output = consoleSpy.mock.calls.flat().join('\n');
    expect(output).toContain('Analysis complete');
    expect(output).toContain('100 files analyzed');
  });

  it('should show domains when provided', () => {
    showAnalysisSuccess({
      filesAnalyzed: 50,
      outputPath: '.spec-gen/analysis/',
      domains: 5,
    });
    const output = consoleSpy.mock.calls.flat().join('\n');
    expect(output).toContain('5 domain clusters');
  });
});

describe('showVerificationSuccess', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('should show passed message', () => {
    showVerificationSuccess({
      score: 0.85,
      filesVerified: 5,
      passed: true,
    });
    const output = consoleSpy.mock.calls.flat().join('\n');
    expect(output).toContain('Verification passed');
    expect(output).toContain('85.0%');
    expect(output).toContain('5 files verified');
  });

  it('should show warning message when not passed', () => {
    showVerificationSuccess({
      score: 0.65,
      filesVerified: 5,
      passed: false,
    });
    const output = consoleSpy.mock.calls.flat().join('\n');
    expect(output).toContain('warnings');
    expect(output).toContain('65.0%');
  });
});
