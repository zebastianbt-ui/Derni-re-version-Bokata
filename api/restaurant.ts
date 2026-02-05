import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const getEnv = (key: string) => process.env[key] ?? "";

const getToken = (req: VercelRequest) => {
  const authHeader = req.headers.authorization || "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
};

const insertMembershipIfMissing = async (supabaseUrl: string, serviceKey: string, userId: string, restaurantId: string) => {
  const serviceClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { error } = await serviceClient.from("memberships").insert({ restaurant_id: restaurantId, user_id: userId, role: "owner" });
  if (error && error.code !== "23505") {
    throw error;
  }
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const supabaseUrl = getEnv("SUPABASE_URL") || getEnv("VITE_SUPABASE_URL");
  const anonKey = getEnv("SUPABASE_ANON_KEY") || getEnv("VITE_SUPABASE_ANON_KEY");
  const serviceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !anonKey || !serviceKey) {
    res.status(500).json({ error: "Missing Supabase env vars" });
    return;
  }

  const token = getToken(req);
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

  const userId = userData.user.id;
  const serviceClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  if (req.method === "GET") {
    const { data: ownerMembership, error: ownerErr } = await serviceClient
      .from("memberships")
      .select("restaurant_id, role")
      .eq("user_id", userId)
      .eq("role", "owner")
      .limit(1)
      .maybeSingle();
    if (ownerErr) {
      res.status(500).json({ error: ownerErr.message });
      return;
    }

    let membership = ownerMembership ?? null;
    if (!membership) {
      const { data: anyMembership, error: anyErr } = await serviceClient
        .from("memberships")
        .select("restaurant_id, role")
        .eq("user_id", userId)
        .limit(1)
        .maybeSingle();
      if (anyErr) {
        res.status(500).json({ error: anyErr.message });
        return;
      }
      membership = anyMembership ?? null;
    }

    let restaurantId = membership?.restaurant_id ?? null;
    let role = membership?.role ?? null;

    if (!restaurantId) {
      const { data: ownedRestaurant, error: ownedErr } = await serviceClient
        .from("restaurants")
        .select("id, owner_id")
        .eq("owner_id", userId)
        .limit(1)
        .maybeSingle();
      if (ownedErr) {
        res.status(500).json({ error: ownedErr.message });
        return;
      }
      if (ownedRestaurant?.id) {
        restaurantId = ownedRestaurant.id;
        role = "owner";
        try {
          await insertMembershipIfMissing(supabaseUrl, serviceKey, userId, restaurantId);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Failed to create membership";
          res.status(500).json({ error: msg });
          return;
        }
      }
    }

    if (!restaurantId) {
      res.status(200).json({ restaurantId: null, role: null, name: null });
      return;
    }

    const { data: rest, error: restErr } = await serviceClient
      .from("restaurants")
      .select("name")
      .eq("id", restaurantId)
      .maybeSingle();
    if (restErr) {
      res.status(500).json({ error: restErr.message });
      return;
    }

    res.status(200).json({ restaurantId, role, name: rest?.name ?? "" });
    return;
  }

  if (req.method === "POST") {
    const { name } = (req.body ?? {}) as { name?: string };
    const baseName = (name ?? "").trim() || "Bokata Restaurant";

    const { data: created, error: createErr } = await serviceClient
      .from("restaurants")
      .insert({ name: baseName, owner_id: userId })
      .select("id,name")
      .single();

    if (createErr || !created?.id) {
      res.status(500).json({ error: createErr?.message ?? "Failed to create restaurant" });
      return;
    }

    try {
      await insertMembershipIfMissing(supabaseUrl, serviceKey, userId, created.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create membership";
      res.status(500).json({ error: msg });
      return;
    }

    res.status(200).json({ restaurantId: created.id, role: "owner", name: created.name });
    return;
  }

  res.status(405).json({ error: "Method Not Allowed" });
}
