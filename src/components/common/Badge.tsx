import React from 'react';

interface BadgeProps {
  variant?: 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'indigo' | 'amber';
  size?: 'xs' | 'sm' | 'md';
  children: React.ReactNode;
  dot?: boolean;
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  variant = 'neutral',
  size = 'md',
  children,
  dot = false,
  className = ''
}) => {
  const sizeClasses = {
    xs: 'px-1.5 py-0.5 text-[10px] leading-tight min-h-[20px]',
    sm: 'px-2 py-0.5 text-[11px] leading-tight min-h-[22px]',
    md: 'px-2.5 py-1 text-xs leading-tight min-h-[26px]'
  }[size];

  const variantClasses = {
    success: 'bg-emerald-50 text-emerald-700 border-emerald-200/80',
    warning: 'bg-amber-50 text-amber-800 border-amber-200/80',
    danger: 'bg-rose-50 text-rose-700 border-rose-200/80',
    info: 'bg-sky-50 text-sky-700 border-sky-200/80',
    neutral: 'bg-slate-100 text-slate-700 border-slate-200/80',
    indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200/80',
    amber: 'bg-amber-100 text-amber-900 border-amber-300'
  }[variant];

  const dotClasses = {
    success: 'bg-emerald-500',
    warning: 'bg-amber-500',
    danger: 'bg-rose-500',
    info: 'bg-sky-500',
    neutral: 'bg-slate-400',
    indigo: 'bg-indigo-500',
    amber: 'bg-amber-500'
  }[variant];

  return (
    <span
      className={`inline-flex items-center justify-center gap-1.5 font-bold rounded-full border shrink-0 ${sizeClasses} ${variantClasses} whitespace-nowrap select-none ${className}`}
    >
      {dot && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotClasses}`} />}
      <span className="truncate">{children}</span>
    </span>
  );
};
