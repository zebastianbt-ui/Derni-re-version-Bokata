import crypto from "crypto";

const START_CITIES = ["Örebro", "Norrköping"] as const;
const SEARCH_TERMS = ["café", "restaurang", "brunch", "lunch", "bistro"] as const;
const EXCLUDED_TERMS = ["pizzeria", "sushi", "thai", "indiskt", "indisk", "takeaway", "konditori"] as const;

const SHEET_COLUMNS = [
  "status",
  "city",
  "place_id",
  "name",
  "category_raw",
  "segment",
  "maps_url",
  "website",
  "phone",
  "rating",
  "reviews_count",
  "opening_hours",
  "email_found",
  "email",
  "stripe_trial_code",
  "email_subject",
  "email_body",
  "notes",
  "created_at",
  "updated_at",
] as const;

type PlaceSearchResult = {
  place_id?: string;
  name?: string;
  types?: string[];
  rating?: number;
  user_ratings_total?: number;
};

type PlaceDetailsResult = {
  place_id?: string;
  name?: string;
  types?: string[];
  website?: string;
  url?: string;
  formatted_phone_number?: string;
  rating?: number;
  user_ratings_total?: number;
  opening_hours?: { weekday_text?: string[] };
};

type CandidateBase = {
  placeId: string;
  city: string;
  matchedQuery: string;
  name: string;
  categoryRaw: string;
  rating: number | null;
  reviewsCount: number | null;
};

type LeadRow = {
  status: "DRAFT_READY";
  city: string;
  place_id: string;
  name: string;
  category_raw: string;
  segment: string;
  maps_url: string;
  website: string;
  phone: string;
  rating: string;
  reviews_count: string;
  opening_hours: string;
  email_found: string;
  email: string;
  stripe_trial_code: string;
  email_subject: string;
  email_body: string;
  notes: string;
  created_at: string;
  updated_at: string;
};

export type LeadAgentOptions = {
  placesApiKey: string;
  sheetsSpreadsheetId: string;
  sheetsTabName: string;
  googleServiceAccountEmail: string;
  googleServiceAccountPrivateKey: string;
  minReviews?: number;
  maxPagesPerQuery?: number;
  maxPlacesToEnrich?: number;
  dryRun?: boolean;
};

export type LeadAgentRunResult = {
  scanned: number;
  enriched: number;
  filtered_out: number;
  ready_count: number;
  duplicate_skipped: number;
  appended_count: number;
  dry_run: boolean;
  columns: readonly string[];
  sample: Array<{ city: string; place_id: string; name: string; segment: string; website: string }>;
};

let sheetTokenCache: { accessToken: string; expiresAt: number } | null = null;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeText = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

const isExcluded = (value: string) => {
  const normalized = normalizeText(value);
  return EXCLUDED_TERMS.some((term) => normalized.includes(normalizeText(term)));
};

const buildPlaceQuery = (term: string, city: string) => `${term} ${city} Sweden`;

const safeString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const toCategoryRaw = (types: string[] | undefined, fallback: string) => {
  const raw = (types ?? []).map((item) => item.replace(/_/g, " ")).join(", ");
  return raw || fallback;
};

const buildMapsUrl = (placeId: string, explicitUrl: string) => {
  if (explicitUrl) return explicitUrl;
  return `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`;
};

const buildEmailSubject = (name: string) => `Förslag för ${name}: fler bokningar med Bokäta`;

const buildEmailBody = (name: string, city: string, segment: string) => {
  const priorityLine =
    segment === "HIGH_PRIORITY_WEBSITE"
      ? "Vi såg att ni redan har en hemsida — perfekt för att aktivera direktbokning med minimal friktion."
      : "Vi kan hjälpa er få fler bokningar även om ni vill starta enkelt utan tekniskt krångel.";

  return [
    `Hej ${name}-teamet,`,
    "",
    `Jag hittade er verksamhet i ${city} och tror att Bokäta kan vara relevant för er.`,
    priorityLine,
    "",
    "Bokäta hjälper restauranger och caféer att:",
    "- ta emot bokningar direkt via webben",
    "- svara snabbare på vanliga frågor med AI-assistent",
    "- minska manuellt arbete kring reservationer",
    "",
    `Om ni vill kan vi sätta upp en kort demo anpassad för ${name}.`,
    "",
    "Vänliga hälsningar,",
    "[Namn]",
    "Bokäta",
  ].join("\n");
};

const base64UrlEncode = (input: Buffer | string) =>
  Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

const getGoogleAccessToken = async (serviceEmail: string, privateKeyRaw: string) => {
  if (sheetTokenCache && sheetTokenCache.expiresAt > Date.now() + 60_000) {
    return sheetTokenCache.accessToken;
  }

  const privateKey = privateKeyRaw.replace(/\\n/g, "\n");
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claimSet = {
    iss: serviceEmail,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedClaimSet = base64UrlEncode(JSON.stringify(claimSet));
  const signingInput = `${encodedHeader}.${encodedClaimSet}`;

  const signer = crypto.createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(privateKey, "base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  const assertion = `${signingInput}.${signature}`;

  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });

  const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!tokenResp.ok) {
    const details = await tokenResp.text();
    throw new Error(`Google OAuth token failed (${tokenResp.status}): ${details}`);
  }

  const tokenJson = (await tokenResp.json()) as { access_token?: string; expires_in?: number };
  if (!tokenJson.access_token) {
    throw new Error("Google OAuth token missing access_token");
  }

  const expiresIn = Number(tokenJson.expires_in ?? 3600);
  sheetTokenCache = {
    accessToken: tokenJson.access_token,
    expiresAt: Date.now() + Math.max(0, expiresIn - 60) * 1000,
  };
  return tokenJson.access_token;
};

const textSearchPlaces = async (apiKey: string, query: string, pageToken?: string) => {
  const url = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
  url.searchParams.set("query", query);
  url.searchParams.set("language", "sv");
  url.searchParams.set("region", "se");
  url.searchParams.set("key", apiKey);
  if (pageToken) url.searchParams.set("pagetoken", pageToken);

  const response = await fetch(url.toString());
  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Google Places textsearch HTTP ${response.status}: ${details}`);
  }

  const payload = (await response.json()) as {
    status?: string;
    error_message?: string;
    next_page_token?: string;
    results?: PlaceSearchResult[];
  };

  const status = payload.status ?? "";
  if (status !== "OK" && status !== "ZERO_RESULTS") {
    throw new Error(`Google Places textsearch failed: ${status} ${payload.error_message ?? ""}`.trim());
  }

  return {
    results: payload.results ?? [],
    nextPageToken: payload.next_page_token ?? "",
  };
};

const detailsSearchPlace = async (apiKey: string, placeId: string): Promise<PlaceDetailsResult | null> => {
  const url = new URL("https://maps.googleapis.com/maps/api/place/details/json");
  url.searchParams.set("place_id", placeId);
  url.searchParams.set(
    "fields",
    [
      "place_id",
      "name",
      "types",
      "website",
      "url",
      "formatted_phone_number",
      "rating",
      "user_ratings_total",
      "opening_hours",
    ].join(",")
  );
  url.searchParams.set("language", "sv");
  url.searchParams.set("region", "se");
  url.searchParams.set("key", apiKey);

  const response = await fetch(url.toString());
  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Google Places details HTTP ${response.status}: ${details}`);
  }

  const payload = (await response.json()) as {
    status?: string;
    error_message?: string;
    result?: PlaceDetailsResult;
  };

  const status = payload.status ?? "";
  if (status === "ZERO_RESULTS") return null;
  if (status !== "OK") {
    throw new Error(`Google Places details failed: ${status} ${payload.error_message ?? ""}`.trim());
  }

  return payload.result ?? null;
};

const collectCandidates = async (apiKey: string, maxPagesPerQuery: number) => {
  const byPlaceId = new Map<string, CandidateBase>();

  for (const city of START_CITIES) {
    for (const term of SEARCH_TERMS) {
      let nextPageToken = "";
      let page = 0;

      while (page < maxPagesPerQuery) {
        if (page > 0 && nextPageToken) {
          await sleep(2200);
        }

        const query = buildPlaceQuery(term, city);
        const { results, nextPageToken: returnedPageToken } = await textSearchPlaces(apiKey, query, nextPageToken || undefined);

        for (const result of results) {
          const placeId = safeString(result.place_id);
          if (!placeId) continue;

          const rawName = safeString(result.name);
          const categoryRaw = toCategoryRaw(result.types, term);
          const existing = byPlaceId.get(placeId);
          const reviewsCount = typeof result.user_ratings_total === "number" ? result.user_ratings_total : null;
          const rating = typeof result.rating === "number" ? result.rating : null;

          if (!existing) {
            byPlaceId.set(placeId, {
              placeId,
              city,
              matchedQuery: term,
              name: rawName || placeId,
              categoryRaw,
              rating,
              reviewsCount,
            });
            continue;
          }

          const existingScore = Number(existing.reviewsCount ?? 0) + (existing.rating ?? 0);
          const candidateScore = Number(reviewsCount ?? 0) + (rating ?? 0);
          if (candidateScore > existingScore) {
            byPlaceId.set(placeId, {
              ...existing,
              city,
              matchedQuery: term,
              name: rawName || existing.name,
              categoryRaw: categoryRaw || existing.categoryRaw,
              rating,
              reviewsCount,
            });
          }
        }

        if (!returnedPageToken) break;
        nextPageToken = returnedPageToken;
        page += 1;
      }
    }
  }

  return Array.from(byPlaceId.values());
};

const toLeadRow = (candidate: CandidateBase, details: PlaceDetailsResult, nowIso: string): LeadRow | null => {
  const placeId = safeString(details.place_id) || candidate.placeId;
  const name = safeString(details.name) || candidate.name;
  const categoryRaw = toCategoryRaw(details.types, candidate.categoryRaw || candidate.matchedQuery);
  if (!placeId || !name || !categoryRaw) return null;

  const website = safeString(details.website);
  const mapsUrl = buildMapsUrl(placeId, safeString(details.url));
  const phone = safeString(details.formatted_phone_number);
  const rating = typeof details.rating === "number" ? details.rating : candidate.rating;
  const reviewsCount =
    typeof details.user_ratings_total === "number" ? details.user_ratings_total : (candidate.reviewsCount ?? null);
  const openingHours = (details.opening_hours?.weekday_text ?? []).join(" | ").trim();

  const segment = website ? "HIGH_PRIORITY_WEBSITE" : "STANDARD";
  const emailSubject = buildEmailSubject(name);
  const emailBody = buildEmailBody(name, candidate.city, segment);
  const notes = `source=google_places;query=${candidate.matchedQuery};priority=${segment};no_send=true`;

  return {
    status: "DRAFT_READY",
    city: candidate.city,
    place_id: placeId,
    name,
    category_raw: categoryRaw,
    segment,
    maps_url: mapsUrl,
    website,
    phone,
    rating: rating == null ? "" : String(rating),
    reviews_count: reviewsCount == null ? "" : String(reviewsCount),
    opening_hours: openingHours,
    email_found: "FALSE",
    email: "",
    stripe_trial_code: "",
    email_subject: emailSubject,
    email_body: emailBody,
    notes,
    created_at: nowIso,
    updated_at: nowIso,
  };
};

const rowToSheetArray = (row: LeadRow) => [
  row.status,
  row.city,
  row.place_id,
  row.name,
  row.category_raw,
  row.segment,
  row.maps_url,
  row.website,
  row.phone,
  row.rating,
  row.reviews_count,
  row.opening_hours,
  row.email_found,
  row.email,
  row.stripe_trial_code,
  row.email_subject,
  row.email_body,
  row.notes,
  row.created_at,
  row.updated_at,
];

const getExistingPlaceIds = async (
  accessToken: string,
  spreadsheetId: string,
  tabName: string
): Promise<Set<string>> => {
  const range = encodeURIComponent(`${tabName}!C2:C`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${range}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Google Sheets read failed (${response.status}): ${details}`);
  }

  const payload = (await response.json()) as { values?: string[][] };
  const ids = new Set<string>();
  for (const row of payload.values ?? []) {
    const placeId = safeString(row?.[0] ?? "");
    if (placeId) ids.add(placeId);
  }
  return ids;
};

const appendRowsToSheet = async (
  accessToken: string,
  spreadsheetId: string,
  tabName: string,
  rows: LeadRow[]
): Promise<number> => {
  if (!rows.length) return 0;

  const range = encodeURIComponent(`${tabName}!A:T`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    spreadsheetId
  )}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ values: rows.map(rowToSheetArray) }),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Google Sheets append failed (${response.status}): ${details}`);
  }

  return rows.length;
};

export const runLeadAgentPhase1 = async (options: LeadAgentOptions): Promise<LeadAgentRunResult> => {
  const minReviews = Math.max(0, Number(options.minReviews ?? 10));
  const maxPagesPerQuery = Math.max(1, Number(options.maxPagesPerQuery ?? 1));
  const maxPlacesToEnrich = Math.max(1, Number(options.maxPlacesToEnrich ?? 120));
  const dryRun = Boolean(options.dryRun);

  const discovered = await collectCandidates(options.placesApiKey, maxPagesPerQuery);
  const prioritizedDiscovered = [...discovered].sort((a, b) => {
    const aReviews = Number(a.reviewsCount ?? 0);
    const bReviews = Number(b.reviewsCount ?? 0);
    return bReviews - aReviews;
  });
  const limited = prioritizedDiscovered.slice(0, maxPlacesToEnrich);

  const nowIso = new Date().toISOString();
  const rows: LeadRow[] = [];
  let filteredOut = 0;

  for (const candidate of limited) {
    if (candidate.reviewsCount != null && candidate.reviewsCount < minReviews) {
      filteredOut += 1;
      continue;
    }

    if (isExcluded(`${candidate.name} ${candidate.categoryRaw}`)) {
      filteredOut += 1;
      continue;
    }

    const details = await detailsSearchPlace(options.placesApiKey, candidate.placeId);
    if (!details) {
      filteredOut += 1;
      continue;
    }

    const row = toLeadRow(candidate, details, nowIso);
    if (!row) {
      filteredOut += 1;
      continue;
    }

    const reviewsCount = Number(row.reviews_count || 0);
    if (reviewsCount < minReviews) {
      filteredOut += 1;
      continue;
    }

    if (isExcluded(`${row.name} ${row.category_raw}`)) {
      filteredOut += 1;
      continue;
    }

    rows.push(row);
  }

  rows.sort((a, b) => {
    if (a.segment !== b.segment) {
      return a.segment === "HIGH_PRIORITY_WEBSITE" ? -1 : 1;
    }
    const aReviews = Number(a.reviews_count || 0);
    const bReviews = Number(b.reviews_count || 0);
    return bReviews - aReviews;
  });

  let duplicateSkipped = 0;
  let appendedCount = 0;

  if (!dryRun) {
    const accessToken = await getGoogleAccessToken(
      options.googleServiceAccountEmail,
      options.googleServiceAccountPrivateKey
    );
    const existingPlaceIds = await getExistingPlaceIds(accessToken, options.sheetsSpreadsheetId, options.sheetsTabName);
    const uniqueRows: LeadRow[] = [];
    const seenInRun = new Set<string>();

    for (const row of rows) {
      if (existingPlaceIds.has(row.place_id) || seenInRun.has(row.place_id)) {
        duplicateSkipped += 1;
        continue;
      }
      seenInRun.add(row.place_id);
      uniqueRows.push(row);
    }

    appendedCount = await appendRowsToSheet(accessToken, options.sheetsSpreadsheetId, options.sheetsTabName, uniqueRows);
  }

  return {
    scanned: discovered.length,
    enriched: limited.length,
    filtered_out: filteredOut,
    ready_count: rows.length,
    duplicate_skipped: duplicateSkipped,
    appended_count: appendedCount,
    dry_run: dryRun,
    columns: SHEET_COLUMNS,
    sample: rows.slice(0, 5).map((row) => ({
      city: row.city,
      place_id: row.place_id,
      name: row.name,
      segment: row.segment,
      website: row.website,
    })),
  };
};
