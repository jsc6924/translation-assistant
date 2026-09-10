import { useEffect, useRef } from './react-shared-runtime';
import { vscode } from './vscode';

interface PendingRequest {
    resolve: (payload: unknown) => void;
    reject: (error: string) => void;
}

interface Envelope {
    type?: string;
    requestId?: string;
    payload?: unknown;
    error?: string;
}

export type RequestHandler<TPayload = unknown> = (payload: TPayload, requestId: string) => void;

function uid(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * 通用 RPC hook：在 webview 与 extension 之间做请求-响应配对，
 * 并允许注册「单向 push」消息监听（无需 requestId）。
 */
export function useVscodeRpc() {
    const pendingRef = useRef<Map<string, PendingRequest>>(new Map());
    const pushHandlersRef = useRef<Map<string, Set<RequestHandler<any>>>>(new Map());

    useEffect(() => {
        const handler = (event: MessageEvent) => {
            const msg = (event.data || {}) as Envelope;
            if (!msg.requestId) { return; }
            const pending = pendingRef.current.get(msg.requestId);
            if (pending) {
                pendingRef.current.delete(msg.requestId);
                if (msg.type === 'requestError') {
                    pending.reject(msg.error || '未知错误');
                } else {
                    pending.resolve(msg.payload);
                }
                return;
            }
            const handlers = pushHandlersRef.current.get(msg.type || '');
            if (handlers) {
                for (const h of handlers) {
                    try { h(msg.payload, msg.requestId); } catch { /* ignore */ }
                }
            }
        };
        window.addEventListener('message', handler);
        return () => window.removeEventListener('message', handler);
    }, []);

    function request<T = unknown>(type: string, payload: Record<string, unknown> = {}): Promise<T> {
        const requestId = uid(type);
        return new Promise<T>((resolve, reject) => {
            pendingRef.current.set(requestId, { resolve: (p) => resolve(p as T), reject });
            vscode.postMessage({ type, requestId, ...payload });
        });
    }

    function post(type: string, payload: Record<string, unknown> = {}): string {
        const requestId = uid(type);
        vscode.postMessage({ type, requestId, ...payload });
        return requestId;
    }

    function onPush<T = unknown>(type: string, handler: RequestHandler<T>): () => void {
        let set = pushHandlersRef.current.get(type);
        if (!set) {
            set = new Set();
            pushHandlersRef.current.set(type, set);
        }
        set.add(handler as RequestHandler<any>);
        return () => {
            const cur = pushHandlersRef.current.get(type);
            if (cur) {
                cur.delete(handler as RequestHandler<any>);
            }
        };
    }

    return { request, post, onPush };
}
