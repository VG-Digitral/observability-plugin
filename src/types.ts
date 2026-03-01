export interface LogEntry {
  uuid: string;
  event: string;
  timestamp: string;
  distinctId: string;
  logLevel: string;
  logEventType: string;
  logMessage: string;
  personId: string;
  properties: Record<string, unknown>;
  receivedAt?: number;
  isInsight?: boolean;
  insightCategory?: string;
  insightColor?: string;
  insightType?: string;
  insightIconUrl?: string;
  level2Markdown?: string;
  sourceLogIds?: string[];
  windowStart?: string;
  windowEnd?: string;
  /** Raw PostHog event row as returned by the API (uuid, event, timestamp, created_at, distinct_id, properties) for "Show raw JSON" in UI */
  rawPosthogEvent?: unknown;
}

export type PollingStatus = 'stopped' | 'starting' | 'active' | 'error';
