import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { rateLimit } from "./_rateLimit";
import crypto from "crypto";

type BookingSettings = {
  seating?: {
    maxBookingDurationMin?: number;
    maxGuests?: number;
    maxTables?: number;
    maxGuestsPerReservation?: number;
  };
  notify_email?: string | null;
  notify_enabled?: boolean | null;
  require_manual_confirmation?: boolean | null;
  knowledge_public?: string | null;
};

const getEnv = (key: string) => process.env[key] ?? "";
const getSiteUrl = () => getEnv("SITE_URL") || "https://www.bokata.se";
const getBookingCancelSecret = (serviceKey: string) => getEnv("BOOKING_CANCEL_SECRET") || serviceKey;
const signBookingCancel = (secret: string, bookingId: string, email: string) =>
  crypto.createHmac("sha256", secret).update(`${bookingId}:${email.toLowerCase().trim()}`).digest("hex");
const buildBookingCancelUrl = (origin: string, secret: string, bookingId: string, email: string) => {
  const normalizedEmail = email.toLowerCase().trim();
  const sig = signBookingCancel(secret, bookingId, normalizedEmail);
  return `${origin}/api/bookings-cancel?bid=${encodeURIComponent(bookingId)}&email=${encodeURIComponent(normalizedEmail)}&sig=${encodeURIComponent(sig)}`;
};
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 20;
const BOOKING_MESSAGE_LABEL = "Bokningsmeddelande";
const BOOKING_CONFIRMATION_EMAIL_AUTO_LABEL = "Bekräftelsemail (automatisk)";
const BOOKING_CONFIRMATION_EMAIL_MANUAL_LABEL = "Bekräftelsemail (manuell)";
const KNOWLEDGE_MESSAGE_LABELS = [
  BOOKING_MESSAGE_LABEL,
  BOOKING_CONFIRMATION_EMAIL_AUTO_LABEL,
  BOOKING_CONFIRMATION_EMAIL_MANUAL_LABEL,
];

const getClientIp = (req: VercelRequest) => {
  const xfwd = req.headers["x-forwarded-for"];
  const ip = Array.isArray(xfwd) ? xfwd[0] : xfwd;
  return (ip || req.socket.remoteAddress || "unknown").split(",")[0].trim();
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");

const extractMultilineLabelValue = (knowledge: string | null | undefined, label: string) => {
  if (!knowledge) return "";
  const lines = String(knowledge).replace(/\r/g, "").split("\n").map((line) => line.trimEnd());
  const labelLower = `${label.toLowerCase()}:`;
  const startIdx = lines.findIndex((line) => line.trimStart().toLowerCase().startsWith(labelLower));
  if (startIdx === -1) return "";
  const first = lines[startIdx].split(":").slice(1).join(":").trim();
  const collected: string[] = [];
  if (first) collected.push(first);
  for (let i = startIdx + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) {
      if (collected.length) collected.push("");
      continue;
    }
    const lower = line.trimStart().toLowerCase();
    if (lower === "infos:" || lower.startsWith("fråga:") || lower.startsWith("svar:")) break;
    if (KNOWLEDGE_MESSAGE_LABELS.some((item) => lower.startsWith(`${item.toLowerCase()}:`))) break;
    collected.push(line.trim());
  }
  return collected.join("\n").trim();
};

const bookingMessageToHtml = (message: string) => {
  const trimmed = message.trim();
  if (!trimmed) return "";
  return trimmed
    .split(/\r?\n/)
    .map((line) => escapeHtml(line))
    .join("<br/>");
};

const stripRepeatedConfirmationIntro = (message: string) => {
  const lines = message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line, idx, arr) => !(idx === 0 && !line) && !(idx === arr.length - 1 && !line));
  const patterns = [
    /^tack för (din|er) bokning/i,
    /^här är (din|dina) bokningsdetaljer/i,
    /^\(?\d{4}-\d{2}-\d{2}\s+kl\s+\d{2}:\d{2}\s*•\s*\d+\s+gäster\)?$/i,
  ];
  while (lines.length && patterns.some((pattern) => pattern.test(lines[0]))) {
    lines.shift();
  }
  return lines.join("\n").trim();
};

const extractFirstName = (fullName: string | null | undefined) => {
  const normalized = (fullName ?? "").trim();
  if (!normalized) return "";
  return normalized.split(/\s+/)[0] ?? "";
};

const capitalizeWord = (value: string) => value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();

const resolveGreetingAndMessageBody = (message: string, firstName: string) => {
  const defaultGreeting = firstName ? `Hej ${firstName}!` : "Hej!";
  const lines = message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return { greeting: defaultGreeting, body: "" };

  const firstLine = lines[0];
  const greetingPrefixMatch = firstLine.match(/^(bonjour|hej|hello)\b/i);
  if (!greetingPrefixMatch) {
    return { greeting: defaultGreeting, body: lines.join("\n") };
  }

  const simpleGreetingMatch = firstLine.match(/^(bonjour|hej|hello)[!\.\s]*$/i);
  const greeting = simpleGreetingMatch
    ? `${capitalizeWord(simpleGreetingMatch[1])}${firstName ? ` ${firstName}` : ""}!`
    : firstLine;

  return { greeting, body: lines.slice(1).join("\n").trim() };
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

const BOOKING_TIME_ZONE = "Europe/Stockholm";
const MANUAL_FULLY_BOOKED_SLOTS: Record<string, string[]> = {
  "2026-04-03": ["13:00", "13:30", "14:00", "14:30"],
  "2026-04-05": ["13:00"],
};

const getNowInBookingTimeZone = () => {
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: BOOKING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(new Date());
  const lookup = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const year = lookup("year");
  const month = lookup("month");
  const day = lookup("day");
  const hour = lookup("hour");
  const minute = lookup("minute");
  return {
    date: `${year}-${month}-${day}`,
    time: `${hour}:${minute}`,
  };
};

const isPastBookingSlot = (dateIso: string, timeValue: string) => {
  const now = getNowInBookingTimeZone();
  if (dateIso < now.date) return true;
  if (dateIso > now.date) return false;
  return normalizeTime(timeValue) < now.time;
};

const isManuallyFullBookedSlot = (dateIso: string, timeValue: string) => {
  const slots = MANUAL_FULLY_BOOKED_SLOTS[dateIso] ?? [];
  return slots.includes(normalizeTime(timeValue));
};

type FloorplanTable = {
  id: number;
  seats: number;
  x: number;
  y: number;
  w: number;
  h: number;
  neighbors: number[];
};

type AssignedTableBlock = {
  tableIds: number[];
  startMin: number;
  endMin: number;
};

const parseTableNumber = (label?: string | null) => {
  if (!label) return null;
  const match = label.match(/\d+/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const defaultSizeForSeats = (seats: number) => {
  if (seats <= 2) return { w: 80, h: 60 };
  if (seats <= 4) return { w: 90, h: 60 };
  if (seats <= 6) return { w: 110, h: 70 };
  if (seats <= 8) return { w: 130, h: 80 };
  return { w: 150, h: 90 };
};

const asFiniteNumber = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const tableCenter = (table: Pick<FloorplanTable, "x" | "y" | "w" | "h">) => ({
  x: table.x + table.w / 2,
  y: table.y + table.h / 2,
});

const centerDistance = (a: Pick<FloorplanTable, "x" | "y" | "w" | "h">, b: Pick<FloorplanTable, "x" | "y" | "w" | "h">) => {
  const ac = tableCenter(a);
  const bc = tableCenter(b);
  return Math.hypot(ac.x - bc.x, ac.y - bc.y);
};

const areTablesAdjacent = (a: FloorplanTable, b: FloorplanTable) => {
  const horizontalGap = Math.min(Math.abs(a.x + a.w - b.x), Math.abs(b.x + b.w - a.x));
  const verticalGap = Math.min(Math.abs(a.y + a.h - b.y), Math.abs(b.y + b.h - a.y));
  const horizontalOverlap = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const verticalOverlap = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  const edgeGap = 42;
  const overlapTolerance = 14;
  const nearHorizontally = horizontalGap <= edgeGap && verticalOverlap >= -overlapTolerance;
  const nearVertically = verticalGap <= edgeGap && horizontalOverlap >= -overlapTolerance;
  const distanceLimit = Math.max(a.w, a.h, b.w, b.h) * 1.8;
  const nearCenter = centerDistance(a, b) <= distanceLimit;
  return nearHorizontally || nearVertically || nearCenter;
};

const buildPlanTables = (planTables: Array<{ seats?: number; x?: number; y?: number; w?: number; h?: number; label?: string }> | undefined) => {
  if (!Array.isArray(planTables) || !planTables.length) return [] as FloorplanTable[];

  const byId = new Map<number, FloorplanTable>();
  planTables.forEach((table, idx) => {
    const id = parseTableNumber(table.label) ?? idx + 1;
    if (byId.has(id)) return;
    const seats = Math.max(0, Number(table.seats) || 0);
    if (!seats) return;
    const defaults = defaultSizeForSeats(seats);
    byId.set(id, {
      id,
      seats,
      x: asFiniteNumber(table.x, idx * (defaults.w + 20)),
      y: asFiniteNumber(table.y, 0),
      w: Math.max(40, asFiniteNumber(table.w, defaults.w)),
      h: Math.max(40, asFiniteNumber(table.h, defaults.h)),
      neighbors: [],
    });
  });

  const tables = Array.from(byId.values()).sort((a, b) => a.id - b.id);
  if (tables.length <= 1) return tables;

  const links = new Map<number, Set<number>>();
  tables.forEach((table) => links.set(table.id, new Set<number>()));

  for (let i = 0; i < tables.length; i += 1) {
    for (let j = i + 1; j < tables.length; j += 1) {
      const a = tables[i];
      const b = tables[j];
      if (!areTablesAdjacent(a, b)) continue;
      links.get(a.id)?.add(b.id);
      links.get(b.id)?.add(a.id);
    }
  }

  tables.forEach((table) => {
    const neighbors = links.get(table.id);
    if (!neighbors || neighbors.size || tables.length <= 1) return;
    let nearest: FloorplanTable | null = null;
    let nearestDist = Number.POSITIVE_INFINITY;
    for (const other of tables) {
      if (other.id === table.id) continue;
      const d = centerDistance(table, other);
      if (d < nearestDist) {
        nearest = other;
        nearestDist = d;
      }
    }
    if (nearest) {
      neighbors.add(nearest.id);
      links.get(nearest.id)?.add(table.id);
    }
  });

  return tables.map((table) => ({
    ...table,
    neighbors: Array.from(links.get(table.id) ?? []).sort((a, b) => a - b),
  }));
};

const chooseBestTableGroup = (args: {
  tables: FloorplanTable[];
  guests: number;
  preferredTableId?: number | null;
  startMin: number;
  endMin: number;
  assigned: AssignedTableBlock[];
}) => {
  if (!args.tables.length) return null;

  const conflictingTableIds = new Set<number>();
  for (const block of args.assigned) {
    if (!overlap(args.startMin, args.endMin, block.startMin, block.endMin)) continue;
    block.tableIds.forEach((id) => conflictingTableIds.add(id));
  }

  const available = args.tables.filter((table) => !conflictingTableIds.has(table.id));
  if (!available.length) return null;

  const availableById = new Map<number, FloorplanTable>();
  available.forEach((table) => availableById.set(table.id, table));

  const sortedCaps = available.map((table) => table.seats).sort((a, b) => b - a);
  let maxCapacity = 0;
  let minNeeded = 0;
  for (const cap of sortedCaps) {
    maxCapacity += cap;
    minNeeded += 1;
    if (maxCapacity >= args.guests) break;
  }
  if (maxCapacity < args.guests) return null;

  const maxGroupSize = Math.min(8, available.length, Math.max(minNeeded + 1, 2));

  const tableSpread = (ids: number[]) => {
    const points = ids.map((id) => availableById.get(id)).filter(Boolean) as FloorplanTable[];
    if (points.length <= 1) return 0;
    const minX = Math.min(...points.map((table) => table.x));
    const maxX = Math.max(...points.map((table) => table.x + table.w));
    const minY = Math.min(...points.map((table) => table.y));
    const maxY = Math.max(...points.map((table) => table.y + table.h));
    return (maxX - minX) + (maxY - minY);
  };

  const candidateScore = (ids: number[]) => {
    const seats = ids.reduce((sum, id) => sum + (availableById.get(id)?.seats ?? 0), 0);
    const overflow = seats - args.guests;
    const missesPreferred =
      args.preferredTableId == null ? 0 : ids.includes(args.preferredTableId) ? 0 : 1;
    return {
      missesPreferred,
      overflow,
      size: ids.length,
      spread: tableSpread(ids),
    };
  };

  const isBetter = (a: number[], b: number[] | null) => {
    if (!b) return true;
    const sa = candidateScore(a);
    const sb = candidateScore(b);
    if (sa.missesPreferred !== sb.missesPreferred) return sa.missesPreferred < sb.missesPreferred;
    if (sa.overflow !== sb.overflow) return sa.overflow < sb.overflow;
    if (sa.size !== sb.size) return sa.size < sb.size;
    if (sa.spread !== sb.spread) return sa.spread < sb.spread;
    return a.join(",") < b.join(",");
  };

  let bestGroup: number[] | null = null;
  const seen = new Set<string>();
  const explored = new Set<string>();

  const evaluateCandidate = (ids: number[], seats: number) => {
    if (seats < args.guests) return;
    const sorted = [...ids].sort((a, b) => a - b);
    const key = sorted.join(",");
    if (seen.has(key)) return;
    seen.add(key);
    if (isBetter(sorted, bestGroup)) bestGroup = sorted;
  };

  const sortedStarts = [...available].sort((a, b) => {
    const aPref = args.preferredTableId != null && a.id === args.preferredTableId ? 0 : 1;
    const bPref = args.preferredTableId != null && b.id === args.preferredTableId ? 0 : 1;
    if (aPref !== bPref) return aPref - bPref;
    if (a.seats !== b.seats) return b.seats - a.seats;
    return a.id - b.id;
  });

  const dfs = (group: number[], seats: number, frontier: Set<number>) => {
    const groupKey = [...group].sort((a, b) => a - b).join(",");
    if (explored.has(groupKey)) return;
    explored.add(groupKey);

    evaluateCandidate(group, seats);
    if (group.length >= maxGroupSize) return;

    const nextCandidates = Array.from(frontier)
      .map((id) => availableById.get(id))
      .filter(Boolean)
      .sort((a, b) => {
        const aPref = args.preferredTableId != null && a.id === args.preferredTableId ? 0 : 1;
        const bPref = args.preferredTableId != null && b.id === args.preferredTableId ? 0 : 1;
        if (aPref !== bPref) return aPref - bPref;
        if (a.seats !== b.seats) return b.seats - a.seats;
        return a.id - b.id;
      }) as FloorplanTable[];

    for (const next of nextCandidates) {
      if (group.includes(next.id)) continue;
      const nextGroup = [...group, next.id];
      const nextFrontier = new Set<number>(frontier);
      nextFrontier.delete(next.id);
      for (const neighborId of next.neighbors) {
        if (!availableById.has(neighborId) || nextGroup.includes(neighborId)) continue;
        nextFrontier.add(neighborId);
      }
      dfs(nextGroup, seats + next.seats, nextFrontier);
    }
  };

  for (const start of sortedStarts) {
    const frontier = new Set<number>(start.neighbors.filter((id) => availableById.has(id)));
    dfs([start.id], start.seats, frontier);
  }

  return bestGroup;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  const ip = getClientIp(req);
  const limiter = await rateLimit(`bookings:${ip}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
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

  if (isPastBookingSlot(date, time)) {
    res.status(400).json({ error: "Det går inte att boka en passerad tid." });
    return;
  }

  if (isManuallyFullBookedSlot(date, time)) {
    res.status(400).json({ error: "Tyvärr är den tiden fullbokad." });
    return;
  }

  const normalizedEmail = email.trim().toLowerCase();

  const { data: settings } = await supabase
    .from("booking_public_settings")
    .select("seating,hours,notify_email,notify_enabled,require_manual_confirmation,knowledge_public")
    .eq("public_id", restaurantId)
    .maybeSingle();

  const s = (settings ?? {}) as BookingSettings & { hours?: any };
  const requireManual = !!s.require_manual_confirmation;
  const notifyEnabled = !!s.notify_enabled;
  const notifyEmail = s.notify_email || null;
  const bookingMessageRaw = extractMultilineLabelValue(
    s.knowledge_public,
    BOOKING_CONFIRMATION_EMAIL_AUTO_LABEL
  );
  const rawDuration = s.seating?.maxBookingDurationMin ?? 90;
  const durationMin = rawDuration && rawDuration > 0 ? rawDuration : 90;
  const maxGuests = s.seating?.maxGuests ?? 60;
  const maxTables = s.seating?.maxTables ?? 20;
  const maxGuestsPerReservation = s.seating?.maxGuestsPerReservation ?? 22;

  if (maxGuestsPerReservation > 0 && guests >= maxGuestsPerReservation) {
    const contactEmail = notifyEmail ? ` Kontakta oss på ${notifyEmail}.` : "";
    res
      .status(400)
      .json({ error: `För ${maxGuestsPerReservation} gäster eller fler behöver ni kontakta oss direkt.${contactEmail}` });
    return;
  }

  const { count: sameEmailCount } = await supabase
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("restaurant_id", restaurantId)
    .eq("date", date)
    .eq("client_email", normalizedEmail)
    .neq("status", "cancelled");
  if ((sameEmailCount ?? 0) >= 2) {
    res.status(400).json({ error: "Max 2 bokningar per dag för samma e‑postadress." });
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

  const planTables = (floorplanRow as any)?.layout?.tables as
    | Array<{ seats?: number; x?: number; y?: number; w?: number; h?: number; label?: string }>
    | undefined;
  const tables = buildPlanTables(planTables);

  if (tables.length) {
    const existing = (sameDayBookings ?? []).map((b: any) => ({
      time: normalizeTime(b.time),
      guests: Number(b.guests) || 0,
      durationMin: b.duration_min ?? durationMin,
      tableId: b.table_id ?? null,
    }));

    const tableMap = new Map<number, FloorplanTable>();
    tables.forEach((table) => tableMap.set(table.id, table));

    const assigned: AssignedTableBlock[] = [];
    const needsAssign: Array<{ time: string; guests: number; durationMin: number; tableId: number | null }> = [];

    for (const booking of existing) {
      const bs = timeToMin(booking.time);
      if (!Number.isFinite(bs)) {
        needsAssign.push(booking);
        continue;
      }
      const be = bs + booking.durationMin;
      if (booking.tableId != null) {
        const fixedTableId = booking.tableId;
        const fixedTable = tableMap.get(fixedTableId);
        const canStayFixed =
          !!fixedTable &&
          fixedTable.seats >= booking.guests &&
          !assigned.some((block) =>
            overlap(bs, be, block.startMin, block.endMin) && block.tableIds.includes(fixedTableId)
          );
        if (canStayFixed) {
          assigned.push({ tableIds: [fixedTableId], startMin: bs, endMin: be });
          continue;
        }
      }
      needsAssign.push(booking);
    }

    needsAssign.sort((a, b) => b.guests - a.guests || timeToMin(a.time) - timeToMin(b.time));

    for (const booking of needsAssign) {
      const bs = timeToMin(booking.time);
      if (!Number.isFinite(bs)) {
        res.status(400).json({ error: "Tyvärr finns det inga lediga bord vid den tiden." });
        return;
      }
      const be = bs + booking.durationMin;
      const group = chooseBestTableGroup({
        tables,
        guests: booking.guests,
        preferredTableId: booking.tableId,
        startMin: bs,
        endMin: be,
        assigned,
      });
      if (!group?.length) {
        res.status(400).json({ error: "Tyvärr finns det inga lediga bord vid den tiden." });
        return;
      }
      assigned.push({ tableIds: group, startMin: bs, endMin: be });
    }

    const requestedGroup = chooseBestTableGroup({
      tables,
      guests,
      startMin,
      endMin,
      assigned,
    });
    if (!requestedGroup?.length) {
      res.status(400).json({ error: "Tyvärr finns det inga lediga bord vid den tiden." });
      return;
    }
    assignedTableId = requestedGroup[0] ?? null;
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
  const confirmTtlHours = Number(getEnv("BOOKING_CONFIRM_TTL_HOURS") || 48);
  const confirmExpiresAt =
    requireManual && confirmTtlHours > 0 ? new Date(Date.now() + confirmTtlHours * 3600_000).toISOString() : null;
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
      client_email: normalizedEmail,
      client_phone: phone || null,
      confirm_token: confirmToken,
      confirm_expires_at: confirmExpiresAt,
    })
    .select("id")
    .single();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  const origin = getSiteUrl();
  const summary = `${date} kl ${time} • ${guests} gäster`;
  const bookingId = inserted?.id ? String(inserted.id) : "";
  const cancelUrl =
    bookingId && normalizedEmail
      ? buildBookingCancelUrl(origin, getBookingCancelSecret(serviceKey), bookingId, normalizedEmail)
      : null;

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
    const firstName = extractFirstName(name);
    const { greeting, body } = resolveGreetingAndMessageBody(bookingMessageRaw, firstName);
    const greetingHtml = escapeHtml(greeting);
    const bookingMessageHtml = bookingMessageToHtml(stripRepeatedConfirmationIntro(body));
    await sendEmail(
      email,
      "Din bokning är bekräftad!",
      `
        <p>${greetingHtml}</p>
        <p>Tack för er bokning!</p>
        ${bookingMessageHtml ? `<p>${bookingMessageHtml}</p>` : "<p>Vi ser fram emot att välkomna er!</p>"}
        <p>(${summary})</p>
        ${cancelUrl ? `<p>Kan du inte komma? <a href="${cancelUrl}">Avboka din reservation här</a>.</p>` : ""}
      `
    );
  }

  res.status(200).json({ status, id: inserted?.id });
}
