import type { VercelRequest, VercelResponse } from "../lib/vercelTypes";
import { createClient } from "@supabase/supabase-js";
import { resolveOwnerPrimaryRestaurant } from "../lib/ownerPrimary";

const getEnv = (key: string) => process.env[key] ?? "";

const getToken = (req: VercelRequest) => {
  const authHeader = req.headers.authorization || "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
};

const OWNER_PRIMARY_TABLE_MISSING_CODE = "42P01";

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
    const ownerPrimary = await resolveOwnerPrimaryRestaurant(serviceClient, userId);
    if (ownerPrimary.error) {
      res.status(500).json({ error: ownerPrimary.error });
      return;
    }

    if (ownerPrimary.isOwner && ownerPrimary.restaurantId) {
      try {
        await insertMembershipIfMissing(supabaseUrl, serviceKey, userId, ownerPrimary.restaurantId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to create membership";
        res.status(500).json({ error: msg });
        return;
      }

      if (ownerPrimary.restaurantName != null) {
        res.status(200).json({
          restaurantId: ownerPrimary.restaurantId,
          role: "owner",
          name: ownerPrimary.restaurantName,
        });
        return;
      }
    }

    const { data: memberships, error: membershipsErr } = await serviceClient
      .from("memberships")
      .select("restaurant_id, role")
      .eq("user_id", userId);
    if (membershipsErr) {
      res.status(500).json({ error: membershipsErr.message });
      return;
    }

    const candidates = (memberships ?? [])
      .filter((membership) => !!membership.restaurant_id)
      .sort((left, right) => {
        const leftRank = left.role === "owner" ? 0 : 1;
        const rightRank = right.role === "owner" ? 0 : 1;
        if (leftRank !== rightRank) return leftRank - rightRank;
        return (left.restaurant_id ?? "").localeCompare(right.restaurant_id ?? "");
      });

    const membership = candidates[0] ?? null;

    const restaurantId = membership?.restaurant_id ?? ownerPrimary.restaurantId ?? null;
    const role = membership?.role ?? (ownerPrimary.restaurantId ? "owner" : null);

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

    const ownerPrimary = await resolveOwnerPrimaryRestaurant(serviceClient, userId);
    if (ownerPrimary.error) {
      res.status(500).json({ error: ownerPrimary.error });
      return;
    }

    if (ownerPrimary.isOwner && ownerPrimary.restaurantId) {
      try {
        await insertMembershipIfMissing(supabaseUrl, serviceKey, userId, ownerPrimary.restaurantId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to create membership";
        res.status(500).json({ error: msg });
        return;
      }

      let nameForResponse = ownerPrimary.restaurantName;
      if (!nameForResponse) {
        const { data: existingRestaurant, error: existingError } = await serviceClient
          .from("restaurants")
          .select("name")
          .eq("id", ownerPrimary.restaurantId)
          .maybeSingle();
        if (existingError) {
          res.status(500).json({ error: existingError.message });
          return;
        }
        nameForResponse = existingRestaurant?.name ?? "";
      }

      res.status(200).json({ restaurantId: ownerPrimary.restaurantId, role: "owner", name: nameForResponse ?? "" });
      return;
    }

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

    const { error: primaryError } = await serviceClient.from("owner_primary_restaurants").upsert(
      {
        owner_id: userId,
        restaurant_id: created.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "owner_id" }
    );

    if (primaryError && primaryError.code !== OWNER_PRIMARY_TABLE_MISSING_CODE) {
      res.status(500).json({ error: primaryError.message });
      return;
    }

    res.status(200).json({ restaurantId: created.id, role: "owner", name: created.name });
    return;
  }

  res.status(405).json({ error: "Method Not Allowed" });
}
