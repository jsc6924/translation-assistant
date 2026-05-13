type NodeJiebaModule = {
	load: (options?: unknown) => unknown;
	cut: (text: string, hmm?: boolean) => string[];
};

let nodejiebaModule: NodeJiebaModule | undefined;

function createLoadError(error: unknown): Error {
	const message = error instanceof Error ? error.message : String(error);
	return new Error(
		`Failed to load nodejieba: ${message}. ` +
		`If this only happens in the published extension, verify the VSIX includes node_modules/nodejieba, ` +
		`its build/Release binary, and cppjieba dict files.`
	);
}

export function getNodeJieba(): NodeJiebaModule {
	if (nodejiebaModule) {
		return nodejiebaModule;
	}

	try {
		nodejiebaModule = require('nodejieba') as NodeJiebaModule;
		return nodejiebaModule;
	} catch (error) {
		throw createLoadError(error);
	}
}

export function ensureNodeJiebaLoaded(): NodeJiebaModule {
	const nodejieba = getNodeJieba();
	nodejieba.load();
	return nodejieba;
}