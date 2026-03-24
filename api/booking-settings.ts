import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const getEnv = (key: string) => process.env[key] ?? "";

type BookingSettingsPayload = {
  restaurantId?: string;
  hours?: unknown;
  seating?: unknown;
  notify_email?: string | null;
  notify_enabled?: boolean | null;
  require_manual_confirmation?: boolean | null;
  knowledge_public?: string | null;
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
    hours,
    seating,
    notify_email,
    notify_enabled,
    require_manual_confirmation,
    knowledge_public,
  } = (req.body ?? {}) as BookingSettingsPayload;

  if (!restaurantId) {
    res.status(400).json({ error: "Missing restaurantId" });
    return;
  }

  const serviceClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const userId = userData.user.id;
  const { data: memberships, error: membershipError } = await serviceClient
    .from("memberships")
    .select("restaurant_id, role")
    .eq("user_id", userId)
    .eq("restaurant_id", restaurantId)
    .limit(1);

  const membership = memberships?.[0] ?? null;

  if (membershipError) {
    res.status(500).json({ error: membershipError.message });
    return;
  }

  if (!membership) {
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

  const { error } = await serviceClient.from("booking_public_settings").upsert(
    {
      public_id: restaurantId,
      hours,
      seating,
      notify_email: notify_email ?? null,
      notify_enabled: notify_enabled ?? null,
      require_manual_confirmation: require_manual_confirmation ?? null,
      knowledge_public: knowledge_public ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "public_id" }
  );

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.status(200).json({ ok: true });
}
