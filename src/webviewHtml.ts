import { LogEntry, PollingStatus } from './types.js';

function escapeHtml(text: string): string {
  if (!text) { return ''; }
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export interface WebviewHtmlOptions {
  pollingStatus: PollingStatus;
  pollingError: string;
  logs: LogEntry[];
}

export function getWebviewHtml(options: WebviewHtmlOptions): string {
  const { pollingStatus, pollingError, logs } = options;
  const hasError = pollingStatus === 'error';

  return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
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
          transition: background 0.15s, transform 0.1s, opacity 0.1s;
        }
        .btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
        .btn:active { transform: scale(0.95); opacity: 0.85; }
        .btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .btn-primary {
          background: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
        }
        .btn-primary:hover { background: var(--vscode-button-hoverBackground); }
        .btn-primary:active { transform: scale(0.95); }

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
        .error-banner button:active { transform: scale(0.95); }

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
          display: flex;
          align-items: center;
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
        .window-indicator:active { background: var(--vscode-list-activeSelectionBackground, var(--vscode-list-hoverBackground)); opacity: 0.85; }
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
        .scroll-to-bottom:active { transform: scale(0.97); }
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
        .log-event-type { color: var(--vscode-textLink-foreground); font-weight: 600; }
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

        .raw-json-wrap { padding: 8px 12px; border-top: 1px solid var(--vscode-panel-border); }
        .raw-json-toggle {
          background: none;
          border: none;
          color: var(--vscode-textLink-foreground);
          font-size: 11px;
          cursor: pointer;
          padding: 4px 0;
          display: flex;
          align-items: center;
          gap: 6px;
          font-family: var(--vscode-font-family);
        }
        .raw-json-toggle:hover { text-decoration: underline; }
        .raw-json-panel {
          display: none;
          margin-top: 8px;
          max-height: 280px;
          overflow: auto;
          background: var(--vscode-textCodeBlock-background);
          border-radius: 4px;
          padding: 10px;
          border: 1px solid var(--vscode-panel-border);
        }
        .raw-json-panel.expanded { display: block; }
        .raw-json-pre {
          margin: 0;
          font-size: 11px;
          font-family: var(--vscode-editor-font-family), monospace;
          white-space: pre-wrap;
          word-break: break-word;
          color: var(--vscode-foreground);
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
          background: linear-gradient(135deg, #2563EB 0%, #3B82F6 100%);
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
          background: linear-gradient(135deg, #1D4ED8 0%, #2563EB 100%);
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
          transition: background 0.15s, color 0.15s, transform 0.1s, opacity 0.1s;
        }
        .btn-clear-selection:hover {
          background: var(--vscode-button-secondaryHoverBackground);
          color: var(--vscode-foreground);
        }
        .btn-clear-selection:active { transform: scale(0.95); opacity: 0.8; }

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
        .insight-icon {
          font-size: 14px;
          flex-shrink: 0;
        }
        .insight-heading {
          font-weight: 600;
          font-size: 11px;
          color: var(--insight-color, var(--vscode-foreground));
        }
        .insight-heading .insight-heading-sep {
          opacity: 0.5;
          margin: 0 4px;
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
        .go-deeper-container {
          margin-top: 12px;
          padding-top: 10px;
          border-top: 1px dashed var(--vscode-panel-border);
          display: flex;
          justify-content: flex-start;
        }
        .go-deeper-btn {
          background: linear-gradient(135deg, #2563EB 0%, #3B82F6 100%);
          color: white;
          border: none;
          border-radius: 5px;
          padding: 6px 16px;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          font-family: var(--vscode-font-family);
          display: flex;
          align-items: center;
          gap: 6px;
          letter-spacing: 0.3px;
          transition: all 0.15s ease;
          box-shadow: 0 2px 6px rgba(37, 99, 235, 0.3);
        }
        .go-deeper-btn:hover {
          background: linear-gradient(135deg, #1D4ED8 0%, #2563EB 100%);
          transform: translateY(-1px);
          box-shadow: 0 3px 10px rgba(37, 99, 235, 0.4);
        }
        .go-deeper-btn:active { transform: translateY(0); }

        .hidden { display: none !important; }

        /* ── Chat Overlay & Panel ── */
        .chat-overlay {
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0, 0, 0, 0.4);
          z-index: 1999;
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.25s ease;
        }
        .chat-overlay.visible {
          opacity: 1;
          pointer-events: auto;
        }

        .chat-panel {
          position: fixed;
          top: 0; right: -34%; bottom: 0;
          width: 34%;
          min-width: 260px;
          background: var(--vscode-editor-background);
          border-left: 1px solid var(--vscode-panel-border);
          z-index: 2000;
          display: flex;
          flex-direction: column;
          transition: right 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: -4px 0 24px rgba(0, 0, 0, 0.3);
        }
        .chat-panel.open { right: 0; }

        .chat-tabs-bar {
          display: flex;
          align-items: stretch;
          background: var(--vscode-sideBar-background);
          border-bottom: 1px solid var(--vscode-panel-border);
          flex-shrink: 0;
          min-height: 35px;
        }
        .chat-tabs-scroll {
          display: flex;
          flex: 1;
          overflow-x: auto;
          min-width: 0;
        }
        .chat-tabs-scroll::-webkit-scrollbar { display: none; }
        .chat-tab {
          padding: 8px 14px;
          font-size: 11px;
          font-family: var(--vscode-font-family);
          color: var(--vscode-descriptionForeground);
          cursor: pointer;
          white-space: nowrap;
          border-right: 1px solid var(--vscode-panel-border);
          max-width: 150px;
          overflow: hidden;
          text-overflow: ellipsis;
          flex-shrink: 0;
          transition: background 0.15s, color 0.15s;
          display: flex;
          align-items: center;
        }
        .chat-tab:hover {
          background: var(--vscode-list-hoverBackground);
          color: var(--vscode-foreground);
        }
        .chat-tab.active {
          color: var(--vscode-foreground);
          background: var(--vscode-editor-background);
          font-weight: 500;
          border-bottom: 2px solid var(--vscode-focusBorder);
        }
        .chat-tab-actions {
          display: flex;
          align-items: center;
          flex-shrink: 0;
        }
        .chat-tab-btn {
          background: transparent;
          border: none;
          color: var(--vscode-descriptionForeground);
          font-size: 14px;
          cursor: pointer;
          padding: 8px 10px;
          line-height: 1;
          transition: background 0.15s, color 0.15s, transform 0.1s;
        }
        .chat-tab-btn:hover {
          background: var(--vscode-toolbar-hoverBackground);
          color: var(--vscode-foreground);
        }
        .chat-tab-btn:active { background: var(--vscode-toolbar-activeBackground, var(--vscode-toolbar-hoverBackground)); transform: scale(0.88); }
        .chat-history-wrapper {
          position: relative;
        }
        .chat-history-dropdown {
          display: none;
          flex-direction: column;
          position: absolute;
          top: 100%;
          right: 0;
          width: 280px;
          max-height: 320px;
          overflow-y: auto;
          background: var(--vscode-editor-background);
          border: 1px solid var(--vscode-panel-border);
          border-radius: 0 0 6px 6px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.3);
          z-index: 100;
        }
        .chat-history-dropdown.visible { display: flex; }
        .chat-history-dropdown-title {
          padding: 10px 12px 6px;
          font-size: 11px;
          font-weight: 600;
          color: var(--vscode-descriptionForeground);
          font-family: var(--vscode-font-family);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .chat-history-item {
          display: flex;
          align-items: center;
          padding: 8px 16px;
          gap: 8px;
          cursor: pointer;
          border-bottom: 1px solid var(--vscode-panel-border);
          transition: background 0.15s ease;
        }
        .chat-history-item:hover {
          background: var(--vscode-list-hoverBackground);
        }
        .chat-history-item.active {
          background: var(--vscode-list-activeSelectionBackground);
          color: var(--vscode-list-activeSelectionForeground);
        }
        .chat-history-item-text {
          flex: 1;
          min-width: 0;
        }
        .chat-history-item-title {
          font-size: 12px;
          font-weight: 500;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          font-family: var(--vscode-font-family);
          color: var(--vscode-foreground);
        }
        .chat-history-item-date {
          font-size: 10px;
          color: var(--vscode-descriptionForeground);
          font-family: var(--vscode-font-family);
          margin-top: 2px;
        }
        .chat-history-delete {
          background: transparent;
          border: none;
          color: var(--vscode-descriptionForeground);
          font-size: 14px;
          cursor: pointer;
          padding: 2px 6px;
          border-radius: 4px;
          line-height: 1;
          flex-shrink: 0;
        }
        .chat-history-delete:hover {
          background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
          color: var(--vscode-errorForeground, #f48771);
        }
        .chat-history-empty {
          padding: 16px;
          text-align: center;
          font-size: 11px;
          color: var(--vscode-descriptionForeground);
          font-family: var(--vscode-font-family);
        }

        .chat-context {
          padding: 10px 16px;
          background: var(--vscode-sideBar-background);
          border-bottom: 1px solid var(--vscode-panel-border);
          flex-shrink: 0;
        }
        .chat-context-title {
          font-size: 11px;
          color: var(--vscode-descriptionForeground);
          font-family: var(--vscode-font-family);
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .chat-context-logs {
          margin-top: 6px;
          max-height: 80px;
          overflow-y: auto;
          font-size: 10px;
          color: var(--vscode-descriptionForeground);
          font-family: var(--vscode-editor-font-family), monospace;
          line-height: 1.5;
        }
        .chat-context-log {
          padding: 1px 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .chat-messages {
          flex: 1;
          overflow-y: auto;
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .chat-msg {
          max-width: 92%;
          padding: 10px 14px;
          border-radius: 12px;
          font-size: 12px;
          line-height: 1.6;
          font-family: var(--vscode-font-family);
          word-wrap: break-word;
        }
        .chat-msg.user {
          align-self: flex-end;
          background: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          border-bottom-right-radius: 4px;
        }
        .chat-msg.assistant {
          align-self: flex-start;
          background: var(--vscode-sideBar-background);
          color: var(--vscode-foreground);
          border: 1px solid var(--vscode-panel-border);
          border-bottom-left-radius: 4px;
        }
        .chat-msg.error {
          align-self: flex-start;
          background: rgba(248, 81, 73, 0.12);
          color: #f85149;
          border: 1px solid rgba(248, 81, 73, 0.3);
          border-bottom-left-radius: 4px;
        }

        .chat-msg.assistant code {
          background: var(--vscode-textCodeBlock-background);
          padding: 1px 5px;
          border-radius: 3px;
          font-family: var(--vscode-editor-font-family), monospace;
          font-size: 11px;
        }
        .chat-msg.assistant pre {
          background: var(--vscode-textCodeBlock-background);
          padding: 8px 10px;
          border-radius: 4px;
          overflow-x: auto;
          margin: 6px 0;
          font-size: 11px;
        }
        .chat-msg.assistant pre code {
          background: none;
          padding: 0;
        }
        .chat-msg.assistant ul, .chat-msg.assistant ol {
          margin: 4px 0;
          padding-left: 18px;
        }
        .chat-msg.assistant li { margin: 2px 0; }
        .chat-msg.assistant strong { font-weight: 600; }

        .typing-indicator {
          align-self: flex-start;
          display: flex;
          gap: 4px;
          padding: 12px 16px;
          background: var(--vscode-sideBar-background);
          border: 1px solid var(--vscode-panel-border);
          border-radius: 12px;
          border-bottom-left-radius: 4px;
        }
        .typing-dot {
          width: 6px; height: 6px;
          border-radius: 50%;
          background: var(--vscode-descriptionForeground);
          animation: typingBounce 1.4s ease-in-out infinite;
        }
        .typing-dot:nth-child(2) { animation-delay: 0.2s; }
        .typing-dot:nth-child(3) { animation-delay: 0.4s; }
        @keyframes typingBounce {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
          30% { transform: translateY(-4px); opacity: 1; }
        }

        .chat-input-container {
          display: flex;
          gap: 8px;
          padding: 12px 16px;
          border-top: 1px solid var(--vscode-panel-border);
          background: var(--vscode-sideBar-background);
          flex-shrink: 0;
          align-items: flex-end;
        }
        .chat-input {
          flex: 1;
          background: var(--vscode-input-background);
          color: var(--vscode-input-foreground);
          border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
          border-radius: 8px;
          padding: 8px 12px;
          font-size: 12px;
          font-family: var(--vscode-font-family);
          resize: none;
          min-height: 36px;
          max-height: 120px;
          line-height: 1.4;
        }
        .chat-input:focus { outline: none; border-color: var(--vscode-focusBorder); }
        .chat-input::placeholder { color: var(--vscode-input-placeholderForeground); }
        .chat-send-btn {
          background: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          border: none;
          padding: 8px 16px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          font-family: var(--vscode-font-family);
          white-space: nowrap;
          transition: background 0.15s, transform 0.1s;
        }
        .chat-send-btn:hover { background: var(--vscode-button-hoverBackground); }
        .chat-send-btn:active { transform: scale(0.96); }
        .chat-send-btn:disabled { opacity: 0.5; cursor: not-allowed; }

        /* Floating chat button */
        .chat-fab {
          position: fixed;
          bottom: 70px;
          right: 16px;
          width: 40px; height: 40px;
          border-radius: 50%;
          background: #2563eb;
          color: white;
          border: none;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 18px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
          z-index: 999;
          transition: background 0.15s;
        }
        .chat-fab:hover {
          background: #1d4ed8;
        }
        .chat-fab:active {
          background: #1e40af;
        }
        .chat-fab svg {
          width: 22px;
          height: 22px;
          display: block;
        }

        .btn-chat-logs {
          background: linear-gradient(135deg, #059669 0%, #10b981 100%);
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
        .btn-chat-logs:hover {
          background: linear-gradient(135deg, #047857 0%, #059669 100%);
          transform: translateY(-1px);
        }
        .btn-chat-logs:active { transform: translateY(0); }

        .settings-wrap {
          position: relative;
          display: inline-block;
        }
        .btn-settings {
          background: var(--vscode-button-secondaryBackground);
          color: var(--vscode-button-secondaryForeground);
          border: none;
          padding: 4px 8px;
          font-size: 11px;
          cursor: pointer;
          border-radius: 3px;
          font-family: var(--vscode-font-family);
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .btn-settings:hover { background: var(--vscode-button-secondaryHoverBackground); }
        .btn-settings:active { transform: scale(0.96); opacity: 0.85; }
        .settings-dropdown {
          position: absolute;
          top: 100%;
          right: 0;
          margin-top: 4px;
          min-width: 160px;
          background: var(--vscode-dropdown-background);
          border: 1px solid var(--vscode-dropdown-border, var(--vscode-panel-border));
          border-radius: 4px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
          z-index: 1000;
          padding: 4px 0;
        }
        .settings-dropdown.hidden {
          display: none;
        }
        .settings-dropdown button {
          display: block;
          width: 100%;
          text-align: left;
          padding: 8px 12px;
          font-size: 12px;
          font-family: var(--vscode-font-family);
          color: var(--vscode-foreground);
          background: none;
          border: none;
          cursor: pointer;
        }
        .settings-dropdown button:hover {
          background: var(--vscode-list-hoverBackground);
        }
        .settings-dropdown button:active { background: var(--vscode-list-activeSelectionBackground, var(--vscode-list-hoverBackground)); opacity: 0.85; }
      </style>
    </head>
    <body>
      <div class="header">
        <h2>QApilot</h2>
        <span class="spacer"></span>
        <button class="btn" id="clear-btn" onclick="clearLogs()">Clear</button>
        <div class="settings-wrap" id="settings-wrap">
          <button class="btn-settings" id="settings-btn" onclick="toggleSettingsDropdown(event)" title="Change PostHog or OpenAI API key">Reset API Keys</button>
          <div class="settings-dropdown hidden" id="settings-dropdown">
            <button type="button" onclick="changePostHogKey()">Change PostHog Key</button>
            <button type="button" onclick="changeOpenAIKey()">Change OpenAI Key</button>
            <button type="button" onclick="refreshSchema()">Refresh schema</button>
          </div>
        </div>
      </div>

      <div class="error-banner ${hasError ? '' : 'hidden'}" id="error-banner">
        <div id="error-message">${escapeHtml(pollingError)}</div>
        <button onclick="startPolling()">Retry</button>
      </div>

      <div class="filter-bar hidden" id="filter-bar">
        <div class="search-container">
          <span class="search-icon"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" stroke-width="1.5"/><line x1="9.9" y1="9.9" x2="14" y2="14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></span>
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
          <p style="margin-bottom: 12px; opacity: 0.5;"><svg width="32" height="32" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="12" r="1.5" fill="currentColor"/><path d="M5.2 9.5a3.96 3.96 0 015.6 0" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M2.5 6.8a7.5 7.5 0 0111 0" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M0 4a11.2 11.2 0 0116 0" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></p>
          <p><strong>Watching for live logs...</strong></p>
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
        <button class="btn-chat-logs" onclick="openNativeChat()">
          <span><svg width="13" height="13" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align:-1px"><path d="M2 3C2 2.45 2.45 2 3 2H13C13.55 2 14 2.45 14 3V10C14 10.55 13.55 11 13 11H5L2 14V3Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg></span>
          Chat with Logs
        </button>
        <button class="btn-send-agent" onclick="sendToAgent()">
          <span><svg width="13" height="13" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align:-1px"><path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3M3.7 3.7l2.1 2.1M10.2 10.2l2.1 2.1M12.3 3.7l-2.1 2.1M5.8 10.2l-2.1 2.1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></span>
          Send to Cursor Agent
        </button>
        <button class="btn-clear-selection" onclick="clearSelection()">Clear</button>
      </div>

      <!-- Floating chat button -->
      <button class="chat-fab hidden" id="chat-fab" onclick="openNativeChat()" title="Chat with logs"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></button>

      <!-- Chat overlay -->
      <div class="chat-overlay" id="chat-overlay" onclick="closeNativeChat()"></div>

      <!-- Chat panel -->
      <div class="chat-panel" id="chat-panel">
        <div class="chat-tabs-bar">
          <div class="chat-tabs-scroll" id="chat-tabs-scroll"></div>
          <div class="chat-tab-actions">
            <button class="chat-tab-btn" onclick="startNewChat()" title="New chat">&#43;</button>
            <div class="chat-history-wrapper">
              <button class="chat-tab-btn" onclick="toggleChatHistoryDropdown()" title="Chat history"><svg width="13" height="13" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.5"/><polyline points="8,4.5 8,8 10.5,10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
              <div class="chat-history-dropdown" id="chat-history-dropdown"></div>
            </div>
            <button class="chat-tab-btn" onclick="closeNativeChat()" title="Close">&#10005;</button>
          </div>
        </div>
        <div class="chat-context" id="chat-context">
          <div class="chat-context-title">
            <span><svg width="11" height="11" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align:-1px"><rect x="3" y="1.5" width="10" height="13" rx="1.5" stroke="currentColor" stroke-width="1.5"/><line x1="5.5" y1="6" x2="10.5" y2="6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><line x1="5.5" y1="8.5" x2="10.5" y2="8.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><line x1="5.5" y1="11" x2="8.5" y2="11" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg></span> Analyzing <span id="chat-log-count">0</span> <span id="chat-context-label">selected</span> log(s)
          </div>
          <div class="chat-context-logs" id="chat-context-logs"></div>
        </div>
        <div class="chat-messages" id="chat-messages"></div>
        <div class="chat-input-container">
          <textarea class="chat-input" id="chat-input" placeholder="Ask about these logs..." rows="1"
                    onkeydown="handleChatKeydown(event)" oninput="autoResizeTextarea(this)"></textarea>
          <button class="chat-send-btn" id="chat-send-btn" onclick="sendChatMessage()">Send</button>
        </div>
      </div>

      <script>
        const vscode = acquireVsCodeApi();
        let pollingStatus = '${pollingStatus}';
        let allLogs = [];
        let displayedLogs = [];
        let selectedIndices = new Set();
        let lastClickedIndex = -1;
        const MAX_DISPLAYED_LOGS = 50;
        const SCROLL_STEP = 10;
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

        function toggleSettingsDropdown(ev) {
          ev.stopPropagation();
          var dd = document.getElementById('settings-dropdown');
          dd.classList.toggle('hidden');
        }

        function closeSettingsDropdown() {
          document.getElementById('settings-dropdown').classList.add('hidden');
        }

        function changePostHogKey() {
          closeSettingsDropdown();
          vscode.postMessage({ type: 'resetPostHogKey' });
        }

        function changeOpenAIKey() {
          closeSettingsDropdown();
          vscode.postMessage({ type: 'resetOpenAIKey' });
        }

        function refreshSchema() {
          closeSettingsDropdown();
          vscode.postMessage({ type: 'refreshSchema' });
        }

        document.addEventListener('click', function() {
          closeSettingsDropdown();
        });
        document.getElementById('settings-wrap')?.addEventListener('click', function(ev) {
          ev.stopPropagation();
        });

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
          requestAnimationFrame(() => {
            const anchorDisplayIdx = oldStartIdx - newStartIdx;
            const cards = container.querySelectorAll('.log-card');
            if (cards[anchorDisplayIdx]) {
              container.scrollTop = cards[anchorDisplayIdx].offsetTop;
            }
            setTimeout(() => { isShiftingWindow = false; }, 400);
          });
        }

        function shiftWindowDown() {
          if (isShiftingWindow) return;
          isShiftingWindow = true;
          clearSelection();

          const filtered = currentFiltered;
          const oldEndIdx = windowEnd === -1 ? filtered.length : Math.min(windowEnd, filtered.length);
          if (oldEndIdx >= filtered.length) { isShiftingWindow = false; return; }

          const anchorFilteredIdx = oldEndIdx - 1;

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
          requestAnimationFrame(() => {
            const actualEnd = windowEnd === -1 ? filtered.length : windowEnd;
            const newStartIdx = Math.max(0, actualEnd - MAX_DISPLAYED_LOGS);
            const anchorDisplayIdx = anchorFilteredIdx - newStartIdx;
            const cards = container.querySelectorAll('.log-card');
            if (cards[anchorDisplayIdx]) {
              const card = cards[anchorDisplayIdx];
              container.scrollTop = card.offsetTop + card.offsetHeight - container.clientHeight;
            }
            setTimeout(() => { isShiftingWindow = false; }, 400);
          });
        }

        document.getElementById('logs-container').addEventListener('scroll', function() {
          if (isShiftingWindow) return;
          const container = this;
          const scrollTop = container.scrollTop;
          const distanceFromBottom = container.scrollHeight - scrollTop - container.clientHeight;

          if (scrollTop < 50 && currentFiltered.length > 0) {
            const endIdx = windowEnd === -1 ? currentFiltered.length : Math.min(windowEnd, currentFiltered.length);
            const startIdx = Math.max(0, endIdx - MAX_DISPLAYED_LOGS);
            if (startIdx > 0) { shiftWindowUp(); return; }
          }

          if (distanceFromBottom < 50 && currentFiltered.length > 0 && windowEnd !== -1) {
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
                const tagResult = fuzzyMatch(searchQuery, log.logEventType || '');
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
              '<p style="margin-bottom: 12px; opacity: 0.5;"><svg width="32" height="32" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="12" r="1.5" fill="currentColor"/><path d="M5.2 9.5a3.96 3.96 0 015.6 0" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M2.5 6.8a7.5 7.5 0 0111 0" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M0 4a11.2 11.2 0 0116 0" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></p>' +
              '<p><strong>Watching for live logs...</strong></p>' +
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

        function faIconClassFromUrl(url) {
          if (!url) return '';
          var match = url.match(/icons\\/([a-z0-9-]+)/i);
          return match ? 'fa-solid fa-' + match[1] : '';
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

        function deepParseJson(val) {
          if (typeof val === 'string') {
            try { return deepParseJson(JSON.parse(val)); } catch(e) { return val; }
          }
          if (Array.isArray(val)) return val.map(deepParseJson);
          if (val && typeof val === 'object') {
            var out = {};
            Object.keys(val).forEach(function(k) { out[k] = deepParseJson(val[k]); });
            return out;
          }
          return val;
        }

        function toggleRawJson(index) {
          var log = displayedLogs[index];
          if (!log || log.rawPosthogEvent == null) return;
          var panel = document.getElementById('raw-json-panel-' + index);
          var card = panel ? panel.closest('.log-card') : null;
          var label = card ? card.querySelector('.raw-json-label') : null;
          if (!panel) return;
          if (panel.classList.contains('expanded')) {
            panel.classList.remove('expanded');
            panel.innerHTML = '';
            panel.setAttribute('aria-hidden', 'true');
            if (label) label.textContent = '\\u25BC Raw JSON';
          } else {
            try {
              var jsonStr = JSON.stringify(deepParseJson(log.rawPosthogEvent), null, 2);
              panel.innerHTML = '<pre class="raw-json-pre">' + escapeHtml(jsonStr) + '</pre>';
              panel.classList.add('expanded');
              panel.setAttribute('aria-hidden', 'false');
              if (label) label.textContent = '\\u25B2 Raw JSON';
            } catch (e) {
              panel.innerHTML = '<pre class="raw-json-pre">' + escapeHtml(String(e)) + '</pre>';
              panel.classList.add('expanded');
              if (label) label.textContent = '\\u25B2 Raw JSON';
            }
          }
        }

        function goDeeper(index) {
          var insight = displayedLogs[index];
          if (!insight || !insight.isInsight) return;

          var parentLogs = [];
          var ids = insight.sourceLogIds;
          if (ids && ids.length > 0) {
            var idSet = {};
            ids.forEach(function(id) { idSet[id] = true; });
            parentLogs = allLogs.filter(function(l) { return !l.isInsight && idSet[l.uuid]; });
          }

          if (parentLogs.length === 0) {
            parentLogs = allLogs.filter(function(l) { return !l.isInsight; }).slice(-25);
          }

          var previewLogs = parentLogs.slice(0, 25);

          var summary = (insight.logMessage || '').substring(0, 200);
          var message = 'Explain this insight in more depth: "' + summary + '". '
            + 'Analyze and explain the source logs. If any thing looks off, identify the root cause, assess the impact, and suggest specific actionable fixes.';

          var windowStart = insight.windowStart || '';
          var windowEnd = insight.windowEnd || '';

          openNativeChat(previewLogs, message, { windowStart: windowStart, windowEnd: windowEnd });
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
            var detailsHtml = '';
            if (log.level2Markdown) {
              detailsHtml =
                '<div class="insight-details-toggle">' +
                  '<button class="details-btn" onclick="event.stopPropagation(); toggleLevel2(\\'' + insightId + '\\')" title="Show detailed analysis">\\u25B6 Details</button>' +
                '</div>' +
                '<div class="insight-level2" id="' + insightId + '">' +
                  renderMarkdown(log.level2Markdown) +
                  '<div class="go-deeper-container">' +
                    '<button class="go-deeper-btn" onclick="event.stopPropagation(); goDeeper(' + index + ')" title="Analyze source logs in depth"><svg width="11" height="11" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align:-1px;margin-right:4px"><circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" stroke-width="1.5"/><line x1="9.9" y1="9.9" x2="14" y2="14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>Go Deeper</button>' +
                  '</div>' +
                '</div>';
            }

            var iconClass = faIconClassFromUrl(log.insightIconUrl || '');
            var iconHtml = iconClass
              ? '<i class="' + iconClass + ' insight-icon" style="color:' + insightColor + '"></i>'
              : '';

            var headingText = escapeHtml(log.insightCategory || log.logLevel);
            if (log.insightType) {
              headingText += '<span class="insight-heading-sep">:</span>' + escapeHtml(log.insightType);
            }

            return '<div class="log-card insight-card ' + selectedClass + '" data-index="' + index + '" ' +
              'style="--insight-color:' + insightColor + '; --insight-bg:rgba(' + rgb + ',0.08); --insight-btn-bg:rgba(' + rgb + ',0.2);" ' +
              'onclick="handleLogClick(event, ' + index + ')">' +
              '<div class="log-header">' +
                '<div class="log-checkbox ' + checkedClass + '"></div>' +
                iconHtml +
                '<span class="insight-heading">' + headingText + '</span>' +
                '<span class="log-timestamp">' + escapeHtml(log.timestamp) + '</span>' +
                '<span class="log-event-type">' + escapeHtml(log.logEventType) + '</span>' +
                '<span class="log-event">' + escapeHtml(log.event) + '</span>' +
              '</div>' +
              '<div class="log-body">' +
                '<div class="log-message">' + messageHtml + '</div>' +
              '</div>' +
              detailsHtml +
            '</div>';
          }

          var rawJsonBlock = '';
          if (log.rawPosthogEvent != null) {
            rawJsonBlock =
              '<div class="raw-json-wrap">' +
                '<button type="button" class="raw-json-toggle" onclick="event.stopPropagation(); toggleRawJson(' + index + ')" title="Show full PostHog response">' +
                  '<span class="raw-json-label">\\u25BC Raw JSON</span>' +
                '</button>' +
                '<div class="raw-json-panel" id="raw-json-panel-' + index + '" aria-hidden="true"></div>' +
              '</div>';
          }
          return '<div class="log-card ' + selectedClass + '" data-index="' + index + '" onclick="handleLogClick(event, ' + index + ')">' +
            '<div class="log-header">' +
              '<div class="log-checkbox ' + checkedClass + '"></div>' +
              '<span class="log-level ' + levelClass + '">' + escapeHtml(log.logLevel) + '</span>' +
              '<span class="log-timestamp">' + escapeHtml(log.timestamp) + '</span>' +
              '<span class="log-event-type">' + escapeHtml(log.logEventType) + '</span>' +
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
            rawJsonBlock +
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

        // ── Native Chat ──

        var chatLogs = [];
        var conversationId = '';
        var isWaitingForResponse = false;
        var allChatsList = [];
        var goDeeperState = null;
        var historyDropdownRequested = false;

        function renderChatTabs() {
          var scrollContainer = document.getElementById('chat-tabs-scroll');
          if (!scrollContainer) return;
          var tabs = [];
          var isCurrentInList = allChatsList.some(function(c) { return c.id === conversationId; });

          if (!isCurrentInList && conversationId) {
            tabs.push({ id: conversationId, title: 'New Chat' });
          }

          for (var i = 0; i < allChatsList.length && tabs.length < 3; i++) {
            tabs.push({ id: allChatsList[i].id, title: allChatsList[i].title });
          }

          scrollContainer.innerHTML = tabs.map(function(tab) {
            var activeClass = tab.id === conversationId ? ' active' : '';
            var safeId = escapeHtml(tab.id);
            var safeTitle = escapeHtml(tab.title);
            return '<div class="chat-tab' + activeClass + '" data-tab-id="' + safeId + '" title="' + safeTitle + '">' + safeTitle + '</div>';
          }).join('');

          scrollContainer.querySelectorAll('.chat-tab').forEach(function(el) {
            var tabId = el.getAttribute('data-tab-id');
            el.addEventListener('click', function() { switchTab(tabId); });
          });
        }

        function switchTab(chatId) {
          if (chatId === conversationId) return;
          var isInHistory = allChatsList.some(function(c) { return c.id === chatId; });
          if (isInHistory) {
            loadChat(chatId);
          }
        }

        function startNewChat() {
          var newId = 'chat-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6);
          conversationId = newId;
          var logsToAnalyze = [];
          var contextLabel = 'latest';
          if (selectedIndices.size > 0) {
            var sortedIdx = Array.from(selectedIndices).sort(function(a, b) { return a - b; });
            logsToAnalyze = sortedIdx.map(function(idx) { return displayedLogs[idx]; }).filter(Boolean);
            contextLabel = 'selected';
          } else {
            logsToAnalyze = allLogs.slice(-25);
          }
          chatLogs = logsToAnalyze;

          document.getElementById('chat-log-count').textContent = chatLogs.length;
          document.getElementById('chat-context-label').textContent = contextLabel;
          var contextContainer = document.getElementById('chat-context-logs');
          contextContainer.innerHTML = chatLogs.map(function(l) {
            return '<div class="chat-context-log">[' + escapeHtml(l.logLevel) + '] ' + escapeHtml(l.timestamp) + ' [' + escapeHtml(l.logEventType) + '] ' + escapeHtml((l.logMessage || '').substring(0, 100)) + '</div>';
          }).join('');

          document.getElementById('chat-messages').innerHTML = '';
          isWaitingForResponse = false;
          document.getElementById('chat-send-btn').disabled = false;
          document.getElementById('chat-context').style.display = '';
          document.getElementById('chat-history-dropdown').classList.remove('visible');
          renderChatTabs();
          document.getElementById('chat-input').focus();
        }

        document.addEventListener('click', function(e) {
          var dropdown = document.getElementById('chat-history-dropdown');
          var wrapper = document.querySelector('.chat-history-wrapper');
          if (dropdown && dropdown.classList.contains('visible') && wrapper && !wrapper.contains(e.target)) {
            dropdown.classList.remove('visible');
            historyDropdownRequested = false;
          }
        });

        function openNativeChat(overrideLogs, autoMessage, goDeeperInfo) {
          var logsToAnalyze = [];
          var contextLabel = 'selected';
          goDeeperState = goDeeperInfo || null;

          if (overrideLogs && overrideLogs.length > 0) {
            logsToAnalyze = overrideLogs;
            contextLabel = 'source';
          } else if (selectedIndices.size > 0) {
            var sortedIdx = Array.from(selectedIndices).sort(function(a, b) { return a - b; });
            logsToAnalyze = sortedIdx.map(function(idx) { return displayedLogs[idx]; }).filter(Boolean);
            contextLabel = 'selected';
          } else {
            logsToAnalyze = allLogs.slice(-25);
            contextLabel = 'latest';
          }

          chatLogs = logsToAnalyze;
          conversationId = 'chat-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6);

          document.getElementById('chat-log-count').textContent = chatLogs.length;
          document.getElementById('chat-context-label').textContent = contextLabel;

          var contextContainer = document.getElementById('chat-context-logs');
          contextContainer.innerHTML = chatLogs.map(function(l) {
            return '<div class="chat-context-log">[' + escapeHtml(l.logLevel) + '] ' + escapeHtml(l.timestamp) + ' [' + escapeHtml(l.logEventType) + '] ' + escapeHtml((l.logMessage || '').substring(0, 100)) + '</div>';
          }).join('');

          document.getElementById('chat-messages').innerHTML = '';
          isWaitingForResponse = false;
          document.getElementById('chat-send-btn').disabled = false;
          document.getElementById('chat-context').style.display = '';
          document.getElementById('chat-history-dropdown').classList.remove('visible');

          document.getElementById('chat-overlay').classList.add('visible');
          document.getElementById('chat-panel').classList.add('open');
          renderChatTabs();
          vscode.postMessage({ type: 'listChats' });
          document.getElementById('chat-input').focus();

          if (autoMessage) {
            document.getElementById('chat-input').value = autoMessage;
            sendChatMessage();
          }
        }

        function closeNativeChat() {
          document.getElementById('chat-overlay').classList.remove('visible');
          document.getElementById('chat-panel').classList.remove('open');
          document.getElementById('chat-history-dropdown').classList.remove('visible');
        }

        function toggleChatHistoryDropdown() {
          var dropdown = document.getElementById('chat-history-dropdown');
          if (dropdown.classList.contains('visible')) {
            dropdown.classList.remove('visible');
            historyDropdownRequested = false;
          } else {
            historyDropdownRequested = true;
            vscode.postMessage({ type: 'listChats' });
          }
        }

        function renderChatHistoryDropdown(chats) {
          var dropdown = document.getElementById('chat-history-dropdown');
          if (!chats || chats.length === 0) {
            dropdown.innerHTML = '<div class="chat-history-dropdown-title">Chat History</div><div class="chat-history-empty">No previous chats</div>';
            return;
          }
          var html = '<div class="chat-history-dropdown-title">Chat History</div>';
          html += chats.map(function(chat) {
            var date = new Date(chat.updatedAt);
            var dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                        + ' ' + date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
            var activeClass = chat.id === conversationId ? ' active' : '';
            var safeId = escapeHtml(chat.id);
            return '<div class="chat-history-item' + activeClass + '" data-chat-id="' + safeId + '">'
              + '<div class="chat-history-item-text">'
              + '<div class="chat-history-item-title">' + escapeHtml(chat.title) + '</div>'
              + '<div class="chat-history-item-date">' + escapeHtml(dateStr) + '</div>'
              + '</div>'
              + '<button class="chat-history-delete" data-delete-id="' + safeId + '" title="Delete">&#10005;</button>'
              + '</div>';
          }).join('');

          dropdown.innerHTML = html;

          dropdown.querySelectorAll('.chat-history-item').forEach(function(el) {
            var chatId = el.getAttribute('data-chat-id');
            el.addEventListener('click', function() {
              dropdown.classList.remove('visible');
              loadChat(chatId);
            });
          });
          dropdown.querySelectorAll('.chat-history-delete').forEach(function(el) {
            var chatId = el.getAttribute('data-delete-id');
            el.addEventListener('click', function(e) { e.stopPropagation(); deleteChat(chatId); });
          });
        }

        function loadChat(chatId) {
          conversationId = chatId;
          document.getElementById('chat-context').style.display = 'none';
          document.getElementById('chat-messages').innerHTML = '';
          isWaitingForResponse = false;
          document.getElementById('chat-send-btn').disabled = false;
          addTypingIndicator();
          vscode.postMessage({ type: 'loadChat', conversationId: chatId });
          renderChatTabs();
        }

        function deleteChat(chatId) {
          vscode.postMessage({ type: 'deleteChat', conversationId: chatId });
          if (chatId === conversationId) {
            document.getElementById('chat-messages').innerHTML = '';
            conversationId = '';
          }
          allChatsList = allChatsList.filter(function(c) { return c.id !== chatId; });
          renderChatTabs();
          renderChatHistoryDropdown(allChatsList);
        }

        function sendChatMessage() {
          var input = document.getElementById('chat-input');
          var message = input.value.trim();
          if (!message || isWaitingForResponse) return;

          addChatMessage('user', message);
          input.value = '';
          input.style.height = '36px';
          isWaitingForResponse = true;
          document.getElementById('chat-send-btn').disabled = true;
          addTypingIndicator();

          var chatMsg = {
            type: 'nativeChatMessage',
            logs: chatLogs,
            message: message,
            conversationId: conversationId
          };
          if (goDeeperState) {
            chatMsg.goDeeper = true;
            chatMsg.windowStart = goDeeperState.windowStart;
            chatMsg.windowEnd = goDeeperState.windowEnd;
            goDeeperState = null;
          }
          vscode.postMessage(chatMsg);
        }

        function addChatMessage(role, content, isError) {
          var container = document.getElementById('chat-messages');
          var msgDiv = document.createElement('div');
          var cls = 'chat-msg ' + role;
          if (isError) cls = 'chat-msg error';
          msgDiv.className = cls;

          if (role === 'assistant' && !isError) {
            msgDiv.innerHTML = renderChatMarkdown(content);
          } else {
            msgDiv.textContent = content;
          }

          removeTypingIndicator();
          container.appendChild(msgDiv);
          container.scrollTop = container.scrollHeight;
        }

        function addTypingIndicator() {
          removeTypingIndicator();
          var container = document.getElementById('chat-messages');
          var indicator = document.createElement('div');
          indicator.className = 'typing-indicator';
          indicator.id = 'typing-indicator';
          indicator.innerHTML = '<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>';
          container.appendChild(indicator);
          container.scrollTop = container.scrollHeight;
        }

        function removeTypingIndicator() {
          var el = document.getElementById('typing-indicator');
          if (el) el.remove();
        }

        function renderChatMarkdown(text) {
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

        function handleChatKeydown(event) {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            sendChatMessage();
          }
        }

        function autoResizeTextarea(el) {
          el.style.height = 'auto';
          el.style.height = Math.min(el.scrollHeight, 120) + 'px';
        }

        function updateChatFab() {
          var fab = document.getElementById('chat-fab');
          if (allLogs.length > 0) {
            fab.classList.remove('hidden');
          } else {
            fab.classList.add('hidden');
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
          updateChatFab();

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
            case 'chatResponse':
              if (message.conversationId === conversationId) {
                isWaitingForResponse = false;
                document.getElementById('chat-send-btn').disabled = false;
                addChatMessage('assistant', message.content, message.isError);
              }
              break;
            case 'chatList':
              allChatsList = message.chats || [];
              renderChatTabs();
              if (historyDropdownRequested) {
                renderChatHistoryDropdown(allChatsList);
                document.getElementById('chat-history-dropdown').classList.add('visible');
                historyDropdownRequested = false;
              }
              break;
            case 'chatLoaded':
              if (message.conversationId === conversationId) {
                removeTypingIndicator();
                document.getElementById('chat-messages').innerHTML = '';
                if (message.error) {
                  addChatMessage('assistant', message.error, true);
                } else if (message.messages) {
                  message.messages.forEach(function(m) {
                    addChatMessage(m.role, m.content, false);
                  });
                }
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
              updateChatFab();
              break;
          }
        });

        ${logs.length > 0 ? `
          allLogs = ${JSON.stringify(logs)};
          allLogs.forEach(function(log) {
            if (log.isInsight && log.insightCategory) {
              addInsightCategoryToFilter(log.insightCategory);
            }
          });
          windowEnd = -1;
          renderFilteredLogs();
          updateChatFab();
        ` : ''}
      </script>
    </body>
    </html>`;
}

export function getIntroHtml(options?: { posthogLogoUri?: string }): string {
  const logoSrc = options?.posthogLogoUri ?? '';
  return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: var(--vscode-font-family), system-ui, sans-serif;
          font-size: 13px;
          color: var(--vscode-foreground);
          background: var(--vscode-panel-background);
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          padding: 24px;
        }
        .intro-container {
          max-width: 420px;
          width: 100%;
          text-align: center;
        }
        .intro-logo {
          margin-bottom: 16px;
          display: flex;
          justify-content: center;
        }
        .intro-logo img {
          width: 48px;
          height: 48px;
          border-radius: 10px;
        }
        .intro-container h1 {
          font-size: 20px;
          font-weight: 700;
          margin-bottom: 8px;
        }
        .intro-tagline {
          color: var(--vscode-descriptionForeground);
          font-size: 13px;
          line-height: 1.6;
          margin-bottom: 28px;
        }
        .feature-list {
          text-align: left;
          margin: 0 auto 32px;
          max-width: 340px;
        }
        .feature-item {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          margin-bottom: 14px;
          font-size: 12px;
          line-height: 1.5;
          color: var(--vscode-foreground);
        }
        .feature-icon {
          display: inline-flex;
          align-items: center;
          flex-shrink: 0;
          margin-top: 1px;
          opacity: 0.8;
        }
        .feature-item strong {
          font-weight: 600;
        }
        .get-started-btn {
          width: 100%;
          max-width: 280px;
          padding: 12px 24px;
          font-size: 14px;
          font-weight: 600;
          font-family: var(--vscode-font-family), system-ui, sans-serif;
          background: linear-gradient(135deg, #2563EB 0%, #3B82F6 100%);
          color: white;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.2s ease;
          box-shadow: 0 2px 8px rgba(37, 99, 235, 0.3);
        }
        .get-started-btn:hover {
          background: linear-gradient(135deg, #1D4ED8 0%, #2563EB 100%);
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(37, 99, 235, 0.4);
        }
        .get-started-btn:active { transform: translateY(0); }
      </style>
    </head>
    <body>
      <div class="intro-container">
        <div class="intro-logo"><img src="${escapeHtml(logoSrc)}" alt="PostHog" /></div>
        <h1>Welcome to QApilot</h1>
        <p class="intro-tagline">AI-powered observability right inside your editor. Connect your logs, get real-time insights, and debug faster.</p>

        <div class="feature-list">
          <div class="feature-item">
            <span class="feature-icon"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="12" r="1.5" fill="currentColor"/><path d="M5.2 9.5a3.96 3.96 0 015.6 0" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M2.5 6.8a7.5 7.5 0 0111 0" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M0 4a11.2 11.2 0 0116 0" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></span>
            <span><strong>Live log streaming</strong> &mdash; Watch events in real time without leaving the IDE.</span>
          </div>
          <div class="feature-item">
            <span class="feature-icon"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9.5 1.5L5 8.5H8.5L7 14.5L12 7.5H8.5L9.5 1.5Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"/></svg></span>
            <span><strong>AI-driven insights</strong> &mdash; Automatically surfaces error spikes, performance regressions, and anomalies.</span>
          </div>
          <div class="feature-item">
            <span class="feature-icon"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 3C2 2.45 2.45 2 3 2H13C13.55 2 14 2.45 14 3V10C14 10.55 13.55 11 13 11H5L2 14V3Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg></span>
            <span><strong>Chat with your logs</strong> &mdash; Ask questions about your logs and get detailed answers.</span>
          </div>
        </div>

        <button class="get-started-btn" onclick="getStarted()">Get Started</button>
      </div>

      <script>
        const vscode = acquireVsCodeApi();
        function getStarted() {
          vscode.postMessage({ type: 'getStarted' });
        }
      </script>
    </body>
    </html>`;
}

export interface SetupHtmlOptions {
  prefilledApiKey?: string;
  prefilledProjectId?: string;
  showBackButton?: boolean;
  /** Resolved URI for the local PostHog logomark (media/posthog-logomark.svg). */
  posthogLogomarkUri?: string;
  /** Resolved URIs for platform icons in media/ (datadog.svg, sentry.svg, grafana.svg). */
  platformIconUris?: { datadog: string; sentry: string; grafana: string };
}

export function getSetupHtml(options?: SetupHtmlOptions): string {
  const apiKey = options?.prefilledApiKey ?? '';
  const projectId = options?.prefilledProjectId ?? '';
  const showBack = options?.showBackButton ?? false;
  const logomarkSrc = options?.posthogLogomarkUri ?? 'https://posthog.com/brand/posthog-logomark.svg';
  const icons = options?.platformIconUris;
  const datadogSrc = icons?.datadog ?? '';
  const sentrySrc = icons?.sentry ?? '';
  const grafanaSrc = icons?.grafana ?? '';
  return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: var(--vscode-font-family), system-ui, sans-serif;
          font-size: 13px;
          color: var(--vscode-foreground);
          background: var(--vscode-panel-background);
          display: flex;
          align-items: flex-start;
          justify-content: center;
          min-height: 100vh;
          padding: 16px 24px;
        }
        .setup-container {
          max-width: 420px;
          width: 100%;
        }
        .setup-header {
          text-align: center;
          margin-bottom: 16px;
        }
        .setup-logo {
          font-size: 32px;
          margin-bottom: 8px;
        }
        .setup-logo img {
          width: 40px;
          height: 40px;
          display: block;
          margin: 0 auto;
        }
        .setup-header h1 {
          font-size: 18px;
          font-weight: 600;
          margin-bottom: 6px;
        }
        .setup-header p {
          color: var(--vscode-descriptionForeground);
          font-size: 12px;
          line-height: 1.5;
        }
        .step-indicator {
          display: flex;
          justify-content: center;
          gap: 8px;
          margin-bottom: 14px;
        }
        .step-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--vscode-panel-border);
        }
        .step-dot.active {
          background: var(--vscode-button-background);
          box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.2);
        }
        .step-dot.done {
          background: #3fb950;
        }
        .form-group {
          margin-bottom: 12px;
        }
        .form-group label {
          display: block;
          font-size: 12px;
          font-weight: 500;
          margin-bottom: 6px;
          color: var(--vscode-foreground);
        }
        .form-group .hint {
          font-size: 11px;
          color: var(--vscode-descriptionForeground);
          margin-top: 4px;
          line-height: 1.4;
        }
        .form-group .hint a {
          color: var(--vscode-textLink-foreground);
          text-decoration: none;
        }
        .form-group .hint a:hover {
          color: var(--vscode-textLink-activeForeground);
        }
        .form-group input {
          width: 100%;
          padding: 8px 10px;
          font-size: 13px;
          font-family: var(--vscode-editor-font-family), monospace;
          background: var(--vscode-input-background);
          color: var(--vscode-input-foreground);
          border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
          border-radius: 4px;
          outline: none;
        }
        .form-group input:focus {
          border-color: var(--vscode-focusBorder);
        }
        .form-group input::placeholder {
          color: var(--vscode-input-placeholderForeground);
        }
        .connect-btn {
          width: 100%;
          padding: 10px;
          font-size: 13px;
          font-weight: 500;
          font-family: var(--vscode-font-family), system-ui, sans-serif;
          background: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          border: none;
          border-radius: 4px;
          cursor: pointer;
          margin-top: 8px;
          transition: background 0.15s, transform 0.1s;
        }
        .connect-btn:hover {
          background: var(--vscode-button-hoverBackground);
        }
        .connect-btn:active { transform: scale(0.98); }
        .connect-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .setup-actions {
          margin-top: 8px;
        }
        .setup-actions .connect-btn { width: 100%; }
        .setup-top-bar {
          margin-bottom: 12px;
          text-align: left;
        }
        .back-btn {
          padding: 0;
          font-size: 12px;
          font-family: var(--vscode-font-family), system-ui, sans-serif;
          background: none;
          color: var(--vscode-textLink-foreground);
          border: none;
          cursor: pointer;
          text-decoration: none;
        }
        .back-btn:hover {
          text-decoration: underline;
        }
        .back-btn:active { opacity: 0.6; }
        .error-msg {
          background: rgba(248, 81, 73, 0.15);
          border: 1px solid rgba(248, 81, 73, 0.4);
          border-radius: 4px;
          padding: 10px 12px;
          color: #f85149;
          font-size: 12px;
          margin-top: 12px;
          display: none;
          line-height: 1.4;
        }
        .success-msg {
          background: rgba(63, 185, 80, 0.15);
          border: 1px solid rgba(63, 185, 80, 0.4);
          border-radius: 4px;
          padding: 10px 12px;
          color: #3fb950;
          font-size: 12px;
          margin-top: 12px;
          display: none;
          line-height: 1.4;
        }
        .help-link {
          display: block;
          text-align: center;
          margin-top: 20px;
          font-size: 11px;
        }
        .help-link a {
          color: var(--vscode-textLink-foreground);
          text-decoration: none;
        }
        .help-link a:hover {
          text-decoration: underline;
        }
        .platforms-section {
          margin-top: 20px;
          text-align: center;
          background: linear-gradient(145deg, rgba(99, 120, 255, 0.07) 0%, var(--vscode-editor-inactiveSelectionBackground) 70%);
          border: 1px solid rgba(99, 120, 255, 0.35);
          border-radius: 12px;
          padding: 16px 20px;
          position: relative;
          box-shadow: 0 0 18px rgba(99, 120, 255, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.04);
        }
        .platforms-icons-row {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 20px;
          margin-bottom: 8px;
        }
        .platforms-icons-row .platform-icon {
          width: 28px;
          height: 28px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .platforms-icons-row .platform-icon svg {
          width: 100%;
          height: 100%;
          object-fit: contain;
        }
        .platforms-icons-row .platform-icon:nth-child(-n+2) img {
          filter: brightness(1.6) saturate(1.5);
        }
        .platforms-coming-soon {
          font-size: 13px;
          font-weight: 500;
          color: var(--vscode-foreground);
          margin-bottom: 4px;
        }
        .platforms-sub {
          font-size: 11px;
          color: var(--vscode-descriptionForeground);
          margin-bottom: 12px;
        }
        .platform-request-btn {
          display: inline-block;
          padding: 9px 20px;
          font-size: 12px;
          font-weight: 500;
          color: var(--vscode-button-foreground);
          background: var(--vscode-button-background);
          border: none;
          border-radius: 6px;
          cursor: pointer;
          text-decoration: none;
          transition: opacity 0.2s, transform 0.1s;
        }
        .platform-request-btn:hover {
          opacity: 0.9;
          color: var(--vscode-button-foreground);
          text-decoration: none;
        }
        .platform-request-btn:active { opacity: 0.75; transform: scale(0.97); }
      </style>
    </head>
    <body>
      <div class="setup-container">
        ${showBack ? '<div class="setup-top-bar"><button class="back-btn" id="back-btn" onclick="goBackToLogs()">← Back</button></div>' : ''}
        <div class="step-indicator">
          <div class="step-dot done"></div>
          <div class="step-dot active"></div>
          <div class="step-dot"></div>
        </div>

        <div class="setup-header">
          <div class="setup-logo"><img src="${escapeHtml(logomarkSrc)}" alt="PostHog" /></div>
          <h1>Connect to PostHog</h1>
        </div>

        <div class="form-group">
          <label for="api-key">Personal API Key</label>
          <input type="password" id="api-key" placeholder="phx_..." autocomplete="off" value="${escapeHtml(apiKey)}" />
          <div class="hint"><a href="https://app.posthog.com/settings/user-api-keys" target="_blank">Find this in PostHog &rarr; Settings &rarr; Personal API Keys</a></div>
        </div>

        <div class="form-group">
          <label for="project-id">Project ID</label>
          <input type="text" id="project-id" placeholder="e.g. 12345" autocomplete="off" value="${escapeHtml(projectId)}" />
          <div class="hint"><a href="https://app.posthog.com/settings/project" target="_blank">Find this in PostHog &rarr; Settings &rarr; Project &rarr; Project ID</a></div>
        </div>

        <div class="setup-actions">
          <button class="connect-btn" id="connect-btn" onclick="handleConnect()">${showBack ? 'Update' : 'Connect'}</button>
        </div>

        <div class="error-msg" id="error-msg"></div>
        <div class="success-msg" id="success-msg"></div>

        <div class="platforms-section">
          <div class="platforms-icons-row" aria-hidden="true">
            <span class="platform-icon" title="Datadog"><img src="${escapeHtml(datadogSrc)}" alt="Datadog" /></span>
            <span class="platform-icon" title="Sentry"><img src="${escapeHtml(sentrySrc)}" alt="Sentry" /></span>
            <span class="platform-icon" title="Grafana"><img src="${escapeHtml(grafanaSrc)}" alt="Grafana" /></span>
          </div>
          <p class="platforms-coming-soon">More platforms coming soon</p>
          <p class="platforms-sub">Datadog, Sentry, Grafana and others are on the way!</p>
          <a class="platform-request-btn" href="https://docs.google.com/forms/d/e/1FAIpQLSdabWeB6nQ2WAuYiLOmXKybHc1IQydhV5wUCvTDw7HCAaDrXw/viewform?usp=dialog" target="_blank">
            Request a platform &rarr;
          </a>
        </div>
      </div>

      <script>
        const vscode = acquireVsCodeApi();

        function handleConnect() {
          const apiKey = document.getElementById('api-key').value.trim();
          const projectId = document.getElementById('project-id').value.trim();
          const errorEl = document.getElementById('error-msg');
          const successEl = document.getElementById('success-msg');
          const btn = document.getElementById('connect-btn');

          errorEl.style.display = 'none';
          successEl.style.display = 'none';

          if (!apiKey) {
            errorEl.textContent = 'Please enter your PostHog Personal API Key.';
            errorEl.style.display = 'block';
            return;
          }
          if (!projectId) {
            errorEl.textContent = 'Please enter your PostHog Project ID.';
            errorEl.style.display = 'block';
            return;
          }

          btn.disabled = true;
          btn.textContent = 'Connecting...';

          vscode.postMessage({
            type: 'saveCredentials',
            apiKey: apiKey,
            projectId: projectId
          });
        }

        function goBackToLogs() {
          vscode.postMessage({ type: 'goBackToLogs' });
        }

        window.addEventListener('message', function(event) {
          const msg = event.data;
          const errorEl = document.getElementById('error-msg');
          const successEl = document.getElementById('success-msg');
          const btn = document.getElementById('connect-btn');

          if (msg.type === 'credentialResult') {
            if (msg.success) {
              successEl.textContent = 'Connected successfully!';
              successEl.style.display = 'block';
              errorEl.style.display = 'none';
            } else {
              errorEl.textContent = msg.error || 'Failed to connect. Check your credentials.';
              errorEl.style.display = 'block';
              successEl.style.display = 'none';
              btn.disabled = false;
              btn.textContent = document.getElementById('back-btn') ? 'Update' : 'Connect';
            }
          }
        });
      </script>
    </body>
    </html>`;
}

export interface OpenAISetupHtmlOptions {
  prefilledOpenAIKey?: string;
  showBackButton?: boolean;
  openaiLogoUri?: string;
  anthropicLogoUri?: string;
  geminiLogoUri?: string;
}

export function getOpenAISetupHtml(options?: OpenAISetupHtmlOptions): string {
  const openaiKey = options?.prefilledOpenAIKey ?? '';
  const showBack = options?.showBackButton ?? false;
  const openaiLogoSrc = options?.openaiLogoUri ?? '';
  const anthropicLogoSrc = options?.anthropicLogoUri ?? '';
  const geminiLogoSrc = options?.geminiLogoUri ?? '';
  return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: var(--vscode-font-family), system-ui, sans-serif;
          font-size: 13px;
          color: var(--vscode-foreground);
          background: var(--vscode-panel-background);
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          padding: 24px;
        }
        .setup-container {
          max-width: 420px;
          width: 100%;
        }
        .setup-header {
          text-align: center;
          margin-bottom: 28px;
        }
        .setup-logo {
          font-size: 32px;
          margin-bottom: 12px;
        }
        .setup-logo img {
          width: 40px;
          height: 40px;
          display: block;
          margin: 0 auto;
        }
        .setup-header h1 {
          font-size: 18px;
          font-weight: 600;
          margin-bottom: 6px;
        }
        .setup-header p {
          color: var(--vscode-descriptionForeground);
          font-size: 12px;
          line-height: 1.5;
        }
        .step-indicator {
          display: flex;
          justify-content: center;
          gap: 8px;
          margin-bottom: 24px;
        }
        .step-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--vscode-panel-border);
        }
        .step-dot.active {
          background: var(--vscode-button-background);
          box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.2);
        }
        .step-dot.done {
          background: #3fb950;
        }
        .form-group {
          margin-bottom: 16px;
        }
        .form-group label {
          display: block;
          font-size: 12px;
          font-weight: 500;
          margin-bottom: 6px;
          color: var(--vscode-foreground);
        }
        .form-group .hint {
          font-size: 11px;
          color: var(--vscode-descriptionForeground);
          margin-top: 4px;
          line-height: 1.4;
        }
        .form-group .hint a {
          color: var(--vscode-textLink-foreground);
          text-decoration: none;
        }
        .form-group .hint a:hover {
          color: var(--vscode-textLink-activeForeground);
        }
        .form-group input {
          width: 100%;
          padding: 8px 10px;
          font-size: 13px;
          font-family: var(--vscode-editor-font-family), monospace;
          background: var(--vscode-input-background);
          color: var(--vscode-input-foreground);
          border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
          border-radius: 4px;
          outline: none;
        }
        .form-group input:focus {
          border-color: var(--vscode-focusBorder);
        }
        .form-group input::placeholder {
          color: var(--vscode-input-placeholderForeground);
        }
        .connect-btn {
          width: 100%;
          padding: 10px;
          font-size: 13px;
          font-weight: 500;
          font-family: var(--vscode-font-family), system-ui, sans-serif;
          background: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          border: none;
          border-radius: 4px;
          cursor: pointer;
          margin-top: 8px;
          transition: background 0.15s, transform 0.1s;
        }
        .connect-btn:hover {
          background: var(--vscode-button-hoverBackground);
        }
        .connect-btn:active { transform: scale(0.98); }
        .connect-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .setup-actions {
          margin-top: 8px;
        }
        .setup-actions .connect-btn { width: 100%; }
        .setup-top-bar {
          margin-bottom: 20px;
          text-align: left;
        }
        .back-btn {
          padding: 0;
          font-size: 12px;
          font-family: var(--vscode-font-family), system-ui, sans-serif;
          background: none;
          color: var(--vscode-textLink-foreground);
          border: none;
          cursor: pointer;
          text-decoration: none;
        }
        .back-btn:hover {
          text-decoration: underline;
        }
        .back-btn:active { opacity: 0.6; }
        .error-msg {
          background: rgba(248, 81, 73, 0.15);
          border: 1px solid rgba(248, 81, 73, 0.4);
          border-radius: 4px;
          padding: 10px 12px;
          color: #f85149;
          font-size: 12px;
          margin-top: 12px;
          display: none;
          line-height: 1.4;
        }
        .success-msg {
          background: rgba(63, 185, 80, 0.15);
          border: 1px solid rgba(63, 185, 80, 0.4);
          border-radius: 4px;
          padding: 10px 12px;
          color: #3fb950;
          font-size: 12px;
          margin-top: 12px;
          display: none;
          line-height: 1.4;
        }
        .ai-models-section {
          margin-top: 36px;
          text-align: center;
          background: linear-gradient(145deg, rgba(99, 120, 255, 0.07) 0%, var(--vscode-editor-inactiveSelectionBackground) 70%);
          border: 1px solid rgba(99, 120, 255, 0.35);
          border-radius: 12px;
          padding: 22px 20px;
          position: relative;
          box-shadow: 0 0 18px rgba(99, 120, 255, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.04);
        }
        .ai-models-icons-row {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 20px;
          margin-bottom: 12px;
        }
        .ai-models-icons-row .model-icon {
          width: 28px;
          height: 28px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .ai-models-icons-row .model-icon img {
          width: 100%;
          height: 100%;
          object-fit: contain;
          filter: invert(1) brightness(0.85);
        }
        .ai-models-coming-soon {
          font-size: 13px;
          font-weight: 500;
          color: var(--vscode-foreground);
          margin-bottom: 6px;
        }
        .ai-models-sub {
          font-size: 11px;
          color: var(--vscode-descriptionForeground);
        }
      </style>
    </head>
    <body>
      <div class="setup-container">
        ${showBack ? '<div class="setup-top-bar"><button class="back-btn" id="back-btn" onclick="goBackToLogs()">← Back</button></div>' : ''}
        <div class="step-indicator">
          <div class="step-dot done"></div>
          <div class="step-dot done"></div>
          <div class="step-dot active"></div>
        </div>

        <div class="setup-header">
          <div class="setup-logo"><img src="${escapeHtml(openaiLogoSrc)}" alt="OpenAI" style="filter: invert(1) brightness(0.9);" /></div>
          <h1>Connect OpenAI</h1>
          <p>QApilot uses OpenAI to analyze your logs and generate insights.</p>
        </div>

        <div class="form-group">
          <label for="openai-key">OpenAI API Key</label>
          <input type="password" id="openai-key" placeholder="sk-..." autocomplete="off" value="${escapeHtml(openaiKey)}" />
          <div class="hint"><a href="https://platform.openai.com/api-keys" target="_blank">Find this at platform.openai.com &rarr; API Keys</a></div>
        </div>

        <div class="setup-actions">
          <button class="connect-btn" id="save-btn" onclick="handleSave()">${showBack ? 'Update' : 'Save &amp; Continue'}</button>
        </div>

        <div class="error-msg" id="error-msg"></div>
        <div class="success-msg" id="success-msg"></div>

        <div class="ai-models-section">
          <div class="ai-models-icons-row" aria-hidden="true">
            <span class="model-icon" title="Anthropic"><img src="${escapeHtml(anthropicLogoSrc)}" alt="Anthropic" /></span>
            <span class="model-icon" title="Gemini"><img src="${escapeHtml(geminiLogoSrc)}" alt="Gemini" /></span>
          </div>
          <p class="ai-models-coming-soon">More AI models coming soon</p>
          <p class="ai-models-sub">Anthropic, Gemini and others are on the way!</p>
        </div>
      </div>

      <script>
        const vscode = acquireVsCodeApi();

        function handleSave() {
          const openaiKey = document.getElementById('openai-key').value.trim();
          const errorEl = document.getElementById('error-msg');
          const successEl = document.getElementById('success-msg');
          const btn = document.getElementById('save-btn');

          errorEl.style.display = 'none';
          successEl.style.display = 'none';

          if (!openaiKey) {
            errorEl.textContent = 'Please enter your OpenAI API key.';
            errorEl.style.display = 'block';
            return;
          }

          if (!openaiKey.startsWith('sk-')) {
            errorEl.textContent = 'OpenAI API keys typically start with "sk-". Please check your key.';
            errorEl.style.display = 'block';
            return;
          }

          btn.disabled = true;
          btn.textContent = 'Validating...';

          vscode.postMessage({
            type: 'saveOpenAIKey',
            openaiKey: openaiKey
          });
        }

        function goBackToLogs() {
          vscode.postMessage({ type: 'goBackToLogs' });
        }

        window.addEventListener('message', function(event) {
          const msg = event.data;
          const errorEl = document.getElementById('error-msg');
          const successEl = document.getElementById('success-msg');
          const btn = document.getElementById('save-btn');

          if (msg.type === 'openaiKeyResult') {
            if (msg.success) {
              successEl.textContent = 'Connected successfully! Starting QApilot...';
              successEl.style.display = 'block';
              errorEl.style.display = 'none';
            } else {
              errorEl.textContent = msg.error || 'Failed to save API key.';
              errorEl.style.display = 'block';
              successEl.style.display = 'none';
              btn.disabled = false;
              btn.textContent = document.getElementById('back-btn') ? 'Update' : 'Save & Continue';
            }
          }
        });
      </script>
    </body>
    </html>`;
}

export function getAnalyzingSchemaHtml(): string {
  return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: var(--vscode-font-family), system-ui, sans-serif;
          font-size: 13px;
          color: var(--vscode-foreground);
          background: var(--vscode-panel-background);
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          padding: 24px;
        }
        .analyzing-container {
          text-align: center;
          max-width: 320px;
        }
        .spinner {
          width: 32px;
          height: 32px;
          margin: 0 auto 16px;
          border: 3px solid var(--vscode-panel-border);
          border-top-color: var(--vscode-button-background);
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        .analyzing-container p {
          color: var(--vscode-descriptionForeground);
          line-height: 1.5;
        }
      </style>
    </head>
    <body>
      <div class="analyzing-container">
        <div class="spinner"></div>
        <p>Analyzing your event schema...</p>
        <p style="margin-top: 8px; font-size: 12px;">Mapping PostHog properties to the log viewer.</p>
      </div>
    </body>
    </html>`;
}
