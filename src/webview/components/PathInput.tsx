import { React, useCallback } from '../react-shared-runtime';
import { TextField } from './TextField';
import { Button } from './Button';
import { useVscodeRpc } from '../useVscodeRpc';

export interface PathInputProps {
    value: string;
    onChange: (value: string) => void;
    isDirectory?: boolean;
    placeholder?: string;
    rootPath?: string;
}

/**
 * 文本框 + 浏览按钮 + 与 extension 后端 dialog 联动。
 * 浏览点击 → 后端 showOpenDialog → 收到 fsPath → 自动转相对路径填入。
 *
 * 用 request（promise）取代 push + requestId 配对，避多实例时派发串扰：
 * 每个 PathInput 实例持有一个 pendingPromise，由 hook 内的 pendingMap 隔离。
 */
export function PathInput({
    value,
    onChange,
    isDirectory = true,
    placeholder,
    rootPath,
}: PathInputProps) {
    const rpc = useVscodeRpc();

    const handleBrowse = useCallback(async () => {
        const result = isDirectory
            ? await rpc.request('openDirectoryDialog', {})
            : await rpc.request('openFileDialog', {});
        if (!result.fsPath) { return; }
        if (rootPath && result.fsPath.startsWith(rootPath)) {
            onChange('.' + result.fsPath.slice(rootPath.length));
        } else {
            onChange(result.fsPath);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isDirectory, rootPath, onChange]);

    return (
        <div className="dlg-path-input">
            <TextField value={value} onChange={onChange} placeholder={placeholder} />
            <Button variant="ghost" onClick={handleBrowse}>浏览</Button>
        </div>
    );
}
