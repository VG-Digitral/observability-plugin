export interface LogEntry {
  uuid: string;
  event: string;
  timestamp: string;
  distinctId: string;
  logLevel: string;
  logTag: string;
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
}

export type PollingStatus = 'stopped' | 'starting' | 'active' | 'error';
