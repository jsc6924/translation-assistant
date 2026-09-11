import { useEffect, useRef } from './react-shared-runtime';
import { vscode } from './vscode';
import type { RequestType, RequestInput, RequestOutput } from '../shared/dlbuild-rpc';

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

export type PushHandler<TPayload = unknown> = (payload: TPayload, requestId: string) => void;

function uid(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * 通用 RPC hook：
 * - request<T>：异步请求-响应，payload 必须是 RequestMap[T]['input']
 * - post：fire-and-forget 单向消息（仍带 requestId 以便后端响应回包关联）
 * - onPush<T>：按 type 注册 push 监听；handler 同时收到 payload 与 requestId
 *
 * 统一协议：所有消息都带 requestId；hook 内按「pending 优先，pending 缺失则派发 push」
 * 派发。request 与 post 都返回 requestId；post 不进入 pending 表，等待 push handler。
 */
export function useVscodeRpc() {
    const pendingRef = useRef<Map<string, PendingRequest>>(new Map());
    const pushHandlersRef = useRef<Map<string, Set<PushHandler<any>>>>(new Map());

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

    function request<T extends RequestType>(
        type: T,
        payload: RequestInput<T>,
    ): Promise<RequestOutput<T>> {
        const requestId = uid(type);
        return new Promise<RequestOutput<T>>((resolve, reject) => {
            pendingRef.current.set(requestId, {
                resolve: (p) => resolve(p as RequestOutput<T>),
                reject,
            });
            vscode.postMessage({ type, requestId, ...payload });
        });
    }

    function post<T extends RequestType>(type: T, payload: RequestInput<T> = {} as RequestInput<T>): string {
        const requestId = uid(type);
        vscode.postMessage({ type, requestId, ...payload });
        return requestId;
    }

    function onPush<T = unknown>(type: string, handler: PushHandler<T>): () => void {
        let set = pushHandlersRef.current.get(type);
        if (!set) {
            set = new Set();
            pushHandlersRef.current.set(type, set);
        }
        set.add(handler as PushHandler<any>);
        return () => {
            const cur = pushHandlersRef.current.get(type);
            if (cur) { cur.delete(handler as PushHandler<any>); }
        };
    }

    return { request, post, onPush };
}
