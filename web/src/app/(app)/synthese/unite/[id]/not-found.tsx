import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export default function UniteNotFound() {
  return (
    <div className="max-w-md">
      <Link
        href="/synthese"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3"
      >
        <ArrowLeft size={14} /> Synthèse
      </Link>
      <h1 className="text-xl font-semibold mb-2">Unité introuvable</h1>
      <p className="text-sm text-muted-foreground">
        Cette unité n'existe pas ou n'appartient pas à ton groupe. Reviens à la synthèse pour
        choisir une unité disponible.
      </p>
    </div>
  );
}
