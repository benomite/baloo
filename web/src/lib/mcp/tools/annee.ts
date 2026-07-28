import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { McpContext } from '../auth';
import { getDb } from '@/lib/db';
import { exerciceBounds, currentExercice } from '@/lib/services/overview';
import {
  getAnneeOverview,
  selectAnneeParActivite,
  selectAnneeEcritures,
  defaultActivitesExcluesIds,
} from '@/lib/services/annee';
import { listActivites } from '@/lib/services/reference';

// Parité MCP ↔ app (ADR-038) pour la page /annee : même service, donc mêmes
// chiffres côté Claude et côté webapp. Lecture seule — rien à créer ici,
// la vue est calculée.

/** Résout la liste d'exclusion comme la page : défaut = activités de camp. */
async function resolveExclusions(groupId: string, horsActiviteIds?: string[]): Promise<string[]> {
  if (horsActiviteIds) return horsActiviteIds;
  const activites = await listActivites({ groupId });
  return defaultActivitesExcluesIds(activites);
}

export function registerAnneeTools(server: McpServer, ctx: McpContext) {
  const horsSchema = z
    .array(z.string())
    .optional()
    .describe(
      "Ids d'activités à exclure du périmètre (cf. list_activites). Par défaut : les activités de camp, qui ont leur suivi propre (list_camps). Passer [] pour tout inclure.",
    );

  server.tool(
    'vue_annee',
    "Bilan réalisé d'un exercice par unité, hors camps : recettes, dépenses, solde et nombre d'écritures pour chaque unité, plus une ligne pour les écritures non imputées. Signale les brouillons et jusqu'où vont réellement les données (dernière écriture, dernier import Comptaweb).",
    {
      exercice: z
        .string()
        .regex(/^\d{4}-\d{4}$/)
        .optional()
        .describe("Exercice SGDF 'YYYY-YYYY' (sept → août). Défaut : exercice courant."),
      hors_activite_ids: horsSchema,
    },
    async ({ exercice, hors_activite_ids }) => {
      const excludeActiviteIds = await resolveExclusions(ctx.groupId, hors_activite_ids);
      const data = await getAnneeOverview(
        { groupId: ctx.groupId },
        { exercice: exercice ?? currentExercice(), excludeActiviteIds },
      );
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    'vue_annee_unite',
    "Détail d'une unité sur l'exercice, hors camps : ventilation par activité et liste complète des écritures. Passer unite_id=null pour les écritures non imputées à une unité.",
    {
      unite_id: z
        .string()
        .nullable()
        .describe("Id de l'unité (cf. list_unites), ou null pour les écritures sans unité."),
      exercice: z
        .string()
        .regex(/^\d{4}-\d{4}$/)
        .optional()
        .describe("Exercice SGDF 'YYYY-YYYY'. Défaut : exercice courant."),
      hors_activite_ids: horsSchema,
    },
    async ({ unite_id, exercice, hors_activite_ids }) => {
      const excludeActiviteIds = await resolveExclusions(ctx.groupId, hors_activite_ids);
      const bornes = exerciceBounds(exercice ?? currentExercice());
      const db = getDb();
      const [parActivite, ecritures] = await Promise.all([
        selectAnneeParActivite(db, ctx.groupId, bornes, excludeActiviteIds, unite_id),
        selectAnneeEcritures(db, ctx.groupId, bornes, excludeActiviteIds, unite_id),
      ]);
      const recettes = parActivite.reduce((s, r) => s + r.recettes, 0);
      const depenses = parActivite.reduce((s, r) => s + r.depenses, 0);
      const payload = {
        unite_id,
        exercice: exercice ?? currentExercice(),
        bornes,
        totalRecettes: recettes,
        totalDepenses: depenses,
        solde: recettes - depenses,
        parActivite,
        ecritures,
      };
      return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
    },
  );
}
