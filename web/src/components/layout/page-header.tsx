interface PageHeaderProps {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}

export function PageHeader({ title, subtitle, children }: PageHeaderProps) {
  return (
    <div className="flex items-end justify-between mb-8 gap-4">
      <div className="min-w-0">
        <h1 className="font-display text-3xl font-medium tracking-tight">{title}</h1>
        {subtitle && (
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        )}
      </div>
      {children && <div className="flex gap-2 shrink-0">{children}</div>}
    </div>
  );
}
