/**
 * HTTP layer for the Atera API
 */

import type { ResolvedConfig } from './config.js';
import type { RateLimiter } from './rate-limiter.js';
import {
  AteraError,
  AteraAuthenticationError,
  AteraNotFoundError,
  AteraValidationError,
  AteraRateLimitError,
  AteraServerError,
} from './errors.js';

/**
 * HTTP request options
 */
export interface RequestOptions {
  /** HTTP method */
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** Request body (will be JSON stringified) */
  body?: unknown;
  /** URL query parameters */
  params?: Record<string, string | number | boolean | undefined>;
}

/**
 * HTTP client for making authenticated requests to the Atera API
 */
export class HttpClient {
  private readonly config: ResolvedConfig;
  private readonly rateLimiter: RateLimiter;

  constructor(config: ResolvedConfig, rateLimiter: RateLimiter) {
    this.config = config;
    this.rateLimiter = rateLimiter;
  }

  /**
   * Make an authenticated request to the API
   */
  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', body, params } = options;

    // Build the URL
    let url = `${this.config.baseUrl}${path}`;
    if (params) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          searchParams.append(key, String(value));
        }
      }
      const queryString = searchParams.toString();
      if (queryString) {
        url += `?${queryString}`;
      }
    }

    return this.executeRequest<T>(url, method, body);
  }

  /**
   * Make a request to a full URL (for pagination)
   */
  async requestUrl<T>(url: string): Promise<T> {
    return this.executeRequest<T>(url, 'GET', undefined);
  }

  /**
   * Execute the request with retry logic
   */
  private async executeRequest<T>(
    url: string,
    method: string,
    body: unknown,
    retryCount: number = 0
  ): Promise<T> {
    // Wait for a rate limit slot
    await this.rateLimiter.waitForSlot();

    // Build headers with API key authentication
    const headers: Record<string, string> = {
      'X-API-KEY': this.config.apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    // Record the request
    this.rateLimiter.recordRequest();

    // Make the request, converting transport failures into typed errors
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new AteraError(
          `Request timed out after ${this.config.timeoutMs}ms: ${method} ${url}`,
          0,
          error
        );
      }
      throw new AteraError(
        `Network error during request: ${method} ${url} - ${
          error instanceof Error ? error.message : String(error)
        }`,
        0,
        error
      );
    }

    // Handle the response
    return this.handleResponse<T>(response, url, method, body, retryCount);
  }

  /**
   * Handle the response and errors
   */
  private async handleResponse<T>(
    response: Response,
    url: string,
    method: string,
    body: unknown,
    retryCount: number
  ): Promise<T> {
    if (response.ok) {
      // Handle empty responses
      const contentType = response.headers.get('content-type');
      if (contentType?.includes('application/json')) {
        return response.json() as Promise<T>;
      }
      // Return empty object for non-JSON responses
      return {} as T;
    }

    // Get response body for error details
    let responseBody: unknown;
    try {
      responseBody = await response.json();
    } catch {
      responseBody = await response.text();
    }

    switch (response.status) {
      case 400: {
        // Parse validation errors if available
        const errors = this.parseValidationErrors(responseBody);
        throw new AteraValidationError(
          'Bad request - validation failed',
          errors,
          responseBody
        );
      }

      case 401:
        throw new AteraAuthenticationError(
          'Authentication failed - invalid API key',
          responseBody
        );

      case 404:
        throw new AteraNotFoundError('Resource not found', responseBody);

      case 429:
        // Rate limited - retry with backoff
        if (this.rateLimiter.shouldRetry(retryCount)) {
          const delay = this.rateLimiter.calculateRetryDelay(retryCount);
          await this.sleep(delay);
          return this.executeRequest<T>(url, method, body, retryCount + 1);
        }
        throw new AteraRateLimitError(
          'Rate limit exceeded and max retries reached',
          this.config.rateLimit.retryAfterMs,
          responseBody
        );

      default:
        if (response.status >= 500) {
          // Server error - retry once
          if (retryCount === 0) {
            await this.sleep(1000);
            return this.executeRequest<T>(url, method, body, 1);
          }
          throw new AteraServerError(
            `Server error: ${response.status} ${response.statusText}`,
            response.status,
            responseBody
          );
        }
        throw new AteraError(
          `Request failed: ${response.status} ${response.statusText}`,
          response.status,
          responseBody
        );
    }
  }

  /**
   * Parse validation errors from response body
   */
  private parseValidationErrors(responseBody: unknown): Array<{ message: string; field?: string }> {
    const errors: Array<{ message: string; field?: string }> = [];

    if (typeof responseBody === 'object' && responseBody !== null) {
      const body = responseBody as Record<string, unknown>;

      // Handle common error response formats
      if (typeof body['message'] === 'string') {
        errors.push({ message: body['message'] });
      }
      if (typeof body['error'] === 'string') {
        errors.push({ message: body['error'] });
      }
      if (Array.isArray(body['errors'])) {
        for (const err of body['errors']) {
          if (typeof err === 'string') {
            errors.push({ message: err });
          } else if (typeof err === 'object' && err !== null) {
            const errObj = err as Record<string, unknown>;
            errors.push({
              message: String(errObj['message'] ?? errObj['error'] ?? err),
              field: typeof errObj['field'] === 'string' ? errObj['field'] : undefined,
            });
          }
        }
      }
    }

    if (errors.length === 0 && typeof responseBody === 'string') {
      errors.push({ message: responseBody });
    }

    return errors;
  }

  /**
   * Sleep for a given duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
