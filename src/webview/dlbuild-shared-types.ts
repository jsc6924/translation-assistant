// 共享类型：webview 与 extension 各自独立引用，避免 webview typecheck 拉入 extension 依赖链

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
