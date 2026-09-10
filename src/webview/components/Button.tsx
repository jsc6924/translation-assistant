import { React } from '../react-shared-runtime';

type ButtonVariant = 'primary' | 'ghost' | 'danger';
type ButtonSize = 'normal' | 'icon' | 'icon-sm';

export interface ButtonProps {
    onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
    disabled?: boolean;
    variant?: ButtonVariant;
    size?: ButtonSize;
    title?: string;
    type?: 'button' | 'submit';
    className?: string;
    children?: React.ReactNode;
}

/**
 * 轻量按钮组件。无样式默认（仅类型），className 透传给调用方控制布局。
 */
export function Button({
    onClick,
    disabled,
    variant = 'primary',
    size = 'normal',
    title,
    type = 'button',
    className,
    children,
}: ButtonProps) {
    const classes = ['dlg-btn', `dlg-btn--${variant}`];
    if (size === 'icon') { classes.push('dlg-btn--icon'); }
    if (size === 'icon-sm') { classes.push('dlg-btn--icon-sm'); }
    if (className) { classes.push(className); }
    return (
        <button
            type={type}
            className={classes.join(' ')}
            onClick={onClick}
            disabled={disabled}
            title={title}
        >
            {children}
        </button>
    );
}
