# Patchs Leveragers sur Element Web

La branche `leveragers` part du tag officiel Element `v1.12.32`, avec ces patchs par-dessus. Ce fichier
sert à celui qui les rejoue sur un nouveau tag (rebase) : une ligne par patch, avec les fichiers
d'Element qu'il touche.

| Commit | But | Fichiers d'Element touchés | Issue Element |
|---|---|---|---|
| `e0825ca` | Écrire un message avec un fichier, envoyé dans le même événement (légende MSC2530) | `src/ContentMessages.ts`, `src/components/views/dialogs/UploadConfirmDialog.tsx`, `res/css/views/dialogs/_UploadConfirmDialog.pcss`, `src/i18n/strings/{en_EN,fr}.json` (+ tests) | aucune référencée |
| `e690728` | Marque « Agents by Leveragers » : icônes, nom, couleur, pages statiques | `res/manifest.json`, `res/vector-icons/*`, `src/vector/index.html`, `src/vector/static/{incompatible-browser,unable-to-load}.html`, `src/async-components/structures/ErrorView.tsx`, `src/i18n/strings/{en_EN,es,fr}.json`, `modules/*/e2e/*.spec.ts` | sans objet |
| `592f054` | Le panneau Fichiers liste les fichiers des salons chiffrés sur le web | `src/components/structures/FilePanel.tsx` (+ nouveau `src/indexing/ServerFileScanner.ts`) | aucune référencée |
| `fix/couleur-barre-titre` | Barre de titre de l'app installée : couleur de départ = fond du thème Leveragers (`#FAF8F4`), pour qu'elle ne passe plus du bleu nuit au clair | `res/manifest.json` (`theme_color`), `src/vector/index.html` (`<meta name="theme-color">`), deux lignes déjà modifiées par `e690728` | sans objet |

Chemins relatifs à `apps/web/` sauf `modules/`.
