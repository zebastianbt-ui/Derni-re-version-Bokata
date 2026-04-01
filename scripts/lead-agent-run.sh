#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  LEAD_AGENT_BASE_URL="https://your-domain" LEAD_AGENT_CRON_SECRET="..." ./scripts/lead-agent-run.sh [--write] [--yes]

Flags:
  --write   Run a second call with dryRun=0 (writes to Google Sheets)
  --yes     Skip confirmation prompt before write run

Optional env tuning:
  MIN_REVIEWS (default: 10)
  MAX_PAGES_PER_QUERY (default: 1)
  MAX_PLACES_TO_ENRICH (default: 120)
EOF
}

run_write=0
assume_yes=0

for arg in "$@"; do
  case "$arg" in
    --write)
      run_write=1
      ;;
    --yes)
      assume_yes=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg"
      usage
      exit 1
      ;;
  esac
done

base_url="${LEAD_AGENT_BASE_URL:-}"
token="${LEAD_AGENT_CRON_SECRET:-}"

if [[ -z "$base_url" || -z "$token" ]]; then
  echo "LEAD_AGENT_BASE_URL and LEAD_AGENT_CRON_SECRET are required."
  usage
  exit 1
fi

min_reviews="${MIN_REVIEWS:-10}"
max_pages_per_query="${MAX_PAGES_PER_QUERY:-1}"
max_places_to_enrich="${MAX_PLACES_TO_ENRICH:-120}"

call_agent() {
  local dry_run_flag="$1"
  local endpoint="${base_url%/}/api/leads-prospect-cron"
  local query="token=${token}&dryRun=${dry_run_flag}&minReviews=${min_reviews}&maxPagesPerQuery=${max_pages_per_query}&maxPlacesToEnrich=${max_places_to_enrich}"

  curl -fsS "${endpoint}?${query}"
}

echo "== Lead Agent dry run =="
call_agent 1
echo

if [[ "$run_write" -eq 0 ]]; then
  echo
  echo "Write run skipped. Use --write to append rows in Google Sheets."
  exit 0
fi

if [[ "$assume_yes" -ne 1 ]]; then
  read -r -p "Proceed with write run (dryRun=0)? [y/N] " confirm
  case "$confirm" in
    y|Y|yes|YES)
      ;;
    *)
      echo "Write run cancelled."
      exit 0
      ;;
  esac
fi

echo
echo "== Lead Agent write run =="
call_agent 0
echo

