import { callApi } from './api.js';
import { log } from './logger.js';
import type { PostHogCredentials } from './credentialManager.js';

export interface SchemaInfo {
  keys: string[];
  samples: Record<string, string[]>;
}

const MAX_SAMPLES_PER_KEY = 3;
const SAMPLE_VALUE_MAX_LEN = 120;

function stringifySample(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.length > SAMPLE_VALUE_MAX_LEN ? v.substring(0, SAMPLE_VALUE_MAX_LEN) + '...' : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    const s = JSON.stringify(v);
    return s.length > SAMPLE_VALUE_MAX_LEN ? s.substring(0, SAMPLE_VALUE_MAX_LEN) + '...' : s;
  } catch {
    return String(v);
  }
}

/**
 * Fetches sample events from PostHog and collects all unique property keys
 * plus 2-3 sample values per key for LLM context.
 */
export async function discoverSchema(credentials: PostHogCredentials): Promise<SchemaInfo | null> {
  const query = `SELECT properties FROM events ORDER BY created_at DESC LIMIT 5`;
  try {
    const response = await callApi('hogql_query', { query }, credentials);
    const results = (response?.data?.results as unknown[][] | undefined) ?? [];
    if (results.length === 0) {
      log('Schema discovery: no events returned');
      return null;
    }

    const keySet = new Set<string>();
    const samplesByKey: Record<string, string[]> = {};

    for (const row of results) {
      if (!row || row.length < 1) continue;
      let properties: Record<string, unknown> = {};
      const raw = row[0];
      if (typeof raw === 'string') {
        try {
          properties = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          continue;
        }
      } else if (typeof raw === 'object' && raw !== null) {
        properties = raw as Record<string, unknown>;
      }

      for (const [k, v] of Object.entries(properties)) {
        keySet.add(k);
        if (!samplesByKey[k]) samplesByKey[k] = [];
        if (samplesByKey[k].length < MAX_SAMPLES_PER_KEY) {
          const s = stringifySample(v);
          if (s && !samplesByKey[k].includes(s)) {
            samplesByKey[k].push(s);
          }
        }
      }
    }

    const keys = Array.from(keySet).sort();
    const samples: Record<string, string[]> = {};
    for (const k of keys) {
      samples[k] = samplesByKey[k] ?? [];
    }

    log(`Schema discovery: ${keys.length} unique property keys from ${results.length} events`);
    return { keys, samples };
  } catch (err) {
    log(`Schema discovery failed: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}

export interface FieldMapping {
  logLevel: string | null;
  logTag: string | null;
  logMessage: string | null;
  personId: string | null;
}

const UI_FIELD_DESCRIPTIONS = `
- logLevel: severity or level of the log (e.g. INFO, ERROR, WARN, DEBUG). Prefer short categorical values.
- logTag: source, service name, or tag that identifies where the log came from (e.g. service name, component).
- logMessage: the main human-readable message or description of the event (e.g. error message, action description). Prefer the most descriptive text field.
- personId: identifier for the user or person (e.g. user_id, anonymous_id). Use null if no such property exists.
`.trim();

/**
 * Calls OpenAI to generate a mapping from PostHog property keys to our UI fields.
 * Returns null if schema is empty or OpenAI fails; caller should use fallback.
 */
export async function generateFieldMapping(
  schemaInfo: SchemaInfo | null,
  openaiKey: string
): Promise<FieldMapping | null> {
  if (!schemaInfo || schemaInfo.keys.length === 0) {
    return null;
  }

  const keysWithSamples = schemaInfo.keys
    .map((k) => {
      const samples = schemaInfo.samples[k];
      const sampleStr = samples.length > 0 ? ` (e.g. ${samples.slice(0, 2).join(', ')})` : '';
      return `  - "${k}"${sampleStr}`;
    })
    .join('\n');

  const systemPrompt = `You are a mapping assistant. Given a list of event property keys from a PostHog project (with optional sample values), you must produce a JSON object that maps each of our UI fields to the single best-matching property key, or null if no good match exists.

Our UI fields and what they represent:
${UI_FIELD_DESCRIPTIONS}

Respond ONLY with a valid JSON object with exactly these keys: logLevel, logTag, logMessage, personId. Each value must be either a string (one of the given property keys) or null. No explanation, no markdown.`;

  const userPrompt = `Here are the property keys from the user's PostHog events:
${keysWithSamples}

Return the mapping JSON only.`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 256,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      log(`OpenAI mapping failed: ${response.status} ${text.substring(0, 200)}`);
      return null;
    }

    const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data?.choices?.[0]?.message?.content;
    if (!content || typeof content !== 'string') {
      log('OpenAI mapping: no content in response');
      return null;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(content) as Record<string, unknown>;
    } catch {
      log('OpenAI mapping: malformed JSON in response');
      return null;
    }

    const mapping: FieldMapping = {
      logLevel: typeof parsed.logLevel === 'string' ? parsed.logLevel : null,
      logTag: typeof parsed.logTag === 'string' ? parsed.logTag : null,
      logMessage: typeof parsed.logMessage === 'string' ? parsed.logMessage : null,
      personId: typeof parsed.personId === 'string' ? parsed.personId : null,
    };

    log(`Field mapping generated: logLevel=${mapping.logLevel ?? 'null'} logTag=${mapping.logTag ?? 'null'} logMessage=${mapping.logMessage ?? 'null'} personId=${mapping.personId ?? 'null'}`);
    return mapping;
  } catch (err) {
    log(`OpenAI mapping error: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
