import { CreditCard } from 'lucide-react';
import { Section } from '@/components/shared/section';

interface Props {
  ribTexte: string | null;
  ribFiles: { id: string; original_filename: string; file_path: string }[];
}

// C1 : un seul bloc compact réunissant les 2 formats de la même info (texte
// IBAN + fichier RIB). Purement informatif pour le trésorier → discret.
export function CoordonneesBancairesCard({ ribTexte, ribFiles }: Props) {
  const rien = !ribTexte && ribFiles.length === 0;
  return (
    <Section title="Coordonnées bancaires">
      {rien ? (
        <p className="text-[12px] text-fg-muted italic">Aucune coordonnée fournie.</p>
      ) : (
        <div className="space-y-1.5">
          {ribTexte && (
            <p className="font-mono text-[11.5px] leading-snug text-fg break-all whitespace-pre-line">
              {ribTexte}
            </p>
          )}
          {ribFiles.map((j) => (
            <a
              key={j.id}
              href={`/api/justificatifs/${j.file_path}`}
              target="_blank"
              rel="noopener"
              className="flex items-center gap-1.5 text-[12px] text-brand hover:underline underline-offset-2"
            >
              <CreditCard size={12} strokeWidth={1.75} className="shrink-0" />
              <span className="truncate">{j.original_filename}</span>
            </a>
          ))}
        </div>
      )}
    </Section>
  );
}
