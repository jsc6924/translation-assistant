import * as net from 'net';
import * as vscode from 'vscode';
import * as path from 'path';
import { spawn } from 'child_process';
import {
	LanguageClient,
	LanguageClientOptions,
	RequestType,
	RevealOutputChannelOn,
	StreamInfo,
} from 'vscode-languageclient/node';
import { channel, channelBridge } from './dlbuild';
import { isActivePullMode, setActivePullMode, updateDatabaseNamingByGameTitle, updateDatabaseTranslationByGameTitle } from './simpletm';

const SERVER_HOST = '127.0.0.1';
const SERVER_PORT = 6009;


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
	error?: string;
}


let languageClient: LanguageClient | undefined;

export function getLanguageClient(): LanguageClient | undefined {
	return languageClient;
}
export const RequestEcho = new RequestType<{ message: string }, { result: string }, void>('dltxt/echo');
export const RequestSubscribeProject = new RequestType<{ project_id: string }, { project_id: string }, void>('simpletm/subscribeProject');

export async function startLanguageClient(context: vscode.ExtensionContext) {
	if (languageClient) {
		return;
	}

	const serverOptions = async (): Promise<StreamInfo> => {
		const socket = net.createConnection(SERVER_PORT, SERVER_HOST);
		return await new Promise<StreamInfo>((resolve, reject) => {
			const cleanup = () => {
				socket.removeListener('connect', handleConnect);
				socket.removeListener('error', handleError);
			};

			const handleConnect = () => {
				cleanup();
				channel.appendLine(`LSP client connected to ${SERVER_HOST}:${SERVER_PORT}`);
				resolve({ reader: socket, writer: socket });
			};

			const handleError = (error: Error) => {
				cleanup();
				reject(error);
			};

			socket.once('connect', handleConnect);
			socket.once('error', handleError);
		});
	};

	const clientOptions: LanguageClientOptions = {
		documentSelector: [
			{ scheme: 'file', language: 'dltxt' },
			{ scheme: 'file', language: 'sltxt' },
		],
		outputChannel: channel,
		revealOutputChannelOn: RevealOutputChannelOn.Never,
	};

	languageClient = new LanguageClient(
		'dltxt-language-client',
		'DLTXT Language Server',
		serverOptions,
		clientOptions,
	);

	languageClient.onNotification("dltxt/notification", (params: ServerNotificationParams) => {
		handleServerHeartbeat(params);
	});

	languageClient.onNotification("simpletm/translationsUpdated", async (params: ProjectTranslationUpdatedNotification) => {
		console.log(`simpletm/translationsUpdated received ${JSON.stringify(params)}`);
		await updateDatabaseTranslationByGameTitle(params.project_id, params, false);
	});

	languageClient.onNotification("simpletm/translationsDeleted", async (params: ProjectTranslationUpdatedNotification) => {
		console.log(`simpletm/translationsDeleted received ${JSON.stringify(params)}`);
		await updateDatabaseTranslationByGameTitle(params.project_id, params, true);
	});

	languageClient.onNotification("simpletm/namingUpdated", async (params: ProjectNamingUpdatedNotification) => {
		console.log(`simpletm/namingUpdated received ${JSON.stringify(params)}`);
		await updateDatabaseNamingByGameTitle(params.project_id, params, false);
	});

	languageClient.onNotification("simpletm/namingDeleted", async (params: ProjectNamingUpdatedNotification) => {
		console.log(`simpletm/namingDeleted received ${JSON.stringify(params)}`);
		await updateDatabaseNamingByGameTitle(params.project_id, params, true);
	});

	languageClient.onNotification("simpletm/projectUpdated", async (params: ProjectNamingUpdatedNotification) => {
		console.log(`simpletm/projectUpdated received ${JSON.stringify(params)}`);
		await vscode.commands.executeCommand('Extension.dltxt.sync_database_by_game_title', params.project_id);
	});

	languageClient.onDidChangeState((event) => {
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

	const SERVER_BIN_PATH = path.join(context.extensionPath, "bin", "dltxt_bridge.exe");

	try {
		await ensureBridgeRunning(SERVER_BIN_PATH);
		await languageClient.start();
	} catch (error) {
		channel.appendLine(`Failed to start LSP client: ${String(error)}`);
		vscode.window.showErrorMessage(`Failed to start language server: ${String(error)}`);
		setActivePullMode(true);
	}
}

async function ensureBridgeRunning(serverBinPath: string): Promise<void> {
	return new Promise((resolve, reject) => {
		// check if it can connect to the server
		const socket = net.createConnection(SERVER_PORT, SERVER_HOST);
		socket.once('connect', () => {
			socket.end();
			resolve();
		});
		socket.once('error', (err: NodeJS.ErrnoException) => {
			if (err.code === 'ECONNREFUSED') {
				// start the server
				const serverProcess = spawn(serverBinPath, [], {
					detached: true,
					stdio: ['ignore', 'pipe', 'pipe'],
				});
				serverProcess.unref();
				serverProcess.once('spawn', () => {
					channelBridge.appendLine(`spawned pid=${serverProcess.pid}`);
					// Wait a moment for the server to start
					setTimeout(() => {
						resolve();
					}, 500);
				});

				serverProcess.once('error', (err: Error) => {
					channelBridge.appendLine(`spawn error: ${err.message}`);
					reject(err);
				});

				serverProcess.stdout?.on('data', (data: Buffer) => {
					channelBridge.append(`[bridge] ${data.toString()}`);
				});

				serverProcess.stderr?.on('data', (data: Buffer) => {
					channelBridge.append(`[bridge] ${data.toString()}`);
				});

				serverProcess.on('exit', (code: number | null, signal: string | null) => {
					channelBridge.show();
					channelBridge.appendLine(`bridge exited with code ${code} and signal ${signal}`);
				});

				serverProcess.on('close', (code: number | null, signal: string | null) => {
					channelBridge.show();
					channelBridge.appendLine(`bridge closed with code ${code} and signal ${signal}`);
				});
			} else {
				reject(err);
			}
		});
	});
}

export async function stopLanguageClient() {
	if (!languageClient) {
		return;
	}

	const client = languageClient;
	languageClient = undefined;

	try {
		await client.stop();
		channel.appendLine('LSP client stopped');
	} catch (error) {
		channel.appendLine(`Failed to stop LSP client: ${String(error)}`);
	}
}

function handleServerHeartbeat(params: ServerNotificationParams | undefined) {
	channel.appendLine(`[LSP notification] ${JSON.stringify(params)}`);
	if (params) {
		if (isActivePullMode() && params.remote_available) {
			vscode.commands.executeCommand('Extension.dltxt.sync_all_database');
			vscode.window.showInformationMessage("已切换到订阅模式");
			setActivePullMode(false);
		}
	}
}

function formatPayload(payload: unknown) {
	if (payload === undefined) {
		return undefined;
	}
	if (typeof payload === 'string') {
		return payload;
	}
	try {
		return JSON.stringify(payload);
	} catch {
		return String(payload);
	}
}

export async function activate(context: vscode.ExtensionContext) {
	await startLanguageClient(context);

    const lspWatchdog = setInterval(async () => {
        if (!getLanguageClient()) {
            await startLanguageClient(context);
        }
    }, 30_000);

    context.subscriptions.push({
        dispose: () => clearInterval(lspWatchdog),
    });

}