/**
 * LLM Service
 *
 * Provides a clean interface for LLM interactions with proper error handling,
 * retry logic, token management, and cost tracking.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import logger from '../../utils/logger.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Completion request parameters
 */
export interface CompletionRequest {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
  stopSequences?: string[];
  responseFormat?: 'text' | 'json';
}

/**
 * Completion response
 */
export interface CompletionResponse {
  content: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  model: string;
  finishReason: 'stop' | 'length' | 'error';
}

/**
 * LLM provider interface
 */
export interface LLMProvider {
  name: string;
  generateCompletion(request: CompletionRequest): Promise<CompletionResponse>;
  countTokens(text: string): number;
  maxContextTokens: number;
  maxOutputTokens: number;
}

/**
 * Token usage tracking
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  requests: number;
}

/**
 * Cost tracking
 */
export interface CostTracking {
  estimatedCost: number;
  currency: string;
  byProvider: Record<string, number>;
}

/**
 * LLM service options
 */
export interface LLMServiceOptions {
  /** Primary provider to use */
  provider?: 'anthropic' | 'openai';
  /** Model override */
  model?: string;
  /** Maximum retry attempts */
  maxRetries?: number;
  /** Initial retry delay in ms */
  initialDelay?: number;
  /** Maximum retry delay in ms */
  maxDelay?: number;
  /** Request timeout in ms */
  timeout?: number;
  /** Cost warning threshold in USD */
  costWarningThreshold?: number;
  /** Log directory for prompts/responses */
  logDir?: string;
  /** Enable prompt logging */
  enableLogging?: boolean;
}

/**
 * Retry configuration
 */
interface RetryConfig {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
  timeout: number;
}

// ============================================================================
// PRICING (per 1M tokens as of 2024)
// ============================================================================

const PRICING = {
  anthropic: {
    'claude-3-5-sonnet-20241022': { input: 3.0, output: 15.0 },
    'claude-3-opus-20240229': { input: 15.0, output: 75.0 },
    'claude-3-sonnet-20240229': { input: 3.0, output: 15.0 },
    'claude-3-haiku-20240307': { input: 0.25, output: 1.25 },
    default: { input: 3.0, output: 15.0 },
  },
  openai: {
    'gpt-4-turbo': { input: 10.0, output: 30.0 },
    'gpt-4': { input: 30.0, output: 60.0 },
    'gpt-4o': { input: 5.0, output: 15.0 },
    'gpt-4o-mini': { input: 0.15, output: 0.6 },
    'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
    default: { input: 5.0, output: 15.0 },
  },
};

// ============================================================================
// TOKEN ESTIMATION
// ============================================================================

/**
 * Estimate token count from text (rough approximation)
 * ~4 characters per token for English text
 */
export function estimateTokens(text: string): number {
  // More accurate estimation considering code
  // Code tends to have more tokens per character due to special chars
  const codePatterns = /[{}()\[\];:,.<>\/\\|`~!@#$%^&*=+]/g;
  const codeCharCount = (text.match(codePatterns) || []).length;
  const regularCharCount = text.length - codeCharCount;

  // Regular text: ~4 chars per token, code chars: ~2 chars per token
  return Math.ceil(regularCharCount / 4 + codeCharCount / 2);
}

// ============================================================================
// ANTHROPIC PROVIDER
// ============================================================================

/**
 * Anthropic Claude provider
 */
export class AnthropicProvider implements LLMProvider {
  name = 'anthropic';
  maxContextTokens = 200000;
  maxOutputTokens = 4096;

  private apiKey: string;
  private model: string;
  private baseUrl = 'https://api.anthropic.com/v1';

  constructor(apiKey: string, model = 'claude-3-5-sonnet-20241022') {
    this.apiKey = apiKey;
    this.model = model;
  }

  countTokens(text: string): number {
    return estimateTokens(text);
  }

  async generateCompletion(request: CompletionRequest): Promise<CompletionResponse> {
    const response = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: request.maxTokens ?? this.maxOutputTokens,
        temperature: request.temperature ?? 0.3,
        system: request.systemPrompt,
        messages: [
          { role: 'user', content: request.userPrompt },
        ],
        stop_sequences: request.stopSequences,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      const errorObj = this.parseError(error, response.status);
      throw errorObj;
    }

    const data = await response.json() as {
      content: Array<{ type: string; text: string }>;
      usage: { input_tokens: number; output_tokens: number };
      model: string;
      stop_reason: string;
    };

    const content = data.content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('');

    return {
      content,
      usage: {
        inputTokens: data.usage.input_tokens,
        outputTokens: data.usage.output_tokens,
        totalTokens: data.usage.input_tokens + data.usage.output_tokens,
      },
      model: data.model,
      finishReason: data.stop_reason === 'end_turn' ? 'stop' : data.stop_reason === 'max_tokens' ? 'length' : 'error',
    };
  }

  private parseError(error: string, status: number): Error & { status?: number; retryable?: boolean } {
    const err = new Error(error) as Error & { status?: number; retryable?: boolean };
    err.status = status;
    err.retryable = status === 429 || status >= 500;
    return err;
  }
}

// ============================================================================
// OPENAI PROVIDER
// ============================================================================

/**
 * OpenAI provider
 */
export class OpenAIProvider implements LLMProvider {
  name = 'openai';
  maxContextTokens = 128000;
  maxOutputTokens = 4096;

  private apiKey: string;
  private model: string;
  private baseUrl = 'https://api.openai.com/v1';

  constructor(apiKey: string, model = 'gpt-4o') {
    this.apiKey = apiKey;
    this.model = model;
  }

  countTokens(text: string): number {
    return estimateTokens(text);
  }

  async generateCompletion(request: CompletionRequest): Promise<CompletionResponse> {
    const messages: Array<{ role: string; content: string }> = [
      { role: 'system', content: request.systemPrompt },
      { role: 'user', content: request.userPrompt },
    ];

    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      max_tokens: request.maxTokens ?? this.maxOutputTokens,
      temperature: request.temperature ?? 0.3,
      stop: request.stopSequences,
    };

    if (request.responseFormat === 'json') {
      body.response_format = { type: 'json_object' };
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      const errorObj = this.parseError(error, response.status);
      throw errorObj;
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string }; finish_reason: string }>;
      usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      model: string;
    };

    return {
      content: data.choices[0]?.message?.content ?? '',
      usage: {
        inputTokens: data.usage.prompt_tokens,
        outputTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      },
      model: data.model,
      finishReason: data.choices[0]?.finish_reason === 'stop' ? 'stop' : data.choices[0]?.finish_reason === 'length' ? 'length' : 'error',
    };
  }

  private parseError(error: string, status: number): Error & { status?: number; retryable?: boolean } {
    const err = new Error(error) as Error & { status?: number; retryable?: boolean };
    err.status = status;
    err.retryable = status === 429 || status >= 500;
    return err;
  }
}

// ============================================================================
// MOCK PROVIDER (for testing)
// ============================================================================

/**
 * Mock provider for testing
 */
export class MockLLMProvider implements LLMProvider {
  name = 'mock';
  maxContextTokens = 100000;
  maxOutputTokens = 4096;

  private responses: Map<string, string> = new Map();
  private defaultResponse = '{"result": "mock response"}';
  public callHistory: CompletionRequest[] = [];
  public shouldFail = false;
  public failCount = 0;
  private currentFailCount = 0;

  setResponse(promptContains: string, response: string): void {
    this.responses.set(promptContains, response);
  }

  setDefaultResponse(response: string): void {
    this.defaultResponse = response;
  }

  countTokens(text: string): number {
    return estimateTokens(text);
  }

  async generateCompletion(request: CompletionRequest): Promise<CompletionResponse> {
    this.callHistory.push(request);

    if (this.shouldFail && this.currentFailCount < this.failCount) {
      this.currentFailCount++;
      const err = new Error('Mock failure') as Error & { status?: number; retryable?: boolean };
      err.status = 500;
      err.retryable = true;
      throw err;
    }

    // Find matching response
    let content = this.defaultResponse;
    for (const [key, value] of this.responses) {
      if (request.userPrompt.includes(key) || request.systemPrompt.includes(key)) {
        content = value;
        break;
      }
    }

    const inputTokens = this.countTokens(request.systemPrompt + request.userPrompt);
    const outputTokens = this.countTokens(content);

    return {
      content,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
      model: 'mock-model',
      finishReason: 'stop',
    };
  }

  reset(): void {
    this.callHistory = [];
    this.shouldFail = false;
    this.failCount = 0;
    this.currentFailCount = 0;
    this.responses.clear();
  }
}

// ============================================================================
// LLM SERVICE
// ============================================================================

/**
 * LLM Service - main interface for LLM interactions
 */
export class LLMService {
  private provider: LLMProvider;
  private retryConfig: RetryConfig;
  private options: Required<LLMServiceOptions>;
  private tokenUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, requests: 0 };
  private costTracking: CostTracking = { estimatedCost: 0, currency: 'USD', byProvider: {} };
  private requestLog: Array<{ timestamp: string; request: CompletionRequest; response?: CompletionResponse; error?: string }> = [];

  constructor(provider: LLMProvider, options: LLMServiceOptions = {}) {
    this.provider = provider;
    this.options = {
      provider: options.provider ?? 'anthropic',
      model: options.model ?? '',
      maxRetries: options.maxRetries ?? 3,
      initialDelay: options.initialDelay ?? 1000,
      maxDelay: options.maxDelay ?? 30000,
      timeout: options.timeout ?? 120000,
      costWarningThreshold: options.costWarningThreshold ?? 10.0,
      logDir: options.logDir ?? '.spec-gen/logs',
      enableLogging: options.enableLogging ?? false,
    };
    this.retryConfig = {
      maxRetries: this.options.maxRetries,
      initialDelay: this.options.initialDelay,
      maxDelay: this.options.maxDelay,
      timeout: this.options.timeout,
    };
  }

  /**
   * Get the provider name
   */
  getProviderName(): string {
    return this.provider.name;
  }

  /**
   * Get maximum context tokens for the provider
   */
  getMaxContextTokens(): number {
    return this.provider.maxContextTokens;
  }

  /**
   * Count tokens in text
   */
  countTokens(text: string): number {
    return this.provider.countTokens(text);
  }

  /**
   * Get current token usage
   */
  getTokenUsage(): TokenUsage {
    return { ...this.tokenUsage };
  }

  /**
   * Get current cost tracking
   */
  getCostTracking(): CostTracking {
    return { ...this.costTracking };
  }

  /**
   * Reset usage tracking
   */
  resetTracking(): void {
    this.tokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, requests: 0 };
    this.costTracking = { estimatedCost: 0, currency: 'USD', byProvider: {} };
    this.requestLog = [];
  }

  /**
   * Generate a completion with retry logic
   */
  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    // Pre-calculate tokens and warn if approaching limit
    const inputTokens = this.countTokens(request.systemPrompt + request.userPrompt);
    const maxTokens = request.maxTokens ?? this.provider.maxOutputTokens;
    const totalExpected = inputTokens + maxTokens;

    if (totalExpected > this.provider.maxContextTokens * 0.9) {
      logger.warning(`Approaching context limit: ${totalExpected} tokens (max: ${this.provider.maxContextTokens})`);
    }

    if (totalExpected > this.provider.maxContextTokens) {
      throw new Error(`Request exceeds context limit: ${totalExpected} > ${this.provider.maxContextTokens}`);
    }

    // Execute with retry logic
    let lastError: Error | null = null;
    let delay = this.retryConfig.initialDelay;

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        logger.debug(`LLM request attempt ${attempt + 1}/${this.retryConfig.maxRetries + 1}`);

        const response = await this.executeWithTimeout(request);

        // Update tracking
        this.updateTracking(response);

        // Log if enabled
        if (this.options.enableLogging) {
          this.logRequest(request, response);
        }

        // Check cost threshold
        if (this.costTracking.estimatedCost > this.options.costWarningThreshold) {
          logger.warning(`Cost threshold exceeded: $${this.costTracking.estimatedCost.toFixed(4)} > $${this.options.costWarningThreshold}`);
        }

        return response;
      } catch (error) {
        lastError = error as Error;
        const errWithStatus = error as Error & { retryable?: boolean };

        // Log error
        if (this.options.enableLogging) {
          this.logRequest(request, undefined, lastError.message);
        }

        // Check if retryable
        if (!errWithStatus.retryable || attempt === this.retryConfig.maxRetries) {
          throw lastError;
        }

        logger.warning(`LLM request failed (attempt ${attempt + 1}), retrying in ${delay}ms: ${lastError.message}`);
        await this.sleep(delay);

        // Exponential backoff
        delay = Math.min(delay * 2, this.retryConfig.maxDelay);
      }
    }

    throw lastError ?? new Error('Unknown error');
  }

  /**
   * Generate a completion expecting JSON response
   */
  async completeJSON<T>(request: CompletionRequest, schema?: object): Promise<T> {
    const jsonRequest = { ...request, responseFormat: 'json' as const };

    // Add JSON instruction to prompt if not already present
    if (!jsonRequest.systemPrompt.toLowerCase().includes('json')) {
      jsonRequest.systemPrompt += '\n\nRespond with valid JSON only.';
    }

    const response = await this.complete(jsonRequest);
    let content = response.content;

    // Extract JSON from markdown code blocks if present
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      content = jsonMatch[1].trim();
    }

    // Parse JSON
    let parsed: T;
    try {
      parsed = JSON.parse(content) as T;
    } catch (parseError) {
      // Retry with correction prompt for parse errors
      logger.warning('JSON parse failed, attempting correction');

      const correctionRequest: CompletionRequest = {
        systemPrompt: 'Fix the following invalid JSON and return only valid JSON. Do not include any explanation.',
        userPrompt: `Invalid JSON:\n${content}\n\nError: ${(parseError as Error).message}\n\nReturn the corrected JSON:`,
        temperature: 0.1,
        responseFormat: 'json',
      };

      const correctionResponse = await this.complete(correctionRequest);
      let correctedContent = correctionResponse.content;

      // Extract from code blocks again
      const correctedMatch = correctedContent.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (correctedMatch) {
        correctedContent = correctedMatch[1].trim();
      }

      parsed = JSON.parse(correctedContent) as T;
    }

    // Validate against schema if provided (after successful parsing)
    if (schema) {
      this.validateSchema(parsed, schema);
    }

    return parsed;
  }

  /**
   * Execute request with timeout
   */
  private async executeWithTimeout(request: CompletionRequest): Promise<CompletionResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.retryConfig.timeout);

    try {
      // Note: fetch doesn't use AbortController in this simple implementation
      // In production, you'd pass the signal to the provider
      const response = await this.provider.generateCompletion(request);
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Update tracking after a successful request
   */
  private updateTracking(response: CompletionResponse): void {
    this.tokenUsage.inputTokens += response.usage.inputTokens;
    this.tokenUsage.outputTokens += response.usage.outputTokens;
    this.tokenUsage.totalTokens += response.usage.totalTokens;
    this.tokenUsage.requests++;

    // Calculate cost
    const cost = this.calculateCost(response);
    this.costTracking.estimatedCost += cost;
    this.costTracking.byProvider[this.provider.name] = (this.costTracking.byProvider[this.provider.name] ?? 0) + cost;
  }

  /**
   * Calculate cost for a response
   */
  private calculateCost(response: CompletionResponse): number {
    const providerPricing = PRICING[this.provider.name as keyof typeof PRICING] ?? PRICING.anthropic;
    const modelPricing = providerPricing[response.model as keyof typeof providerPricing] ?? providerPricing.default;

    const inputCost = (response.usage.inputTokens / 1_000_000) * modelPricing.input;
    const outputCost = (response.usage.outputTokens / 1_000_000) * modelPricing.output;

    return inputCost + outputCost;
  }

  /**
   * Log request/response
   */
  private logRequest(request: CompletionRequest, response?: CompletionResponse, error?: string): void {
    const logEntry = {
      timestamp: new Date().toISOString(),
      request: this.redactSecrets(request),
      response,
      error,
    };

    this.requestLog.push(logEntry);
  }

  /**
   * Redact potential secrets from request
   */
  private redactSecrets(request: CompletionRequest): CompletionRequest {
    const secretPatterns = [
      /(?:api[_-]?key|password|secret|token|auth)['":\s]*[=:]\s*['"]?[\w-]{20,}['"]?/gi,
      /['"]?[a-zA-Z0-9]{32,}['"]?/g, // Long alphanumeric strings
    ];

    let systemPrompt = request.systemPrompt;
    let userPrompt = request.userPrompt;

    for (const pattern of secretPatterns) {
      systemPrompt = systemPrompt.replace(pattern, '[REDACTED]');
      userPrompt = userPrompt.replace(pattern, '[REDACTED]');
    }

    return { ...request, systemPrompt, userPrompt };
  }

  /**
   * Simple schema validation
   */
  private validateSchema(data: unknown, schema: object): void {
    // Simple type checking - in production use a proper JSON schema validator
    const schemaObj = schema as Record<string, unknown>;
    if (schemaObj.type === 'object' && schemaObj.required && Array.isArray(schemaObj.required)) {
      const dataObj = data as Record<string, unknown>;
      for (const field of schemaObj.required) {
        if (!(field in dataObj)) {
          throw new Error(`Missing required field: ${field}`);
        }
      }
    }
  }

  /**
   * Save logs to disk
   */
  async saveLogs(): Promise<void> {
    if (this.requestLog.length === 0) return;

    await mkdir(this.options.logDir, { recursive: true });

    const filename = `llm-log-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    const filepath = join(this.options.logDir, filename);

    await writeFile(filepath, JSON.stringify({
      summary: {
        tokenUsage: this.tokenUsage,
        costTracking: this.costTracking,
      },
      requests: this.requestLog,
    }, null, 2));

    logger.debug(`Saved LLM logs to ${filepath}`);
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create an LLM service with the specified provider
 */
export function createLLMService(options: LLMServiceOptions = {}): LLMService {
  const providerName = options.provider ?? 'anthropic';
  let provider: LLMProvider;

  if (providerName === 'anthropic') {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY environment variable is not set');
    }
    provider = new AnthropicProvider(apiKey, options.model ?? 'claude-3-5-sonnet-20241022');
  } else if (providerName === 'openai') {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is not set');
    }
    provider = new OpenAIProvider(apiKey, options.model ?? 'gpt-4o');
  } else {
    throw new Error(`Unknown provider: ${providerName}`);
  }

  return new LLMService(provider, options);
}

/**
 * Create an LLM service with a mock provider (for testing)
 */
export function createMockLLMService(options: LLMServiceOptions = {}): { service: LLMService; provider: MockLLMProvider } {
  const provider = new MockLLMProvider();
  const service = new LLMService(provider, options);
  return { service, provider };
}
