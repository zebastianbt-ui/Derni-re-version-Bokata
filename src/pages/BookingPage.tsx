import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../supabaseClient";
import forkTransparent from "../assets/fork-transparent.png";

/**
 * Bokäta – Bokningssida (v2, rosa+lila)
 * Komplett bokningsflöde på svenska.
 *
 */

type Reservation = {
  id: string;
  restaurantSlug: string;
  date: string;
  time: string;
  guests: number;
  name: string;
  email: string;
  phone?: string;
  notes?: string;
  status: "pending" | "confirmed" | "cancelled";
  createdAt: string;
};

type DayName = "måndag" | "tisdag" | "onsdag" | "torsdag" | "fredag" | "lördag" | "söndag";

type HoursPeriod = {
  id?: string;
  name?: string;
  from: string;
  to: string;
  days: Record<DayName, { closed: boolean; open: string; close: string }>;
};

type BookingPublicSettings = {
  public_id: string;
  hours: {
    normal: Record<DayName, { closed: boolean; open: string; close: string }>;
    special: { date: string; closed: boolean; open: string; close: string }[];
    periods?: HoursPeriod[];
  };
  seating: {
    maxGuests: number;
    maxGuestsPerReservation: number;
    groupThreshold: number;
    maxBookingDurationMin: number;
  };
  knowledge_public?: string | null;
  notify_email?: string | null;
  notify_enabled?: boolean | null;
  require_manual_confirmation?: boolean | null;
};

const DEFAULT_HOURS: BookingPublicSettings["hours"] = {
  normal: {
    måndag: { closed: false, open: "11:00", close: "21:00" },
    tisdag: { closed: false, open: "11:00", close: "21:00" },
    onsdag: { closed: false, open: "11:00", close: "21:00" },
    torsdag: { closed: false, open: "11:00", close: "21:00" },
    fredag: { closed: false, open: "11:00", close: "21:00" },
    lördag: { closed: false, open: "11:00", close: "21:00" },
    söndag: { closed: false, open: "11:00", close: "21:00" },
  },
  special: [],
  periods: [
    {
      id: "default",
      from: new Date().toISOString().slice(0, 10),
      to: new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().slice(0, 10),
      days: {
        måndag: { closed: false, open: "11:00", close: "21:00" },
        tisdag: { closed: false, open: "11:00", close: "21:00" },
        onsdag: { closed: false, open: "11:00", close: "21:00" },
        torsdag: { closed: false, open: "11:00", close: "21:00" },
        fredag: { closed: false, open: "11:00", close: "21:00" },
        lördag: { closed: false, open: "11:00", close: "21:00" },
        söndag: { closed: false, open: "11:00", close: "21:00" },
      },
    },
  ],
};

const DEFAULT_SEATING: BookingPublicSettings["seating"] = {
  maxGuests: 60,
  maxGuestsPerReservation: 8,
  groupThreshold: 6,
  maxBookingDurationMin: 90,
};

function loadReservations(): Reservation[] {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem("bokata_reservations") : null;
    return raw ? (JSON.parse(raw) as Reservation[]) : [];
  } catch {
    return [];
  }
}

function saveReservation(r: Reservation) {
  const existing = loadReservations();
  const updated = [r, ...existing].slice(0, 2000);
  if (typeof window !== "undefined") {
    localStorage.setItem("bokata_reservations", JSON.stringify(updated));
    window.dispatchEvent(new CustomEvent("bokata:new-reservation", { detail: r }));
    localStorage.setItem("bokata_last_update", String(Date.now()));
  }
}

function toISODateInputValue(date = new Date()) {
  const tz = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return tz.toISOString().split("T")[0];
}

function cloneDays(days: Record<DayName, { closed: boolean; open: string; close: string }>) {
  return {
    måndag: { ...days.måndag },
    tisdag: { ...days.tisdag },
    onsdag: { ...days.onsdag },
    torsdag: { ...days.torsdag },
    fredag: { ...days.fredag },
    lördag: { ...days.lördag },
    söndag: { ...days.söndag },
  };
}

function defaultPeriodRange() {
  const start = new Date();
  const end = new Date();
  end.setFullYear(end.getFullYear() + 1);
  return { from: toISODateInputValue(start), to: toISODateInputValue(end) };
}

function normalizeHours(hours: BookingPublicSettings["hours"]) {
  const normal = hours.normal ? cloneDays(hours.normal) : cloneDays(DEFAULT_HOURS.normal);
  const special = Array.isArray(hours.special) ? [...hours.special] : [];
  const rawPeriods = Array.isArray(hours.periods) ? hours.periods : [];
  const { from, to } = defaultPeriodRange();
  const periods =
    rawPeriods.length > 0
      ? rawPeriods.map((p) => ({
          id: p.id,
          from: p.from || from,
          to: p.to || to,
          days: cloneDays(p.days ?? normal),
        }))
      : [
          {
            id: "default",
            from,
            to,
            days: cloneDays(normal),
          },
        ];
  return { normal, special, periods };
}

function isIsoInRange(iso: string, from: string, to: string) {
  return iso >= from && iso <= to;
}

function periodSpanDays(from: string, to: string) {
  const a = new Date(from + "T00:00:00Z");
  const b = new Date(to + "T00:00:00Z");
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor((b.getTime() - a.getTime()) / 86400000));
}

function pickPeriodForDate(periods: HoursPeriod[], iso: string) {
  const matches = periods.filter((p) => isIsoInRange(iso, p.from, p.to));
  if (!matches.length) return null;
  return matches.sort((a, b) => periodSpanDays(a.from, a.to) - periodSpanDays(b.from, b.to))[0];
}

function makeId(prefix = "resv") {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

function genTimeSlots(start = "11:00", end = "21:00", stepMin = 30, lastBookingBufferMin = 60) {
  const out: string[] = [];
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const startMins = sh * 60 + sm;
  const endMins = eh * 60 + em;
  const lastStart = Math.max(startMins, endMins - lastBookingBufferMin);
  for (let m = startMins; m <= lastStart; m += stepMin) {
    const h = Math.floor(m / 60)
      .toString()
      .padStart(2, "0");
    const mm = (m % 60).toString().padStart(2, "0");
    out.push(`${h}:${mm}`);
  }
  return out;
}

const weekdaySv: DayName[] = ["söndag", "måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag"];
const toDayName = (iso: string): DayName | null => {
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return null;
  return weekdaySv[d.getDay()];
};

function mockAvailability(date: string, time: string, guests: number) {
  const d = new Date(date + "T" + (time || "12:00"));
  const dow = d.getDay();
  const busy = (dow === 5 || dow === 6) && ["18:00", "18:30", "19:00", "19:30", "20:00"].includes(time);
  const capacity = busy ? 24 : 40;
  const booked = Math.floor(((d.getTime() / 1000) % 7) + (busy ? 10 : 2));
  const available = Math.max(0, capacity - booked);
  return { capacity, booked, available, canFit: guests <= available };
}

export default function BookingPage() {
  const [restaurantSlug, setRestaurantSlug] = useState("demo");
  const [restaurantName, setRestaurantName] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get("r");
    const fromLocal = window.localStorage.getItem("bokata_restaurant_id");
    setRestaurantSlug(fromQuery || fromLocal || "demo");
  }, []);

  const [date, setDate] = useState<string>(toISODateInputValue());
  const [time, setTime] = useState<string>("");
  const [guests, setGuests] = useState<number>(2);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [created, setCreated] = useState<Reservation | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const formRef = useRef<HTMLFormElement | null>(null);
  const [publicSettings, setPublicSettings] = useState<BookingPublicSettings | null>(null);
  const [qaQuestion, setQaQuestion] = useState("");
  const [qaAnswer, setQaAnswer] = useState<string | null>(null);
  const [qaLoading, setQaLoading] = useState(false);
  const [qaHistory, setQaHistory] = useState<{ role: "user" | "assistant"; content: string }[]>([]);

  useEffect(() => {
    const load = async () => {
      if (!restaurantSlug || restaurantSlug === "demo") return;
      const { data } = await supabase
        .from("booking_public_settings")
        .select("public_id,hours,seating,knowledge_public")
        .eq("public_id", restaurantSlug)
        .maybeSingle();
      if (data) setPublicSettings(data as BookingPublicSettings);
    };
    load();
  }, [restaurantSlug]);

  useEffect(() => {
    const loadName = async () => {
      if (!restaurantSlug || restaurantSlug === "demo") return;
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(restaurantSlug);
      if (!isUuid) {
        setRestaurantName(restaurantSlug);
        return;
      }
      const { data } = await supabase.from("restaurants").select("name").eq("id", restaurantSlug).maybeSingle();
      setRestaurantName(data?.name ?? null);
    };
    loadName();
  }, [restaurantSlug]);

  const effectiveSettings = publicSettings ?? { public_id: restaurantSlug, hours: DEFAULT_HOURS, seating: DEFAULT_SEATING };
  const normalizedHours = useMemo(() => normalizeHours(effectiveSettings.hours), [effectiveSettings.hours]);
  const settingsMissing = !publicSettings && restaurantSlug !== "demo";

  const isClosedDate = (iso: string) => {
    const special = normalizedHours.special.find((s) => s.date === iso);
    if (special) return special.closed;
    const day = toDayName(iso);
    if (!day) return false;
    const period = pickPeriodForDate(normalizedHours.periods, iso);
    const d = (period?.days ?? normalizedHours.normal)[day];
    return d?.closed ?? false;
  };

  const dayHours = (iso: string) => {
    const special = normalizedHours.special.find((s) => s.date === iso);
    if (special) return special.closed ? null : { open: special.open, close: special.close };
    const day = toDayName(iso);
    if (!day) return null;
    const period = pickPeriodForDate(normalizedHours.periods, iso);
    const d = (period?.days ?? normalizedHours.normal)[day];
    return d && !d.closed ? { open: d.open, close: d.close } : null;
  };

  const times = useMemo(() => {
    const h = dayHours(date);
    if (!h) return [];
    return genTimeSlots(h.open, h.close, 30);
  }, [date, normalizedHours]);

  const avail = useMemo(() => {
    if (isClosedDate(date)) return { capacity: 0, booked: 0, available: 0, canFit: false };
    return mockAvailability(date, time, guests);
  }, [date, time, guests, normalizedHours]);
  const formReady = Boolean(date && time && guests && name && email);
  const [viewMonth, setViewMonth] = useState(() => Number(date.split("-")[1]) - 1);
  const [viewYear, setViewYear] = useState(() => Number(date.split("-")[0]));

  const monthName = (m: number) =>
    ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"][m];
  const daysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
  const startOffset = (y: number, m: number) => (new Date(y, m, 1).getDay() + 6) % 7; // Monday=0
  const calendarDays = useMemo(() => {
    const count = daysInMonth(viewYear, viewMonth);
    const offset = startOffset(viewYear, viewMonth);
    const blanks = Array.from({ length: offset }, (_, i) => ({ key: `b-${i}`, day: null as number | null }));
    const days = Array.from({ length: count }, (_, i) => ({ key: `d-${i + 1}`, day: i + 1 }));
    return [...blanks, ...days];
  }, [viewYear, viewMonth]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!date || !time || !guests || !name || !email) return;
    setSubmitting(true);
    const resv: Reservation = {
      id: makeId(),
      restaurantSlug,
      date,
      time,
      guests,
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim() || undefined,
      notes: notes.trim() || undefined,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    if (!restaurantSlug || restaurantSlug === "demo") {
      setTimeout(() => {
        saveReservation(resv);
        setCreated(resv);
        setSubmitting(false);
      }, 350);
      return;
    }
    try {
      const r = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          restaurantId: restaurantSlug,
          date,
          time,
          guests,
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim() || null,
          notes: notes.trim() || null,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || "Kunde inte skicka bokning.");
      setCreated({ ...resv, status: data.status ?? resv.status });
      setSubmitting(false);
    } catch (err) {
      console.error(err);
      setSubmitting(false);
      alert(err instanceof Error ? err.message : "Kunde inte skicka bokning.");
    }
  }

  const askAi = async () => {
    const text = qaQuestion.trim();
    if (!text) return;
    setQaLoading(true);
    setQaAnswer(null);
    try {
      const nextHistory = [...qaHistory, { role: "user", content: text }];
      const r = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          knowledge: publicSettings?.knowledge_public ?? "",
          history: nextHistory,
          context: {
            baseDate: date,
            nowTime: `${new Date().getHours().toString().padStart(2, "0")}:${new Date().getMinutes().toString().padStart(2, "0")}`,
            seating: effectiveSettings.seating,
            hours: normalizedHours,
          },
        }),
      });
      const raw = await r.text();
      let data: { reply?: string; error?: string } = {};
      try {
        data = raw ? (JSON.parse(raw) as { reply?: string; error?: string }) : {};
      } catch {
        data = {};
      }
      if (!r.ok) throw new Error(data?.error || raw || "Kunde inte hämta svar.");
      const reply = data.reply || "Inget svar.";
      setQaAnswer(reply);
      setQaHistory([...nextHistory, { role: "assistant", content: reply }]);
    } catch (err) {
      setQaAnswer(err instanceof Error ? err.message : "Kunde inte hämta svar.");
    } finally {
      setQaLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <header className="sticky top-0 z-10 backdrop-blur bg-white/80 border-b border-pink-100">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
              <img
                src={forkTransparent}
                alt="Bokäta"
                className="h-10 w-auto object-contain"
              />
            <div>
              <div className="text-xs uppercase tracking-wider bg-clip-text text-transparent bg-gradient-to-r from-pink-600 to-violet-600 font-semibold">
                Bokäta – Boka bord
              </div>
              {restaurantName ? <div className="text-sm text-gray-500">{restaurantName}</div> : null}
            </div>
          </div>
        </div>
      </header>

      <main className={`max-w-6xl mx-auto px-4 pt-8 ${created ? "pb-8" : "pb-24 md:pb-12"}`}>
        {!created ? (
          <section id="booking">
            <form ref={formRef} onSubmit={submit} className="space-y-10">
              <div className="relative left-1/2 right-1/2 -ml-[50vw] -mr-[50vw] w-screen rounded-3xl bg-gradient-to-br from-[#3d015f] via-[#2a0044] to-pink-600 text-white p-6 md:p-10 overflow-hidden shadow-lg">
                <img
                  src={forkTransparent}
                  alt=""
                  aria-hidden="true"
                  className="pointer-events-none absolute right-16 top-1/2 h-64 md:h-80 w-auto -translate-y-1/2 opacity-95 hidden md:block"
                />
                <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-6 relative">
                  <div className="rounded-3xl border border-violet-200 bg-white p-6 h-full min-h-[440px] flex flex-col">
                    <div className="flex items-center justify-between mb-4">
                      <button
                        type="button"
                        className="h-10 w-10 rounded-full border border-violet-200 text-violet-700 hover:bg-violet-100"
                        onClick={() => {
                          const nm = viewMonth === 0 ? 11 : viewMonth - 1;
                          const ny = viewMonth === 0 ? viewYear - 1 : viewYear;
                          setViewMonth(nm);
                          setViewYear(ny);
                        }}
                      >
                        ‹
                      </button>
                      <div className="text-lg font-semibold text-violet-800">
                        {monthName(viewMonth)} {viewYear}
                      </div>
                      <button
                        type="button"
                        className="h-10 w-10 rounded-full border border-violet-200 text-violet-700 hover:bg-violet-100"
                        onClick={() => {
                          const nm = viewMonth === 11 ? 0 : viewMonth + 1;
                          const ny = viewMonth === 11 ? viewYear + 1 : viewYear;
                          setViewMonth(nm);
                          setViewYear(ny);
                        }}
                      >
                        ›
                      </button>
                    </div>
                    <div className="grid grid-cols-7 text-sm text-violet-700/80 mb-3">
                      {["M", "T", "O", "T", "F", "L", "S"].map((d) => (
                        <div key={d} className="text-center">{d}</div>
                      ))}
                    </div>
                    <div className="grid grid-cols-7 gap-3">
                      {calendarDays.map((c) => {
                        if (!c.day) return <div key={c.key} className="h-10" />;
                        const iso = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(c.day).padStart(2, "0")}`;
                        const isSel = iso === date;
                        const closed = isClosedDate(iso);
                        return (
                          <button
                            key={c.key}
                            type="button"
                            onClick={() => !closed && setDate(iso)}
                            disabled={closed}
                            className={`h-12 rounded-2xl text-sm font-semibold flex flex-col items-center justify-center leading-tight ${
                              closed
                                ? "bg-gray-100 text-gray-400 border border-gray-200"
                                : isSel
                                ? "bg-gradient-to-r from-violet-600 to-pink-600 text-white"
                                : "bg-white text-violet-700 border border-violet-200 hover:bg-violet-100"
                            }`}
                          >
                            <span>{c.day}</span>
                            {closed && <span className="text-[10px] mt-0.5">Stängt</span>}
                          </button>
                        );
                      })}
                    </div>
                    <button
                      type="submit"
                      disabled={!date || !time || !guests || !name || !email || submitting || !avail.canFit}
                      className="mt-6 w-full px-5 py-3 rounded-2xl font-semibold text-white bg-gradient-to-r from-violet-600 to-pink-600 disabled:opacity-50 shadow-md hover:shadow-lg transition"
                    >
                      {submitting ? "Skickar…" : "BOKA"}
                    </button>
                  </div>

                  <div>
                    <div className="rounded-3xl bg-white border border-violet-100 p-6 md:p-8 h-full min-h-[440px] flex flex-col">
                      <div className="grid grid-cols-3 gap-2 max-h-[280px] min-h-[180px] overflow-auto pr-1">
                        {times.map((t) => {
                          const a = mockAvailability(date, t, guests);
                          const isSel = t === time;
                          const tag = a.canFit ? (a.available <= 2 ? "Snart full" : a.available <= 6 ? "Populär" : "") : "";
                          return (
                            <button
                              key={t}
                              onClick={() => setTime(t)}
                              className={`text-[10px] rounded-md px-1.5 py-1 border transition ${
                                a.canFit
                                  ? isSel
                                    ? "bg-gradient-to-r from-violet-600 to-pink-600 text-white border-violet-600"
                                    : "bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-100"
                                  : "bg-gray-50 text-gray-400 border-gray-200 line-through cursor-not-allowed"
                              }`}
                            >
                              <div className="flex flex-col items-center leading-tight">
                                <span>{t}</span>
                                {tag && <span className="text-[10px] mt-0.5 opacity-80">{tag}</span>}
                              </div>
                            </button>
                          );
                        })}
                      </div>

                      <div className="mt-6 text-xs text-gray-500">
                        {settingsMissing
                          ? "Tiderna är inte konfigurerade än. Välj ändå en tid så uppdateras när restaurangen sparat sina tider."
                          : ""}
                      </div>
                      <div className="pt-6">
                        <div className="rounded-2xl border border-violet-100 bg-violet-50/70 p-4 space-y-4">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <label className="block">
                              <span className="text-xs font-semibold text-gray-600 pl-1">Namn</span>
                              <input
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="För- och efternamn"
                                className="mt-2 w-full rounded-xl border-gray-300 focus:border-violet-400 focus:ring-violet-400 px-4 py-3 text-center text-sm text-gray-900 placeholder:text-gray-400"
                              />
                            </label>
                            <label className="block">
                              <span className="text-xs font-semibold text-gray-600 pl-1">Antal gäster</span>
                              <input
                                type="number"
                                min={1}
                                max={16}
                                value={guests}
                                onChange={(e) => setGuests(Number(e.target.value))}
                                className="mt-2 w-full rounded-xl border-gray-300 focus:border-violet-400 focus:ring-violet-400 text-center px-4 py-3 text-sm text-gray-900"
                              />
                            </label>
                          </div>
                          <label className="block">
                            <span className="text-xs font-semibold text-gray-600 pl-1">E‑post</span>
                            <input
                              type="email"
                              value={email}
                              onChange={(e) => setEmail(e.target.value)}
                              placeholder="namn@example.com"
                              className="mt-2 w-full rounded-xl border-gray-300 focus:border-violet-400 focus:ring-violet-400 px-4 py-3 text-center text-sm text-gray-900 placeholder:text-gray-400"
                            />
                          </label>
                          <label className="block">
                            <span className="text-xs font-semibold text-gray-600 pl-1">Kommentar</span>
                            <textarea
                              rows={3}
                              value={notes}
                              onChange={(e) => setNotes(e.target.value)}
                              placeholder="Allergier, barnvagn…"
                              className="mt-2 w-full rounded-xl border-gray-300 focus:border-violet-400 focus:ring-violet-400 px-4 py-3 text-center text-sm text-gray-900 placeholder:text-gray-400"
                            />
                          </label>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-pink-100 bg-white px-6 py-3 text-center text-sm text-gray-700">
                <span className="font-semibold text-gray-900">Snabböversikt</span>{" "}
                {new Date(date).toLocaleDateString()} • {guests} gäster
                {name ? ` • ${name}` : ""}
                {email ? ` • ${email}` : ""}
                {notes ? ` • ${notes}` : ""}
              </div>

              <div className="relative left-1/2 right-1/2 -ml-[50vw] -mr-[50vw] w-screen rounded-3xl bg-gradient-to-br from-[#3d015f] via-[#2a0044] to-pink-600 p-6 md:p-10">
                <div className="max-w-6xl mx-auto flex flex-col lg:flex-row items-center gap-6">
                  <div className="w-full lg:w-[70%] rounded-3xl border border-violet-100 bg-white p-6 md:p-8 h-full flex flex-col">
                    <h3 className="text-xl font-bold text-gray-800">Frågor?</h3>
                    <p className="text-sm text-gray-600 mt-1">Ställ din fråga och AI:n svarar.</p>
                    <div className="mt-4 space-y-3 flex-1">
                      <textarea
                        value={qaQuestion}
                        onChange={(e) => setQaQuestion(e.target.value)}
                        placeholder="Ex: Har ni öppet på söndag? Finns det parkering?"
                        className="w-full min-h-[120px] rounded-2xl border border-violet-200 bg-violet-50/60 px-4 py-3 focus:border-violet-400 focus:ring-violet-400"
                      />
                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          onClick={askAi}
                          disabled={qaLoading || !qaQuestion.trim()}
                          className="rounded-xl bg-gradient-to-r from-violet-600 to-pink-600 text-white px-4 py-2 text-sm font-semibold disabled:opacity-60"
                        >
                          {qaLoading ? "Svarar..." : "Fråga AI"}
                        </button>
                        {qaAnswer && <div className="text-sm text-gray-700">{qaAnswer}</div>}
                      </div>
                    </div>
                  </div>
                  <div className="hidden lg:flex w-[30%] justify-end pr-4">
                    <img src={forkTransparent} alt="" aria-hidden="true" className="h-[28rem] w-auto" />
                  </div>
                </div>
              </div>
            </form>
          </section>
        ) : (
          <section className="max-w-2xl mx-auto">
            <div className="rounded-3xl bg-white shadow-sm border border-violet-100 p-6 md:p-8 text-center">
              <h2 className="text-xl md:text-2xl font-extrabold text-gray-800">Tack! Din bokning är skickad</h2>
              <p className="text-gray-600 mt-2">
                En bekräftelse skickas till <span className="font-semibold">{created!.email}</span>.
              </p>

              <div className="mt-6 text-sm bg-violet-50 border border-violet-100 rounded-2xl p-4 text-left">
                <div>
                  <span className="font-semibold">ID:</span> {created!.id}
                </div>
                <div>
                  <span className="font-semibold">Datum:</span> {created!.date}
                </div>
                <div>
                  <span className="font-semibold">Tid:</span> {created!.time}
                </div>
                <div>
                  <span className="font-semibold">Gäster:</span> {created!.guests}
                </div>
                <div>
                  <span className="font-semibold">Namn:</span> {created!.name}
                </div>
                {created!.phone && (
                  <div>
                    <span className="font-semibold">Telefon:</span> {created!.phone}
                  </div>
                )}
                {created!.notes && (
                  <div>
                    <span className="font-semibold">Kommentar:</span> {created!.notes}
                  </div>
                )}
              </div>

              <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
                <button
                  onClick={() => setCreated(null)}
                  className="px-5 py-3 rounded-2xl font-semibold text-white bg-gradient-to-r from-violet-600 via-pink-600 to-rose-600 shadow-md hover:shadow-lg transition"
                >
                  Ny bokning
                </button>
                <a
                  href={`/booking?r=${restaurantSlug}`}
                  className="px-5 py-3 rounded-2xl font-semibold text-violet-700 bg-violet-50 border border-violet-100 hover:bg-violet-100 transition"
                >
                  Tillbaka
                </a>
              </div>

              <div className="mt-6 text-xs text-gray-500">
                Tips: om Dashboard är öppet i en annan flik syns bokningen redan där.
              </div>
            </div>
          </section>
        )}

      </main>

      {!created && (
        <div className="fixed bottom-0 left-0 right-0 z-20 md:hidden">
          <div className="mx-auto max-w-5xl px-4 pb-4">
            <div className="rounded-2xl border border-white/10 bg-white/90 backdrop-blur shadow-lg p-3 flex items-center justify-between">
              <div className="text-sm">
                <div className="font-semibold text-gray-800">Din bokning</div>
                <div className="text-xs text-gray-600">{date} • {time || "välj tid"} • {guests} gäster</div>
              </div>
              <button
                type="button"
                disabled={!formReady || submitting || !avail.canFit}
                className="px-4 py-2 rounded-xl font-semibold text-white bg-gradient-to-r from-violet-600 via-pink-600 to-rose-600 disabled:opacity-50"
                onClick={() => formRef.current?.requestSubmit()}
              >
                {submitting ? "Skickar…" : "Boka"}
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className="mt-2 py-4 text-center">
        <div className="text-2xl md:text-3xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-violet-600 via-pink-500 to-rose-500">
          Bokäta
        </div>
        <div className="mt-1 text-lg md:text-xl font-semibold text-gray-700">
          Den lagar inte mat. Den lagar allt annat.
        </div>
        <a
          href="/"
          className="mt-3 inline-flex items-center justify-center rounded-full border border-pink-200 bg-pink-50 px-5 py-2 text-sm font-semibold text-pink-700 hover:bg-pink-100"
        >
          Driver du också restaurang? Upptäck Bokäta →
        </a>
        <div className="mt-4 text-xs text-gray-400">© 2026 Bokäta. Stockholm, Sweden. All rights reserved.</div>
      </footer>
    </div>
  );
}

// --- Testhelpers (manuella, kör i konsolen om du vill) ---
export function __test__idUniqueness(n = 200) {
  const s = new Set<string>();
  for (let i = 0; i < n; i++) s.add(makeId());
  if (s.size !== n) throw new Error("IDs ska vara unika");
  return true;
}

export function __test__availabilitySanity() {
  const a1 = mockAvailability("2025-08-26", "18:00", 2);
  const a2 = mockAvailability("2025-08-26", "12:00", 2);
  if (a1.capacity < a2.capacity) throw new Error("Busy-logik ska inte sänka kapacitet under normal");
  if (a1.available < 0 || a2.available < 0) throw new Error("Tillgänglighet får inte vara negativ");
  return true;
}
