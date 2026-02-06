import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

type BookingSettings = {
  seating?: { maxBookingDurationMin?: number };
  notify_email?: string | null;
  notify_enabled?: boolean | null;
  require_manual_confirmation?: boolean | null;
};

const getEnv = (key: string) => process.env[key] ?? "";
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 20;
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

const getClientIp = (req: VercelRequest) => {
  const xfwd = req.headers["x-forwarded-for"];
  const ip = Array.isArray(xfwd) ? xfwd[0] : xfwd;
  return (ip || req.socket.remoteAddress || "unknown").split(",")[0].trim();
};

const rateLimit = (key: string) => {
  const now = Date.now();
  const entry = rateLimitStore.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { ok: true, remaining: RATE_LIMIT_MAX - 1, resetAt: now + RATE_LIMIT_WINDOW_MS };
  }
  if (entry.count >= RATE_LIMIT_MAX) {
    return { ok: false, remaining: 0, resetAt: entry.resetAt };
  }
  entry.count += 1;
  return { ok: true, remaining: RATE_LIMIT_MAX - entry.count, resetAt: entry.resetAt };
};

const pad2 = (n: number) => String(n).padStart(2, "0");
const timeToMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return NaN;
  return h * 60 + m;
};
const minToTime = (m: number) => `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
const overlap = (aS: number, aE: number, bS: number, bE: number) => aS < bE && bS < aE;
const toDayNameSv = (iso: string) => {
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return null;
  const names = ["söndag", "måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag"];
  return names[d.getUTCDay()];
};
const isIsoInRange = (iso: string, from: string, to: string) => iso >= from && iso <= to;
const periodSpanDays = (from: string, to: string) => {
  const a = new Date(from + "T00:00:00Z");
  const b = new Date(to + "T00:00:00Z");
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor((b.getTime() - a.getTime()) / 86400000));
};
const pickPeriodForDate = (periods: any[], iso: string) => {
  const matches = periods.filter((p) => isIsoInRange(iso, p.from, p.to));
  if (!matches.length) return null;
  return matches.sort((a, b) => periodSpanDays(a.from, a.to) - periodSpanDays(b.from, b.to))[0];
};
const normalizeTime = (t: string) => (t?.length >= 5 ? t.slice(0, 5) : t);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  const limiter = rateLimit(`bookings:${getClientIp(req)}`);
  if (!limiter.ok) {
    res.status(429).json({ error: "För många försök. Försök igen om en minut." });
    return;
  }

  const supabaseUrl = getEnv("SUPABASE_URL") || getEnv("VITE_SUPABASE_URL");
  const serviceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  const resendKey = getEnv("RESEND_API_KEY");
  const resendFrom = getEnv("RESEND_FROM") || "Bokäta <no-reply@bokata.se>";

  if (!supabaseUrl || !serviceKey) {
    res.status(500).json({ error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" });
    return;
  }

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const {
    restaurantId,
    date,
    time,
    guests,
    name,
    email,
    phone,
    notes,
  } = (req.body ?? {}) as {
    restaurantId?: string;
    date?: string;
    time?: string;
    guests?: number;
    name?: string;
    email?: string;
    phone?: string | null;
    notes?: string | null;
  };

  if (!restaurantId || !date || !time || !guests || !name || !email) {
    res.status(400).json({ error: "Missing booking fields" });
    return;
  }

  const { data: settings } = await supabase
    .from("booking_public_settings")
    .select("seating,hours,notify_email,notify_enabled,require_manual_confirmation")
    .eq("public_id", restaurantId)
    .maybeSingle();

  const s = (settings ?? {}) as BookingSettings & { hours?: any };
  const requireManual = !!s.require_manual_confirmation;
  const notifyEnabled = !!s.notify_enabled;
  const notifyEmail = s.notify_email || null;
  const rawDuration = s.seating?.maxBookingDurationMin ?? 90;
  const durationMin = rawDuration && rawDuration > 0 ? rawDuration : 90;
  const maxGuests = s.seating?.maxGuests ?? 60;
  const maxTables = s.seating?.maxTables ?? 20;
  const maxGuestsPerReservation = s.seating?.maxGuestsPerReservation ?? 22;

  if (guests > maxGuestsPerReservation) {
    res.status(400).json({ error: `För många gäster per bokning (max ${maxGuestsPerReservation}).` });
    return;
  }

  const hours = s.hours ?? null;
  if (hours) {
    const special = Array.isArray(hours.special) ? hours.special : [];
    const periods = Array.isArray(hours.periods) ? hours.periods : [];
    const normal = hours.normal ?? null;
    const dayName = toDayNameSv(date);
    if (!dayName) {
      res.status(400).json({ error: "Ogiltigt datum." });
      return;
    }
    const specialDay = special.find((d: any) => d.date === date);
    if (specialDay?.closed) {
      res.status(400).json({ error: "Restaurangen är stängd den dagen." });
      return;
    }
    let dayHours: { open: string; close: string } | null = null;
    if (specialDay && !specialDay.closed) {
      dayHours = { open: specialDay.open, close: specialDay.close };
    } else {
      const period = periods.length ? pickPeriodForDate(periods, date) : null;
      const d = (period?.days ?? normal)?.[dayName];
      if (!d || d.closed) {
        res.status(400).json({ error: "Restaurangen är stängd den dagen." });
        return;
      }
      dayHours = { open: d.open, close: d.close };
    }
    const t = timeToMin(time);
    const openMin = timeToMin(dayHours.open);
    const closeMin = timeToMin(dayHours.close);
    const lastBookingBufferMin = 60;
    const latestStart = Math.max(openMin, closeMin - lastBookingBufferMin);
    if (!Number.isFinite(t) || t < openMin || t > latestStart) {
      res.status(400).json({
        error: `Ogiltig tid. Vi har öppet ${dayHours.open}–${dayHours.close}. Sista bokningsbara tiden är ${minToTime(latestStart)}.`,
      });
      return;
    }
  }

  const { data: sameDayBookings } = await supabase
    .from("bookings")
    .select("time,guests,duration_min,status,table_id")
    .eq("restaurant_id", restaurantId)
    .eq("date", date)
    .neq("status", "cancelled");

  const startMin = timeToMin(normalizeTime(time));
  const endMin = startMin + durationMin;
  const overlapGuests =
    (sameDayBookings ?? []).reduce((sum, b: any) => {
      const bs = timeToMin(normalizeTime(b.time));
      const bd = b.duration_min ?? durationMin;
      const be = bs + bd;
      if (!Number.isFinite(bs)) return sum;
      if (!overlap(startMin, endMin, bs, be)) return sum;
      return sum + (b.guests ?? 0);
    }, 0) + guests;

  if (overlapGuests > maxGuests) {
    res.status(400).json({ error: "Tyvärr är det fullt vid den tiden." });
    return;
  }

  let assignedTableId: number | null = null;
  const { data: floorplanRow } = await supabase
    .from("floorplans")
    .select("layout")
    .eq("restaurant_id", restaurantId)
    .maybeSingle();

  const planTables = (floorplanRow as any)?.layout?.tables as Array<{ seats?: number }> | undefined;
  const tables =
    Array.isArray(planTables) && planTables.length
      ? planTables.map((t, i) => ({ id: i + 1, seats: Number(t.seats) || 0 })).filter((t) => t.seats > 0)
      : [];

  if (tables.length) {
    const existing = (sameDayBookings ?? []).map((b: any) => ({
      time: normalizeTime(b.time),
      guests: Number(b.guests) || 0,
      durationMin: b.duration_min ?? durationMin,
      tableId: b.table_id ?? null,
    }));

    const assigned: Array<{ tableId: number; time: string; guests: number; durationMin: number }> = [];

    for (const b of existing) {
      if (b.tableId) {
        assigned.push({ tableId: b.tableId, time: b.time, guests: b.guests, durationMin: b.durationMin });
      }
    }

    const needsAssign = existing
      .filter((b) => !b.tableId)
      .sort((a, b) => b.guests - a.guests || timeToMin(a.time) - timeToMin(b.time));

    let overbooked = false;
    const canUseTable = (tableId: number, t: string, dur: number) => {
      const s = timeToMin(t);
      const e = s + dur;
      return !assigned.some((x) => {
        if (x.tableId !== tableId) return false;
        const xs = timeToMin(x.time);
        const xe = xs + x.durationMin;
        return overlap(s, e, xs, xe);
      });
    };

    for (const b of needsAssign) {
      const eligible = tables.filter((t) => t.seats >= b.guests).sort((a, b) => a.seats - b.seats);
      const chosen = eligible.find((t) => canUseTable(t.id, b.time, b.durationMin));
      if (chosen) {
        assigned.push({ tableId: chosen.id, time: b.time, guests: b.guests, durationMin: b.durationMin });
      } else {
        overbooked = true;
      }
    }

    if (overbooked) {
      res.status(400).json({ error: "Tyvärr finns det inga lediga bord vid den tiden." });
      return;
    }

    const eligible = tables.filter((t) => t.seats >= guests).sort((a, b) => a.seats - b.seats);
    const chosen = eligible.find((t) => canUseTable(t.id, normalizeTime(time), durationMin));
    if (!chosen) {
      res.status(400).json({ error: "Tyvärr finns det inga lediga bord vid den tiden." });
      return;
    }
    assignedTableId = chosen.id;
  } else {
    const overlapTables =
      (sameDayBookings ?? []).reduce((sum, b: any) => {
        const bs = timeToMin(normalizeTime(b.time));
        const bd = b.duration_min ?? durationMin;
        const be = bs + bd;
        if (!Number.isFinite(bs)) return sum;
        if (!overlap(startMin, endMin, bs, be)) return sum;
        return sum + 1;
      }, 0) + 1;

    if (overlapTables > maxTables) {
      res.status(400).json({ error: "Tyvärr finns det inga lediga bord vid den tiden." });
      return;
    }
  }

  const confirmToken = requireManual ? crypto.randomUUID() : null;
  const status = requireManual ? "pending" : "confirmed";

  const { data: inserted, error } = await supabase
    .from("bookings")
    .insert({
      restaurant_id: restaurantId,
      date,
      time,
      guests,
      name,
      notes: notes || null,
      status,
      source: "web",
      duration_min: durationMin,
      table_id: assignedTableId,
      client_email: email,
      client_phone: phone || null,
      confirm_token: confirmToken,
    })
    .select("id")
    .single();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  const origin = `https://${req.headers.host}`;
  const summary = `${date} kl ${time} • ${guests} gäster`;

  const sendEmail = async (to: string, subject: string, html: string) => {
    if (!resendKey) return { ok: false, status: 0, text: "Missing RESEND_API_KEY" };
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resendKey}`,
      },
      body: JSON.stringify({ from: resendFrom, to, subject, html }),
    });
    const text = await resp.text();
    if (!resp.ok) {
      console.error("Resend error", resp.status, text || resp.statusText, { to, from: resendFrom });
    }
    return { ok: resp.ok, status: resp.status, text };
  };

  if (notifyEnabled && notifyEmail) {
    const actions = requireManual
      ? `
        <p><a href="${origin}/api/bookings-confirm?token=${confirmToken}&action=confirm">✅ Bekräfta</a></p>
        <p><a href="${origin}/api/bookings-confirm?token=${confirmToken}&action=decline">❌ Avböj</a></p>
      `
      : "";
    await sendEmail(
      notifyEmail,
      requireManual ? "Ny bokning (väntar på bekräftelse)" : "Ny bokning",
      `
        <h2>Ny bokning</h2>
        <p><strong>${name}</strong></p>
        <p>${summary}</p>
        <p>Email: ${email}${phone ? `<br/>Telefon: ${phone}` : ""}</p>
        ${notes ? `<p>Önskemål: ${notes}</p>` : ""}
        ${actions}
      `
    );
  }

  if (!requireManual && resendKey) {
    await sendEmail(
      email,
      "Din bokning är bekräftad",
      `
        <h2>Bokning bekräftad</h2>
        <p>Hej ${name}!</p>
        <p>Din bokning är bekräftad: ${summary}.</p>
        <p>Välkommen!</p>
      `
    );
  }

  res.status(200).json({ status, id: inserted?.id });
}
