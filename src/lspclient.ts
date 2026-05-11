import * as net from 'net';
import * as vscode from 'vscode';
import * as path from 'path';
import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import {
	LanguageClient,
	LanguageClientOptions,
	RequestType,
	RevealOutputChannelOn,
	StreamInfo,
} from 'vscode-languageclient/node';
import { channel, channelBridge } from './dlbuild';
import { isActivePullMode, setActivePullMode, updateDatabaseNamingByGameTitle, updateDatabaseTranslationByGameTitle } from './simpletm';
import { getRegexConfigPayload, ParserRegexConfigPayload } from './parser';
import * as crossref from './crossref';

const SERVER_HOST = '127.0.0.1';
const SERVER_PORT = 6010;


interface ServerNotificationParams {
	message: string;
	remote_available: boolean;
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

export type ResGetParserRegex = ParserRegexConfigPayload | null;

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

export function getLanguageClient(): LanguageClient | undefined {
	return languageClient;
}
export const RequestEcho = new RequestType<{ message: string }, { result: string }, void>('dltxt/echo');
export const RequestSubscribeProject = new RequestType<{ project_id: string }, { project_id: string }, void>('simpletm/subscribeProject');
export const RequestGetDocumentContent = new RequestType<{ uri: string }, ResGetDocumentContent, void>('dltxt/get_document_content');
export const RequestGetParsedDocument = new RequestType<{ uri: string }, ResGetParsedDocument, void>('dltxt/get_parsed_document');
export const RequestGetSimilarText = new RequestType<GetSimilarTextParams, ResGetSimilarText, void>('dltxt/get_similar_text');

async function pushParserRegexConfigToBridge() {
	if (!languageClient) {
		return;
	}

	const parserRegex = getRegexConfigPayload();
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

	const SERVER_BIN_PATH = path.join(context.extensionPath, "bin", "dltxt_bridge_v3.exe");

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
		return getRegexConfigPayload() ?? null;
	});

	client.onNotification("simpletm/translationsUpdated", async (params: ProjectTranslationUpdatedNotification) => {
		console.log(`simpletm/translationsUpdated received ${JSON.stringify(params)}`);
		await updateDatabaseTranslationByGameTitle(params.project_id, params, false);
	});

	client.onNotification("simpletm/translationsDeleted", async (params: ProjectTranslationUpdatedNotification) => {
		console.log(`simpletm/translationsDeleted received ${JSON.stringify(params)}`);
		await updateDatabaseTranslationByGameTitle(params.project_id, params, true);
	});

	client.onNotification("simpletm/namingUpdated", async (params: ProjectNamingUpdatedNotification) => {
		console.log(`simpletm/namingUpdated received ${JSON.stringify(params)}`);
		await updateDatabaseNamingByGameTitle(params.project_id, params, false);
	});

	client.onNotification("simpletm/namingDeleted", async (params: ProjectNamingUpdatedNotification) => {
		console.log(`simpletm/namingDeleted received ${JSON.stringify(params)}`);
		await updateDatabaseNamingByGameTitle(params.project_id, params, true);
	});

	client.onNotification("simpletm/projectUpdated", async (params: ProjectNamingUpdatedNotification) => {
		console.log(`simpletm/projectUpdated received ${JSON.stringify(params)}`);
		await vscode.commands.executeCommand('Extension.dltxt.sync_database_by_game_title', params.project_id);
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

		// TODO: push regex to bridge
	}));

	try {
		await client.start();
		languageClient = client;
		await pushParserRegexConfigToBridge();
	} catch (error) {
		channel.appendLine(`Failed to start LSP client: ${String(error)}`);
		vscode.window.showErrorMessage(`Failed to start language server: ${String(error)}`);
		await stopBridgeProcess();
		setActivePullMode(true);
	}
}

const channelBridgeStderr = vscode.window.createOutputChannel("DLTXT Bridge stderr");

async function spawnBridgeProcess(serverBinPath: string): Promise<StreamInfo> {
	return new Promise((resolve, reject) => {
		const serverProcess = spawn(serverBinPath, ['--remote-host', 'simpletm.jscrosoft.com', '--remote-port', '443'], {
			stdio: ['pipe', 'pipe', 'pipe'],
		});
		bridgeProcess = serverProcess;

		const clearBridgeProcess = () => {
			if (bridgeProcess === serverProcess) {
				bridgeProcess = undefined;
			}
		};

		serverProcess.once('spawn', () => {
			channelBridge.appendLine(`spawned pid=${serverProcess.pid}`);
			resolve({ reader: serverProcess.stdout, writer: serverProcess.stdin });
		});

		serverProcess.once('error', (error: Error) => {
			clearBridgeProcess();
			channelBridge.appendLine(`spawn error: ${error.message}`);
			reject(error);
		});

		serverProcess.stderr.on('data', (data: Buffer) => {
			channelBridgeStderr.append(`${data.toString()}\n`);
		});

		serverProcess.on('exit', (code: number | null, signal: string | null) => {
			clearBridgeProcess();
			channelBridge.appendLine(`bridge exited with code ${code} and signal ${signal}`);
		});

		serverProcess.on('close', (code: number | null, signal: string | null) => {
			clearBridgeProcess();
			channelBridge.appendLine(`bridge closed with code ${code} and signal ${signal}`);
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
	if (params) {
		if (isActivePullMode() && params.remote_available) {
			vscode.commands.executeCommand('Extension.dltxt.sync_all_database');
			setActivePullMode(false);
		}
	}
}

export async function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(vscode.commands.registerCommand('Extension.dltxt.internal.onBridgeCrossrefIndexReady', async () => {
		await crossref.handleBridgeCrossrefIndexReady(context);
	}));
	await startLanguageClient(context);
}