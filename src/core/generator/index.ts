/**
 * Generator module index
 */

export * from './spec-pipeline.js';
export * from './openspec-format-generator.js';
export {
  // Explicitly export from openspec-compat, excluding ValidationResult
  // which is already exported from openspec-format-generator
  OpenSpecValidator,
  OpenSpecConfigManager,
  validateFullSpec,
  normalizeDomainName,
  buildDetectedContext,
  type OpenSpecConfig,
  type SpecGenMetadata,
  type DetectedContext,
} from './openspec-compat.js';
export * from './openspec-writer.js';
