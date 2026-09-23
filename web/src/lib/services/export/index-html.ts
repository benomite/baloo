// Page `index.html` de l'archive : rendu HTML pur, aucune I/O ici. Le
// script appelant (`scripts/export-exercice.ts`) résout les chemins des
// dossiers de pièces (existence réelle sur disque, via le registre
// anti-collision de `dossierEcritureUnique` pour les écritures) et passe
// des données déjà formatées — cette fonction ne fait que composer le HTML.
//
// Contraintes non négociables (cf. brief tâche 14, ADR-040) :
// - page autonome : CSS inline, aucune ressource externe (pas de CDN, pas
//   de police distante) — elle doit s'ouvrir depuis un Drive téléchargé,
//   sans réseau, des années plus tard ;
// - liens relatifs uniquement, jamais de chemin absolu ni de `file://` ;
// - tout texte issu de la base est échappé, y compris dans les attributs
//   `href` (un libellé d'écriture ou une note peut contenir n'importe quoi).
import { formatRapportTexte, type Controle } from './controles';
import type { BornesExercice } from './bornes';

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Encode un chemin relatif pour un `href` : préserve les `/` (séparateurs
// de dossiers), encode chaque segment (espaces, accents, `#`, `?`…). Les
// noms de dossiers dérivent parfois d'une saisie libre (ex. `numero_piece`
// Comptaweb, jamais slugifié dans `dossierEcriture`) : rien ne garantit
// qu'ils soient déjà utilisables tels quels dans une URL.
export function hrefRelatif(chemin: string): string {
  return chemin
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

export interface ColonneIndex {
  label: string;
  align?: 'right';
}

export interface LigneIndex {
  cellules: string[];
  // undefined : cette section n'a pas de notion de « dossier de pièces »
  // (pas de colonne dédiée). null : la section en a une, mais aucun
  // dossier n'existe pour cette ligne précise. string : chemin relatif
  // (depuis la racine de l'archive, `/` toujours, quel que soit l'OS) vers
  // le dossier de pièces.
  dossierRelatif?: string | null;
}

export interface FichierIndex {
  nom: string;
  relatif: string;
}

export interface BlocTableau {
  // Sous-titre optionnel : une section peut porter plusieurs tableaux
  // (ex. 04-caisse : mouvements, dépôts espèces, dépôts chèques, avances
  // de camp — quatre tables distinctes sous une même section).
  titre?: string;
  headers: ColonneIndex[];
  lignes: LigneIndex[];
  // Message affiché à la place du tableau quand `lignes` est vide.
  videTexte?: string;
}

export interface SectionIndex {
  id: string;
  titre: string;
  blocs: BlocTableau[];
  // Fichiers de la section (CSV, .md…) proposés en lien depuis l'en-tête
  // de section, en plus des liens par ligne.
  fichiers?: FichierIndex[];
}

export interface EnteteIndex {
  groupeNom: string;
  exercice: string;
  debut: string;
  fin: string;
  genereLe: string; // ISO 'YYYY-MM-DD'
  // Paragraphes de mention du caviardage, réutilisés VERBATIM depuis le
  // README (cf. brief : « reprends la formulation déjà présente, ne la
  // réinvente pas »).
  caviardage: string[];
}

export interface IndexHtmlData {
  entete: EnteteIndex;
  bornes: BornesExercice;
  controles: Controle[];
  sections: SectionIndex[];
}

const STYLES = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 2rem 1.25rem 4rem;
    background: #f7f6f3;
    color: #1f2320;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    line-height: 1.5;
  }
  main {
    max-width: 960px;
    margin: 0 auto;
  }
  header.entete {
    background: #ffffff;
    border: 1px solid #d8d5cc;
    border-radius: 8px;
    padding: 1.5rem 1.75rem;
    margin-bottom: 1.5rem;
  }
  header.entete h1 { margin: 0 0 .25rem; font-size: 1.5rem; }
  header.entete .sous-titre { margin: 0 0 1rem; color: #55584f; }
  header.entete dl { display: grid; grid-template-columns: max-content 1fr; gap: .25rem 1rem; margin: 0 0 1rem; }
  header.entete dt { color: #55584f; }
  header.entete dd { margin: 0; }
  .caviardage { font-size: .9rem; color: #55584f; border-top: 1px solid #eae7de; padding-top: .75rem; margin-top: .75rem; }
  .caviardage p { margin: 0 0 .5rem; }
  .caviardage p:last-child { margin-bottom: 0; }
  nav.sommaire {
    background: #ffffff;
    border: 1px solid #d8d5cc;
    border-radius: 8px;
    padding: .75rem 1.25rem;
    margin-bottom: 1.5rem;
    font-size: .9rem;
  }
  nav.sommaire a { color: #2f5233; text-decoration: none; margin-right: 1rem; white-space: nowrap; }
  nav.sommaire a:hover { text-decoration: underline; }
  section.controles {
    background: #ffffff;
    border: 1px solid #d8d5cc;
    border-left: 6px solid #8a8672;
    border-radius: 8px;
    padding: 1.25rem 1.5rem;
    margin-bottom: 1.5rem;
  }
  section.controles.alerte { border-left-color: #b5651d; }
  section.controles h2 { margin-top: 0; }
  section.controles pre {
    white-space: pre-wrap;
    word-break: break-word;
    background: #f7f6f3;
    border: 1px solid #eae7de;
    border-radius: 6px;
    padding: 1rem;
    font-size: .85rem;
    margin: 0;
  }
  section.donnees {
    background: #ffffff;
    border: 1px solid #d8d5cc;
    border-radius: 8px;
    padding: 1.25rem 1.5rem;
    margin-bottom: 1.5rem;
  }
  section.donnees h2 { margin-top: 0; }
  section.donnees h3 { margin-bottom: .5rem; }
  .compte { color: #8a8672; font-weight: normal; font-size: .85em; }
  .fichiers { font-size: .9rem; color: #55584f; }
  .fichiers a { color: #2f5233; }
  .vide { color: #8a8672; font-style: italic; }
  table { width: 100%; border-collapse: collapse; font-size: .9rem; margin-bottom: .5rem; }
  th, td { text-align: left; padding: .4rem .6rem; border-bottom: 1px solid #eae7de; vertical-align: top; }
  th { color: #55584f; font-weight: 600; border-bottom: 2px solid #d8d5cc; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tbody tr:hover { background: #f7f6f3; }
  td.muted { color: #b3b0a4; }
  footer { text-align: center; color: #8a8672; font-size: .8rem; margin-top: 2rem; }
  @media print {
    body { background: #ffffff; padding: 0; }
    nav.sommaire { display: none; }
    section.controles, section.donnees, header.entete { border: none; box-shadow: none; break-inside: avoid; }
  }
`;

function renderBloc(b: BlocTableau): string {
  const titreHtml = b.titre ? `<h3>${escapeHtml(b.titre)} <span class="compte">(${b.lignes.length})</span></h3>` : '';

  if (b.lignes.length === 0) {
    return `${titreHtml}<p class="vide">${escapeHtml(b.videTexte ?? 'Aucun élément.')}</p>`;
  }

  const avecPieces = b.lignes.some((l) => l.dossierRelatif !== undefined);
  const thead = `<tr>${b.headers
    .map((h) => `<th${h.align === 'right' ? ' class="num"' : ''}>${escapeHtml(h.label)}</th>`)
    .join('')}${avecPieces ? '<th>Pièces</th>' : ''}</tr>`;

  const tbody = b.lignes
    .map((l) => {
      const cellules = l.cellules
        .map((c, i) => `<td${b.headers[i]?.align === 'right' ? ' class="num"' : ''}>${escapeHtml(c)}</td>`)
        .join('');
      const pieceCell = !avecPieces
        ? ''
        : l.dossierRelatif
          ? `<td><a href="${escapeHtml(hrefRelatif(l.dossierRelatif))}">dossier</a></td>`
          : '<td class="muted">—</td>';
      return `<tr>${cellules}${pieceCell}</tr>`;
    })
    .join('');

  return `${titreHtml}<table>
      <thead>${thead}</thead>
      <tbody>${tbody}</tbody>
    </table>`;
}

function renderSection(s: SectionIndex): string {
  const fichiersHtml =
    s.fichiers && s.fichiers.length > 0
      ? `<p class="fichiers">Fichiers : ${s.fichiers
          .map((f) => `<a href="${escapeHtml(hrefRelatif(f.relatif))}">${escapeHtml(f.nom)}</a>`)
          .join(' · ')}</p>`
      : '';

  const totalLignes = s.blocs.reduce((acc, b) => acc + b.lignes.length, 0);
  const blocsHtml = s.blocs.map(renderBloc).join('\n');

  return `<section class="donnees" id="${escapeHtml(s.id)}">
    <h2>${escapeHtml(s.titre)} <span class="compte">(${totalLignes})</span></h2>
    ${fichiersHtml}
    ${blocsHtml}
  </section>`;
}

export function genererIndexHtml(data: IndexHtmlData): string {
  const { entete, controles, bornes, sections } = data;
  const totalControles = controles.reduce((acc, c) => acc + c.lignes.length, 0);

  const enteteDl = [
    ['Groupe', entete.groupeNom],
    ['Exercice', entete.exercice],
    ['Période', `${entete.debut} → ${entete.fin}`],
    ['Export généré le', entete.genereLe],
  ]
    .map(([dt, dd]) => `<dt>${escapeHtml(dt)}</dt><dd>${escapeHtml(dd)}</dd>`)
    .join('');

  const caviardageHtml = entete.caviardage.map((p) => `<p>${escapeHtml(p)}</p>`).join('');

  const sommaireHtml = [
    `<a href="#controles">Contrôles</a>`,
    ...sections.map((s) => `<a href="#${escapeHtml(s.id)}">${escapeHtml(s.titre)}</a>`),
  ].join('');

  const resumeControles =
    totalControles === 0
      ? "Rien à signaler : l'exercice était prêt à être clos au moment de l'export."
      : `${totalControles} point${totalControles > 1 ? 's' : ''} à vérifier au moment de l'export.`;

  const sectionsHtml = sections.map(renderSection).join('\n');

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Archive ${escapeHtml(entete.exercice)} — ${escapeHtml(entete.groupeNom)}</title>
<style>${STYLES}</style>
</head>
<body>
<main>
  <header class="entete">
    <h1>Archive de l'exercice ${escapeHtml(entete.exercice)}</h1>
    <p class="sous-titre">${escapeHtml(entete.groupeNom)}</p>
    <dl>${enteteDl}</dl>
    <div class="caviardage">${caviardageHtml}</div>
  </header>

  <nav class="sommaire">${sommaireHtml}</nav>

  <section class="controles${totalControles > 0 ? ' alerte' : ''}" id="controles">
    <h2>Contrôles de cohérence</h2>
    <p>${escapeHtml(resumeControles)}</p>
    <pre>${escapeHtml(formatRapportTexte(controles, bornes))}</pre>
  </section>

  ${sectionsHtml}

  <footer>Archive générée par Baloo — page autonome, à conserver avec le reste du dossier.</footer>
</main>
</body>
</html>
`;
}
