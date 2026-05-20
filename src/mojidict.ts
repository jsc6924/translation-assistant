import * as vscode from 'vscode';
import { URL } from 'url';
import { getWebviewContentWithScripts, registerCommand } from './utils';
import { channel } from './dlbuild';

const axios = require('axios');

const MOJIDICT_ROOT_URL = 'https://www.mojidict.com/';
const MOJIDICT_SEARCH_URL = 'https://api.mojidict.com/parse/functions/union-api';
const MOJIDICT_DETAILS_URL = 'https://api.mojidict.com/parse/functions/nlt-fetchManyLatestWords';

let cachedApplicationId: string | undefined;

interface MojidictWord {
	id: string;
	spell: string;
	pron: string;
	accent: string;
	excerpt: string;
	details: Array<{ id: string; title: string }>;
	subDetails: Array<{
		id: string;
		title: string;
		detailId: string;
		examples: Array<{ id: string; title: string; trans: string }>;
	}>;
}

interface MojidictDetailsResponse {
	words: MojidictWord[];
}

class MojidictClient {
	private applicationId: string | undefined;
	private initializePromise: Promise<void> | undefined;

	constructor() {
		this.applicationId = cachedApplicationId;
	}

	async initialize(): Promise<void> {
		if (!this.initializePromise) {
			this.initializePromise = this.refreshApplicationId().finally(() => {
				this.initializePromise = undefined;
			});
		}

		await this.initializePromise;
	}

	private async ensureApplicationId(): Promise<string> {
		if (!this.applicationId) {
			await this.initialize();
		}

		if (!this.applicationId) {
			throw new Error('Mojidict ApplicationID is unavailable');
		}

		return this.applicationId;
	}

	private async refreshApplicationId(): Promise<void> {
		channel.appendLine('Fetching Mojidict ApplicationID');
		const html = await this.fetchText(MOJIDICT_ROOT_URL);
		const directId = this.extractApplicationId(html);
		if (directId) {
			await this.saveApplicationId(directId);
			return;
		}

		const scriptUrls = this.extractPreloadScriptUrls(html, MOJIDICT_ROOT_URL);
		for (const scriptUrl of scriptUrls) {
			try {
				const script = await this.fetchText(scriptUrl);
				const applicationId = this.extractApplicationId(script);
				if (applicationId) {
					await this.saveApplicationId(applicationId);
					return;
				}
			} catch (error) {
				channel.appendLine(`Skipping Mojidict asset ${scriptUrl}: ${String(error)}`);
			}
		}

		throw new Error('ApplicationID not found in Mojidict assets');
	}

	private async saveApplicationId(applicationId: string): Promise<void> {
		this.applicationId = applicationId;
		cachedApplicationId = applicationId;
		channel.appendLine(`Fetched Mojidict ApplicationID: ${applicationId}`);
	}

	private async fetchText(url: string): Promise<string> {
		const response = await axios.get(url, {
			responseType: 'text',
			headers: {
				'User-Agent': 'Mozilla/5.0',
			},
		});

		return typeof response.data === 'string' ? response.data : String(response.data);
	}

	private extractApplicationId(text: string): string | undefined {
		const match = text.match(/_ApplicationId\s*=\s*["']([A-Za-z0-9]+)["']/);
		return match?.[1];
	}

	private extractPreloadScriptUrls(html: string, baseUrl: string): string[] {
		const urls: string[] = [];
		const linkPattern = /<link\b[^>]*>/gi;
		const hrefPattern = /\bhref\s*=\s*["']([^"']+)["']/i;
		const relPattern = /\brel\s*=\s*["']preload["']/i;
		const asPattern = /\bas\s*=\s*["']script["']/i;

		for (const tag of html.match(linkPattern) ?? []) {
			if (!relPattern.test(tag) || !asPattern.test(tag)) {
				continue;
			}

			const hrefMatch = tag.match(hrefPattern);
			if (!hrefMatch?.[1]) {
				continue;
			}

			urls.push(new URL(hrefMatch[1], baseUrl).toString());
		}

		return urls;
	}

	private async postJson(url: string, payload: Record<string, unknown>): Promise<any> {
		const applicationId = await this.ensureApplicationId();
		const requestPayload = {
			...payload,
			_ApplicationId: applicationId,
			g_os: 'PCWeb',
		};

		try {
			const response = await axios.post(url, requestPayload, {
				headers: {
					'Content-Type': 'application/json',
				},
			});
			return response.data;
		} catch (error) {
			channel.appendLine(`Mojidict request failed, refreshing ApplicationID: ${String(error)}`);
			await this.refreshApplicationId();
			const refreshedPayload = {
				...payload,
				_ApplicationId: this.applicationId,
				g_os: 'PCWeb',
			};
			const response = await axios.post(url, refreshedPayload, {
				headers: {
					'Content-Type': 'application/json',
				},
			});
			return response.data;
		}
	}

	async search(query: string): Promise<any> {
		return await this.postJson(MOJIDICT_SEARCH_URL, {
			functions: [
				{
					name: 'search-all',
					params: {
						text: query,
						types: [102, 106],
					},
				},
			],
		});
	}

	async fetchDetails(objectIds: string[]): Promise<MojidictDetailsResponse> {
		const response = await this.postJson(MOJIDICT_DETAILS_URL, {
			itemsJson: objectIds.map((objectId) => ({ objectId })),
			skipAccessories: false,
		});

		return this.transformDetailsResponse(response);
	}

	private transformDetailsResponse(response: any): MojidictDetailsResponse {
		const result = response?.result?.result;
		if (!Array.isArray(result)) {
			throw new Error("Cannot find 'result.result' in Mojidict response");
		}

		const words = result
			.map((entry: any) => this.transformSingleWord(entry))
			.filter((word: MojidictWord) => word.id.length > 0);

		return { words };
	}

	private transformSingleWord(word: any): MojidictWord {
		const wordNode = word?.word ?? {};
		const subDetailIndexById = new Map<string, number>();
		const transformed: MojidictWord = {
			id: this.jsonStringField(wordNode, 'objectId'),
			spell: this.jsonStringField(wordNode, 'spell'),
			pron: this.jsonStringField(wordNode, 'pron'),
			accent: this.jsonStringField(wordNode, 'accent'),
			excerpt: this.jsonStringField(wordNode, 'excerpt'),
			details: [],
			subDetails: [],
		};

		for (const detail of Array.isArray(word?.details) ? word.details : []) {
			transformed.details.push({
				id: this.jsonStringField(detail, 'objectId'),
				title: this.jsonStringField(detail, 'title'),
			});
		}

		for (const subDetail of Array.isArray(word?.subdetails) ? word.subdetails : []) {
			const id = this.jsonStringField(subDetail, 'objectId');
			transformed.subDetails.push({
				id,
				title: this.jsonStringField(subDetail, 'title'),
				detailId: this.jsonStringField(subDetail, 'detailsId'),
				examples: [],
			});
			subDetailIndexById.set(id, transformed.subDetails.length - 1);
		}

		for (const example of Array.isArray(word?.examples) ? word.examples : []) {
			const subDetailId = this.jsonStringField(example, 'subdetailsId');
			const subDetailIndex = subDetailIndexById.get(subDetailId);
			if (subDetailIndex === undefined) {
				continue;
			}

			transformed.subDetails[subDetailIndex].examples.push({
				id: this.jsonStringField(example, 'objectId'),
				title: this.jsonStringField(example, 'title'),
				trans: this.jsonStringField(example, 'trans'),
			});
		}

		return transformed;
	}

	private jsonStringField(value: any, key: string): string {
		return value && typeof value[key] === 'string' ? value[key] : '';
	}
}

let mojidictClient: MojidictClient | undefined;


function getMojidictClient(): MojidictClient {
	if (!mojidictClient) {
		mojidictClient = new MojidictClient();
	}

	return mojidictClient;
}

async function searchWords(context: vscode.ExtensionContext, word: string, maxLen: number): Promise<MojidictDetailsResponse> {
	const client = getMojidictClient();
	const searchResponse = await client.search(word);
	const objectIds: string[] = [];

	for (const item of searchResponse?.result?.results?.['search-all']?.result?.word?.searchResult ?? []) {
		if (typeof item?.targetId === 'string' && objectIds.length < maxLen) {
			objectIds.push(item.targetId);
		}
	}

	if (objectIds.length === 0) {
		return { words: [] };
	}

	return await client.fetchDetails(objectIds);
}

async function mojidictSearch(context: vscode.ExtensionContext, word: string): Promise<void> {
	const config = vscode.workspace.getConfiguration('dltxt.y.searchWord.dictserver');
	const maxLen = config.get('displayCount') as number;
	let response: MojidictDetailsResponse = { words: [] };

	try {
		response = await searchWords(context, word, maxLen);
	} catch (error) {
		channel.appendLine(`查询时发生错误 ${String(error)}`);
	}

	const jsonData = JSON.stringify(response, null, 2);
	const panel = vscode.window.createWebviewPanel(
		'dict-server-result-viewer',
		`"${word}"的搜索结果`,
		vscode.ViewColumn.One,
		{ enableScripts: true }
	);

	const sharedReactUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'webview', 'react-shared-vendor.js'));
	const scriptUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'webview', 'dictserver.js'));
	const cssUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'src', 'webview', 'dictserver.css'));
	panel.webview.html = getWebviewContentWithScripts([sharedReactUri, scriptUri], cssUri, jsonData);
	panel.reveal();
}

async function mojidictSearchLite(context: vscode.ExtensionContext, word: string): Promise<MojidictDetailsResponse | undefined> {
	try {
		return await searchWords(context, word, 1);
	} catch {
		return undefined;
	}
}

function getWordMarkdown(word: MojidictWord): string {
	let markdown = `### ${word.spell}\n\n${word.excerpt}\n\n`;

	let index = 1;
	for (const subDetail of word.subDetails) {
		markdown += `**(${index++})** ${subDetail.title}\n\n`;
	}

	return markdown;
}

class MojidictHoverProvider implements vscode.HoverProvider {
	constructor(private readonly context: vscode.ExtensionContext) {}

	provideHover(document: vscode.TextDocument): vscode.ProviderResult<vscode.Hover> {
		const config = vscode.workspace.getConfiguration('dltxt.y.searchWord.dictserver.hover');
		const show = config.get('show') as boolean;
		if (!show) {
			return undefined;
		}

		const activeSelection = vscode.window.activeTextEditor?.selection;
		if (!activeSelection || activeSelection.isEmpty) {
			return undefined;
		}

		const selectedText = document.getText(activeSelection);
		return mojidictSearchLite(this.context, selectedText).then((result) => {
			if (!result || result.words.length < 1) {
				return undefined;
			}

			return new vscode.Hover(new vscode.MarkdownString(getWordMarkdown(result.words[0])));
		}).catch(() => undefined);
	}
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	registerCommand(context, 'Extension.dltxt.dictserver.editor.searchWord', () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor || !editor.selection) {
			return;
		}

		const word = editor.document.getText(editor.selection);
		if (word.length === 0) {
			vscode.window.showInformationMessage('请选中一段内容后再查询');
			return;
		}

		void mojidictSearch(context, word);
	});

	const hoverProvider = new MojidictHoverProvider(context);
	context.subscriptions.push(
		vscode.languages.registerHoverProvider({ scheme: 'file', language: 'dltxt' }, hoverProvider)
	);

	try {
		await getMojidictClient().initialize();
	} catch (error) {
		channel.appendLine(`Failed to initialize Mojidict client: ${String(error)}`);
	}
}