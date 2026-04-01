#!/usr/bin/env bash

set -euo pipefail

required_vars=(
  "GOOGLE_PLACES_API_KEY"
  "GOOGLE_SHEETS_SPREADSHEET_ID"
  "GOOGLE_SERVICE_ACCOUNT_EMAIL"
  "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY"
  "LEAD_AGENT_CRON_SECRET"
)

optional_vars=(
  "GOOGLE_SHEETS_TAB_NAME"
  "LEAD_AGENT_DEFAULT_DRY_RUN"
  "LEAD_AGENT_BASE_URL"
)

print_var_status() {
  local var_name="$1"
  local value="${!var_name:-}"
  if [[ -n "$value" ]]; then
    printf "✅ %s set\n" "$var_name"
  else
    printf "❌ %s missing\n" "$var_name"
  fi
}

echo "== Lead Agent preflight =="
echo

missing=()
for var_name in "${required_vars[@]}"; do
  print_var_status "$var_name"
  if [[ -z "${!var_name:-}" ]]; then
    missing+=("$var_name")
  fi
done

echo
for var_name in "${optional_vars[@]}"; do
  print_var_status "$var_name"
done

echo
if [[ -n "${GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY:-}" ]]; then
  if [[ "${GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY}" != *"BEGIN PRIVATE KEY"* ]]; then
    echo "⚠️  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY looks unusual (no BEGIN PRIVATE KEY marker)."
  fi
fi

if [[ -n "${GOOGLE_SERVICE_ACCOUNT_EMAIL:-}" ]]; then
  if [[ "${GOOGLE_SERVICE_ACCOUNT_EMAIL}" != *"@"* ]]; then
    echo "⚠️  GOOGLE_SERVICE_ACCOUNT_EMAIL seems invalid."
  fi
fi

if [[ ${#missing[@]} -gt 0 ]]; then
  echo
  echo "Preflight failed. Missing required vars: ${missing[*]}"
  exit 1
fi

echo
echo "Required env vars are present."

if [[ -n "${LEAD_AGENT_BASE_URL:-}" ]]; then
  endpoint="${LEAD_AGENT_BASE_URL%/}/api/leads-prospect-cron?token=${LEAD_AGENT_CRON_SECRET}&dryRun=1&maxPlacesToEnrich=5"
  echo "Running a remote dry-run health check..."
  curl -fsS "$endpoint" >/dev/null
  echo "✅ Endpoint reachable and dry-run succeeded."
else
  echo "ℹ️  Set LEAD_AGENT_BASE_URL to include endpoint dry-run health check."
fi

