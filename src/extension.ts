import * as vscode from 'vscode';
import * as http from 'http';
import * as https from 'https';

const API_URL = 'https://us6krurah3.execute-api.eu-north-1.amazonaws.com/prod/api/posthog';
const POLL_INTERVAL_MS = 3000;
const MAX_LOGS = 500;

function log(message: string): void {
  const timestamp = new Date().toISOString().substring(11, 19);
  console.log(`[QAPilot][${timestamp}]`, message);
}

interface LogEntry {
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
  insightType?: 'universal' | 'sub';
  level2Markdown?: string;
  sourceLogIds?: string[];
}

type PollingStatus = 'stopped' | 'starting' | 'active' | 'error';

class QAPilotViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'qapilot.logsView';
  private _view?: vscode.WebviewView;
  private _logs: LogEntry[] = [];
  private _pollTimer: ReturnType<typeof setInterval> | null = null;
  private _pollingStatus: PollingStatus = 'stopped';
  private _pollingError: string = '';
  private _lastTimestamp: string | null = null;
  private _seenUuids: Set<string> = new Set();
  private _isFetching = false;
  private _insightInterval: ReturnType<typeof setInterval> | null = null;
  private _lastInsightTime: number = 0;
  private readonly INSIGHT_INTERVAL_MS = 30000;
  private _lastSummary: string = '';
  private _consecutiveEmptyCycles: number = 0;
  private readonly MAX_EMPTY_CYCLES = 2;
  private _knownInsightCategories: Set<string> = new Set();

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };

    webviewView.webview.html = this._getHtmlContent();

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
      }
    });
  }

  // ── Polling ───────────────────────────────────────────────────────

  public startPolling() {
    if (this._pollTimer) {
      log('Polling already active');
      return;
    }

    this._pollingStatus = 'starting';
    this._pollingError = '';
    this._updateWebviewStatus();

    this._poll();

    this._pollTimer = setInterval(() => this._poll(), POLL_INTERVAL_MS);

    this._pollingStatus = 'active';
    this._updateWebviewStatus();
    log('Polling started (every 3 seconds)');

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
    const now = Date.now();
    const cutoffTime = now - this.INSIGHT_INTERVAL_MS;

    const recentLogs = this._logs.filter(l =>
      l.receivedAt && l.receivedAt >= cutoffTime && !l.isInsight
    );

    if (recentLogs.length === 0) {
      this._consecutiveEmptyCycles++;
      log(`No new logs in the last 30s (empty cycle ${this._consecutiveEmptyCycles}/${this.MAX_EMPTY_CYCLES})`);
      if (this._consecutiveEmptyCycles >= this.MAX_EMPTY_CYCLES) {
        log('Circuit breaker: stopping insight generation');
        this._stopInsightGeneration();
        this._lastSummary = '';
      }
      return;
    }

    this._consecutiveEmptyCycles = 0;
    log(`Generating insights for ${recentLogs.length} logs...`);

    const logsText = recentLogs.map(l =>
      `${l.timestamp} - ${l.logTag} - ${l.logLevel} - ${l.logMessage}`
    ).join('\n');

    const sourceLogIds = recentLogs.map(l => l.uuid);

    try {
      const body = JSON.stringify({
        logs_text: logsText,
        previous_summary: this._lastSummary
      });

      const result = await new Promise<string>((resolve, reject) => {
        const req = http.request(
          {
            hostname: '3.228.128.128',
            port: 80,
            path: '/agent/analyze',
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
            timeout: 30000
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
        insight_type: 'universal' | 'sub';
        level1: string;
        level2_markdown: string;
      }
      interface AnalyzeResponse {
        insights: AnalyzeInsight[];
        neutral_summary: string;
      }

      const response: AnalyzeResponse = JSON.parse(result);

      if (response.neutral_summary) {
        this._lastSummary = response.neutral_summary;
      }

      if (!response.insights || response.insights.length === 0) {
        log('No insights returned from analyzer');
        return;
      }

      const newCategories: string[] = [];

      for (const insight of response.insights) {
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
          logTag: 'AI',
          logMessage: insight.level1,
          personId: '',
          properties: {},
          receivedAt: Date.now(),
          sourceLogIds,
          isInsight: true,
          insightCategory: category,
          insightColor: insight.icon_color,
          insightType: insight.insight_type,
          level2Markdown: insight.level2_markdown
        };

        this._logs.push(insightLog);
        this._sendLogToWebview(insightLog);
      }

      if (newCategories.length > 0) {
        this._sendNewInsightCategories(newCategories);
      }

      log(`Generated ${response.insights.length} insight(s) from analyzer`);
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

  private async _poll(): Promise<void> {
    if (this._isFetching) { return; }
    this._isFetching = true;
    try {
      await this._fetchLogs();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`Poll error: ${msg}`);
      this._pollingError = msg;
      this._pollingStatus = 'error';
      this._updateWebviewStatus();
    } finally {
      this._isFetching = false;
    }
  }

  private async _fetchLogs(): Promise<void> {
    let query: string;
    if (this._lastTimestamp) {
      query = `SELECT uuid, event, timestamp, distinct_id, properties FROM events WHERE timestamp > '${this._lastTimestamp}' ORDER BY timestamp ASC LIMIT 100`;
    } else {
      query = `SELECT uuid, event, timestamp, distinct_id, properties FROM events ORDER BY timestamp DESC LIMIT 100`;
    }

    const response = await this._callApi('hogql_query', { query });

    if (!response || !response.data) {
      return;
    }

    const results: unknown[][] = (response.data.results as unknown[][]) || [];
    if (results.length === 0) { return; }

    // First fetch returns DESC order — reverse so oldest is first
    const rows = this._lastTimestamp ? results : [...results].reverse();

    let newCount = 0;
    for (const row of rows) {
      const entry = this._parseRow(row);
      if (!entry || !entry.uuid) { continue; }
      if (this._seenUuids.has(entry.uuid)) { continue; }

      this._seenUuids.add(entry.uuid);
      this._logs.push(entry);
      this._sendLogToWebview(entry);
      newCount++;

      // Track latest timestamp for incremental polls
      if (!this._lastTimestamp || entry.timestamp > this._lastTimestamp) {
        this._lastTimestamp = entry.timestamp;
      }
    }

    // Cap stored logs
    if (this._logs.length > MAX_LOGS) {
      const removed = this._logs.splice(0, this._logs.length - MAX_LOGS);
      for (const r of removed) { this._seenUuids.delete(r.uuid); }
    }

    if (newCount > 0) {
      log(`Fetched ${newCount} new log(s)`);

      if (!this._insightInterval) {
        this._consecutiveEmptyCycles = 0;
        this._startInsightGeneration();
      }
    }

    // Clear any previous error on success
    if (this._pollingStatus === 'error') {
      this._pollingStatus = 'active';
      this._pollingError = '';
      this._updateWebviewStatus();
    }
  }

  // ── API ───────────────────────────────────────────────────────────

  private _callApi(action: string, params: Record<string, unknown>): Promise<{ data: Record<string, unknown> }> {
    const body = JSON.stringify({ action, params });

    return new Promise((resolve, reject) => {
      const url = new URL(API_URL);
      const req = https.request(
        {
          hostname: url.hostname,
          port: 443,
          path: url.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body)
          }
        },
        (res) => {
          let data = '';
          res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
          res.on('end', () => {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(new Error(`Invalid JSON from API: ${data.substring(0, 200)}`));
            }
          });
        }
      );
      req.on('error', reject);
      req.setTimeout(10000, () => { req.destroy(new Error('API request timeout')); });
      req.write(body);
      req.end();
    });
  }

  // ── Log Parsing ───────────────────────────────────────────────────

  private _parseRow(row: unknown[]): LogEntry | null {
    if (!row || row.length < 4) { return null; }
    const [rawUuid, rawEvent, rawTimestamp, rawDistinctId, rawProps] = row;

    let properties: Record<string, unknown> = {};
    if (typeof rawProps === 'string') {
      try { properties = JSON.parse(rawProps); } catch { properties = {}; }
    } else if (typeof rawProps === 'object' && rawProps !== null) {
      properties = rawProps as Record<string, unknown>;
    }

    const event = String(rawEvent || '');
    const logLevel = String(properties.log_level || properties.level || 'INFO').toUpperCase();
    const logTag = String(properties.log_tag || properties.tag || properties.source || '');
    const logMessage = this._extractMessage(event, properties);

    return {
      uuid: String(rawUuid || ''),
      event,
      timestamp: this._formatTimestamp(String(rawTimestamp || '')),
      distinctId: String(rawDistinctId || ''),
      logLevel,
      logTag,
      logMessage,
      personId: String(properties.person_id || rawDistinctId || ''),
      properties,
      receivedAt: Date.now()
    };
  }

  private _extractMessage(event: string, properties: Record<string, unknown>): string {
    if (properties.log_message) { return String(properties.log_message); }
    if (properties.message) { return String(properties.message); }

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

  private _formatTimestamp(ts: string): string {
    if (!ts) { return ''; }
    return ts.replace('T', ' ').substring(0, 19);
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
    this._lastTimestamp = null;
    this._seenUuids.clear();
    this._logs = [];
    if (this._view) {
      this._view.webview.postMessage({ type: 'clearLogs' });
    }
    this._poll();
    log('Refreshed — refetching all logs');
  }

  public clearLogs() {
    this._logs = [];
    this._seenUuids.clear();
    this._lastTimestamp = null;
    if (this._view) {
      this._view.webview.postMessage({ type: 'clearLogs' });
    }
    vscode.window.showInformationMessage('Logs cleared');
  }

  // ── Send to Agent ─────────────────────────────────────────────────

  private async _sendLogsToAgent(logs: LogEntry[]) {
    if (!logs || logs.length === 0) {
      vscode.window.showWarningMessage('No logs selected');
      return;
    }

    const formattedLogs = logs
      .map(l => `[${l.logLevel}] ${l.timestamp} [${l.logTag}] ${l.logMessage}`)
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

  // ── Webview HTML ──────────────────────────────────────────────────

  private _getHtmlContent(): string {
    const hasError = this._pollingStatus === 'error';

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: var(--vscode-editor-font-family), 'Fira Code', 'Consolas', monospace;
          font-size: 12px;
          color: var(--vscode-foreground);
          background: var(--vscode-panel-background);
          padding: 8px;
          line-height: 1.5;
        }

        /* Header */
        .header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 12px;
          padding-bottom: 8px;
          border-bottom: 1px solid var(--vscode-panel-border);
        }
        .header h2 {
          font-size: 13px;
          font-weight: 600;
          color: var(--vscode-foreground);
          font-family: var(--vscode-font-family);
        }
        .spacer { flex: 1; }
        .btn {
          background: var(--vscode-button-secondaryBackground);
          color: var(--vscode-button-secondaryForeground);
          border: none;
          padding: 4px 8px;
          font-size: 11px;
          cursor: pointer;
          border-radius: 3px;
          font-family: var(--vscode-font-family);
        }
        .btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
        .btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .btn-primary {
          background: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
        }
        .btn-primary:hover { background: var(--vscode-button-hoverBackground); }

        /* Error Banner */
        .error-banner {
          background: rgba(248, 81, 73, 0.15);
          border: 1px solid rgba(248, 81, 73, 0.4);
          border-radius: 4px;
          padding: 12px;
          margin-bottom: 12px;
          color: #f85149;
          font-size: 12px;
          font-family: var(--vscode-font-family);
        }
        .error-banner button {
          background: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          border: none;
          padding: 4px 12px;
          font-size: 11px;
          cursor: pointer;
          border-radius: 3px;
          margin-top: 8px;
          font-family: var(--vscode-font-family);
        }
        .error-banner button:hover { background: var(--vscode-button-hoverBackground); }

        /* Filter Bar */
        .filter-bar {
          display: flex;
          gap: 8px;
          margin-bottom: 12px;
          padding: 8px;
          background: var(--vscode-sideBar-background);
          border-radius: 4px;
          align-items: center;
          flex-wrap: wrap;
        }
        .search-container {
          flex: 1;
          min-width: 150px;
          position: relative;
        }
        .search-input {
          width: 100%;
          padding: 6px 10px 6px 28px;
          border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
          background: var(--vscode-input-background);
          color: var(--vscode-input-foreground);
          border-radius: 4px;
          font-size: 12px;
          font-family: var(--vscode-font-family);
        }
        .search-input:focus { outline: none; border-color: var(--vscode-focusBorder); }
        .search-input::placeholder { color: var(--vscode-input-placeholderForeground); }
        .search-icon {
          position: absolute;
          left: 8px;
          top: 50%;
          transform: translateY(-50%);
          font-size: 12px;
          opacity: 0.6;
          pointer-events: none;
        }
        .filter-select {
          padding: 6px 10px;
          border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
          background: var(--vscode-dropdown-background);
          color: var(--vscode-dropdown-foreground);
          border-radius: 4px;
          font-size: 12px;
          font-family: var(--vscode-font-family);
          cursor: pointer;
          min-width: 90px;
        }
        .filter-select:focus { outline: none; border-color: var(--vscode-focusBorder); }
        .filter-label {
          font-size: 11px;
          color: var(--vscode-descriptionForeground);
          font-family: var(--vscode-font-family);
        }
        .result-count {
          font-size: 11px;
          color: var(--vscode-descriptionForeground);
          font-family: var(--vscode-font-family);
          white-space: nowrap;
        }
        .highlight {
          background: rgba(255, 213, 0, 0.3);
          border-radius: 2px;
        }

        /* Virtual scroll indicators */
        .window-indicator {
          text-align: center;
          padding: 10px 12px;
          font-size: 11px;
          color: var(--vscode-textLink-foreground);
          font-family: var(--vscode-font-family);
          opacity: 0.85;
          border-radius: 4px;
          margin-bottom: 8px;
          user-select: none;
          cursor: pointer;
          transition: opacity 0.2s ease, background 0.2s ease;
        }
        .window-indicator:hover {
          opacity: 1;
          background: var(--vscode-list-hoverBackground);
        }
        .window-indicator .indicator-arrow {
          display: inline-block;
          animation: bounce 1.5s ease infinite;
          margin-right: 4px;
        }
        .window-indicator.top .indicator-arrow { animation-name: bounceUp; }
        .window-indicator.bottom .indicator-arrow { animation-name: bounceDown; }
        @keyframes bounceUp {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-3px); }
        }
        @keyframes bounceDown {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(3px); }
        }

        .logs-container {
          max-height: calc(100vh - 140px);
          overflow-y: auto;
          position: relative;
        }

        /* Scroll to Bottom Button */
        .scroll-to-bottom-container {
          position: fixed;
          bottom: 80px;
          left: 50%;
          transform: translateX(-50%) scale(0.8);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          z-index: 100;
          opacity: 0;
          transition: opacity 0.2s ease, transform 0.2s ease;
          pointer-events: none;
        }
        .scroll-to-bottom-container.visible {
          opacity: 1;
          transform: translateX(-50%) scale(1);
          pointer-events: auto;
        }
        .new-logs-badge {
          background: linear-gradient(135deg, #059669 0%, #10b981 100%);
          color: white;
          font-size: 11px;
          font-weight: 600;
          padding: 4px 10px;
          border-radius: 12px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
          font-family: var(--vscode-font-family);
          white-space: nowrap;
          animation: badgePop 0.3s ease-out;
        }
        @keyframes badgePop {
          0% { transform: scale(0.5); opacity: 0; }
          50% { transform: scale(1.1); }
          100% { transform: scale(1); opacity: 1; }
        }
        .scroll-to-bottom {
          width: 36px; height: 36px;
          border-radius: 50%;
          background: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          border: none;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
          transition: background 0.2s ease, transform 0.2s ease;
        }
        .scroll-to-bottom:hover {
          background: var(--vscode-button-hoverBackground);
          transform: scale(1.1);
        }
        .scroll-to-bottom svg { width: 18px; height: 18px; }

        /* Log Card */
        .log-card {
          margin-bottom: 8px;
          border: 1px solid var(--vscode-panel-border);
          border-radius: 4px;
          background: var(--vscode-editor-background);
          overflow: hidden;
          cursor: pointer;
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .log-card:hover { border-color: var(--vscode-focusBorder); }
        .log-card.selected {
          border-color: var(--vscode-button-background);
          box-shadow: 0 0 0 1px var(--vscode-button-background);
          background: color-mix(in srgb, var(--vscode-button-background) 8%, var(--vscode-editor-background));
        }
        .log-card.new-log {
          animation: highlightNew 1.5s ease-out;
        }
        @keyframes highlightNew {
          0% { border-color: var(--vscode-focusBorder); box-shadow: 0 0 8px var(--vscode-focusBorder); }
          100% { border-color: var(--vscode-panel-border); box-shadow: none; }
        }

        /* Card Header */
        .log-header {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 8px 12px;
          background: var(--vscode-sideBar-background);
          border-bottom: 1px solid var(--vscode-panel-border);
          flex-wrap: wrap;
        }
        .log-checkbox {
          width: 16px; height: 16px;
          border-radius: 3px;
          border: 1.5px solid var(--vscode-checkbox-border, var(--vscode-panel-border));
          background: var(--vscode-checkbox-background, var(--vscode-input-background));
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          transition: all 0.15s;
        }
        .log-checkbox:hover { border-color: var(--vscode-focusBorder); }
        .log-checkbox.checked {
          background: var(--vscode-button-background);
          border-color: var(--vscode-button-background);
        }
        .log-checkbox.checked::after {
          content: '\\2713';
          color: var(--vscode-button-foreground);
          font-size: 11px;
          font-weight: bold;
        }
        .log-level {
          font-weight: 700;
          padding: 2px 8px;
          border-radius: 3px;
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .log-level.info { background: rgba(55, 148, 255, 0.2); color: #3794ff; }
        .log-level.debug { background: rgba(128, 128, 128, 0.2); color: var(--vscode-descriptionForeground); }
        .log-level.warn, .log-level.warning { background: rgba(204, 167, 0, 0.2); color: #cca700; }
        .log-level.error { background: rgba(241, 76, 76, 0.2); color: #f14c4c; }
        .log-level.critical { background: rgba(200, 20, 20, 0.3); color: #ff4444; }
        .log-timestamp { color: var(--vscode-descriptionForeground); font-size: 11px; }
        .log-tag { color: var(--vscode-textLink-foreground); font-weight: 600; }
        .log-event {
          color: var(--vscode-symbolIcon-functionForeground, #b180d7);
          margin-left: auto;
          font-size: 11px;
        }

        /* Card Body */
        .log-body { padding: 12px; }
        .log-message {
          font-size: 13px;
          line-height: 1.6;
          white-space: pre-wrap;
          word-break: break-word;
          color: var(--vscode-foreground);
        }

        /* Card Footer */
        .log-meta {
          padding: 8px 12px;
          background: var(--vscode-sideBar-background);
          border-top: 1px solid var(--vscode-panel-border);
          font-size: 10px;
          color: var(--vscode-descriptionForeground);
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 4px 16px;
        }
        .log-meta-item { display: flex; gap: 6px; }
        .log-meta-label { color: var(--vscode-descriptionForeground); opacity: 0.7; }
        .log-meta-value {
          color: var(--vscode-foreground);
          word-break: break-all;
          font-family: var(--vscode-editor-font-family), monospace;
        }

        .empty-state {
          text-align: center;
          padding: 60px 20px;
          color: var(--vscode-descriptionForeground);
          font-family: var(--vscode-font-family);
        }
        .empty-state p { margin: 8px 0; }
        .empty-state code {
          background: var(--vscode-textCodeBlock-background);
          padding: 2px 6px;
          border-radius: 3px;
          font-family: var(--vscode-editor-font-family), monospace;
        }

        /* Selection toolbar */
        .selection-toolbar {
          position: fixed;
          bottom: 16px;
          left: 50%;
          transform: translateX(-50%);
          background: var(--vscode-editor-background);
          border: 1px solid var(--vscode-panel-border);
          border-radius: 8px;
          padding: 8px 16px;
          display: flex;
          align-items: center;
          gap: 12px;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
          z-index: 1000;
          animation: slideUp 0.2s ease-out;
        }
        @keyframes slideUp {
          from { transform: translateX(-50%) translateY(20px); opacity: 0; }
          to { transform: translateX(-50%) translateY(0); opacity: 1; }
        }
        .selection-count {
          font-size: 12px;
          color: var(--vscode-foreground);
          font-family: var(--vscode-font-family);
          font-weight: 500;
        }
        .toolbar-divider {
          width: 1px; height: 20px;
          background: var(--vscode-panel-border);
        }
        .btn-send-agent {
          background: linear-gradient(135deg, #7c3aed 0%, #a855f7 100%);
          color: white;
          border: none;
          padding: 6px 14px;
          font-size: 12px;
          cursor: pointer;
          border-radius: 5px;
          font-family: var(--vscode-font-family);
          font-weight: 500;
          display: flex;
          align-items: center;
          gap: 6px;
          transition: all 0.15s;
        }
        .btn-send-agent:hover {
          background: linear-gradient(135deg, #6d28d9 0%, #9333ea 100%);
          transform: translateY(-1px);
        }
        .btn-send-agent:active { transform: translateY(0); }
        .btn-clear-selection {
          background: transparent;
          color: var(--vscode-descriptionForeground);
          border: none;
          padding: 6px 10px;
          font-size: 11px;
          cursor: pointer;
          border-radius: 4px;
          font-family: var(--vscode-font-family);
        }
        .btn-clear-selection:hover {
          background: var(--vscode-button-secondaryHoverBackground);
          color: var(--vscode-foreground);
        }

        /* Insight Cards */
        .log-card.insight-card {
          border: 2px solid var(--insight-color, var(--vscode-panel-border));
          background: var(--insight-bg, var(--vscode-editor-background));
        }
        .log-card.insight-card:hover {
          border-color: var(--insight-color, var(--vscode-focusBorder));
        }
        .log-card.insight-card.selected {
          box-shadow: 0 0 0 1px var(--insight-color, var(--vscode-button-background));
        }
        .log-level.insight-level {
          color: var(--insight-color, var(--vscode-foreground));
          background: var(--insight-btn-bg, rgba(128,128,128,0.2));
          border: 1px solid var(--insight-color, var(--vscode-panel-border));
        }
        .insight-type-badge {
          font-size: 9px;
          padding: 1px 6px;
          border-radius: 8px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          opacity: 0.8;
        }
        .insight-details-toggle {
          padding: 6px 12px 10px;
          display: flex;
          justify-content: flex-start;
        }
        .details-btn {
          background: var(--insight-btn-bg, rgba(128,128,128,0.2));
          color: var(--insight-color, var(--vscode-foreground));
          border: 1px solid var(--insight-color, var(--vscode-panel-border));
          border-radius: 4px;
          padding: 4px 12px;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s ease;
          letter-spacing: 0.3px;
          opacity: 0.85;
        }
        .details-btn:hover {
          opacity: 1;
          box-shadow: 0 0 6px var(--insight-btn-bg, rgba(128,128,128,0.3));
        }
        .details-btn:active { transform: scale(0.97); }
        .insight-level2 {
          padding: 0 12px;
          max-height: 0;
          overflow: hidden;
          transition: max-height 0.3s ease, padding 0.3s ease;
          font-size: 12px;
          line-height: 1.6;
          color: var(--vscode-foreground);
        }
        .insight-level2.expanded {
          max-height: 500px;
          padding: 10px 12px 12px;
          border-top: 1px solid var(--vscode-panel-border);
        }
        .insight-level2 strong { font-weight: 600; }
        .insight-level2 ul, .insight-level2 ol { margin: 6px 0; padding-left: 18px; }
        .insight-level2 li { margin: 3px 0; }
        .insight-level2 code {
          background: var(--vscode-textCodeBlock-background);
          padding: 1px 5px;
          border-radius: 3px;
          font-family: var(--vscode-editor-font-family), monospace;
          font-size: 11px;
        }

        .hidden { display: none !important; }
      </style>
    </head>
    <body>
      <div class="header">
        <h2>QAPilot</h2>
        <span class="spacer"></span>
        <button class="btn" id="clear-btn" onclick="clearLogs()">Clear</button>
      </div>

      <div class="error-banner ${hasError ? '' : 'hidden'}" id="error-banner">
        <div id="error-message">${this._escapeHtml(this._pollingError)}</div>
        <button onclick="startPolling()">Retry</button>
      </div>

      <div class="filter-bar hidden" id="filter-bar">
        <div class="search-container">
          <span class="search-icon">&#128269;</span>
          <input type="text" class="search-input" id="search-input" placeholder="Search all logs..." oninput="handleFilter()">
        </div>
        <label class="filter-label">Level:</label>
        <select class="filter-select" id="level-filter" onchange="handleFilter()">
          <option value="all">All</option>
          <option value="debug">Debug</option>
          <option value="info">Info</option>
          <option value="warn">Warn</option>
          <option value="error">Error</option>
          <option value="critical">Critical</option>
          <option value="all-insights">All Insights</option>
        </select>
        <span class="result-count" id="result-count"></span>
      </div>

      <div class="logs-container" id="logs-container">
        <div class="empty-state">
          <p style="font-size: 24px; margin-bottom: 12px;">&#128225;</p>
          <p><strong>Connecting to PostHog...</strong></p>
          <p style="margin-top: 12px; font-size: 11px; opacity: 0.7;">Logs will appear here as they are fetched.</p>
        </div>
      </div>

      <div class="scroll-to-bottom-container" id="scroll-to-bottom-container">
        <div class="new-logs-badge hidden" id="new-logs-badge">0 new</div>
        <button class="scroll-to-bottom" id="scroll-to-bottom" onclick="handleScrollButton()" title="Jump to latest logs">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </button>
      </div>

      <div class="selection-toolbar hidden" id="selection-toolbar">
        <span class="selection-count" id="selection-count">0 selected</span>
        <div class="toolbar-divider"></div>
        <button class="btn-send-agent" onclick="sendToAgent()">
          <span>&#10024;</span>
          Send to Cursor Agent
        </button>
        <button class="btn-clear-selection" onclick="clearSelection()">Clear</button>
      </div>

      <script>
        const vscode = acquireVsCodeApi();
        let pollingStatus = '${this._pollingStatus}';
        let allLogs = [];
        let displayedLogs = [];
        let selectedIndices = new Set();
        let lastClickedIndex = -1;
        const MAX_DISPLAYED_LOGS = 10;
        const SCROLL_STEP = 5;
        let windowEnd = -1;
        let isShiftingWindow = false;
        let currentFiltered = [];
        let newLogsCount = 0;

        function startPolling() {
          vscode.postMessage({ type: 'startPolling' });
        }

        function clearLogs() {
          vscode.postMessage({ type: 'clear' });
          clearSelection();
        }

        function escapeHtml(text) {
          const div = document.createElement('div');
          div.textContent = text || '';
          return div.innerHTML;
        }

        // ── Scroll handling ──

        function isAtBottom() {
          const container = document.getElementById('logs-container');
          return container.scrollHeight - container.scrollTop - container.clientHeight < 50;
        }

        function handleScrollButton() {
          const container = document.getElementById('logs-container');
          windowEnd = -1;
          newLogsCount = 0;
          updateNewLogsBadge();
          renderFilteredLogs();
          requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
        }

        function updateNewLogsBadge() {
          const badge = document.getElementById('new-logs-badge');
          if (newLogsCount > 0) {
            badge.textContent = newLogsCount === 1 ? '1 new log' : newLogsCount + ' new logs';
            badge.classList.remove('hidden');
          } else {
            badge.classList.add('hidden');
          }
        }

        function updateScrollButton() {
          const container = document.getElementById('logs-container');
          const scrollBtnContainer = document.getElementById('scroll-to-bottom-container');
          const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;

          if (distanceFromBottom < 50 && newLogsCount > 0 && windowEnd === -1) {
            newLogsCount = 0;
            updateNewLogsBadge();
            renderFilteredLogs();
            container.scrollTop = container.scrollHeight;
          }

          if (distanceFromBottom > 100 || newLogsCount > 0 || windowEnd !== -1) {
            scrollBtnContainer.classList.add('visible');
          } else {
            scrollBtnContainer.classList.remove('visible');
          }
        }

        // ── Virtual scrolling ──

        function shiftWindowUp() {
          if (isShiftingWindow) return;
          isShiftingWindow = true;
          clearSelection();

          const filtered = currentFiltered;
          const oldEndIdx = windowEnd === -1 ? filtered.length : Math.min(windowEnd, filtered.length);
          const oldStartIdx = Math.max(0, oldEndIdx - MAX_DISPLAYED_LOGS);
          if (oldStartIdx <= 0) { isShiftingWindow = false; return; }

          const newStartIdx = Math.max(0, oldStartIdx - SCROLL_STEP);
          windowEnd = newStartIdx + MAX_DISPLAYED_LOGS;
          renderFilteredLogs();

          const container = document.getElementById('logs-container');
          const topIndicator = document.getElementById('top-indicator');
          const indicatorHeight = topIndicator ? topIndicator.offsetHeight + 8 : 0;
          container.scrollTop = Math.max(40, indicatorHeight);
          setTimeout(() => { isShiftingWindow = false; }, 200);
        }

        function shiftWindowDown() {
          if (isShiftingWindow) return;
          isShiftingWindow = true;
          clearSelection();

          const filtered = currentFiltered;
          const oldEndIdx = windowEnd === -1 ? filtered.length : Math.min(windowEnd, filtered.length);
          if (oldEndIdx >= filtered.length) { isShiftingWindow = false; return; }

          const newEndIdx = Math.min(filtered.length, oldEndIdx + SCROLL_STEP);
          if (newEndIdx >= filtered.length) {
            windowEnd = -1;
            newLogsCount = 0;
            updateNewLogsBadge();
          } else {
            windowEnd = newEndIdx;
          }

          renderFilteredLogs();

          const container = document.getElementById('logs-container');
          const bottomIndicator = document.getElementById('bottom-indicator');
          const indicatorHeight = bottomIndicator ? bottomIndicator.offsetHeight + 8 : 0;
          const maxScroll = container.scrollHeight - container.clientHeight;
          container.scrollTop = Math.min(maxScroll - 40, maxScroll - indicatorHeight);
          setTimeout(() => { isShiftingWindow = false; }, 200);
        }

        document.getElementById('logs-container').addEventListener('scroll', function() {
          if (isShiftingWindow) return;
          const container = this;
          const scrollTop = container.scrollTop;
          const distanceFromBottom = container.scrollHeight - scrollTop - container.clientHeight;

          if (scrollTop < 30 && currentFiltered.length > 0) {
            const endIdx = windowEnd === -1 ? currentFiltered.length : Math.min(windowEnd, currentFiltered.length);
            const startIdx = Math.max(0, endIdx - MAX_DISPLAYED_LOGS);
            if (startIdx > 0) { shiftWindowUp(); return; }
          }

          if (distanceFromBottom < 30 && currentFiltered.length > 0 && windowEnd !== -1) {
            const endIdx = Math.min(windowEnd, currentFiltered.length);
            if (endIdx < currentFiltered.length) { shiftWindowDown(); return; }
          }

          updateScrollButton();
        });

        // ── Selection ──

        function handleLogClick(event, index) {
          event.stopPropagation();
          if (event.shiftKey && lastClickedIndex !== -1) {
            const start = Math.min(lastClickedIndex, index);
            const end = Math.max(lastClickedIndex, index);
            for (let i = start; i <= end; i++) { selectedIndices.add(i); }
          } else {
            if (selectedIndices.has(index)) {
              selectedIndices.delete(index);
            } else {
              selectedIndices.add(index);
            }
            lastClickedIndex = index;
          }
          updateSelectionUI();
        }

        function updateSelectionUI() {
          const cards = document.querySelectorAll('.log-card');
          cards.forEach((card, idx) => {
            const checkbox = card.querySelector('.log-checkbox');
            if (selectedIndices.has(idx)) {
              card.classList.add('selected');
              if (checkbox) checkbox.classList.add('checked');
            } else {
              card.classList.remove('selected');
              if (checkbox) checkbox.classList.remove('checked');
            }
          });

          const toolbar = document.getElementById('selection-toolbar');
          const countEl = document.getElementById('selection-count');
          if (selectedIndices.size > 0) {
            toolbar.classList.remove('hidden');
            countEl.textContent = selectedIndices.size + ' selected';
          } else {
            toolbar.classList.add('hidden');
          }
        }

        function clearSelection() {
          selectedIndices.clear();
          lastClickedIndex = -1;
          updateSelectionUI();
        }

        function sendToAgent() {
          if (selectedIndices.size === 0) return;
          const sortedIndices = Array.from(selectedIndices).sort((a, b) => a - b);
          const selectedLogs = sortedIndices.map(idx => displayedLogs[idx]).filter(Boolean);
          vscode.postMessage({ type: 'sendToAgent', logs: selectedLogs });
          clearSelection();
        }

        // ── Search and Filtering ──

        function fuzzyMatch(pattern, text) {
          if (!pattern) return { match: true, score: 0, indices: [] };
          if (!text) return { match: false, score: 0, indices: [] };
          const patternLower = pattern.toLowerCase();
          const textLower = text.toLowerCase();
          const idx = textLower.indexOf(patternLower);
          if (idx !== -1) {
            const indices = [];
            for (let i = 0; i < pattern.length; i++) { indices.push(idx + i); }
            let score = 100 + (100 - idx);
            if (idx === 0) score += 50;
            if (idx > 0 && /\\s/.test(text[idx - 1])) score += 30;
            return { match: true, score, indices };
          }
          return { match: false, score: 0, indices: [] };
        }

        function highlightMatches(text, indices) {
          if (!indices || indices.length === 0) return escapeHtml(text);
          let result = '';
          let lastIdx = 0;
          const groups = [];
          let currentGroup = [indices[0]];
          for (let i = 1; i < indices.length; i++) {
            if (indices[i] === indices[i-1] + 1) {
              currentGroup.push(indices[i]);
            } else {
              groups.push(currentGroup);
              currentGroup = [indices[i]];
            }
          }
          groups.push(currentGroup);
          for (const group of groups) {
            const start = group[0];
            const end = group[group.length - 1] + 1;
            result += escapeHtml(text.substring(lastIdx, start));
            result += '<span class="highlight">' + escapeHtml(text.substring(start, end)) + '</span>';
            lastIdx = end;
          }
          result += escapeHtml(text.substring(lastIdx));
          return result;
        }

        var knownInsightCategories = {};

        function addInsightCategoryToFilter(category) {
          var normalizedKey = 'insight-' + category.toLowerCase().replace(/\\s+/g, '-');
          if (knownInsightCategories[normalizedKey]) return;
          knownInsightCategories[normalizedKey] = true;
          var select = document.getElementById('level-filter');
          var option = document.createElement('option');
          option.value = normalizedKey;
          option.textContent = '\\u25CF ' + category;
          select.appendChild(option);
        }

        function filterLogs() {
          var searchQuery = document.getElementById('search-input').value.trim();
          var levelFilter = document.getElementById('level-filter').value;

          var filtered = allLogs.filter(function(log) {
            if (levelFilter !== 'all') {
              if (levelFilter === 'all-insights') {
                return !!log.isInsight;
              }
              if (levelFilter.indexOf('insight-') === 0) {
                if (!log.isInsight) return false;
                var catKey = 'insight-' + (log.insightCategory || '').toLowerCase().replace(/\\s+/g, '-');
                return catKey === levelFilter;
              }
              var logLevel = (log.logLevel || '').toLowerCase();
              if (levelFilter === 'warn' && logLevel !== 'warn' && logLevel !== 'warning') return false;
              else if (levelFilter !== 'warn' && logLevel !== levelFilter) return false;
            }
            return true;
          });

          if (searchQuery) {
            filtered = filtered
              .map(log => {
                const messageResult = fuzzyMatch(searchQuery, log.logMessage);
                const eventResult = fuzzyMatch(searchQuery, log.event || '');
                const uuidResult = fuzzyMatch(searchQuery, log.uuid || '');
                const distinctIdResult = fuzzyMatch(searchQuery, log.distinctId || '');
                const tagResult = fuzzyMatch(searchQuery, log.logTag || '');
                if (messageResult.match || eventResult.match || uuidResult.match || distinctIdResult.match || tagResult.match) {
                  const searchIndices = {
                    message: messageResult.match ? messageResult.indices : [],
                    event: eventResult.match ? eventResult.indices : [],
                    uuid: uuidResult.match ? uuidResult.indices : [],
                    distinctId: distinctIdResult.match ? distinctIdResult.indices : [],
                    tag: tagResult.match ? tagResult.indices : []
                  };
                  const score = Math.max(messageResult.score, eventResult.score, uuidResult.score, distinctIdResult.score, tagResult.score);
                  return { log, match: true, score, searchIndices };
                }
                return { log, match: false, score: 0, searchIndices: { message: [], event: [], uuid: [], distinctId: [], tag: [] } };
              })
              .filter(item => item.match)
              .sort((a, b) => b.score - a.score)
              .map(item => ({ ...item.log, _searchIndices: item.searchIndices }));
          }

          return filtered;
        }

        function handleFilter() {
          windowEnd = -1;
          renderFilteredLogs();
        }

        // ── Rendering ──

        function renderFilteredLogs() {
          const container = document.getElementById('logs-container');
          const resultCount = document.getElementById('result-count');
          const filterBar = document.getElementById('filter-bar');

          if (allLogs.length === 0) {
            displayedLogs = [];
            currentFiltered = [];
            container.innerHTML =
              '<div class="empty-state">' +
              '<p style="font-size: 24px; margin-bottom: 12px;">&#128225;</p>' +
              '<p><strong>Connecting to PostHog...</strong></p>' +
              '<p style="margin-top: 12px; font-size: 11px; opacity: 0.7;">Logs will appear here as they are fetched.</p>' +
              '</div>';
            resultCount.textContent = '';
            clearSelection();
            return;
          }

          filterBar.classList.remove('hidden');
          container.classList.remove('hidden');

          const filtered = filterLogs();
          currentFiltered = filtered;

          let endIdx, startIdx;
          if (windowEnd === -1 || windowEnd > filtered.length) {
            endIdx = filtered.length;
          } else {
            endIdx = windowEnd;
          }
          startIdx = Math.max(0, endIdx - MAX_DISPLAYED_LOGS);
          displayedLogs = filtered.slice(startIdx, endIdx);
          const searchQuery = document.getElementById('search-input').value.trim();

          const canScrollUp = startIdx > 0;
          const canScrollDown = endIdx < filtered.length;

          selectedIndices = new Set([...selectedIndices].filter(idx => idx < displayedLogs.length));
          updateSelectionUI();

          if (displayedLogs.length === 0) {
            if (searchQuery || document.getElementById('level-filter').value !== 'all') {
              resultCount.textContent = '0 matches (total: ' + allLogs.length + ')';
            } else {
              resultCount.textContent = '';
            }
            container.innerHTML =
              '<div class="empty-state">' +
              '<p>No logs match your filter</p>' +
              '<p>Try adjusting the search or level filter</p>' +
              '</div>';
            return;
          }

          if (searchQuery || document.getElementById('level-filter').value !== 'all') {
            resultCount.textContent = 'Showing ' + (startIdx + 1) + '\\u2013' + endIdx + ' of ' + filtered.length + ' matches (total: ' + allLogs.length + ')';
          } else {
            resultCount.textContent = 'Showing ' + (startIdx + 1) + '\\u2013' + endIdx + ' of ' + allLogs.length + ' logs';
          }

          let html = '';
          if (canScrollUp) {
            html += '<div class="window-indicator top" id="top-indicator" onclick="shiftWindowUp()"><span class="indicator-arrow">\\u25B2</span> ' + startIdx + ' older log' + (startIdx !== 1 ? 's' : '') + ' above \\u2014 click to load</div>';
          }
          html += displayedLogs.map((log, idx) =>
            createLogCard(log, idx, selectedIndices.has(idx), log._searchIndices)
          ).join('');
          if (canScrollDown) {
            const newerCount = filtered.length - endIdx;
            html += '<div class="window-indicator bottom" id="bottom-indicator" onclick="shiftWindowDown()"><span class="indicator-arrow">\\u25BC</span> ' + newerCount + ' newer log' + (newerCount !== 1 ? 's' : '') + ' below \\u2014 click to load</div>';
          }
          container.innerHTML = html;
        }

        function hexToRgb(hex) {
          var r = parseInt(hex.slice(1, 3), 16);
          var g = parseInt(hex.slice(3, 5), 16);
          var b = parseInt(hex.slice(5, 7), 16);
          return r + ',' + g + ',' + b;
        }

        function renderMarkdown(text) {
          var html = escapeHtml(text);
          html = html.replace(/\`\`\`([\\s\\S]*?)\`\`\`/g, '<pre><code>$1</code></pre>');
          html = html.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
          html = html.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
          html = html.replace(/^#{1,6} (.+)$/gm, '<strong>$1</strong>');
          html = html.replace(/^[\\-\\*] (.+)$/gm, '<li>$1</li>');
          html = html.replace(/(<li>.*<\\/li>)/s, '<ul>$1</ul>');
          html = html.replace(/\\n/g, '<br>');
          return html;
        }

        function toggleLevel2(id) {
          var el = document.getElementById(id);
          if (!el) return;
          var btn = el.previousElementSibling ? el.previousElementSibling.querySelector('.details-btn') : null;
          if (el.classList.contains('expanded')) {
            el.classList.remove('expanded');
            if (btn) btn.textContent = '\\u25B6 Details';
          } else {
            el.classList.add('expanded');
            if (btn) btn.textContent = '\\u25BC Details';
          }
        }

        function createLogCard(log, index, isSelected, searchIndices) {
          var levelClass = (log.logLevel || 'info').toLowerCase();

          var messageIndices = [];
          var uuidIndices = [];
          var distinctIdIndices = [];
          var eventIndices = [];

          if (searchIndices && typeof searchIndices === 'object' && !Array.isArray(searchIndices)) {
            messageIndices = searchIndices.message || [];
            uuidIndices = searchIndices.uuid || [];
            distinctIdIndices = searchIndices.distinctId || [];
            eventIndices = searchIndices.event || [];
          }

          var messageHtml = messageIndices.length > 0 ? highlightMatches(log.logMessage, messageIndices) : escapeHtml(log.logMessage);
          var uuidHtml = uuidIndices.length > 0 ? highlightMatches(log.uuid || '', uuidIndices) : escapeHtml(log.uuid || '');
          var distinctIdHtml = distinctIdIndices.length > 0 ? highlightMatches(log.distinctId || '', distinctIdIndices) : escapeHtml(log.distinctId || '');
          var eventHtml = eventIndices.length > 0 ? highlightMatches(log.event || '', eventIndices) : escapeHtml(log.event || '');

          var selectedClass = isSelected ? 'selected' : '';
          var checkedClass = isSelected ? 'checked' : '';

          var isInsight = !!log.isInsight;
          var insightColor = log.insightColor || '';
          var rgb = insightColor ? hexToRgb(insightColor) : '';

          if (isInsight) {
            var insightId = 'insight-' + index + '-' + Date.now();
            var typeLabel = (log.insightType === 'universal') ? 'Universal' : 'Focused';

            var detailsHtml = '';
            if (log.level2Markdown) {
              detailsHtml =
                '<div class="insight-details-toggle">' +
                  '<button class="details-btn" onclick="event.stopPropagation(); toggleLevel2(\\'' + insightId + '\\')" title="Show detailed analysis">\\u25B6 Details</button>' +
                '</div>' +
                '<div class="insight-level2" id="' + insightId + '">' +
                  renderMarkdown(log.level2Markdown) +
                '</div>';
            }

            return '<div class="log-card insight-card ' + selectedClass + '" data-index="' + index + '" ' +
              'style="--insight-color:' + insightColor + '; --insight-bg:rgba(' + rgb + ',0.08); --insight-btn-bg:rgba(' + rgb + ',0.2);" ' +
              'onclick="handleLogClick(event, ' + index + ')">' +
              '<div class="log-header">' +
                '<div class="log-checkbox ' + checkedClass + '"></div>' +
                '<span class="log-level insight-level">' + escapeHtml(log.insightCategory || log.logLevel) + '</span>' +
                '<span class="insight-type-badge" style="background:rgba(' + rgb + ',0.15); color:' + insightColor + ';">' + typeLabel + '</span>' +
                '<span class="log-timestamp">' + escapeHtml(log.timestamp) + '</span>' +
                '<span class="log-tag">' + escapeHtml(log.logTag) + '</span>' +
                '<span class="log-event">' + escapeHtml(log.event) + '</span>' +
              '</div>' +
              '<div class="log-body">' +
                '<div class="log-message">' + messageHtml + '</div>' +
              '</div>' +
              detailsHtml +
            '</div>';
          }

          return '<div class="log-card ' + selectedClass + '" data-index="' + index + '" onclick="handleLogClick(event, ' + index + ')">' +
            '<div class="log-header">' +
              '<div class="log-checkbox ' + checkedClass + '"></div>' +
              '<span class="log-level ' + levelClass + '">' + escapeHtml(log.logLevel) + '</span>' +
              '<span class="log-timestamp">' + escapeHtml(log.timestamp) + '</span>' +
              '<span class="log-tag">' + escapeHtml(log.logTag) + '</span>' +
              '<span class="log-event">' + eventHtml + '</span>' +
            '</div>' +
            '<div class="log-body">' +
              '<div class="log-message">' + messageHtml + '</div>' +
            '</div>' +
            '<div class="log-meta">' +
              '<div class="log-meta-item">' +
                '<span class="log-meta-label">uuid:</span>' +
                '<span class="log-meta-value">' + uuidHtml + '</span>' +
              '</div>' +
              '<div class="log-meta-item">' +
                '<span class="log-meta-label">distinct_id:</span>' +
                '<span class="log-meta-value">' + distinctIdHtml + '</span>' +
              '</div>' +
              '<div class="log-meta-item">' +
                '<span class="log-meta-label">person_id:</span>' +
                '<span class="log-meta-value">' + escapeHtml(log.personId || '') + '</span>' +
              '</div>' +
            '</div>' +
          '</div>';
        }

        function updatePollingStatus(status, error) {
          pollingStatus = status;
          const errorBanner = document.getElementById('error-banner');
          const errorMessage = document.getElementById('error-message');

          if (status === 'error') {
            errorMessage.textContent = error || 'Unknown error';
            errorBanner.classList.remove('hidden');
          } else {
            errorBanner.classList.add('hidden');
          }
        }

        function addLog(log) {
          const container = document.getElementById('logs-container');
          const inFollowMode = windowEnd === -1;
          const wasAtBottom = isAtBottom();

          allLogs.push(log);
          if (allLogs.length > 500) {
            allLogs = allLogs.slice(-500);
          }

          document.getElementById('filter-bar').classList.remove('hidden');
          container.classList.remove('hidden');

          if (inFollowMode && wasAtBottom) {
            renderFilteredLogs();
            container.scrollTop = container.scrollHeight;
          } else {
            newLogsCount++;
            updateNewLogsBadge();
            updateScrollButton();
          }
        }

        window.addEventListener('message', function(event) {
          var message = event.data;
          switch (message.type) {
            case 'pollingStatus':
              updatePollingStatus(message.status, message.error);
              break;
            case 'newLog':
              if (message.log.isInsight && message.log.insightCategory) {
                addInsightCategoryToFilter(message.log.insightCategory);
              }
              addLog(message.log);
              break;
            case 'newInsightCategories':
              if (message.categories && Array.isArray(message.categories)) {
                message.categories.forEach(function(cat) { addInsightCategoryToFilter(cat); });
              }
              break;
            case 'clearLogs':
              allLogs = [];
              displayedLogs = [];
              currentFiltered = [];
              windowEnd = -1;
              newLogsCount = 0;
              document.getElementById('search-input').value = '';
              document.getElementById('level-filter').value = 'all';
              clearSelection();
              updateNewLogsBadge();
              updateScrollButton();
              renderFilteredLogs();
              break;
          }
        });

        ${this._logs.length > 0 ? `
          allLogs = ${JSON.stringify(this._logs)};
          allLogs.forEach(function(log) {
            if (log.isInsight && log.insightCategory) {
              addInsightCategoryToFilter(log.insightCategory);
            }
          });
          windowEnd = -1;
          renderFilteredLogs();
        ` : ''}
      </script>
    </body>
    </html>`;
  }

  private _escapeHtml(text: string): string {
    if (!text) { return ''; }
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

let provider: QAPilotViewProvider;

export function activate(context: vscode.ExtensionContext) {
  log('QAPilot extension is now active!');

  provider = new QAPilotViewProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      QAPilotViewProvider.viewType,
      provider
    )
  );

  // Auto-start polling
  provider.startPolling();

  context.subscriptions.push(
    vscode.commands.registerCommand('qapilot.refreshLogs', () => {
      provider.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('qapilot.clearLogs', () => {
      provider.clearLogs();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('qapilot.startPolling', () => {
      provider.startPolling();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('qapilot.stopPolling', () => {
      provider.stopPolling();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('qapilot.fetchLogs', () => {
      vscode.commands.executeCommand('qapilot.logsView.focus');
    })
  );
}

export function deactivate() {
  if (provider) {
    provider.stopPolling();
  }
}
