import * as net from 'net';
import * as vscode from 'vscode';
import {
	LanguageClient,
	LanguageClientOptions,
	RequestType,
	RevealOutputChannelOn,
	StreamInfo,
} from 'vscode-languageclient/node';
import { channel } from './dlbuild';

const SERVER_HOST = '127.0.0.1';
const SERVER_PORT = 6009;
const SERVER_NOTIFICATION_METHOD = 'dltxt/notification';

interface ServerNotificationParams {
	message?: string;
	type?: 'info' | 'warn' | 'error' | 'log';
	payload?: unknown;
}

interface ProjectTranslationUpdatedNotification {
	project_id: string;
}

interface ProjectNamingUpdatedNotification {
	project_id: string;
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
		handleServerNotification(params);
	});

	languageClient.onNotification("simpletm/translationsUpdated", (params: ProjectTranslationUpdatedNotification) => {
		vscode.window.showInformationMessage(`术语库词条更新通知: ${params.project_id}`);
	});

	languageClient.onNotification("simpletm/namingUpdated", (params: ProjectNamingUpdatedNotification) => {
		vscode.window.showInformationMessage(`术语库人称表更新通知: ${params.project_id}`);
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

	try {
		await languageClient.start();
	} catch (error) {
		channel.appendLine(`Failed to start LSP client: ${String(error)}`);
		languageClient = undefined;
	}
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

function handleServerNotification(params: ServerNotificationParams | undefined) {
	const message = params?.message ?? formatPayload(params?.payload) ?? 'Received server notification';
	channel.appendLine(`[LSP notification] ${message}`);

	vscode.window.showInformationMessage(`Server notification: ${message}`);
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