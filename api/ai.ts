import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  const RATE_LIMIT_WINDOW_MS = 60_000;
  const RATE_LIMIT_MAX = 30;
  const rateLimitStore = (globalThis as any).__bokataAiRateLimit ?? new Map<string, { count: number; resetAt: number }>();
  (globalThis as any).__bokataAiRateLimit = rateLimitStore;
  const getClientIp = () => {
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
    if (entry.count >= RATE_LIMIT_MAX) return { ok: false, remaining: 0, resetAt: entry.resetAt };
    entry.count += 1;
    return { ok: true, remaining: RATE_LIMIT_MAX - entry.count, resetAt: entry.resetAt };
  };
  const limiter = rateLimit(`ai:${getClientIp()}`);
  if (!limiter.ok) {
    res.status(429).json({ error: "För många AI-förfrågningar. Försök igen om en minut." });
    return;
  }

  const { message, knowledge, context, history, turnstileToken } = (req.body ?? {}) as {
    message?: string;
    knowledge?: string;
    history?: { role: "user" | "assistant"; content: string }[];
    turnstileToken?: string;
    context?: {
      baseDate?: string;
      nowTime?: string;
      seating?: {
        maxGuests?: number;
        maxGuestsPerReservation?: number;
        groupThreshold?: number;
        maxBookingDurationMin?: number;
      };
      hours?: {
        normal?: Record<string, { closed: boolean; open: string; close: string }>;
        special?: { date: string; closed: boolean; open: string; close: string }[];
        periods?: { id?: string; name?: string; from: string; to: string; days: Record<string, { closed: boolean; open: string; close: string }> }[];
      };
      tables?: number[];
      bookings?: { date: string; time: string; guests: number; durationMin?: number; tableId?: number | null }[];
    };
  };

  if (!message || typeof message !== "string") {
    res.status(400).json({ error: "Missing message" });
    return;
  }

  const verifyTurnstile = async (token: string, ip: string) => {
    const secret = process.env.TURNSTILE_SECRET_KEY;
    if (!secret) return { ok: false };
    const body = new URLSearchParams({ secret, response: token });
    if (ip) body.set("remoteip", ip);
    const resp = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const data = (await resp.json()) as { success?: boolean };
    return { ok: !!data?.success };
  };

  const authHeader = req.headers.authorization || "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  let authOk = false;
  if (bearer) {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
    if (supabaseUrl && anonKey) {
      const authClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
      const { data } = await authClient.auth.getUser(bearer);
      authOk = !!data?.user;
    }
  }

  if (!authOk) {
    if (!turnstileToken) {
      res.status(403).json({ error: "Turnstile verification required." });
      return;
    }
    const ip = (() => {
      const xfwd = req.headers["x-forwarded-for"];
      const val = Array.isArray(xfwd) ? xfwd[0] : xfwd;
      return (val || req.socket.remoteAddress || "unknown").split(",")[0].trim();
    })();
    const check = await verifyTurnstile(turnstileToken, ip);
    if (!check.ok) {
      res.status(403).json({ error: "Turnstile verification failed." });
      return;
    }
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    return;
  }

  const hoursSummary = (() => {
    const normal = context?.hours?.normal;
    const periods = context?.hours?.periods;
    const order = ["måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag", "söndag"];
    const base = context?.baseDate;
    const period =
      base && Array.isArray(periods)
        ? periods.find((p) => base >= p.from && base <= p.to) ?? periods[0]
        : Array.isArray(periods) && periods.length
        ? periods[0]
        : null;
    const days = period?.days ?? normal;
    if (!days) return "";
    const lines = order.map((d) => {
      const day = days[d];
      if (!day) return null;
      return day.closed ? `${d}: stängt` : `${d}: ${day.open}–${day.close}`;
    });
    const range = period ? ` (${period.from}–${period.to})` : "";
    return `${lines.filter(Boolean).join(", ")}${range}`;
  })();

  const dashboardFacts = [
    hoursSummary ? `Öppettider (från dashboard): ${hoursSummary}` : "",
    context?.seating?.maxBookingDurationMin ? `Bordsbokningstid: ${context.seating.maxBookingDurationMin} min` : "",
    context?.seating?.maxGuests ? `Max gäster i restaurangen: ${context.seating.maxGuests}` : "",
    context?.seating?.maxGuestsPerReservation ? `Max gäster per bokning: ${context.seating.maxGuestsPerReservation}` : "",
  ].filter(Boolean).join("\n");

  const systemPrompt = `
Du är en restaurangassistent för Bokäta.
Svara alltid på svenska.
Var kort, tydlig och vänlig.

Viktig policy:
- Du får ENDAST svara på frågor som handlar om restaurangen, bokningar, öppettider, meny, allergier, adress, kontakt, betalning, policyer, tillgänglighet eller liknande.
- Om frågan inte handlar om restaurangen: svara exakt
  "Jag kan tyvärr bara svara på frågor om restaurangen."

Kunskapsbas:
- Använd informationen i KUNSKAPSBAS som primär källa.
- Om KUNSKAPSBAS saknar svaret, använd FAKTA FRÅN DASHBOARD.
- Tolka olika formuleringar som betyder samma sak.
- Om något är oklart, ställ en kort följdfråga istället för att vägra.

Tolkningsregel:
- Förstå olika sätt att fråga samma sak (ex: "öppet måndag?" = "Har ni öppet på måndag?").

KUNSKAPSBAS:
${knowledge ?? ""}

FAKTA FRÅN DASHBOARD:
${dashboardFacts}
`.trim();

  const pad2 = (n: number) => String(n).padStart(2, "0");
  const toUtcDate = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    if (!y || !m || !d) return null;
    return new Date(Date.UTC(y, m - 1, d));
  };
  const fmtDate = (dt: Date) => `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
  const addDays = (iso: string, n: number) => {
    const dt = toUtcDate(iso);
    if (!dt) return null;
    dt.setUTCDate(dt.getUTCDate() + n);
    return fmtDate(dt);
  };
  const spanDays = (from: string, to: string) => {
    const a = toUtcDate(from);
    const b = toUtcDate(to);
    if (!a || !b) return Number.POSITIVE_INFINITY;
    return Math.max(0, Math.floor((b.getTime() - a.getTime()) / 86400000));
  };
  const timeToMin = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };
  const minToTime = (m: number) => `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
  const round30 = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    if (m < 15) return `${pad2(h)}:00`;
    if (m < 45) return `${pad2(h)}:30`;
    return `${pad2((h + 1) % 24)}:00`;
  };
  const overlap = (aS: number, aE: number, bS: number, bE: number) => aS < bE && bS < aE;
  const weekdaySv = ["söndag", "måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag"];
  const weekdayIndex: Record<string, number> = {
    söndag: 0,
    måndag: 1,
    tisdag: 2,
    onsdag: 3,
    torsdag: 4,
    fredag: 5,
    lördag: 6,
  };

  const msgLower = message.toLowerCase();
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();

  const knowledgeText = (knowledge ?? "").trim();
  const knowledgeLines = knowledgeText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const getField = (label: string) => {
    const line = knowledgeLines.find((l) => l.toLowerCase().startsWith(label.toLowerCase() + ":"));
    return line ? line.split(":").slice(1).join(":").trim() : "";
  };
  const getFieldAny = (labels: string[]) => {
    for (const label of labels) {
      const val = getField(label);
      if (val) return val;
    }
    return "";
  };
  const kbInfo = {
    name: getField("Namn"),
    address: getField("Adress"),
    phone: getField("Telefon"),
    email: getField("E-post"),
    website: getFieldAny(["Webbplats", "Hemsida", "Website", "Site"]),
    payment: getField("Betalning"),
    allergies: getField("Allergier"),
    kids: getField("Barn"),
    pets: getField("Djurpolicy"),
    parking: getFieldAny(["Parkering", "Parking"]),
    transport: getField("Kollektivtrafik"),
    instagram: getFieldAny(["Instagram", "Insta"]),
    facebook: getField("Facebook"),
    googleMaps: getFieldAny(["Google Maps", "Maps", "GoogleMaps"]),
  };
  const kbFaqs = (() => {
    const out: { q: string; a: string }[] = [];
    let q: string | null = null;
    for (const l of knowledgeLines) {
      if (l.toLowerCase().startsWith("fråga:")) {
        q = l.slice(6).trim();
        continue;
      }
      if (l.toLowerCase().startsWith("svar:") && q) {
        out.push({ q, a: l.slice(5).trim() });
        q = null;
      }
    }
    return out;
  })();
  const isRestaurantTopic =
    /(boka|bokning|reservation|reservera|bord|table|öppet|öppettider|tider|stängt|adress|address|hitta|var ligger|ligger|kontakt|telefon|email|e-post|meny|allergi|gluten|laktos|nöt|betal|kort|kontant|swish|pris|vegetar|vegan|barn|barnstol|hund|djur|terrass|parkering|parking|tillgäng|wheelchair)/i.test(
      msgLower
    );
  const lastAssistant = history?.slice().reverse().find((h) => h.role === "assistant")?.content || "";
  const isFollowUp =
    /^(varför|varfor|var|hur|vad|vilken|vilket|vilka|och|då|sa|så|ok|okej|tack)\b/i.test(msgLower) ||
    msgLower.length <= 12;
  const isWhyFollowUp = /^(varför|varfor)\b/i.test(msgLower);
  const closedRanges = (() => {
    const ranges: { start: string; end: string }[] = [];
    const closedDates =
      context?.hours?.special
        ?.filter((s) => s.closed && s.date)
        .map((s) => s.date)
        .sort() ?? [];
    if (closedDates.length) {
      let start = closedDates[0];
      let prev = closedDates[0];
      for (let i = 1; i < closedDates.length; i++) {
        const cur = closedDates[i];
        const nextExpected = addDays(prev, 1);
        if (nextExpected && cur === nextExpected) {
          prev = cur;
        } else {
          ranges.push({ start, end: prev });
          start = cur;
          prev = cur;
        }
      }
      ranges.push({ start, end: prev });
    }
    const periods = context?.hours?.periods ?? [];
    for (const p of periods) {
      const days = p?.days ? Object.values(p.days) : [];
      if (days.length && days.every((d) => d?.closed)) {
        ranges.push({ start: p.from, end: p.to });
      }
    }
    if (!ranges.length) return ranges;
    const sorted = ranges.slice().sort((a, b) => a.start.localeCompare(b.start));
    const merged: { start: string; end: string }[] = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
      const cur = sorted[i];
      const last = merged[merged.length - 1];
      const nextExpected = addDays(last.end, 1);
      if (cur.start <= last.end || (nextExpected && cur.start === nextExpected)) {
        if (cur.end > last.end) last.end = cur.end;
      } else {
        merged.push({ ...cur });
      }
    }
    return merged;
  })();
  const closedRangeForDate = (iso?: string | null) => {
    if (!iso) return null;
    return closedRanges.find((r) => iso >= r.start && iso <= r.end) ?? null;
  };

  if (isWhyFollowUp && closedRanges.length) {
    const rangesText = closedRanges
      .map((r) => (r.start === r.end ? r.start : `${r.start}–${r.end}`))
      .join(", ");
    res.status(200).json({ reply: `Vi har en stängd period: ${rangesText}.` });
    return;
  }
  if (!isRestaurantTopic && !isFollowUp) {
    res.status(200).json({ reply: "Jag kan tyvärr bara svara på frågor om restaurangen." });
    return;
  }
  if (!isRestaurantTopic && isFollowUp && !lastAssistant) {
    res.status(200).json({ reply: "Jag kan tyvärr bara svara på frågor om restaurangen." });
    return;
  }

  if (isWhyFollowUp && lastAssistant) {
    if (/stängt|stängd|stängda/i.test(lastAssistant)) {
      if (closedRanges.length) {
        const rangesText = closedRanges
          .map((r) => (r.start === r.end ? r.start : `${r.start}–${r.end}`))
          .join(", ");
        res.status(200).json({ reply: `Vi har en stängd period: ${rangesText}.` });
        return;
      }
      res.status(200).json({ reply: "Vi är stängda enligt våra öppettider den dagen." });
      return;
    }
  }

  const normMsg = normalize(message);
  for (const qa of kbFaqs) {
    const qn = normalize(qa.q);
    if (qn && (normMsg.includes(qn) || qn.includes(normMsg)) && qa.a) {
      res.status(200).json({ reply: qa.a });
      return;
    }
  }

  const addressMatch = /(adress|address|var ligger|hitta|vägbeskrivning)/i.test(msgLower);
  if (addressMatch && kbInfo.address) {
    res.status(200).json({ reply: `Vi finns på ${kbInfo.address}.` });
    return;
  }
  if (/(telefon|ring|tel)/i.test(msgLower) && kbInfo.phone) {
    res.status(200).json({ reply: `Du kan nå oss på ${kbInfo.phone}.` });
    return;
  }
  if (/(e-post|email|mail)/i.test(msgLower) && kbInfo.email) {
    res.status(200).json({ reply: `Du kan maila oss på ${kbInfo.email}.` });
    return;
  }
  if (/(meny|menu|à la carte|rätter|mat)/i.test(msgLower) && kbInfo.website) {
    res.status(200).json({ reply: `Menyn finns här: ${kbInfo.website}` });
    return;
  }
  if (/(instagram|insta)/i.test(msgLower) && kbInfo.instagram) {
    res.status(200).json({ reply: `Instagram: ${kbInfo.instagram}.` });
    return;
  }
  if (/facebook/i.test(msgLower) && kbInfo.facebook) {
    res.status(200).json({ reply: `Facebook: ${kbInfo.facebook}.` });
    return;
  }
  if (/(google maps|karta|maps)/i.test(msgLower) && kbInfo.googleMaps) {
    res.status(200).json({ reply: `Google Maps: ${kbInfo.googleMaps}.` });
    return;
  }
  if (/(betal|kort|kontant|swish)/i.test(msgLower) && kbInfo.payment) {
    res.status(200).json({ reply: `Vi tar ${kbInfo.payment}.` });
    return;
  }
  if (/(allerg|gluten|laktos|nöt)/i.test(msgLower) && kbInfo.allergies) {
    res.status(200).json({ reply: `Vi kan hjälpa till med: ${kbInfo.allergies}.` });
    return;
  }
  if (/(barn|barnstol|barnmeny|barnvagn)/i.test(msgLower) && kbInfo.kids) {
    res.status(200).json({ reply: `För barn gäller: ${kbInfo.kids}.` });
    return;
  }
  if (/(hund|djur|terrass)/i.test(msgLower) && kbInfo.pets) {
    res.status(200).json({ reply: `Djurpolicy: ${kbInfo.pets}.` });
    return;
  }
  if (/parkering/i.test(msgLower) && kbInfo.parking) {
    res.status(200).json({ reply: `Parkering: ${kbInfo.parking}.` });
    return;
  }
  if (/(kollektiv|buss|tåg|spårvagn|tunnelbana)/i.test(msgLower) && kbInfo.transport) {
    res.status(200).json({ reply: `Kollektivtrafik: ${kbInfo.transport}.` });
    return;
  }

  const parseTime = (txt: string) => {
    const m = txt.match(/\b(\d{1,2})(?:[:\.h](\d{2}))\b/);
    if (m) {
      const h = Number(m[1]);
      const mm = Number(m[2]);
      if (h >= 0 && h <= 23 && mm >= 0 && mm <= 59) return `${pad2(h)}:${pad2(mm)}`;
    }
    const hOnly = txt.match(/\bkl\s*(\d{1,2})\b/i) || txt.match(/\b(\d{1,2})\s*(?:tiden|tiden|tiden)\b/i);
    if (hOnly) {
      const h = Number(hOnly[1]);
      if (h >= 0 && h <= 23) return `${pad2(h)}:00`;
    }
    return null;
  };

  const parseDate = (txt: string, baseDate?: string) => {
    const base = baseDate ?? fmtDate(new Date());
    if (/i\s*dag|idag/.test(txt)) return base;
    if (/i\s*morgon|imorgon/.test(txt)) return addDays(base, 1);
    const iso = txt.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const dmy = txt.match(/\b(\d{1,2})[\/\.](\d{1,2})\b/);
    if (dmy) {
      const d = Number(dmy[1]);
      const m = Number(dmy[2]);
      const [y] = base.split("-").map(Number);
      if (d >= 1 && d <= 31 && m >= 1 && m <= 12) return `${y}-${pad2(m)}-${pad2(d)}`;
    }
    const months: Record<string, number> = {
      jan: 1,
      januari: 1,
      feb: 2,
      februari: 2,
      mar: 3,
      mars: 3,
      apr: 4,
      april: 4,
      maj: 5,
      jun: 6,
      juni: 6,
      jul: 7,
      juli: 7,
      aug: 8,
      augusti: 8,
      sep: 9,
      september: 9,
      okt: 10,
      oktober: 10,
      nov: 11,
      november: 11,
      dec: 12,
      december: 12,
    };
    const dm = txt.match(/\b(\d{1,2})\s+([a-zåäö]+)\b/);
    if (dm) {
      const d = Number(dm[1]);
      const m = months[dm[2]];
      const [y] = base.split("-").map(Number);
      if (d >= 1 && d <= 31 && m) return `${y}-${pad2(m)}-${pad2(d)}`;
    }
    const hasNext = /nästa/i.test(txt);
    for (const d of weekdaySv) {
      if (new RegExp(`\\b${d}\\b`, "i").test(txt)) {
        const baseDt = toUtcDate(base);
        if (!baseDt) return null;
        const cur = baseDt.getUTCDay();
        const target = weekdayIndex[d];
        let delta = (target - cur + 7) % 7;
        if (hasNext) delta = delta === 0 ? 7 : delta + 7;
        return addDays(base, delta);
      }
    }
    return null;
  };

  const getPeriodForDate = (iso?: string | null) => {
    if (!iso) return null;
    const periods = context?.hours?.periods;
    if (!Array.isArray(periods) || !periods.length) return null;
    const matches = periods.filter((p) => iso >= p.from && iso <= p.to);
    if (!matches.length) return periods[periods.length - 1];
    return matches.sort((a, b) => spanDays(a.from, a.to) - spanDays(b.from, b.to))[0];
  };

  const isClosedDate = (iso?: string | null) => {
    if (!iso) return false;
    const special = context?.hours?.special?.find((s) => s.date === iso);
    if (special) return special.closed;
    const dt = toUtcDate(iso);
    if (!dt) return false;
    const dayName = weekdaySv[dt.getUTCDay()];
    const period = getPeriodForDate(iso);
    const normal = context?.hours?.normal;
    const d = (period?.days ?? normal)?.[dayName];
    return d?.closed ?? false;
  };

  const getDayHours = (iso?: string | null) => {
    if (!iso) return null;
    const dt = toUtcDate(iso);
    if (!dt) return null;
    const dayName = weekdaySv[dt.getUTCDay()];
    const period = getPeriodForDate(iso);
    const normal = context?.hours?.normal;
    const d = (period?.days ?? normal)?.[dayName];
    if (!d) return null;
    return { dayName, ...d };
  };

  const isHoursQuestion = /(öppet|öppettider|öppettid|stängt|stängda)/i.test(msgLower);
  if (isHoursQuestion) {
    const base = context?.baseDate ?? fmtDate(new Date());
    if (/nästa vecka/i.test(msgLower)) {
      const baseDt = toUtcDate(base) ?? new Date();
      const cur = baseDt.getUTCDay();
      const deltaToNextMon = ((1 - cur + 7) % 7) || 7;
      const start = addDays(base, deltaToNextMon);
      const days: string[] = [];
      for (let i = 0; i < 7; i++) {
        const d = addDays(start ?? base, i);
        if (d) days.push(d);
      }
      const openDays: string[] = [];
      const closedDays: string[] = [];
      for (const d of days) {
        const hours = getDayHours(d);
        if (!hours || hours.closed || isClosedDate(d)) {
          closedDays.push(`${hours?.dayName ?? d}`);
        } else {
          openDays.push(`${hours.dayName} ${hours.open}–${hours.close}`);
        }
      }
      if (!openDays.length) {
        res.status(200).json({ reply: "Vi har stängt hela nästa vecka." });
        return;
      }
      res.status(200).json({
        reply: `Nästa vecka har vi öppet: ${openDays.join(", ")}.${closedDays.length ? ` Stängt: ${closedDays.join(", ")}.` : ""}`,
      });
      return;
    }

    const date = parseDate(msgLower, base);
    if (date) {
      const range = closedRangeForDate(date);
      if (range) {
        res.status(200).json({ reply: `Vi har en stängd period: ${range.start}–${range.end}.` });
        return;
      }
      const hours = getDayHours(date);
      if (!hours || hours.closed || isClosedDate(date)) {
        res.status(200).json({ reply: `Vi har stängt ${hours?.dayName ? `på ${hours.dayName}` : "den dagen"}.` });
        return;
      }
      if (/idag|nu|just nu/i.test(msgLower) && context?.nowTime) {
        const nowMin = timeToMin(context.nowTime);
        const openMin = timeToMin(hours.open);
        const closeMin = timeToMin(hours.close);
        if (nowMin < openMin) {
          res.status(200).json({ reply: `Vi öppnar kl ${hours.open} idag.` });
          return;
        }
        if (nowMin > closeMin) {
          res.status(200).json({ reply: `Vi har stängt för idag. Vi stängde kl ${hours.close}.` });
          return;
        }
      }
      res.status(200).json({ reply: `Vi har öppet ${hours.open}–${hours.close}.` });
      return;
    }
  }

  const parseGuests = (txt: string) => {
    const m = txt.match(/\b(\d{1,3})\s*(gäster|pers|personer|person|guests)\b/i);
    if (m) return Number(m[1]);
    const v = txt.match(/\bvi\s*är\s*(\d{1,3})\b/i);
    if (v) return Number(v[1]);
    const nums = (txt.match(/\b\d{1,3}\b/g) || []).map(Number);
    const filtered = nums.filter((n) => n > 0 && n <= 200);
    return filtered.length ? filtered[0] : null;
  };

  const isBookingIntent = (txt: string) =>
    /(boka|bokning|reservation|reservera|bord|table)/i.test(txt) ||
    /\b\d{1,2}[:\.h]\d{2}\b/.test(txt) ||
    /\b\d{1,3}\s*(gäster|guests|personer|pers)\b/i.test(txt);

  const findAvailableTable = (args: {
    date: string;
    time: string;
    guests: number;
    bookings: { date: string; time: string; durationMin?: number; tableId?: number | null }[];
    tables: number[];
    durationMin: number;
  }) => {
    const when = round30(args.time);
    const s = timeToMin(when);
    const e = s + args.durationMin;
    for (let i = 0; i < args.tables.length; i++) {
      const id = i + 1;
      const cap = args.tables[i];
      if (cap < args.guests) continue;
      const conflict = args.bookings.some((b) => {
        if (b.date !== args.date) return false;
        if (b.tableId !== id) return false;
        const bs = timeToMin(round30(b.time));
        const bd = b.durationMin ?? args.durationMin;
        const be = bs + bd;
        return overlap(s, e, bs, be);
      });
      if (!conflict) return id;
    }
    return null;
  };

  if (context && isBookingIntent(message)) {
    const baseDate = context.baseDate;
    const date = parseDate(msgLower, baseDate);
    const time = parseTime(msgLower);
    const guests = parseGuests(msgLower);

    if (!guests) {
      res.status(200).json({ reply: "Hur många gäster gäller det?" });
      return;
    }

    const maxPer = context.seating?.maxGuestsPerReservation ?? 12;
    const maxTotal = context.seating?.maxGuests ?? 60;
    const group = context.seating?.groupThreshold ?? maxPer;
    if (guests > maxTotal) {
      res.status(200).json({ reply: `Vi har tyvärr max ${maxTotal} gäster samtidigt. Vill du välja en mindre grupp?` });
      return;
    }
    if (guests > maxPer || guests >= group) {
      res.status(200).json({ reply: `För ${guests} gäster behöver vi manuell bekräftelse. Vi återkommer snarast.` });
      return;
    }

    if (!date) {
      res.status(200).json({ reply: "Vilket datum önskar du boka?" });
      return;
    }
    if (!time) {
      res.status(200).json({ reply: "Vilken tid önskar du?" });
      return;
    }

    const day = toUtcDate(date)?.getUTCDay();
    const dayName = day != null ? weekdaySv[day] : null;
    const range = closedRangeForDate(date);
    if (range) {
      res.status(200).json({ reply: `Vi har en stängd period: ${range.start}–${range.end}.` });
      return;
    }
    const hours = getDayHours(date);
    if (!hours || hours.closed || isClosedDate(date)) {
      res.status(200).json({ reply: `Tyvärr, vi har stängt ${dayName ? `på ${dayName}ar` : "den dagen"}.` });
      return;
    }
    const open = hours.open;
    const close = hours.close;
    if (open && close) {
      const t = timeToMin(time);
      const lastBookingBufferMin = 60;
      const latestStart = Math.max(timeToMin(open), timeToMin(close) - lastBookingBufferMin);
      if (t < timeToMin(open) || t > latestStart) {
        res.status(200).json({
          reply: `Vi har öppet ${open}–${close}. Sista bokningsbara tiden är ${minToTime(latestStart)}.`,
        });
        return;
      }
    }

    const tables = context.tables ?? [2, 2, 2, 4, 4, 4, 6, 6];
    const durationMin = context.seating?.maxBookingDurationMin ?? 90;
    const bookings = context.bookings ?? [];
    const tableId = findAvailableTable({ date, time, guests, bookings, tables, durationMin });
    if (!tableId) {
      res.status(200).json({ reply: "Tyvärr är det fullt den tiden. Vill du prova en annan tid?" });
      return;
    }

    res.status(200).json({ reply: `Ja, det finns plats. Vill du att jag bokar ${date} kl ${time} för ${guests} gäster?` });
    return;
  }

  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        { role: "system", content: systemPrompt },
        ...(history ?? []),
        { role: "user", content: message },
      ],
    }),
  });

  const data = await r.json();
  if (!r.ok) {
    const msg =
      data?.error?.message ||
      data?.error ||
      `OpenAI error (${r.status})`;
    res.status(500).json({ error: msg });
    return;
  }

  const reply =
    (data?.choices?.[0]?.message?.content ?? "").trim() ||
    "Jag kan tyvärr inte svara säkert på det just nu. Jag vidarebefordrar din fråga och vi återkommer så snart som möjligt.";

  res.status(200).json({ reply });
}
