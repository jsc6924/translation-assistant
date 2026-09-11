// 跨边界共享：webview 与 extension 都引用这个文件。
// 仅放纯类型与常量，禁止 import 任何 extension 模块，避免 webview typecheck 拉入传递依赖。

export type TabId = 'extract' | 'pack' | 'concat' | 'merge' | 'wordcount' | 'transform';

export interface ExtractItem {
    capture: string;
    tag: string;
    group: number;
}

export interface ExtractConfig {
    input: { path: string; encoding: string; ext: string; digits: number; items: ExtractItem[] };
    output: { path: string; encoding: string };
}

export interface PackConfig {
    input: { path: string; encoding: string };
    output: { path: string; encoding: string };
}

export interface ConcatConfig {
    input: { path: string; encoding: string };
    output: { path: string; encoding: string };
}

export interface MergeConfig {
    input1: { path: string; encoding: string };
    input2: { path: string; encoding: string };
    output: { path: string; encoding: string };
}

export interface WordcountConfig {
    input: { path: string; encoding: string };
}

export interface TransformConfig {
    input: { path: string; encoding: string };
    output?: { path: string; encoding: string };
    script?: { path: string };
    mode: 'line' | 'block';
    operations: any[];
    'on-global-begin'?: string;
    'on-global-end'?: string;
    'on-file-begin'?: string;
    'on-file-end'?: string;
    'on-text-block'?: string;
}

// ============================================================
// RPC 协议：RequestMap 定义每条消息的「入参 → 出参」形状。
// 单一数据源（single source of truth）：webview 与 extension 都引用它。
// ============================================================

export interface OperationResult {
    ok: boolean;
    message: string;
    total?: number;
    success?: number;
}

export interface DialogResult {
    fsPath: string;
}

export interface RequestMap {
    validateConfig: {
        input: { activeTab: TabId; config: unknown };
        output: { ok: boolean; error?: string };
    };
    runOperation: {
        input: { activeTab: TabId; config: unknown };
        output: OperationResult;
    };
    openDirectoryDialog: {
        input: Record<string, never>;
        output: DialogResult;
    };
    openFileDialog: {
        input: Record<string, never>;
        output: DialogResult;
    };
}

export type RequestType = keyof RequestMap;
export type RequestInput<T extends RequestType> = RequestMap[T]['input'];
export type RequestOutput<T extends RequestType> = RequestMap[T]['output'];

// 响应 envelope
export interface ResponseEnvelope<T = unknown> {
    type: string;
    requestId?: string;
    payload?: T;
    error?: string;
}
