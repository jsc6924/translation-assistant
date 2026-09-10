import { React } from '../react-shared-runtime';

type TextFieldType = 'text' | 'number' | 'password' | 'email';

export interface TextFieldProps {
    value: string;
    onChange: (value: string) => void;
    type?: TextFieldType;
    placeholder?: string;
    min?: number;
    step?: number;
    disabled?: boolean;
    title?: string;
    className?: string;
    ariaLabel?: string;
}

/**
 * 无样式默认（仅 reset + 占满父级宽度）的文本输入框。
 * className 透传，调用方控制宽度/弹性（如 .capture 之类）。
 */
export function TextField({
    value,
    onChange,
    type = 'text',
    placeholder,
    min,
    step,
    disabled,
    title,
    className,
    ariaLabel,
}: TextFieldProps) {
    return (
        <input
            className={`dlg-textfield ${className || ''}`.trim()}
            type={type}
            value={value}
            placeholder={placeholder}
            disabled={disabled}
            title={title}
            aria-label={ariaLabel}
            min={min}
            step={step}
            onChange={(e) => onChange(e.target.value)}
        />
    );
}
