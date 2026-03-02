import { log } from './logger.js';
import { API_URL } from './constants.js';
import type { PostHogCredentials } from './credentialManager.js';

export async function callApi(action: string, params: Record<string, unknown>, credentials: PostHogCredentials): Promise<{ data: Record<string, unknown> }> {
  const body = JSON.stringify({ action, params, credentials });
  log(`API call: ${action} (${body.length} bytes)`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);

  try {
    console.log('calling API', new Date().toISOString());
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: controller.signal
    });
    console.log('response received from API', new Date().toISOString());
    clearTimeout(timeoutId);

    const text = await response.text();

    if (!response.ok) {
      throw new Error(`API returned ${response.status}: ${text.substring(0, 200)}`);
    }

    const parsed = JSON.parse(text) as Record<string, unknown>;
    // Lambda function URL returns { statusCode, body, headers, ... }; actual payload is in body (JSON string)
    if ('body' in parsed && typeof parsed.body === 'string') {
      const body = JSON.parse(parsed.body) as Record<string, unknown>;
      // Proxy/Lambda may return { success, data: { results, ... } }; we need response.data.results for callers
      const data = body && typeof body.data === 'object' && body.data !== null ? (body.data as Record<string, unknown>) : body;
      return { data };
    }
    // Already in expected shape { data: ... } (e.g. API Gateway that unwraps for us)
    return parsed as { data: Record<string, unknown> };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('API request timeout (20s)');
    }
    throw err;
  }
}
