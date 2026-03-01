import * as vscode from 'vscode';
import * as http from 'http';
import * as https from 'https';

import { LogEntry, PollingStatus } from './types.js';
import { POLL_INTERVAL_MS, MAX_LOGS, VISIBILITY_DELAY_S } from './constants.js';
import { log } from './logger.js';
import { callApi } from './api.js';
import { parseRow, formatTimestamp, reparseLogEntry } from './logParser.js';
import { getWebviewHtml, getIntroHtml, getSetupHtml, getOpenAISetupHtml, getAnalyzingSchemaHtml, type SetupHtmlOptions, type OpenAISetupHtmlOptions } from './webviewHtml.js';
import type * as ConversationStore from './conversationStore.js';
import { CredentialManager, type PostHogCredentials, type FieldMapping } from './credentialManager.js';
import { discoverSchema, generateFieldMapping } from './schemaMapper.js';

export class QAPilotViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'qapilot.logsView';
  private _view?: vscode.WebviewView;
  private _logs: LogEntry[] = [];
  private _pollTimer: ReturnType<typeof setInterval> | null = null;
  private _pollingStatus: PollingStatus = 'stopped';
  private _pollingError: string = '';
  private _lastCreatedAt: string | null = null;
  private _seenUuids: Set<string> = new Set();
  private _isFetching = false;
  private _totalPolled = 0;
  private _totalSkipped = 0;
  private _pollCycles = 0;
  private _insightInterval: ReturnType<typeof setInterval> | null = null;
  private _lastInsightTime: number = 0;
  private readonly INSIGHT_INTERVAL_MS = 30000;
  private _lastSummary: string = '';
  private _consecutiveEmptyCycles: number = 0;
  private readonly MAX_EMPTY_CYCLES = 2;
  private _knownInsightCategories: Set<string> = new Set();
  private _credentials: PostHogCredentials | null = null;
  private _openaiKey: string | null = null;
  private _fieldMapping: FieldMapping | null = null;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _conversationStore: typeof ConversationStore,
    private readonly _credentialManager: CredentialManager,
  ) {}

  public async resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };

    this._credentials = await this._credentialManager.get();
    this._openaiKey = await this._credentialManager.getOpenAIKey();
    if (this._credentials) {
      this._fieldMapping = await this._credentialManager.getFieldMapping(this._credentials.projectId);
    }

    if (this._credentials && this._openaiKey) {
      this._showLogsView();
    } else if (this._credentials) {
      this._showOpenAISetupView();
    } else {
      this._showIntroView();
    }

    webviewView.webview.onDidReceiveMessage(data => {
      switch (data.type) {
        case 'refresh':
          this.refresh();
          break;
        case 'clear':
          this.clearLogs();
          break;
        case 'startPolling':
          this.startPolling();
          break;
        case 'stopPolling':
          this.stopPolling();
          break;
        case 'sendToAgent':
          this._sendLogsToAgent(data.logs);
          break;
        case 'nativeChatMessage':
          this._handleNativeChatMessage(
            data.logs, data.message, data.conversationId,
            data.goDeeper ? { windowStart: data.windowStart, windowEnd: data.windowEnd } : undefined
          );
          break;
        case 'listChats':
          this._handleListChats();
          break;
        case 'loadChat':
          this._handleLoadChat(data.conversationId);
          break;
        case 'deleteChat':
          this._handleDeleteChat(data.conversationId);
          break;
        case 'getStarted':
          this._showSetupView();
          break;
        case 'saveCredentials':
          this._handleSaveCredentials(data.apiKey, data.projectId);
          break;
        case 'saveOpenAIKey':
          this._handleSaveOpenAIKey(data.openaiKey);
          break;
        case 'resetPostHogKey':
          this._handleResetPostHogKey();
          break;
        case 'resetOpenAIKey':
          this._handleResetOpenAIKey();
          break;
        case 'refreshSchema':
          this._handleRefreshSchema();
          break;
        case 'goBackToLogs':
          this._handleGoBackToLogs();
          break;
        case 'disconnect':
          this._handleDisconnect();
          break;
      }
    });
  }

  // ── View Switching ─────────────────────────────────────────────────

  private _showIntroView() {
    if (!this._view) { return; }
    const logoUri = this._view.webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'qapilot-logo.png')
    ).toString();
    this._view.webview.html = getIntroHtml({ posthogLogoUri: logoUri });
  }

  private _showSetupView(options?: SetupHtmlOptions) {
    if (!this._view) { return; }
    const toUri = (file: string) =>
      this._view!.webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', file)).toString();
    this._view.webview.html = getSetupHtml({
      ...options,
      posthogLogomarkUri: toUri('posthog-logomark.svg'),
      platformIconUris: {
        datadog: toUri('datadog.svg'),
        sentry: toUri('sentry.svg'),
        grafana: toUri('grafana.svg'),
      },
    });
  }

  private _showOpenAISetupView(options?: OpenAISetupHtmlOptions) {
    if (!this._view) { return; }
    const toUri = (file: string) =>
      this._view!.webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', file)).toString();
    this._view.webview.html = getOpenAISetupHtml({
      ...options,
      openaiLogoUri: toUri('openai.svg'),
      anthropicLogoUri: toUri('anthropic.svg'),
      geminiLogoUri: toUri('gemini.svg'),
    });
  }

  private _showLogsView() {
    if (!this._view) { return; }
    this._view.webview.html = getWebviewHtml({
      pollingStatus: this._pollingStatus,
      pollingError: this._pollingError,
      logs: this._logs
    });
  }

  private _showAnalyzingSchemaView() {
    if (!this._view) { return; }
    this._view.webview.html = getAnalyzingSchemaHtml();
  }

  /** Fetches sample events, asks LLM for field mapping, stores it. Uses null mapping on any failure. */
  private async _runSchemaMappingFlow(): Promise<void> {
    if (!this._credentials || !this._openaiKey) {
      this._fieldMapping = null;
      return;
    }
    this._showAnalyzingSchemaView();
    try {
      let schemaInfo: Awaited<ReturnType<typeof discoverSchema>> = null;
      try {
        schemaInfo = await discoverSchema(this._credentials);
      } catch (err) {
        log(`Schema discovery failed, using fallback mapping: ${err instanceof Error ? err.message : String(err)}`);
        this._fieldMapping = null;
        return;
      }
      const mapping = await generateFieldMapping(schemaInfo, this._openaiKey);
      if (mapping) {
        await this._credentialManager.storeFieldMapping(this._credentials.projectId, mapping);
        this._fieldMapping = mapping;
      } else {
        this._fieldMapping = null;
        log('Field mapping not generated (empty schema or OpenAI failure), using fallback');
        void vscode.window.showWarningMessage(
          'QAPilot could not generate a custom field mapping. Using default property names (log_message, level, etc.). If your events use different property keys, logs may not display correctly.'
        );
      }
    } catch (err) {
      log(`Schema mapping flow error: ${err instanceof Error ? err.message : String(err)}`);
      this._fieldMapping = null;
    }
  }

  private async _handleSaveCredentials(apiKey: string, projectId: string) {
    try {
      const testCreds: PostHogCredentials = { apiKey, projectId };
      const testQuery = 'SELECT 1';
      await callApi('hogql_query', { query: testQuery }, testCreds);

      await this._credentialManager.store(apiKey, projectId);
      this._credentials = testCreds;

      this._view?.webview.postMessage({ type: 'credentialResult', success: true });
      log('PostHog credentials saved successfully');

      await new Promise(resolve => setTimeout(resolve, 800));

      const existingOpenAIKey = await this._credentialManager.getOpenAIKey();
      if (existingOpenAIKey) {
        this._openaiKey = existingOpenAIKey;
        await this._runSchemaMappingFlow();
        this._showLogsView();
        this.startPolling();
      } else {
        this._showOpenAISetupView();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`Credential validation failed: ${msg}`);
      this._view?.webview.postMessage({
        type: 'credentialResult',
        success: false,
        error: `Connection failed: ${msg}`
      });
    }
  }

  private async _handleSaveOpenAIKey(openaiKey: string) {
    try {
      await this._credentialManager.storeOpenAIKey(openaiKey);
      this._openaiKey = openaiKey;

      this._view?.webview.postMessage({ type: 'openaiKeyResult', success: true });
      log('OpenAI API key saved successfully');

      await new Promise(resolve => setTimeout(resolve, 800));
      await this._runSchemaMappingFlow();
      this._showLogsView();
      this.startPolling();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`Failed to save OpenAI key: ${msg}`);
      this._view?.webview.postMessage({
        type: 'openaiKeyResult',
        success: false,
        error: `Failed to save key: ${msg}`
      });
    }
  }

  private async _handleResetPostHogKey() {
    this.stopPolling();
    const creds = await this._credentialManager.get();
    this._showSetupView({
      prefilledApiKey: creds?.apiKey,
      prefilledProjectId: creds?.projectId,
      showBackButton: true
    });
    log('Showing PostHog setup to change key');
  }

  private async _handleResetOpenAIKey() {
    this.stopPolling();
    const openaiKey = await this._credentialManager.getOpenAIKey();
    this._showOpenAISetupView({
      prefilledOpenAIKey: openaiKey ?? undefined,
      showBackButton: true
    });
    log('Showing OpenAI setup to change key');
  }

  private async _handleRefreshSchema() {
    if (!this._credentials || !this._openaiKey) {
      void vscode.window.showWarningMessage('PostHog and OpenAI keys are required to refresh schema.');
      return;
    }
    await this._runSchemaMappingFlow();
    // Re-parse all existing logs with the new mapping so they render with the updated schema
    if (this._fieldMapping && this._logs.length > 0) {
      this._logs = this._logs.map((entry) => reparseLogEntry(entry, this._fieldMapping));
      log(`Re-parsed ${this._logs.length} existing log(s) with new schema mapping`);
    }
    this._showLogsView();
    void vscode.window.showInformationMessage('Schema mapping refreshed. All logs now use the updated mapping.');
    log('Schema mapping refreshed by user');
  }

  private _handleGoBackToLogs() {
    this._showLogsView();
    this.startPolling();
    log('Returned to logs view');
  }

  private async _handleDisconnect() {
    this.stopPolling();
    const projectId = this._credentials?.projectId;
    if (projectId) {
      await this._credentialManager.clearFieldMapping(projectId);
    }
    await this._credentialManager.clear();
    this._credentials = null;
    this._openaiKey = null;
    this._fieldMapping = null;
    this._logs = [];
    this._seenUuids.clear();
    this._lastCreatedAt = null;
    this._showIntroView();
    log('Disconnected — credentials cleared');
  }

  /** Clears all credentials and shows the welcome screen (for testing or starting over). */
  public async resetToWelcome(): Promise<void> {
    await this._handleDisconnect();
  }

  public async hasCredentials(): Promise<boolean> {
    this._credentials = await this._credentialManager.get();
    return this._credentials !== null;
  }

  // ── Polling ───────────────────────────────────────────────────────

  private _currentTimestamp(offsetSeconds: number = 0): string {
    const d = new Date();
    if (offsetSeconds) { d.setSeconds(d.getSeconds() - offsetSeconds); }
    return d.toISOString().replace('T', ' ').substring(0, 19);
  }

  public async startPolling() {
    if (!this._credentials) {
      log('Cannot start polling — no credentials configured');
      return;
    }
    if (this._pollTimer) {
      log('Polling already active');
      return;
    }

    if (!this._openaiKey) {
      this._openaiKey = await this._credentialManager.getOpenAIKey();
    }

    if (!this._fieldMapping) {
      this._fieldMapping = await this._credentialManager.getFieldMapping(this._credentials.projectId);
      log(`Loaded field mapping from storage: ${this._fieldMapping ? JSON.stringify(this._fieldMapping) : 'NULL'}`);
    } else {
      log(`Field mapping already in memory: ${JSON.stringify(this._fieldMapping)}`);
    }

    if (!this._fieldMapping && this._openaiKey) {
      log('No stored field mapping found — running schema mapping before first poll');
      await this._runSchemaMappingFlow();
      this._showLogsView();
    }

    this._pollingStatus = 'starting';
    this._pollingError = '';
    this._updateWebviewStatus();

    if (!this._lastCreatedAt) {
      this._lastCreatedAt = this._currentTimestamp(5);
      log(`Starting from 5 seconds ago: ${this._lastCreatedAt}`);
    }

    this._poll();

    this._pollTimer = setInterval(() => this._poll(), POLL_INTERVAL_MS);

    this._pollingStatus = 'active';
    this._updateWebviewStatus();
    log('Polling started (every 5 seconds)');

    this._startInsightGeneration();
  }

  public stopPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
    this._stopInsightGeneration();
    this._pollingStatus = 'stopped';
    this._updateWebviewStatus();
    log('Polling stopped');
  }

  // ── Insight Generation ───────────────────────────────────────────

  private _startInsightGeneration(): void {
    this._stopInsightGeneration();
    this._lastInsightTime = Date.now();
    this._insightInterval = setInterval(async () => {
      await this._generateInsights();
    }, this.INSIGHT_INTERVAL_MS);
    log('Started insight generation (every 30 seconds)');
  }

  private _stopInsightGeneration(): void {
    if (this._insightInterval) {
      clearInterval(this._insightInterval);
      this._insightInterval = null;
      log('Stopped insight generation');
    }
  }

  private async _generateInsights(): Promise<void> {
    if (!this._credentials) { return; }

    const now = new Date();
    const safeEnd = new Date(now.getTime() - VISIBILITY_DELAY_S * 1000);
    const startTime = new Date(this._lastInsightTime);
    this._lastInsightTime = safeEnd.getTime();
    const endTs = safeEnd.toISOString();
    const startTs = startTime.toISOString();

    log(`Fetching & analyzing logs from ${startTs} to ${endTs}...`);

    try {
      const body = JSON.stringify({
        platform: 'posthog',
        start_ts: startTs,
        end_ts: endTs,
        previous_summary: this._lastSummary || 'System was stable, no anomalies detected.',
        credentials: this._credentials,
        openai_api_key: this._openaiKey
      });

      const startFmt = startTs.replace('T', ' ').substring(0, 19);
      const endFmt = endTs.replace('T', ' ').substring(0, 19);
      const sourceLogIds = this._logs
        .filter(l => !l.isInsight && l.timestamp >= startFmt && l.timestamp <= endFmt)
        .map(l => l.uuid);

      const result = await new Promise<string>((resolve, reject) => {
        const req = https.request(
          {
            hostname: '4uyj2dfeujg7r6rhg3nvdkrwfy0schxe.lambda-url.us-east-1.on.aws',
            path: '/fetch_and_analyze',
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
            timeout: 60000
          },
          (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => resolve(data));
          }
        );
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
        req.write(body);
        req.end();
      });

      interface AnalyzeInsight {
        category: string;
        icon_color: string;
        icon_url: string;
        insight_type: string;
        level1: string;
        level2_markdown: string;
      }
      interface AnalyzeResponse {
        insights: AnalyzeInsight[];
        neutral_summary: string;
        total_logs?: number;
      }

      const response: AnalyzeResponse = JSON.parse(result);
      log(`Analyzer returned ${response.total_logs ?? '?'} logs, ${response.insights?.length ?? 0} insight(s)`);

      if (response.neutral_summary) {
        this._lastSummary = response.neutral_summary;
      }

      const hasSubstantiveLogs = (response.total_logs ?? 0) > 1;

      if (!hasSubstantiveLogs) {
        this._consecutiveEmptyCycles++;
        log(`No substantive logs from service (empty cycle ${this._consecutiveEmptyCycles}/${this.MAX_EMPTY_CYCLES})`);
        if (this._consecutiveEmptyCycles >= this.MAX_EMPTY_CYCLES) {
          log('Circuit breaker: stopping insight generation — no logs from service');
          this._stopInsightGeneration();
          this._lastSummary = '';
        }
        return;
      }

      this._consecutiveEmptyCycles = 0;

      const actionableInsights = (response.insights || []).filter(i =>
        i.category?.toLowerCase() !== 'no anomaly'
      );

      if (actionableInsights.length === 0) {
        log('Only "No Anomaly" insights — skipping UI cards');
        return;
      }

      const newCategories: string[] = [];

      for (const insight of actionableInsights) {
        const category = insight.category || 'Insight';
        const normalizedCategory = category.toLowerCase().replace(/\s+/g, '-');

        if (!this._knownInsightCategories.has(normalizedCategory)) {
          this._knownInsightCategories.add(normalizedCategory);
          newCategories.push(category);
        }

        const insightLog: LogEntry = {
          uuid: `insight-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          event: 'AI Insight',
          timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
          distinctId: 'llm-analyzer',
          logLevel: category,
          logEventType: 'AI',
          logMessage: insight.level1,
          personId: '',
          properties: {},
          receivedAt: Date.now(),
          sourceLogIds,
          windowStart: startTs,
          windowEnd: endTs,
          isInsight: true,
          insightCategory: category,
          insightColor: insight.icon_color,
          insightType: insight.insight_type,
          insightIconUrl: insight.icon_url,
          level2Markdown: insight.level2_markdown
        };

        this._logs.push(insightLog);
        this._sendLogToWebview(insightLog);
      }

      if (newCategories.length > 0) {
        this._sendNewInsightCategories(newCategories);
      }

      log(`Generated ${actionableInsights.length} actionable insight(s) from analyzer`);
    } catch (error) {
      log(`Failed to generate insights: ${error}`);
    }
  }

  private _sendNewInsightCategories(categories: string[]) {
    if (this._view) {
      this._view.webview.postMessage({
        type: 'newInsightCategories',
        categories
      });
    }
  }

  // ── Poll Cycle ──────────────────────────────────────────────────

  private async _poll(): Promise<void> {
    this._pollCycles++;
    if (this._isFetching) {
      this._totalSkipped++;
      log(`Poll #${this._pollCycles} skipped (still fetching). Total: ${this._totalPolled} polled, ${this._totalSkipped} skipped`);
      return;
    }
    this._isFetching = true;
    try {
      await this._fetchLogs();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`Poll #${this._pollCycles} error: ${msg}`);
      this._pollingError = msg;
      this._pollingStatus = 'error';
      this._updateWebviewStatus();
    } finally {
      this._isFetching = false;
    }
  }

  private async _fetchLogs(): Promise<void> {
    if (!this._credentials) { throw new Error('No credentials'); }

    const nowTs = this._currentTimestamp(VISIBILITY_DELAY_S);
    const query = `SELECT uuid, event, timestamp, created_at, distinct_id, properties FROM events WHERE created_at > '${this._lastCreatedAt}' AND created_at <= '${nowTs}' ORDER BY created_at ASC LIMIT 100`;

    const response = await callApi('hogql_query', { query }, this._credentials);

    if (!response || !response.data) {
      log('API returned no data');
      return;
    }

    const results: unknown[][] = (response.data.results as unknown[][]) || [];
    if (results.length === 0) {
      log(`No events after ${this._lastCreatedAt}`);
      return;
    }

    log(`Got ${results.length} event(s) after ${this._lastCreatedAt}`);
    log(`Field mapping in use: ${this._fieldMapping ? JSON.stringify(this._fieldMapping) : 'NULL'}`);
    const rows = results;

    let newCount = 0;
    for (const row of rows) {
      const entry = parseRow(row, this._fieldMapping);
      if (!entry || !entry.uuid) { continue; }
      if (this._seenUuids.has(entry.uuid)) { continue; }

      this._seenUuids.add(entry.uuid);
      this._logs.push(entry);
      this._sendLogToWebview(entry);
      newCount++;

      const rowCreatedAt = formatTimestamp(String(row[3] || ''));
      if (!this._lastCreatedAt || rowCreatedAt > this._lastCreatedAt) {
        this._lastCreatedAt = rowCreatedAt;
      }
    }

    if (this._logs.length > MAX_LOGS) {
      const removed = this._logs.splice(0, this._logs.length - MAX_LOGS);
      for (const r of removed) { this._seenUuids.delete(r.uuid); }
    }

    this._totalPolled += newCount;
    log(`Poll #${this._pollCycles}: +${newCount} new, ${results.length} returned, ${results.length - newCount} deduped | Total polled: ${this._totalPolled}, cursor: ${this._lastCreatedAt}`);

    if (newCount > 0) {
      if (!this._insightInterval) {
        this._consecutiveEmptyCycles = 0;
        this._startInsightGeneration();
      }
    }

    if (this._pollingStatus === 'error') {
      this._pollingStatus = 'active';
      this._pollingError = '';
      this._updateWebviewStatus();
    }
  }

  // ── Webview Communication ─────────────────────────────────────────

  private _sendLogToWebview(entry: LogEntry) {
    if (this._view) {
      this._view.webview.postMessage({ type: 'newLog', log: entry });
    }
  }

  private _updateWebviewStatus() {
    if (this._view) {
      this._view.webview.postMessage({
        type: 'pollingStatus',
        status: this._pollingStatus,
        error: this._pollingError
      });
    }
  }

  public refresh() {
    this._lastCreatedAt = this._currentTimestamp(5);
    this._seenUuids.clear();
    this._logs = [];
    if (this._view) {
      this._view.webview.postMessage({ type: 'clearLogs' });
    }
    this._poll();
    log(`Refreshed — watching for new logs from ${this._lastCreatedAt}`);
  }

  public clearLogs() {
    this._logs = [];
    this._seenUuids.clear();
    this._lastCreatedAt = this._currentTimestamp(5);
    if (this._view) {
      this._view.webview.postMessage({ type: 'clearLogs' });
    }
    vscode.window.showInformationMessage('Logs cleared');
  }

  // ── Native Chat ──────────────────────────────────────────────────

  private async _handleNativeChatMessage(
    logs: LogEntry[],
    message: string,
    conversationId: string,
    goDeeperInfo?: { windowStart: string; windowEnd: string }
  ) {
    try {
      const existingContext = await this._conversationStore.load(conversationId);
      const isFollowUp = !!existingContext;

      let body: string;
      let path: string;

      if (isFollowUp) {
        path = '/deep_insight/chat';
        body = JSON.stringify({
          question: message,
          conversation_context: existingContext,
          openai_api_key: this._openaiKey
        });
      } else if (goDeeperInfo && this._credentials) {
        path = '/fetch_and_deep_insight';
        body = JSON.stringify({
          platform: 'posthog',
          start_ts: goDeeperInfo.windowStart,
          end_ts: goDeeperInfo.windowEnd,
          question: message,
          credentials: this._credentials,
          openai_api_key: this._openaiKey
        });
      } else {
        path = '/deep_insight';
        const formattedLogs = logs.map(l =>
          `[${l.logLevel}] ${l.timestamp} [${l.logEventType}] ${l.logMessage}`
        ).join('\n');
        body = JSON.stringify({
          logs_text: formattedLogs,
          question: message,
          openai_api_key: this._openaiKey
        });
      }

      log(`Chat ${isFollowUp ? 'follow-up' : 'initial'} → ${path}`);

      const result = await new Promise<string>((resolve, reject) => {
        const req = https.request(
          {
            hostname: '4uyj2dfeujg7r6rhg3nvdkrwfy0schxe.lambda-url.us-east-1.on.aws',
            path,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
            timeout: 120000
          },
          (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
              if (res.statusCode && res.statusCode >= 400) {
                reject(new Error(`Server returned ${res.statusCode}: ${data}`));
              } else {
                resolve(data);
              }
            });
          }
        );
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
        req.write(body);
        req.end();
      });

      let content: string;
      try {
        const parsed = JSON.parse(result);

        if (parsed.conversation_context) {
          const title = isFollowUp ? undefined : message.substring(0, 60);
          await this._conversationStore.save(conversationId, parsed.conversation_context, title);
        }

        if (parsed.markdown) {
          content = parsed.markdown;
        } else {
          content = parsed.answer || parsed.response || parsed.message || parsed.content || result;
        }
      } catch {
        content = result;
      }

      this._sendChatResponse(conversationId, content, false);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log(`Chat error: ${msg}`);
      this._sendChatResponse(conversationId, `Failed to get response: ${msg}`, true);
    }
  }

  private _sendChatResponse(conversationId: string, content: string, isError: boolean) {
    if (this._view) {
      this._view.webview.postMessage({
        type: 'chatResponse',
        conversationId,
        content,
        isError
      });
    }
  }

  // ── Chat History ─────────────────────────────────────────────────

  private _handleListChats() {
    const chats = this._conversationStore.listAll();
    this._view?.webview.postMessage({ type: 'chatList', chats });
  }

  private async _handleLoadChat(conversationId: string) {
    const context = await this._conversationStore.load(conversationId);
    if (!context) {
      this._view?.webview.postMessage({
        type: 'chatLoaded',
        conversationId,
        messages: [],
        error: 'Conversation not found',
      });
      return;
    }

    const messages = (context as { messages?: { role: string; content: string }[] }).messages || [];
    this._view?.webview.postMessage({
      type: 'chatLoaded',
      conversationId,
      messages,
    });
  }

  private async _handleDeleteChat(conversationId: string) {
    await this._conversationStore.remove(conversationId);
    this._handleListChats();
  }

  // ── Send to Agent ─────────────────────────────────────────────────

  private async _sendLogsToAgent(logs: LogEntry[]) {
    if (!logs || logs.length === 0) {
      vscode.window.showWarningMessage('No logs selected');
      return;
    }

    const formattedLogs = logs
      .map(l => `[${l.logLevel}] ${l.timestamp} [${l.logEventType}] ${l.logMessage}`)
      .join('\n');

    const prompt = `I found the following logs in my PostHog data. Can you help me identify and fix any issues?\n\n\`\`\`\n${formattedLogs}\n\`\`\``;

    await vscode.env.clipboard.writeText(prompt);

    const allCommands = await vscode.commands.getCommands(true);
    const chatCommands = [
      'workbench.action.chat.open',
      'workbench.action.chat.newChat',
      'composer.openNewComposer',
      'aichat.newchataction'
    ];

    for (const cmd of chatCommands) {
      if (allCommands.includes(cmd)) {
        try {
          await vscode.commands.executeCommand(cmd);
          await new Promise(resolve => setTimeout(resolve, 400));

          try {
            await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
            vscode.window.showInformationMessage(`Sent ${logs.length} log(s) to chat`);
            return;
          } catch {
            // paste failed, continue
          }
          break;
        } catch {
          // continue
        }
      }
    }

    vscode.window.showInformationMessage(
      `${logs.length} log(s) copied! Press Cmd+L to open chat, then Cmd+V to paste`
    );
  }
}
