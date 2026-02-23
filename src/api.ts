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

    const parsed = JSON.parse(text) as { data: Record<string, unknown> };
    console.log('API response', parsed);
    return parsed;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('API request timeout (20s)');
    }
    throw err;
  }
}
