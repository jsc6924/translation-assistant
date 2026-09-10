import { React } from '../react-shared-runtime';

export interface SelectOption {
    value: string;
    label: string;
}

export interface SelectProps {
    value: string;
    onChange: (value: string) => void;
    options: SelectOption[];
    disabled?: boolean;
    title?: string;
    className?: string;
    ariaLabel?: string;
}

export function Select({
    value,
    onChange,
    options,
    disabled,
    title,
    className,
    ariaLabel,
}: SelectProps) {
    return (
        <select
            className={`dlg-select ${className || ''}`.trim()}
            value={value}
            disabled={disabled}
            title={title}
            aria-label={ariaLabel}
            onChange={(e) => onChange(e.target.value)}
        >
            {options.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
        </select>
    );
}
