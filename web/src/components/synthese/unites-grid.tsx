import Link from 'next/link';
import { UniteCard, type UniteCardData } from './unite-card';

interface Props {
  unites: UniteCardData[];
  exerciceParam: string;
}

export function UnitesGrid({ unites, exerciceParam }: Props) {
  if (unites.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Aucune unité importée.{' '}
        <Link href="/import" className="text-brand hover:underline underline-offset-2">
          Synchronise les référentiels Comptaweb
        </Link>
        {' '}pour les voir apparaître.
      </p>
    );
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {unites.map((u) => (
        <UniteCard key={u.id} unite={u} exerciceParam={exerciceParam} />
      ))}
    </div>
  );
}
