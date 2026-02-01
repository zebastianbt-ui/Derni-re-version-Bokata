import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  const { message, knowledge, context } = (req.body ?? {}) as {
    message?: string;
    knowledge?: string;
    context?: {
      baseDate?: string;
      seating?: {
        maxGuests?: number;
        maxGuestsPerReservation?: number;
        groupThreshold?: number;
        maxBookingDurationMin?: number;
      };
      hours?: {
        normal?: Record<string, { closed: boolean; open: string; close: string }>;
        special?: { date: string; closed: boolean; open: string; close: string }[];
      };
      tables?: number[];
      bookings?: { date: string; time: string; guests: number; durationMin?: number; tableId?: number | null }[];
    };
  };

  if (!message || typeof message !== "string") {
    res.status(400).json({ error: "Missing message" });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    return;
  }

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
- Tolka olika formuleringar som betyder samma sak.
- Om något är oklart, ställ en kort följdfråga istället för att vägra.

Tolkningsregel:
- Förstå olika sätt att fråga samma sak (ex: "öppet måndag?" = "Har ni öppet på måndag?").

KUNSKAPSBAS:
${knowledge ?? ""}
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
  const timeToMin = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };
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
  const isRestaurantTopic =
    /(boka|bokning|reservation|reservera|bord|table|öppet|öppettider|tider|adress|hitta|kontakt|telefon|email|e-post|meny|allergi|gluten|laktos|nöt|betal|kort|kontant|swish|pris|vegetar|vegan|barn|barnstol|hund|djur|terrass|parkering|tillgäng|wheelchair)/i.test(
      msgLower
    );
  if (!isRestaurantTopic) {
    res.status(200).json({ reply: "Jag kan tyvärr bara svara på frågor om restaurangen." });
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
    for (const d of weekdaySv) {
      if (new RegExp(`\\b${d}\\b`, "i").test(txt)) {
        const baseDt = toUtcDate(base);
        if (!baseDt) return null;
        const cur = baseDt.getUTCDay();
        const target = weekdayIndex[d];
        const delta = (target - cur + 7) % 7;
        return addDays(base, delta);
      }
    }
    return null;
  };

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
    const special = context.hours?.special?.find((s) => s.date === date);
    const normal = dayName ? context.hours?.normal?.[dayName] : null;
    if ((special && special.closed) || (!special && normal?.closed)) {
      res.status(200).json({ reply: `Tyvärr, vi har stängt ${dayName ? `på ${dayName}ar` : "den dagen"}.` });
      return;
    }
    const open = special?.open ?? normal?.open;
    const close = special?.close ?? normal?.close;
    if (open && close) {
      const t = timeToMin(time);
      if (t < timeToMin(open) || t > timeToMin(close)) {
        res.status(200).json({ reply: `Vi har öppet ${open}–${close}. Vill du boka en annan tid?` });
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
        { role: "user", content: message },
      ],
    }),
  });

  const data = await r.json();
const reply =
  (data?.choices?.[0]?.message?.content ?? "").trim() ||
  "Jag kan tyvärr inte svara säkert på det just nu. Jag vidarebefordrar din fråga och vi återkommer så snart som möjligt.";

  res.status(200).json({ reply });
}
