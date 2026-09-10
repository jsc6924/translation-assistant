import { React, useEffect, useRef } from '../react-shared-runtime';
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
 * 用 ref 记录本次浏览的 requestId，只响应自己触发的响应，避免多实例时互相覆盖。
 */
export function PathInput({
    value,
    onChange,
    isDirectory = true,
    placeholder,
    rootPath,
}: PathInputProps) {
    const rpc = useVscodeRpc();
    const pendingRequestIdRef = useRef<string | null>(null);

    useEffect(() => {
        const off = rpc.onPush<{ fsPath: string }>('dialogResult', (payload, requestId) => {
            if (requestId !== pendingRequestIdRef.current) { return; }
            pendingRequestIdRef.current = null;
            if (!payload?.fsPath) { return; }
            if (rootPath && payload.fsPath.startsWith(rootPath)) {
                onChange('.' + payload.fsPath.slice(rootPath.length));
            } else {
                onChange(payload.fsPath);
            }
        });
        return off;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rootPath]);

    function handleBrowse() {
        pendingRequestIdRef.current = rpc.post(isDirectory ? 'openDirectoryDialog' : 'openFileDialog');
    }

    return (
        <div className="dlg-path-input">
            <TextField value={value} onChange={onChange} placeholder={placeholder} />
            <Button variant="ghost" onClick={handleBrowse}>浏览</Button>
        </div>
    );
}

