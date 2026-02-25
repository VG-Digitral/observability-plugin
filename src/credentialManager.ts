import * as vscode from 'vscode';

export interface PostHogCredentials {
  apiKey: string;
  projectId: string;
}

const KEY_API_KEY = 'qapilot.posthog.apiKey';
const KEY_PROJECT_ID = 'qapilot.posthog.projectId';
const KEY_OPENAI_KEY = 'qapilot.openai.apiKey';

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

  async clear(): Promise<void> {
    await this._secrets.delete(KEY_API_KEY);
    await this._secrets.delete(KEY_PROJECT_ID);
    await this._secrets.delete(KEY_OPENAI_KEY);
  }
}
