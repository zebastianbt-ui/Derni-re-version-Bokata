import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { PRIMARY_RESTAURANT_MISMATCH_CODE, resolveOwnerPrimaryRestaurant } from "./_ownerPrimary";

const getEnv = (key: string) => process.env[key] ?? "";

type AiSettingsPayload = {
  restaurantId?: string;
  knowledge?: string | null;
  assistant_name?: string | null;
  web_search_enabled?: boolean | null;
  site_url?: string | null;
  google_maps_url?: string | null;
  facebook_url?: string | null;
  instagram_url?: string | null;
  forceOverwrite?: boolean;
};

const textLength = (value: unknown) => (typeof value === "string" ? value.trim().length : 0);

const isSuspiciousAiOverwrite = (existingKnowledge: unknown, incomingKnowledge: unknown) => {
  const existingLen = textLength(existingKnowledge);
  const incomingLen = textLength(incomingKnowledge);
  return (
    existingLen >= 300 &&
    incomingLen + 120 < existingLen &&
    incomingLen < Math.floor(existingLen * 0.9)
  );
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  const supabaseUrl = getEnv("SUPABASE_URL") || getEnv("VITE_SUPABASE_URL");
  const anonKey = getEnv("SUPABASE_ANON_KEY") || getEnv("VITE_SUPABASE_ANON_KEY");
  const serviceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !anonKey || !serviceKey) {
    res.status(500).json({ error: "Missing Supabase env vars" });
    return;
  }

  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) {
    res.status(401).json({ error: "Missing auth token" });
    return;
  }

  const authClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
  const { data: userData, error: userError } = await authClient.auth.getUser(token);
  if (userError || !userData?.user) {
    res.status(401).json({ error: "Invalid auth token" });
    return;
  }

  const {
    restaurantId,
    knowledge,
    assistant_name,
    web_search_enabled,
    site_url,
    google_maps_url,
    facebook_url,
    instagram_url,
    forceOverwrite,
  } = (req.body ?? {}) as AiSettingsPayload;

  if (!restaurantId) {
    res.status(400).json({ error: "Missing restaurantId" });
    return;
  }

  const serviceClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const userId = userData.user.id;

  const ownerPrimary = await resolveOwnerPrimaryRestaurant(serviceClient, userId);
  if (ownerPrimary.error) {
    res.status(500).json({ error: ownerPrimary.error });
    return;
  }

  if (
    ownerPrimary.isOwner &&
    !ownerPrimary.missingTable &&
    ownerPrimary.restaurantId &&
    ownerPrimary.restaurantId !== restaurantId
  ) {
    res.status(409).json({
      error: "Write blocked: this account can only update its primary restaurant settings.",
      code: PRIMARY_RESTAURANT_MISMATCH_CODE,
      expectedRestaurantId: ownerPrimary.restaurantId,
    });
    return;
  }

  const { data: memberships, error: membershipError } = await serviceClient
    .from("memberships")
    .select("restaurant_id")
    .eq("user_id", userId)
    .eq("restaurant_id", restaurantId)
    .limit(1);

  if (membershipError) {
    res.status(500).json({ error: membershipError.message });
    return;
  }

  if (!memberships?.length) {
    const { data: ownedRestaurant, error: restaurantError } = await serviceClient
      .from("restaurants")
      .select("id, owner_id")
      .eq("id", restaurantId)
      .maybeSingle();

    if (restaurantError) {
      res.status(500).json({ error: restaurantError.message });
      return;
    }

    if (ownedRestaurant?.owner_id !== userId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const { error: insertMembershipError } = await serviceClient
      .from("memberships")
      .insert({ restaurant_id: restaurantId, user_id: userId, role: "owner" });
    if (insertMembershipError && insertMembershipError.code !== "23505") {
      res.status(500).json({ error: insertMembershipError.message });
      return;
    }
  }

  const { data: existingSettings, error: existingSettingsError } = await serviceClient
    .from("ai_settings")
    .select("knowledge")
    .eq("restaurant_id", restaurantId)
    .maybeSingle();

  if (existingSettingsError) {
    res.status(500).json({ error: existingSettingsError.message });
    return;
  }

  if (!forceOverwrite && isSuspiciousAiOverwrite(existingSettings?.knowledge, knowledge)) {
    res.status(409).json({
      error:
        "Blocked suspicious AI knowledge overwrite. Reload the dashboard first, then retry only if this large change is intentional.",
      code: "SUSPICIOUS_OVERWRITE_BLOCKED",
    });
    return;
  }

  const { error } = await serviceClient.from("ai_settings").upsert(
    {
      restaurant_id: restaurantId,
      knowledge: knowledge ?? null,
      assistant_name: assistant_name ?? null,
      web_search_enabled: web_search_enabled ?? null,
      site_url: site_url ?? null,
      google_maps_url: google_maps_url ?? null,
      facebook_url: facebook_url ?? null,
      instagram_url: instagram_url ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "restaurant_id" }
  );

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.status(200).json({ ok: true });
}
