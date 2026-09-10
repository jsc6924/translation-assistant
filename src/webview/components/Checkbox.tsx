import { React } from '../react-shared-runtime';

export interface CheckboxProps {
    checked: boolean;
    onChange: (checked: boolean) => void;
    label?: string;
    disabled?: boolean;
    className?: string;
}

export function Checkbox({ checked, onChange, label, disabled, className }: CheckboxProps) {
    const element = (
        <input
            className="dlg-checkbox"
            type="checkbox"
            checked={checked}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked)}
        />
    );
    if (!label) { return element; }
    return (
        <label className={`dlg-checkbox-row ${className || ''}`.trim()}>
            {element}
            <span>{label}</span>
        </label>
    );
}
