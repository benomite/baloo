// Script one-shot : crée des notes topic='outils' avec l'état spécifique
// des intégrations du groupe courant, en complément de doc/integrations.md
// (qui ne contient que le générique).
//
// Les valeurs ici sont lues dans compta/.env pour rester user-dépendantes.

import { ensureComptawebEnv } from '../src/lib/comptaweb/env-loader';
import { getDb } from '../src/lib/db';
import { currentTimestamp } from '../src/lib/ids';
import { getCliContext } from './cli-context';

async function main() {
  ensureComptawebEnv();
  const ctx = await getCliContext();
  const db = getDb();
  const now = currentTimestamp();

  const groupeContact = process.env.BALOO_GROUP_EMAIL_CONTACT;

  const notes: { id: string; title: string; content: string }[] = [
    {
      id: 'note-outils-etat-global',
      title: 'État global des outils',
      content: [
        `État actuel du paysage outillé du trésorier (au ${now.slice(0, 10)}).`,
        '',
        `## Comptaweb (SGDF)`,
        `- Rôle : comptabilité officielle. Source de vérité comptable.`,
        `- Accès : imposé par le mouvement. Au quotidien.`,
        '',
        `## BNP Paribas`,
        `- Rôle : exécution des mouvements bancaires (virements).`,
        `- Hypothèse : BNP = exécutant, Comptaweb = vérité comptable.`,
        `- Voir aussi la note 'comptes' qui détaille le compte principal.`,
        '',
        `## Airtable`,
        `- Rôle historique : suivi opérationnel hors Comptaweb (remboursements, abandons, caisse, dépôts chèques, ANCV, documents).`,
        `- Pain point : pas de partage gratuit, donc base solo du trésorier — structurellement bloquant.`,
        `- Tentative de migration "compta générale" dans Airtable : abandonnée en cours de saison (risque de bascule d'outil trop élevé), revenu au Sheet historique.`,
        `- Solution transitoire : migration progressive vers baloo-compta (SQLite + MCP).`,
        '',
        `## Google Sheet "Compta Unités"`,
        `- Rôle : suivi des sorties d'argent au fil de l'eau, journal des chefs avant saisie Comptaweb.`,
        `- Usage : quotidien, historique. Avantage vs Airtable : partageable gratuitement via Drive.`,
        '',
        `## Notion`,
        `- Rôle : orga générale, calendrier.`,
        `- Contrainte : le trésorier a un accès invité au workspace, pas membre. Le MCP Notion ne peut donc pas être utilisé (cf. doc/integrations.md).`,
        '',
        `## Gmail + Drive`,
        `- Rôle : correspondance officielle + fichiers partagés.`,
        `- Compte : ${groupeContact ?? 'adresse asso dans .env BALOO_GROUP_EMAIL_CONTACT'}.`,
        `- Accès Baloo : read-only via MCP communautaire (cf. doc/integrations.md).`,
        '',
        `## Tension observée`,
        `Outils qui se chevauchent partiellement (Airtable, Sheet, Comptaweb, Notion). Dispersion assumée à court terme ; objectif moyen terme : simplifier le paysage en passant par baloo-compta. Le point le plus bloquant reste l'impossibilité de partager Airtable sans abonnement payant.`,
      ].join('\n'),
    },
    {
      id: 'note-outils-airtable-tables',
      title: 'Tables Airtable actuellement utilisées',
      content: [
        'Tables connues dans la base compta du groupe (à explorer via MCP, pas à figer ici) :',
        '',
        '- Remboursements — priorité haute, migré vers baloo-compta (remboursements).',
        '- Abandons de frais — priorité haute, migré (abandons_frais).',
        '- Caisse (monnaie) — priorité moyenne, migré (mouvements_caisse).',
        '- Dépôts de chèques — banque — priorité moyenne, migré (depots_cheques).',
        '- Dépôts de chèques — ANCV — priorité moyenne, migré.',
        '- Documents — priorité basse.',
        '- Compta générale — abandonnée (retour au Sheet).',
        '',
        "Le schéma effectif est découvert dynamiquement par Baloo via get_table_schema au moment d'utiliser la table. Ne pas dupliquer le schéma Airtable dans la mémoire.",
      ].join('\n'),
    },
    {
      id: 'note-outils-mcp-disponibles',
      title: 'MCPs disponibles côté Baloo',
      content: [
        `État au ${now.slice(0, 10)} des intégrations MCP branchées sur l'install :`,
        '',
        '- **baloo-compta** (local, stdio) : compta opérationnelle en SQLite. Source de vérité opérationnelle pour les nouvelles écritures.',
        '- **airtable** (HTTP, officiel) : lecture seule au MVP (cf. doc/integrations.md).',
        '- **workspace** (uvx, communautaire) : Gmail + Drive + Sheets, lecture seule.',
        '- **claude-in-chrome** : browser automation, utilisé pour la discovery Comptaweb.',
        '',
        "Notion : non branché (contrainte d'accès invité).",
      ].join('\n'),
    },
  ];

  for (const n of notes) {
    await db.prepare(
      `INSERT OR REPLACE INTO notes (id, group_id, user_id, topic, title, content_md, created_at, updated_at)
       VALUES (?, ?, NULL, 'outils', ?, ?, ?, ?)`,
    ).run(n.id, ctx.groupId, n.title, n.content, now, now);
    console.log(`  + note ${n.id}`);
  }
  console.log(`\nImport terminé : ${notes.length} notes 'outils'.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
