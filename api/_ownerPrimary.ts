import type { SupabaseClient } from "@supabase/supabase-js";

export const PRIMARY_RESTAURANT_MISMATCH_CODE = "PRIMARY_RESTAURANT_MISMATCH";

const MISSING_RELATION_CODE = "42P01";

type RestaurantLite = {
  id: string;
  name?: string | null;
};

const isMissingRelationError = (error: { code?: string | null } | null | undefined) => {
  return error?.code === MISSING_RELATION_CODE;
};

const chooseRestaurantByBookings = async (
  serviceClient: SupabaseClient,
  ownedRestaurants: RestaurantLite[]
): Promise<{ restaurantId: string; restaurantName: string | null } | { error: string }> => {
  if (!ownedRestaurants.length) {
    return { error: "No owned restaurants" };
  }

  if (ownedRestaurants.length === 1) {
    return {
      restaurantId: ownedRestaurants[0].id,
      restaurantName: ownedRestaurants[0].name ?? null,
    };
  }

  const ownedIds = ownedRestaurants.map((restaurant) => restaurant.id);
  const { data: bookingRows, error: bookingError } = await serviceClient
    .from("bookings")
    .select("restaurant_id,created_at")
    .in("restaurant_id", ownedIds);

  if (bookingError) {
    return { error: bookingError.message };
  }

  const stats = new Map<string, { count: number; latest: string | null }>();
  for (const ownedId of ownedIds) {
    stats.set(ownedId, { count: 0, latest: null });
  }

  for (const row of bookingRows ?? []) {
    const restaurantId = row.restaurant_id as string | null;
    if (!restaurantId || !stats.has(restaurantId)) continue;
    const current = stats.get(restaurantId) ?? { count: 0, latest: null };
    const nextCount = current.count + 1;
    const createdAt = typeof row.created_at === "string" ? row.created_at : null;
    const nextLatest = !current.latest || (createdAt && createdAt > current.latest) ? createdAt ?? current.latest : current.latest;
    stats.set(restaurantId, { count: nextCount, latest: nextLatest });
  }

  const sorted = ownedRestaurants.slice().sort((left, right) => {
    const leftStats = stats.get(left.id) ?? { count: 0, latest: null };
    const rightStats = stats.get(right.id) ?? { count: 0, latest: null };

    if (leftStats.count !== rightStats.count) {
      return rightStats.count - leftStats.count;
    }

    const leftLatest = leftStats.latest ?? "";
    const rightLatest = rightStats.latest ?? "";
    if (leftLatest !== rightLatest) {
      return rightLatest.localeCompare(leftLatest);
    }

    return left.id.localeCompare(right.id);
  });

  return {
    restaurantId: sorted[0].id,
    restaurantName: sorted[0].name ?? null,
  };
};

const readOwnerPrimary = async (serviceClient: SupabaseClient, ownerId: string) => {
  const { data, error } = await serviceClient
    .from("owner_primary_restaurants")
    .select("restaurant_id")
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (error) {
    if (isMissingRelationError(error)) {
      return { restaurantId: null as string | null, missingTable: true, error: null as string | null };
    }
    return { restaurantId: null as string | null, missingTable: false, error: error.message };
  }

  return {
    restaurantId: (data?.restaurant_id as string | null) ?? null,
    missingTable: false,
    error: null as string | null,
  };
};

const upsertOwnerPrimary = async (serviceClient: SupabaseClient, ownerId: string, restaurantId: string) => {
  const { error } = await serviceClient.from("owner_primary_restaurants").upsert(
    {
      owner_id: ownerId,
      restaurant_id: restaurantId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "owner_id" }
  );

  if (error && isMissingRelationError(error)) {
    return { missingTable: true, error: null as string | null };
  }

  return { missingTable: false, error: error?.message ?? null };
};

export const resolveOwnerPrimaryRestaurant = async (serviceClient: SupabaseClient, ownerId: string) => {
  const { data: ownedRows, error: ownedError } = await serviceClient
    .from("restaurants")
    .select("id,name")
    .eq("owner_id", ownerId);

  if (ownedError) {
    return {
      isOwner: false,
      restaurantId: null as string | null,
      restaurantName: null as string | null,
      error: ownedError.message,
      missingTable: false,
    };
  }

  const ownedRestaurants = ((ownedRows ?? []) as RestaurantLite[]).filter((restaurant) => !!restaurant.id);
  if (!ownedRestaurants.length) {
    return {
      isOwner: false,
      restaurantId: null as string | null,
      restaurantName: null as string | null,
      error: null as string | null,
      missingTable: false,
    };
  }

  const byId = new Map(ownedRestaurants.map((restaurant) => [restaurant.id, restaurant]));

  const mapping = await readOwnerPrimary(serviceClient, ownerId);
  if (mapping.error) {
    return {
      isOwner: true,
      restaurantId: null as string | null,
      restaurantName: null as string | null,
      error: mapping.error,
      missingTable: mapping.missingTable,
    };
  }

  if (mapping.restaurantId && byId.has(mapping.restaurantId)) {
    const restaurant = byId.get(mapping.restaurantId)!;
    return {
      isOwner: true,
      restaurantId: restaurant.id,
      restaurantName: restaurant.name ?? null,
      error: null as string | null,
      missingTable: mapping.missingTable,
    };
  }

  const chosen = await chooseRestaurantByBookings(serviceClient, ownedRestaurants);
  if ("error" in chosen) {
    return {
      isOwner: true,
      restaurantId: null as string | null,
      restaurantName: null as string | null,
      error: chosen.error,
      missingTable: mapping.missingTable,
    };
  }

  if (!mapping.missingTable) {
    const persist = await upsertOwnerPrimary(serviceClient, ownerId, chosen.restaurantId);
    if (persist.error) {
      return {
        isOwner: true,
        restaurantId: null as string | null,
        restaurantName: null as string | null,
        error: persist.error,
        missingTable: persist.missingTable,
      };
    }
  }

  return {
    isOwner: true,
    restaurantId: chosen.restaurantId,
    restaurantName: chosen.restaurantName,
    error: null as string | null,
    missingTable: mapping.missingTable,
  };
};
