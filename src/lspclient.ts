import * as net from 'net';
import * as vscode from 'vscode';
import * as path from 'path';
import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import WebSocket = require('ws');
import {
	LanguageClient,
	LanguageClientOptions,
	RequestType,
	RevealOutputChannelOn,
	StreamInfo,
} from 'vscode-languageclient/node';
import { channel } from './dlbuild';
import { isActivePullMode, setActivePullMode, updateDatabaseNamingByGameTitle, updateDatabaseTranslationByGameTitle } from './simpletm';
import { getParserConfigPayload, ParserConfigPayload } from './parser';
import * as crossref from './crossref';

const SIMPLETM_WS_URL = 'wss://simpletm.jscrosoft.com/ws';
const SIMPLETM_RECONNECT_DELAY_MS = 3000;
const SIMPLETM_REQUEST_TIMEOUT_MS = 10000;

interface ServerNotificationParams {
	message: string;
}

interface JsonRpcMessage {
	jsonrpc?: string;
	id?: string | number | null;
	method?: string;
	params?: unknown;
	result?: unknown;
	error?: {
		code?: number;
		message?: string;
	};
}

interface PendingWebSocketRequest {
	resolve: (result: unknown) => void;
	reject: (error: Error) => void;
	timeout: NodeJS.Timeout;
}

export interface ProjectTranslationUpdatedNotification {
	success: boolean;
	project_id: string;
	key: string;
	value?: string;
	comment?: string;
	error?: string;
}

export interface ProjectBatchUpdatedNotification {
	success: boolean;
	project_id: string;
	error?: string;
}

export interface ProjectNamingUpdatedNotification {
	success: boolean;
	project_id: string;
	caller?: string;
	called?: string;
	transcaller?: string;
	comment?: string;
	error?: string;
}

export interface ResGetDocumentContent {
	content: string;
}

export interface ResGetParsedDocument {
	content: {
		originalLineIndex: number;
		translatedLineIndex: number;
		original: string;
		translated: string;
	}[];
}

export type ResGetParserRegex = ParserConfigPayload | null;

export interface SimilarTextLineInfo {
	fileName: string;
	lineNumber: number;
	jpLine: string;
	trLine: string;
}

export interface SimilarTextRef {
	lineInfo: SimilarTextLineInfo;
	score: number;
}

export interface SimilarTextMatch {
	lineNumber: number;
	exactCount: number;
	refs: SimilarTextRef[];
}

export interface ResGetSimilarText {
	matches: SimilarTextMatch[];
}

export interface GetSimilarTextParams {
	uri: string;
	threshold: number;
	limit: number;
}


let languageClient: LanguageClient | undefined;
let bridgeProcess: ChildProcessWithoutNullStreams | undefined;
let simpleTMWebSocketClient: SimpleTMWebSocketClient | undefined;

export function getLanguageClient(): LanguageClient | undefined {
	return languageClient;
}
export const RequestEcho = new RequestType<{ message: string }, { result: string }, void>('dltxt/echo');
export const RequestGetDocumentContent = new RequestType<{ uri: string }, ResGetDocumentContent, void>('dltxt/get_document_content');
export const RequestGetParsedDocument = new RequestType<{ uri: string }, ResGetParsedDocument, void>('dltxt/get_parsed_document');
export const RequestGetSimilarText = new RequestType<GetSimilarTextParams, ResGetSimilarText, void>('dltxt/get_similar_text');

class SimpleTMWebSocketClient {
	private socket: WebSocket | undefined;
	private reconnectTimer: NodeJS.Timeout | undefined;
	private nextRequestId = 0;
	private readonly subscribedProjects = new Set<string>();
	private readonly pendingRequests = new Map<string, PendingWebSocketRequest>();
	private stopRequested = false;
	private static UUID = SimpleTMWebSocketClient.generateUUID();

	static generateUUID(): string {
		// simplified UUID generator for request IDs
		let id = '';
		for (let i = 0; i < 48; i++) {
			id += Math.floor(Math.random() * 16).toString(16);
		}
		return id;
	}

	async start(): Promise<void> {
		this.stopRequested = false;
		this.ensureConnected();
	}

	async stop(): Promise<void> {
		this.stopRequested = true;
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = undefined;
		}

		this.rejectAllPendingRequests(new Error('SimpleTM websocket stopped'));

		const socket = this.socket;
		this.socket = undefined;
		if (!socket || socket.readyState === WebSocket.CLOSED) {
			return;
		}

		await new Promise<void>((resolve) => {
			let settled = false;
			const finish = () => {
				if (settled) {
					return;
				}
				settled = true;
				resolve();
			};

			const timer = setTimeout(finish, 1000);
			socket.once('close', () => {
				clearTimeout(timer);
				finish();
			});

			try {
				socket.close();
			} catch {
				clearTimeout(timer);
				finish();
			}
		});
	}

	async subscribeProject(projectId: string): Promise<void> {
		if (!projectId) {
			return;
		}

		const isNewProject = !this.subscribedProjects.has(projectId);
		this.subscribedProjects.add(projectId);
		this.ensureConnected();

		if (!isNewProject || !this.isOpen()) {
			return;
		}

		await this.sendSubscribeProject(projectId);
	}

	private isOpen(): boolean {
		return this.socket?.readyState === WebSocket.OPEN;
	}

	private ensureConnected(): void {
		if (this.stopRequested) {
			return;
		}

		if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
			return;
		}

		const socket = new WebSocket(SIMPLETM_WS_URL);
		this.socket = socket;

		socket.on('open', () => {
			channel.appendLine(`SimpleTM websocket connected: ${SIMPLETM_WS_URL}`);
			void this.handleOpen(socket);
		});

		socket.on('message', async (data) => {
			await this.handleMessage(data);
		});

		socket.on('error', (error) => {
			channel.appendLine(`SimpleTM websocket error: ${error.message}`);
		});

		socket.on('close', (code, reasonBuffer) => {
			if (this.socket === socket) {
				this.socket = undefined;
			}

			const reason = this.rawDataToString(reasonBuffer);
			channel.appendLine(`SimpleTM websocket closed: code=${code} reason=${reason}`);
			this.rejectAllPendingRequests(new Error('SimpleTM websocket disconnected'));
			setActivePullMode(true);

			if (!this.stopRequested) {
				this.scheduleReconnect();
			}
		});
	}

	private scheduleReconnect(): void {
		if (this.reconnectTimer || this.stopRequested) {
			return;
		}

		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = undefined;
			this.ensureConnected();
		}, SIMPLETM_RECONNECT_DELAY_MS);
	}

	private async handleOpen(socket: WebSocket): Promise<void> {
		if (this.socket !== socket) {
			return;
		}

		for (const projectId of this.subscribedProjects) {
			try {
				await this.sendSubscribeProject(projectId);
			} catch (error) {
				channel.appendLine(`Failed to resubscribe project ${projectId}: ${String(error)}`);
			}
		}

		if (isActivePullMode()) {
			setActivePullMode(false);
			void vscode.commands.executeCommand('Extension.dltxt.sync_all_database');
		}
	}

	private async sendSubscribeProject(projectId: string): Promise<void> {
		const response = await this.sendRequest<{ project_id: string }>('simpletm/subscribeProject', { project_id: projectId });
		channel.appendLine(`SimpleTM websocket subscribed to project ${response.project_id}`);
	}

	private sendRequest<TResponse>(method: string, params: Record<string, unknown>): Promise<TResponse> {
		const socket = this.socket;
		if (!socket || socket.readyState !== WebSocket.OPEN) {
			return Promise.reject(new Error('SimpleTM websocket is not connected'));
		}

		const requestId = `simpletm-${SimpleTMWebSocketClient.UUID}-${++this.nextRequestId}`;
		const payload = JSON.stringify({
			jsonrpc: '2.0',
			id: requestId,
			method,
			params,
		});

		return new Promise<TResponse>((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.pendingRequests.delete(requestId);
				reject(new Error(`SimpleTM websocket request timed out: ${method}`));
			}, SIMPLETM_REQUEST_TIMEOUT_MS);

			this.pendingRequests.set(requestId, {
				resolve: (result: unknown) => {
					clearTimeout(timeout);
					this.pendingRequests.delete(requestId);
					resolve(result as TResponse);
				},
				reject: (error: Error) => {
					clearTimeout(timeout);
					this.pendingRequests.delete(requestId);
					reject(error);
				},
				timeout,
			});

			socket.send(payload, (error?: Error) => {
				if (!error) {
					return;
				}

				const pending = this.pendingRequests.get(requestId);
				if (pending) {
					pending.reject(error);
				}
			});
		});
	}

	private async handleMessage(data: WebSocket.RawData): Promise<void> {
		const rawMessage = this.rawDataToString(data);
		let message: JsonRpcMessage;

		try {
			message = JSON.parse(rawMessage) as JsonRpcMessage;
		} catch (error) {
			channel.appendLine(`Ignoring non-JSON SimpleTM websocket payload: ${String(error)}`);
			return;
		}

		if (message.id !== undefined && message.id !== null && !message.method) {
			channel.appendLine(`received response: id=${message.id} result=${JSON.stringify(message.result)} error=${JSON.stringify(message.error)}`);
			this.handleResponse(message);
			return;
		}

		if (!message.method) {
			return;
		}

		channel.appendLine(`received notification: method=${message.method} params=${JSON.stringify(message.params)}`);
		await this.dispatchNotification(message.method, message.params);
	}

	private handleResponse(message: JsonRpcMessage): void {
		const requestId = String(message.id);
		const pending = this.pendingRequests.get(requestId);
		if (!pending) {
			return;
		}

		if (message.error) {
			pending.reject(new Error(message.error.message ?? `SimpleTM websocket request failed: ${requestId}`));
			return;
		}

		pending.resolve(message.result);
	}

	private async dispatchNotification(method: string, params: unknown): Promise<void> {
		switch (method) {
			case 'simpletm/translationsUpdated':
				await updateDatabaseTranslationByGameTitle((params as ProjectTranslationUpdatedNotification).project_id, params as ProjectTranslationUpdatedNotification, false);
				return;
			case 'simpletm/translationsDeleted':
				await updateDatabaseTranslationByGameTitle((params as ProjectTranslationUpdatedNotification).project_id, params as ProjectTranslationUpdatedNotification, true);
				return;
			case 'simpletm/namingUpdated':
				await updateDatabaseNamingByGameTitle((params as ProjectNamingUpdatedNotification).project_id, params as ProjectNamingUpdatedNotification, false);
				return;
			case 'simpletm/namingDeleted':
				await updateDatabaseNamingByGameTitle((params as ProjectNamingUpdatedNotification).project_id, params as ProjectNamingUpdatedNotification, true);
				return;
			case 'simpletm/projectUpdated':
				await vscode.commands.executeCommand('Extension.dltxt.sync_database_by_game_title', (params as ProjectBatchUpdatedNotification).project_id);
				return;
			default:
				channel.appendLine(`Unhandled SimpleTM websocket notification: ${method}`);
		}
	}

	private rejectAllPendingRequests(error: Error): void {
		for (const [requestId, pending] of this.pendingRequests) {
			clearTimeout(pending.timeout);
			this.pendingRequests.delete(requestId);
			pending.reject(error);
		}
	}

	private rawDataToString(data: WebSocket.RawData): string {
		if (typeof data === 'string') {
			return data;
		}

		if (Buffer.isBuffer(data)) {
			return data.toString('utf8');
		}

		if (Array.isArray(data)) {
			return Buffer.concat(data).toString('utf8');
		}

		return Buffer.from(data).toString('utf8');
	}
}

export async function subscribeProjectNotifications(projectId: string): Promise<void> {
	if (!simpleTMWebSocketClient) {
		simpleTMWebSocketClient = new SimpleTMWebSocketClient();
		await simpleTMWebSocketClient.start();
	}

	await simpleTMWebSocketClient.subscribeProject(projectId);
}

async function pushParserRegexConfigToBridge() {
	if (!languageClient) {
		return;
	}

	const parserRegex = getParserConfigPayload();
	if (!parserRegex) {
		channel.appendLine('skip pushing parser regex config because it is unavailable');
		return;
	}

	await languageClient.sendNotification('dltxt/set_parser_regex', {
		parserRegex,
	});
}

async function notifyBridgeCrossrefIndexReady() {
	channel.appendLine('received crossref index ready notification');
	await vscode.commands.executeCommand('Extension.dltxt.internal.onBridgeCrossrefIndexReady');
}

export async function startLanguageClient(context: vscode.ExtensionContext) {
	if (languageClient) {
		return;
	}

	const SERVER_BIN_PATH = path.join(context.extensionPath, "bin", "dltxt_lsp_server.exe");

	const serverOptions = async (): Promise<StreamInfo> => {
		await stopBridgeProcess();
		return await spawnBridgeProcess(SERVER_BIN_PATH);
	};

	const clientOptions: LanguageClientOptions = {
		documentSelector: [
			{ scheme: 'file', language: 'dltxt' },
			{ scheme: 'file', language: 'sltxt' },
		],
		outputChannel: channel,
		revealOutputChannelOn: RevealOutputChannelOn.Never,
	};

	const client = new LanguageClient(
		'dltxt-language-client',
		'DLTXT Language Server',
		serverOptions,
		clientOptions,
	);

	client.onNotification("dltxt/notification", (params: ServerNotificationParams) => {
		handleServerHeartbeat(params);
	});

	client.onNotification("dltxt/crossref_index_ready", async () => {
		try {
			await notifyBridgeCrossrefIndexReady();
		} catch (error) {
			channel.appendLine(`Failed to handle crossref index ready notification: ${String(error)}`);
		}
	});

	client.onRequest('dltxt/get_parser_regex', async (): Promise<ResGetParserRegex> => {
		return getParserConfigPayload() ?? null;
	});

	client.onDidChangeState((event) => {
		switch (event.newState) {
			case 1: // Starting
				channel.appendLine('LSP client is starting...');
				break;
			case 2: // Running
				channel.appendLine('LSP client is running');
				break;
			case 3: // Stopped
				channel.appendLine('LSP client has stopped');
				setActivePullMode(true);
				break;
			default:
				break;
		}
	});

	context.subscriptions.push({
		dispose: () => {
			void stopLanguageClient();
		},
	});

	context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(async (event) => {
		if (!event.affectsConfiguration('dltxt.core')) {
			return;
		}

		try {
			await pushParserRegexConfigToBridge();
		} catch (error) {
			channel.appendLine(`Failed to push parser regex config to bridge: ${String(error)}`);
		}
	}));

	try {
		await client.start();
		languageClient = client;
		if (!simpleTMWebSocketClient) {
			simpleTMWebSocketClient = new SimpleTMWebSocketClient();
		}
		await simpleTMWebSocketClient.start();
		await pushParserRegexConfigToBridge();
	} catch (error) {
		channel.appendLine(`Failed to start LSP client: ${String(error)}`);
		vscode.window.showErrorMessage(`Failed to start language server: ${String(error)}`);
		if (simpleTMWebSocketClient) {
			await simpleTMWebSocketClient.stop();
		}
		await stopBridgeProcess();
		setActivePullMode(true);
	}
}

const channelLSPStderr = vscode.window.createOutputChannel("DLTXT LSP stderr");

async function spawnBridgeProcess(serverBinPath: string): Promise<StreamInfo> {
	return new Promise((resolve, reject) => {
		const serverProcess = spawn(serverBinPath, [], {
			stdio: ['pipe', 'pipe', 'pipe'],
		});
		bridgeProcess = serverProcess;

		const clearBridgeProcess = () => {
			if (bridgeProcess === serverProcess) {
				bridgeProcess = undefined;
			}
		};

		serverProcess.once('spawn', () => {
			channel.appendLine(`[LSP] spawned pid=${serverProcess.pid}`);
			resolve({ reader: serverProcess.stdout, writer: serverProcess.stdin });
		});

		serverProcess.once('error', (error: Error) => {
			clearBridgeProcess();
			channel.appendLine(`[LSP] spawn error: ${error.message}`);
			reject(error);
		});

		serverProcess.stderr.on('data', (data: Buffer) => {
			channelLSPStderr.append(`${data.toString()}\n`);
		});

		serverProcess.on('exit', (code: number | null, signal: string | null) => {
			clearBridgeProcess();
			channel.appendLine(`[LSP] bridge exited with code ${code} and signal ${signal}`);
		});

		serverProcess.on('close', (code: number | null, signal: string | null) => {
			clearBridgeProcess();
			channel.appendLine(`[LSP] bridge closed with code ${code} and signal ${signal}`);
		});
	});
}

async function waitForBridgeProcessExit(process: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<boolean> {
	if (process.exitCode !== null || process.killed) {
		return true;
	}

	return await new Promise<boolean>((resolve) => {
		const onExit = () => {
			cleanup();
			resolve(true);
		};
		const onClose = () => {
			cleanup();
			resolve(true);
		};
		const cleanup = () => {
			clearTimeout(timer);
			process.removeListener('exit', onExit);
			process.removeListener('close', onClose);
		};
		const timer = setTimeout(() => {
			cleanup();
			resolve(false);
		}, timeoutMs);

		process.once('exit', onExit);
		process.once('close', onClose);
	});
}

async function stopBridgeProcess(): Promise<void> {
	const process = bridgeProcess;
	if (!process) {
		return;
	}

	bridgeProcess = undefined;

	try {
		process.stdin.end();
	} catch {
		// ignore
	}

	if (await waitForBridgeProcessExit(process, 1000)) {
		return;
	}

	try {
		process.kill();
	} catch {
		return;
	}

	await waitForBridgeProcessExit(process, 1000);
}

export async function stopLanguageClient() {
	if (simpleTMWebSocketClient) {
		await simpleTMWebSocketClient.stop();
		simpleTMWebSocketClient = undefined;
	}

	if (!languageClient) {
		await stopBridgeProcess();
		return;
	}

	const client = languageClient;
	languageClient = undefined;

	try {
		await client.stop();
		channel.appendLine('LSP client stopped');
	} catch (error) {
		channel.appendLine(`Failed to stop LSP client: ${String(error)}`);
	} finally {
		await stopBridgeProcess();
	}
}

function handleServerHeartbeat(params: ServerNotificationParams | undefined) {
	channel.appendLine(`[LSP notification] ${JSON.stringify(params)}`);
}

export async function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(vscode.commands.registerCommand('Extension.dltxt.internal.onBridgeCrossrefIndexReady', async () => {
		await crossref.handleBridgeCrossrefIndexReady(context);
	}));
	await startLanguageClient(context);
}