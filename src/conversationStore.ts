import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { log } from './logger.js';

const ALGORITHM = 'aes-256-gcm';
const KEY_SECRET_NAME = 'qapilot.conversationEncryptionKey';
const INDEX_FILE = 'index.json';

export interface ChatMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

let _storageDir: vscode.Uri | null = null;
let _secrets: vscode.SecretStorage | null = null;
let _encryptionKey: Buffer | null = null;
let _index: ChatMeta[] = [];

export async function init(
  globalStorageUri: vscode.Uri,
  secrets: vscode.SecretStorage
): Promise<void> {
  _storageDir = vscode.Uri.joinPath(globalStorageUri, 'conversations');
  _secrets = secrets;

  await vscode.workspace.fs.createDirectory(_storageDir);

  let keyHex = await secrets.get(KEY_SECRET_NAME);
  if (!keyHex) {
    keyHex = crypto.randomBytes(32).toString('hex');
    await secrets.store(KEY_SECRET_NAME, keyHex);
    log('Generated new conversation encryption key');
  }
  _encryptionKey = Buffer.from(keyHex, 'hex');

  _index = await _loadIndex();
}

// ── Index persistence ────────────────────────────────────────────

function _indexUri(): vscode.Uri {
  return vscode.Uri.joinPath(_storageDir!, INDEX_FILE);
}

async function _loadIndex(): Promise<ChatMeta[]> {
  try {
    const raw = await vscode.workspace.fs.readFile(_indexUri());
    return JSON.parse(Buffer.from(raw).toString('utf8'));
  } catch {
    return [];
  }
}

async function _saveIndex(): Promise<void> {
  const json = JSON.stringify(_index, null, 2);
  await vscode.workspace.fs.writeFile(_indexUri(), Buffer.from(json, 'utf8'));
}

// ── Encryption helpers ───────────────────────────────────────────

function encrypt(data: string): Buffer {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, _encryptionKey!, iv);
  const encrypted = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]);
}

function decrypt(blob: Buffer): string {
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const ciphertext = blob.subarray(28);
  const decipher = crypto.createDecipheriv(ALGORITHM, _encryptionKey!, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

function fileUri(conversationId: string): vscode.Uri {
  const safe = conversationId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return vscode.Uri.joinPath(_storageDir!, `${safe}.enc`);
}

// ── Public API ───────────────────────────────────────────────────

export async function save(
  conversationId: string,
  context: Record<string, unknown>,
  title?: string,
): Promise<void> {
  if (!_storageDir || !_encryptionKey) { return; }
  const json = JSON.stringify(context);
  const blob = encrypt(json);
  await vscode.workspace.fs.writeFile(fileUri(conversationId), blob);

  const now = new Date().toISOString();
  const existing = _index.find(m => m.id === conversationId);
  if (existing) {
    existing.updatedAt = now;
    if (title) { existing.title = title; }
  } else {
    _index.push({
      id: conversationId,
      title: title || 'New chat',
      createdAt: now,
      updatedAt: now,
    });
  }
  await _saveIndex();
}

export async function load(
  conversationId: string
): Promise<Record<string, unknown> | null> {
  if (!_storageDir || !_encryptionKey) { return null; }
  try {
    const blob = Buffer.from(await vscode.workspace.fs.readFile(fileUri(conversationId)));
    const json = decrypt(blob);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export async function remove(conversationId: string): Promise<void> {
  if (!_storageDir) { return; }
  try {
    await vscode.workspace.fs.delete(fileUri(conversationId));
  } catch {
    // file may not exist
  }
  _index = _index.filter(m => m.id !== conversationId);
  await _saveIndex();
}

export function listAll(): ChatMeta[] {
  return [..._index].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}
