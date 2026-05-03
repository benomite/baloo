import { LifeBuoy, Mail } from 'lucide-react';
import { getDb } from '@/lib/db';

// Encart discret en bas de chaque page authentifiée. Donne au user un
// chemin direct vers le trésorier du groupe en cas de blocage : un
// clic, mail pré-rempli, pas de support à faire à part répondre.
//
// On prend le premier user role='tresorier' actif (par created_at).
// Pas de notion de "trésorier principal" en BDD — c'est le premier
// trésorier inscrit dans le groupe par convention.
async function getMainTresorierEmail(groupId: string): Promise<string | null> {
  const row = await getDb()
    .prepare(
      `SELECT email FROM users
       WHERE group_id = ? AND statut = 'actif' AND role = 'tresorier'
       ORDER BY created_at ASC
       LIMIT 1`,
    )
    .get<{ email: string }>(groupId);
  return row?.email ?? null;
}

interface Props {
  groupId: string;
  /** Email du user courant — pour exclure du destinataire si c'est lui
   *  le trésorier (sinon il s'enverrait un mail à lui-même). */
  selfEmail?: string;
}

export async function HelpFooter({ groupId, selfEmail }: Props) {
  const tresorierEmail = await getMainTresorierEmail(groupId);
  if (!tresorierEmail || tresorierEmail === selfEmail) return null;

  const subject = 'Coup de main sur Baloo';
  const body =
    "Bonjour,\n\nJe suis sur Baloo et j'ai une question sur :\n\n[décris ce qui te bloque]\n\nMerci d'avance,";
  const mailto = `mailto:${tresorierEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  return (
    <footer className="mt-12 pt-6 border-t border-border-soft">
      <a
        href={mailto}
        className="group flex items-center gap-3 rounded-lg border border-border-soft bg-bg-sunken/40 px-4 py-3 text-[12.5px] hover:border-brand-100 hover:bg-brand-50/30 transition-colors"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand">
          <LifeBuoy size={16} strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-medium text-fg">Tu es bloqué ?</div>
          <div className="text-fg-muted">
            Le trésorier ({tresorierEmail}) est là pour t&apos;aider — un clic et le mail est
            pré-rempli.
          </div>
        </div>
        <Mail
          size={14}
          strokeWidth={1.75}
          className="shrink-0 text-fg-subtle group-hover:text-brand transition-colors"
        />
      </a>
    </footer>
  );
}
