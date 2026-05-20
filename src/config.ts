/**
 * Configuration types and defaults for the Atera client
 */

/**
 * Rate limiting configuration
 */
export interface RateLimitConfig {
  /** Whether rate limiting is enabled (default: true) */
  enabled: boolean;
  /** Maximum requests per window (default: 700) */
  maxRequests: number;
  /** Window duration in milliseconds (default: 60000) */
  windowMs: number;
  /** Threshold percentage to start throttling (default: 0.8 = 80%) */
  throttleThreshold: number;
  /** Delay between retries on 429 (default: 5000ms) */
  retryAfterMs: number;
  /** Maximum retry attempts on rate limit errors (default: 3) */
  maxRetries: number;
}

/**
 * Default rate limit configuration for Atera (700 req/min)
 */
export const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  enabled: true,
  maxRequests: 700,
  windowMs: 60_000,
  throttleThreshold: 0.8,
  retryAfterMs: 5_000,
  maxRetries: 3,
};

/**
 * Default base URL for the Atera API
 */
export const DEFAULT_BASE_URL = 'https://app.atera.com/api/v3';

/**
 * Default request timeout in milliseconds (30 seconds)
 */
export const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Configuration for the Atera client
 */
export interface AteraConfig {
  /** API Key for authentication (X-API-KEY header) */
  apiKey: string;
  /** Base URL for the API (default: https://app.atera.com/api/v3) */
  baseUrl?: string;
  /** Request timeout in milliseconds (default: 30000) */
  timeoutMs?: number;
  /** Rate limiting configuration */
  rateLimit?: Partial<RateLimitConfig>;
}

/**
 * Resolved configuration with all defaults applied
 */
export interface ResolvedConfig {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
  rateLimit: RateLimitConfig;
}

/**
 * Resolves a configuration object by applying defaults
 */
export function resolveConfig(config: AteraConfig): ResolvedConfig {
  if (!config.apiKey) {
    throw new Error('API key is required');
  }

  return {
    apiKey: config.apiKey,
    baseUrl: config.baseUrl ?? DEFAULT_BASE_URL,
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    rateLimit: {
      ...DEFAULT_RATE_LIMIT_CONFIG,
      ...config.rateLimit,
    },
  };
}
