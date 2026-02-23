import * as vscode from 'vscode';
import { QAPilotViewProvider } from './QAPilotViewProvider.js';
import * as conversationStore from './conversationStore.js';
import { CredentialManager } from './credentialManager.js';
import { log } from './logger.js';

let provider: QAPilotViewProvider;

export async function activate(context: vscode.ExtensionContext) {
  log('QAPilot extension is now active!');

  try {
    await conversationStore.init(context.globalStorageUri, context.secrets);
  } catch (e) {
    log(`Conversation store init failed (chat history won't persist): ${e}`);
  }

  const credentialManager = new CredentialManager(context.secrets);
  provider = new QAPilotViewProvider(context.extensionUri, conversationStore, credentialManager);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      QAPilotViewProvider.viewType,
      provider
    )
  );

  const hasCreds = await provider.hasCredentials();
  if (hasCreds) {
    provider.startPolling();
  } else {
    log('No PostHog credentials configured — waiting for setup');
  }

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
