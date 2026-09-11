// webview 端共享类型 - re-export 自 src/shared/dlbuild-rpc.ts
// 保持单一数据源（single source of truth）

export type {
    TabId, ExtractItem, ExtractConfig, PackConfig, ConcatConfig,
    MergeConfig, WordcountConfig, TransformConfig,
    OperationResult, DialogResult,
    RequestMap, RequestType, RequestInput, RequestOutput, ResponseEnvelope,
} from '../shared/dlbuild-rpc';
