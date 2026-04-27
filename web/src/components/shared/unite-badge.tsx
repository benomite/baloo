// Pastille colorée + code unité. Couleur = charte SGDF par branche
// (stockée dans unites.couleur). Fallback en gris neutre si l'unité n'a pas
// de couleur (ex: unités locales hors référentiel officiel).

interface Props {
  code?: string | null;
  name?: string | null;
  couleur?: string | null;
  size?: 'sm' | 'md';
  showLabel?: boolean;
}

export function UniteBadge({ code, name, couleur, size = 'sm', showLabel = true }: Props) {
  if (!code) return <span className="text-muted-foreground">—</span>;
  const dotSize = size === 'sm' ? 'h-2.5 w-2.5' : 'h-3 w-3';
  const bg = couleur ?? '#C9C9C9';
  return (
    <span className="inline-flex items-center gap-1.5" title={name ?? code}>
      <span
        className={`${dotSize} shrink-0 rounded-full ring-1 ring-black/5`}
        style={{ backgroundColor: bg }}
        aria-hidden
      />
      {showLabel && <span className="text-sm">{code}</span>}
    </span>
  );
}
