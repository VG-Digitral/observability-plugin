import { LogEntry } from './types.js';
import type { FieldMapping } from './schemaMapper.js';

export function formatTimestamp(ts: string): string {
  if (!ts) { return ''; }
  return ts.replace('T', ' ').substring(0, 19);
}

function getProp(properties: Record<string, unknown>, key: string | null): unknown {
  if (!key || !(key in properties)) return undefined;
  return properties[key];
}

export function extractMessage(
  event: string,
  properties: Record<string, unknown>,
  mapping?: { logMessage: string | null } | null
): string {
  if (mapping?.logMessage && properties[mapping.logMessage] != null) {
    return String(properties[mapping.logMessage]);
  }
  // Hardcoded fallbacks commented out to verify LLM schema matching
  // if (properties.log_message) { return String(properties.log_message); }
  // if (properties.message) { return String(properties.message); }

  const skipKeys = new Set([
    'log_level', 'log_tag', 'level', 'tag', 'source', 'person_id',
    '$lib', '$lib_version', '$geoip_city_name', '$geoip_country_name',
    '$geoip_country_code', '$geoip_continent_name', '$geoip_continent_code',
    '$geoip_postal_code', '$geoip_latitude', '$geoip_longitude',
    '$geoip_time_zone', '$geoip_subdivision_1_code', '$geoip_subdivision_1_name',
    '$geoip_subdivision_2_code', '$geoip_subdivision_2_name',
    '$geoip_city_confidence', '$geoip_country_confidence',
    '$set', '$set_once', '$ip'
  ]);

  const relevant = Object.entries(properties)
    .filter(([k]) => !skipKeys.has(k) && !k.startsWith('$geoip'))
    .slice(0, 8)
    .map(([k, v]) => {
      const val = typeof v === 'object' ? JSON.stringify(v) : String(v);
      return `${k}=${val.length > 80 ? val.substring(0, 80) + '...' : val}`;
    })
    .join(', ');

  return relevant || event;
}

export function parseRow(row: unknown[], fieldMapping?: FieldMapping | null): LogEntry | null {
  if (!row || row.length < 5) { return null; }
  const [rawUuid, rawEvent, rawTimestamp, /* created_at */, rawDistinctId, rawProps] = row;

  let properties: Record<string, unknown> = {};
  if (typeof rawProps === 'string') {
    try { properties = JSON.parse(rawProps); } catch { properties = {}; }
  } else if (typeof rawProps === 'object' && rawProps !== null) {
    properties = rawProps as Record<string, unknown>;
  }

  const event = String(rawEvent || '');
  const rawLevel = fieldMapping?.logLevel != null ? getProp(properties, fieldMapping.logLevel) : undefined;
  const logLevel = String(
    rawLevel ?? /* properties.log_level ?? properties.level ?? */ 'INFO'
  ).toUpperCase();
  const rawTag = fieldMapping?.logTag != null ? getProp(properties, fieldMapping.logTag) : undefined;
  const logTag = String(rawTag ?? /* properties.log_tag ?? properties.tag ?? properties.source ?? */ '');
  const logMessage = extractMessage(event, properties, fieldMapping ?? undefined);
  const rawPersonId = fieldMapping?.personId != null ? getProp(properties, fieldMapping.personId) : undefined;
  const personId = String(rawPersonId ?? /* properties.person_id ?? */ rawDistinctId ?? '');

  return {
    uuid: String(rawUuid || ''),
    event,
    timestamp: formatTimestamp(String(rawTimestamp || '')),
    distinctId: String(rawDistinctId || ''),
    logLevel,
    logTag,
    logMessage,
    personId,
    properties,
    receivedAt: Date.now()
  };
}
