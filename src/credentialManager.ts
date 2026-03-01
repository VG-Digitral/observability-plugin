import * as vscode from 'vscode';
import type { FieldMapping } from './schemaMapper.js';

export interface PostHogCredentials {
  apiKey: string;
  projectId: string;
}

export type { FieldMapping };

const KEY_API_KEY = 'qapilot.posthog.apiKey';
const KEY_PROJECT_ID = 'qapilot.posthog.projectId';
const KEY_OPENAI_KEY = 'qapilot.openai.apiKey';

function fieldMappingKey(projectId: string): string {
  return `qapilot.fieldMapping.${projectId}`;
}

export class CredentialManager {
  constructor(private readonly _secrets: vscode.SecretStorage) {}

  async get(): Promise<PostHogCredentials | null> {
    const apiKey = await this._secrets.get(KEY_API_KEY);
    const projectId = await this._secrets.get(KEY_PROJECT_ID);
    if (!apiKey || !projectId) { return null; }
    return { apiKey, projectId };
  }

  async store(apiKey: string, projectId: string): Promise<void> {
    await this._secrets.store(KEY_API_KEY, apiKey);
    await this._secrets.store(KEY_PROJECT_ID, projectId);
  }

  async getOpenAIKey(): Promise<string | null> {
    const key = await this._secrets.get(KEY_OPENAI_KEY);
    return key || null;
  }

  async storeOpenAIKey(key: string): Promise<void> {
    await this._secrets.store(KEY_OPENAI_KEY, key);
  }

  async clearPostHog(): Promise<void> {
    await this._secrets.delete(KEY_API_KEY);
    await this._secrets.delete(KEY_PROJECT_ID);
  }

  async clearOpenAIKey(): Promise<void> {
    await this._secrets.delete(KEY_OPENAI_KEY);
  }

  async clear(): Promise<void> {
    await this._secrets.delete(KEY_API_KEY);
    await this._secrets.delete(KEY_PROJECT_ID);
    await this._secrets.delete(KEY_OPENAI_KEY);
  }

  async storeFieldMapping(projectId: string, mapping: FieldMapping): Promise<void> {
    await this._secrets.store(fieldMappingKey(projectId), JSON.stringify(mapping));
  }

  async getFieldMapping(projectId: string): Promise<FieldMapping | null> {
    const raw = await this._secrets.get(fieldMappingKey(projectId));
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as FieldMapping;
      const valid = (x: unknown): x is string | null => x === null || typeof x === 'string';
      if (!valid(parsed.logLevel) || !valid(parsed.logEventType) || !valid(parsed.logMessage) || !valid(parsed.personId)) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  async clearFieldMapping(projectId: string): Promise<void> {
    await this._secrets.delete(fieldMappingKey(projectId));
  }
}
