const shared = globalThis.DLTXTReactShared;

if (!shared || !shared.React || !shared.ReactDOMClient) {
  throw new Error('Shared React vendor is not loaded.');
}

export const React = shared.React;
export const {
  Fragment,
  useEffect,
  useRef,
  useState,
} = shared.React;

export const createRoot = shared.ReactDOMClient.createRoot;
