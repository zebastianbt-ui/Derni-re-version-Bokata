# Lead Agent — Phase 1 (Google Places ➜ Google Sheets)

## Architecture

- Endpoint: `GET /api/leads-prospect-cron`
- Source de données: Google Places API (Text Search + Place Details)
- Villes: `Örebro`, `Norrköping`
- Requêtes: `café`, `restaurang`, `brunch`, `lunch`, `bistro`
- Exclusions: `pizzeria`, `sushi`, `thai`, `indiskt`, `indisk`, `takeaway`, `konditori`
- Sortie: append dans Google Sheets avec `status = DRAFT_READY`
- Sécurité: aucun envoi email, aucun branchement Gmail

## Flux

1. Recherche Places pour chaque combinaison `ville x requête`
2. Déduplication par `place_id`
3. Enrichissement via Place Details
4. Filtrage:
   - minimum `10` avis Google
   - exclusion par mots-clés
5. Priorisation:
   - `segment = HIGH_PRIORITY_WEBSITE` si `website` présent
   - sinon `segment = STANDARD`
6. Génération draft:
   - `email_subject`
   - `email_body`
7. Écriture dans Google Sheets (sans envoi email)

## Variables d'environnement

Obligatoires:

- `GOOGLE_PLACES_API_KEY`
- `GOOGLE_SHEETS_SPREADSHEET_ID`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`

Optionnelles:

- `GOOGLE_SHEETS_TAB_NAME` (défaut: `Prospects`)
- `LEAD_AGENT_CRON_SECRET` (recommandé pour appels manuels sécurisés)
- `LEAD_AGENT_DEFAULT_DRY_RUN` (défaut safe: `true` si absent)

Pré-requis Google Sheets:

- partager le Google Sheet avec `GOOGLE_SERVICE_ACCOUNT_EMAIL` (éditeur)

## Exemple d'appel

Dry run (ne rien écrire):

`/api/leads-prospect-cron?token=YOUR_SECRET&dryRun=1`

Run normal:

`/api/leads-prospect-cron?token=YOUR_SECRET`

Paramètres optionnels:

- `minReviews` (défaut `10`)
- `maxPagesPerQuery` (défaut `1`)
- `maxPlacesToEnrich` (défaut `120`)

## Résolution du mode dry run

- Si `dryRun` est présent dans la query (`1/0/true/false`), il est prioritaire
- Sinon l'API utilise `LEAD_AGENT_DEFAULT_DRY_RUN`
- Si `LEAD_AGENT_DEFAULT_DRY_RUN` est absent, fallback en `true`

La réponse JSON expose:

- `resolved_dry_run`
- `default_dry_run_from_env`

## Cron Vercel

- Cron suivi clients existant: `/api/followup-cron` à `08:00` UTC
- Cron prospection Phase 1: `/api/leads-prospect-cron` à `06:00` UTC

## Scripts opérateur

Préflight config:

`./scripts/lead-agent-preflight.sh`

Préflight + ping endpoint dry run:

`LEAD_AGENT_BASE_URL=https://YOUR_DOMAIN LEAD_AGENT_CRON_SECRET=YOUR_SECRET ./scripts/lead-agent-preflight.sh`

Run dry run manuel:

`LEAD_AGENT_BASE_URL=https://YOUR_DOMAIN LEAD_AGENT_CRON_SECRET=YOUR_SECRET ./scripts/lead-agent-run.sh`

Run dry run puis write run:

`LEAD_AGENT_BASE_URL=https://YOUR_DOMAIN LEAD_AGENT_CRON_SECRET=YOUR_SECRET ./scripts/lead-agent-run.sh --write`

Run write sans prompt:

`LEAD_AGENT_BASE_URL=https://YOUR_DOMAIN LEAD_AGENT_CRON_SECRET=YOUR_SECRET ./scripts/lead-agent-run.sh --write --yes`

## Procédure recommandée (safe rollout)

1. Configurer `LEAD_AGENT_DEFAULT_DRY_RUN=true`
2. Lancer preflight + dry run manuel
3. Vérifier le JSON (`ready_count`, `sample`, `resolved_dry_run=true`)
4. Lancer un write run manuel avec `dryRun=0`
5. Vérifier les lignes dans Google Sheets
6. Garder 2-3 jours en observation
7. Passer `LEAD_AGENT_DEFAULT_DRY_RUN=false` pour la prod continue

## Troubleshooting

- `Missing env vars`: variable manquante côté Vercel
- `Invalid dryRun value`: utiliser uniquement `1/0/true/false`
- `Google OAuth token failed (invalid_grant)`: private key mal formatée (garder les `\n`)
- `Google Sheets read failed (403)`: Google Sheet non partagé au service account
- `Google Places textsearch/details failed (REQUEST_DENIED)`: clé API invalide ou API non activée

## Important

- Aucun email n'est envoyé.
- Aucun branchement Gmail n'est utilisé dans cette phase.
