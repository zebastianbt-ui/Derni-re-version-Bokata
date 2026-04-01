import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runLeadAgentPhase1 } from "./_leadAgent";

const getEnv = (key: string) => process.env[key] ?? "";

const getQueryValue = (value: string | string[] | undefined) => {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
};

const isTruthy = (value: string) => ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());
const isFalsy = (value: string) => ["0", "false", "no", "off"].includes(String(value || "").toLowerCase());

const parseBooleanLike = (value: string): boolean | null => {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return null;
  if (isTruthy(normalized)) return true;
  if (isFalsy(normalized)) return false;
  return null;
};

const toNumber = (raw: unknown, fallback: number) => {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  const cronHeader = req.headers["x-vercel-cron"];
  const token = getQueryValue(req.query?.token);
  const secret = getEnv("LEAD_AGENT_CRON_SECRET");
  if (!cronHeader && !(secret && token && token === secret)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const placesApiKey = getEnv("GOOGLE_PLACES_API_KEY");
  const sheetsSpreadsheetId = getEnv("GOOGLE_SHEETS_SPREADSHEET_ID");
  const sheetsTabName = getEnv("GOOGLE_SHEETS_TAB_NAME") || "Prospects";
  const googleServiceAccountEmail = getEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  const googleServiceAccountPrivateKey = getEnv("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY");

  const missing: string[] = [];
  if (!placesApiKey) missing.push("GOOGLE_PLACES_API_KEY");
  if (!sheetsSpreadsheetId) missing.push("GOOGLE_SHEETS_SPREADSHEET_ID");
  if (!googleServiceAccountEmail) missing.push("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  if (!googleServiceAccountPrivateKey) missing.push("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY");

  if (missing.length) {
    res.status(500).json({ error: `Missing env vars: ${missing.join(", ")}` });
    return;
  }

  try {
    const defaultDryRun = parseBooleanLike(getEnv("LEAD_AGENT_DEFAULT_DRY_RUN")) ?? true;

    const dryRunRaw = req.query?.dryRun;
    let dryRun = defaultDryRun;
    if (dryRunRaw !== undefined) {
      const parsedDryRun = parseBooleanLike(getQueryValue(dryRunRaw));
      if (parsedDryRun == null) {
        res.status(400).json({ error: "Invalid dryRun value. Use 1/0/true/false." });
        return;
      }
      dryRun = parsedDryRun;
    }

    const minReviews = toNumber(getQueryValue(req.query?.minReviews), 10);
    const maxPagesPerQuery = toNumber(getQueryValue(req.query?.maxPagesPerQuery), 1);
    const maxPlacesToEnrich = toNumber(getQueryValue(req.query?.maxPlacesToEnrich), 120);

    const result = await runLeadAgentPhase1({
      placesApiKey,
      sheetsSpreadsheetId,
      sheetsTabName,
      googleServiceAccountEmail,
      googleServiceAccountPrivateKey,
      minReviews,
      maxPagesPerQuery,
      maxPlacesToEnrich,
      dryRun,
    });

    res.status(200).json({
      ok: true,
      phase: "phase_1_places_to_sheets",
      message: "Drafts generated in Google Sheets. No emails sent. Gmail not connected.",
      resolved_dry_run: dryRun,
      default_dry_run_from_env: defaultDryRun,
      ...result,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Lead agent failed";
    res.status(500).json({ error: errorMessage });
  }
}
