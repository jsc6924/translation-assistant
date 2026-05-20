interface VSCodeWebviewApi<TState = unknown> {
	postMessage(message: unknown): void;
	setState(state: TState): TState;
	getState(): TState | undefined;
}

type SharedReactVendor = {
	React: typeof import('react');
	ReactDOMClient: typeof import('react-dom/client');
};

declare global {
	function acquireVsCodeApi<TState = unknown>(): VSCodeWebviewApi<TState>;
	var DLTXTReactShared: SharedReactVendor | undefined;
}

export {};