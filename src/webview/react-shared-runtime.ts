// 运行时从全局 IIFE（globalThis.DLTXTReactShared）取 React，
// 类型从真正的 'react' / 'react-dom/client' 包拿，从而获得完整泛型签名。

import type * as ReactNS from 'react';
import type * as ReactDOMNS from 'react-dom/client';

const shared = globalThis.DLTXTReactShared;

if (!shared || !shared.React || !shared.ReactDOMClient) {
    throw new Error('Shared React vendor is not loaded.');
}

export const React = shared.React as typeof ReactNS;
export const {
    Fragment,
    useEffect,
    useRef,
    useState,
} = shared.React as typeof ReactNS;
export const createRoot = shared.ReactDOMClient.createRoot as typeof ReactDOMNS.createRoot;
