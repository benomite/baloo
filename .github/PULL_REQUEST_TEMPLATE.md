<!--
Merci pour la PR ! Quelques infos pour faciliter la review.
Pas besoin de remplir toutes les sections — supprime ce qui n'est pas pertinent.
-->

## Quoi

<!-- Une phrase qui décrit le changement. -->

## Pourquoi

<!--
Lien vers l'issue : Closes #N
Ou contexte court : « bug en prod sur X », « préparation chantier Y », etc.
-->

## Comment vérifier

<!-- Étapes manuelles pour tester. Si tests automatisés, mentionner aussi. -->

- [ ] …

## Checklist

- [ ] `pnpm lint` passe.
- [ ] `pnpm exec tsc --noEmit` passe.
- [ ] `pnpm test` passe.
- [ ] Pas de donnée nominative dans le diff (noms, montants, emails réels).
- [ ] Pas de `DELETE` sur des tables métier (préservation des données — cf. `CLAUDE.md`).
- [ ] Si changement structurel : ADR ajouté/mis à jour dans `doc/decisions.md`.
- [ ] Si changement UX : screenshot ou GIF.

## Screenshots / GIFs

<!-- Si UI change. -->
