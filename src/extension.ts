import * as vscode from 'vscode';
import { QAPilotViewProvider } from './QAPilotViewProvider.js';
import * as conversationStore from './conversationStore.js';
import { log } from './logger.js';

let provider: QAPilotViewProvider;

export async function activate(context: vscode.ExtensionContext) {
  log('QAPilot extension is now active!');

  await conversationStore.init(context.globalStorageUri, context.secrets);

  provider = new QAPilotViewProvider(context.extensionUri, conversationStore);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      QAPilotViewProvider.viewType,
      provider
    )
  );

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
