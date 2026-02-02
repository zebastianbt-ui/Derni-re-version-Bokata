import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../supabaseClient";

/**
 * Bokäta – Bokningssida (v2, rosa+lila)
 * Komplett bokningsflöde på svenska.
 *
 * Fix: Stängd och komplett <svg> i ForkLogo (tidigare fel: oavslutad path gav
 * "Unterminated string constant").
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

type BookingPublicSettings = {
  public_id: string;
  hours: {
    normal: Record<DayName, { closed: boolean; open: string; close: string }>;
    special: { date: string; closed: boolean; open: string; close: string }[];
  };
  seating: {
    maxGuests: number;
    maxGuestsPerReservation: number;
    groupThreshold: number;
    maxBookingDurationMin: number;
  };
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

function makeId(prefix = "resv") {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

function genTimeSlots(start = "11:00", end = "21:00", stepMin = 30) {
  const out: string[] = [];
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const startMins = sh * 60 + sm;
  const endMins = eh * 60 + em;
  for (let m = startMins; m <= endMins; m += stepMin) {
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
  const restaurantSlug = useMemo(() => {
    if (typeof window === "undefined") return "demo";
    const params = new URLSearchParams(window.location.search);
    return params.get("r") || "demo";
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

  useEffect(() => {
    const load = async () => {
      if (!restaurantSlug || restaurantSlug === "demo") return;
      const { data } = await supabase
        .from("booking_public_settings")
        .select("public_id,hours,seating")
        .eq("public_id", restaurantSlug)
        .maybeSingle();
      if (data) setPublicSettings(data as BookingPublicSettings);
    };
    load();
  }, [restaurantSlug]);

  const isClosedDate = (iso: string) => {
    if (!publicSettings) return false;
    const special = publicSettings.hours.special.find((s) => s.date === iso);
    if (special) return special.closed;
    const day = toDayName(iso);
    if (!day) return false;
    return publicSettings.hours.normal[day]?.closed ?? false;
  };

  const dayHours = (iso: string) => {
    if (!publicSettings) return null;
    const special = publicSettings.hours.special.find((s) => s.date === iso);
    if (special) return special.closed ? null : { open: special.open, close: special.close };
    const day = toDayName(iso);
    if (!day) return null;
    const d = publicSettings.hours.normal[day];
    return d && !d.closed ? { open: d.open, close: d.close } : null;
  };

  const times = useMemo(() => {
    const h = dayHours(date);
    if (!h) return [];
    return genTimeSlots(h.open, h.close, 30);
  }, [date, publicSettings]);

  const avail = useMemo(() => {
    if (isClosedDate(date)) return { capacity: 0, booked: 0, available: 0, canFit: false };
    return mockAvailability(date, time, guests);
  }, [date, time, guests, publicSettings]);
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

  function submit(e: React.FormEvent) {
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
    setTimeout(() => {
      saveReservation(resv);
      setCreated(resv);
      setSubmitting(false);
    }, 350);
  }

  return (
    <div className="min-h-screen relative overflow-hidden bg-gradient-to-br from-[#2b0a4f] via-[#4b0c73] to-[#c0167a] text-gray-800">
      <div className="pointer-events-none absolute -top-40 -left-40 h-[34rem] w-[34rem] rounded-full bg-fuchsia-400/25 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-52 -right-28 h-[32rem] w-[32rem] rounded-full bg-violet-400/25 blur-3xl" />

      <header className="sticky top-0 z-10 backdrop-blur bg-white/10 border-b border-white/10">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ForkLogo />
            <div>
              <div className="text-xs uppercase tracking-wider bg-clip-text text-transparent bg-gradient-to-r from-pink-200 to-violet-200 font-semibold">
                Bokäta – Boka bord
              </div>
              <div className="text-sm text-white/70">{restaurantSlug}</div>
            </div>
          </div>
          <a href="#booking" className="text-sm font-medium text-white/80 hover:text-white">
            Till bokningen
          </a>
        </div>
      </header>

      <main className={`max-w-5xl mx-auto px-4 py-8 ${created ? "" : "pb-28"}`}>
        {!created ? (
          <section id="booking">
            <div className="rounded-3xl bg-white shadow-sm border border-rose-100 p-6 md:p-8">
              <form ref={formRef} onSubmit={submit} className="space-y-6">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <label className="block">
                      <span className="text-sm font-semibold text-gray-700">Datum</span>
                      <div className="mt-1 rounded-3xl border border-violet-200 bg-violet-50/70 p-6">
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
                                className={`h-12 rounded-2xl text-sm font-semibold ${
                                  closed
                                    ? "bg-gray-100 text-gray-400 border border-gray-200"
                                    : isSel
                                    ? "bg-gradient-to-r from-violet-600 to-pink-600 text-white"
                                    : "bg-white text-violet-700 border border-violet-200 hover:bg-violet-100"
                                }`}
                              >
                                {c.day}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div className="mt-2 text-xs text-gray-500">Valt datum: {date}</div>
                  </label>

                  <div>
                    <div className="rounded-3xl bg-white border border-violet-100 p-6 md:p-8">
                      <h2 className="text-lg font-bold text-gray-800">Snabböversikt</h2>
                      <p className="text-sm text-gray-600">{new Date(date).toLocaleDateString()} • {guests} gäster</p>

                      <div className="mt-4 grid grid-cols-3 gap-2 max-h-[360px] overflow-auto pr-1">
                        {times.map((t) => {
                          const a = mockAvailability(date, t, guests);
                          const isSel = t === time;
                          const tag = a.canFit ? (a.available <= 2 ? "Snart full" : a.available <= 6 ? "Populär" : "") : "";
                          return (
                            <button
                              key={t}
                              onClick={() => setTime(t)}
                              className={`text-sm rounded-xl px-3 py-2 border transition ${
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

                      <div className="mt-6 text-xs text-gray-500">Demoöversikt. Den verkliga kapaciteten kopplas till Dashboard.</div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <label className="block">
                    <span className="text-sm font-semibold text-gray-700">Tid</span>
                    <select
                      value={time}
                      onChange={(e) => setTime(e.target.value)}
                      className="mt-1 w-full rounded-xl border-gray-300 focus:border-violet-400 focus:ring-violet-400"
                    >
                      <option value="">{times.length ? "Välj…" : "Stängt"}</option>
                      {times.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-sm font-semibold text-gray-700">Antal gäster</span>
                    <input
                      type="number"
                      min={1}
                      max={16}
                      value={guests}
                      onChange={(e) => setGuests(Number(e.target.value))}
                      className="mt-1 w-full rounded-xl border-gray-300 focus:border-violet-400 focus:ring-violet-400"
                    />
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <label className="block">
                      <span className="text-sm font-semibold text-gray-700">Namn</span>
                      <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="För- och efternamn"
                        className="mt-1 w-full rounded-xl border-gray-300 focus:border-violet-400 focus:ring-violet-400"
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-semibold text-gray-700">E‑post</span>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="namn@example.com"
                        className="mt-1 w-full rounded-xl border-gray-300 focus:border-violet-400 focus:ring-violet-400"
                      />
                    </label>
                  </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <label className="block">
                      <span className="text-sm font-semibold text-gray-700">Telefon (valfritt)</span>
                      <input
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="07…"
                        className="mt-1 w-full rounded-xl border-gray-300 focus:border-violet-400 focus:ring-violet-400"
                      />
                    </label>
                    <label className="block sm:col-span-2">
                      <span className="text-sm font-semibold text-gray-700">Kommentar</span>
                      <textarea
                        rows={4}
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Allergier, barnvagn…"
                        className="mt-1 w-full rounded-xl border-gray-300 focus:border-violet-400 focus:ring-violet-400"
                      />
                    </label>
                  </div>

                <div
                    className={`rounded-2xl border p-4 transition ${
                      formReady ? "bg-gradient-to-r from-violet-50 to-pink-50 border-violet-200" : "bg-violet-50 border-violet-100"
                    }`}
                  >
                    <div className="text-sm font-semibold text-violet-700 mb-1">Din bokning</div>
                    <div className="text-sm text-gray-700">
                      {date ? date : "Välj datum"} • {time ? `kl ${time}` : "välj tid"} • {guests} gäster
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {name ? name : "Ditt namn"} • {email ? email : "din e‑post"}
                    </div>
                  </div>

                <div className="flex items-center justify-between bg-violet-50 border border-violet-100 rounded-2xl p-4">
                    <div>
                      <div className="text-sm font-semibold text-violet-700">Tillgänglighet</div>
                      <div className="text-xs text-violet-600">
                        {isClosedDate(date) ? (
                          <>Stängt den här dagen. Välj en annan dag.</>
                        ) : time ? (
                          avail.canFit ? (
                            <>Plats för {guests} gäster kl {time}.</>
                          ) : (
                            <>Fullt kl {time}. Välj annan tid eller minska antal.</>
                          )
                        ) : (
                          <>Välj en tid.</>
                        )}
                      </div>
                    </div>
                    <button
                      disabled={!date || !time || !guests || !name || !email || submitting || !avail.canFit}
                      className="px-5 py-3 rounded-2xl font-semibold text-white bg-gradient-to-r from-violet-600 via-pink-600 to-rose-600 disabled:opacity-50 shadow-md hover:shadow-lg transition"
                    >
                      {submitting ? "Skickar…" : "Boka"}
                    </button>
                </div>
              </form>
            </div>
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
                  href="#booking"
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

      <footer className="mt-12 py-12 text-center">
        <div className="text-2xl md:text-3xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-violet-600 via-pink-500 to-rose-500">
          Bokäta – Den lagar inte mat. Den lagar allt annat.
        </div>
        <a
          href="/"
          className="mt-4 inline-flex items-center justify-center rounded-full border border-white/30 bg-white/10 px-5 py-2 text-sm font-semibold text-white/90 backdrop-blur hover:bg-white/20"
        >
          Driver du också restaurang? Upptäck Bokäta →
        </a>
      </footer>
    </div>
  );
}

function ForkLogo() {
  return (
    <svg viewBox="0 0 48 48" className="h-9 w-9">
      <defs>
        <linearGradient id="g" x1="0" x2="1">
          <stop offset="0%" stopColor="#8b5cf6" />
          <stop offset="50%" stopColor="#ec4899" />
          <stop offset="100%" stopColor="#f43f5e" />
        </linearGradient>
      </defs>
      <g fill="url(#g)" stroke="none">
        <path
          d="M14 4c-1.1 0-2 .9-2 2v8c0 3.3 2.7 6 6 6h2v20c0 2.2 1.8 4 4 4s4-1.8 4-4V20h2c3.3 0 6-2.7 6-6V6c0-1.1-.9-2-2-2s-2 .9-2 2v6h-2V6c0-1.1-.9-2-2-2s-2 .9-2 2v6h-2V6c0-1.1-.9-2-2-2s-2 .9-2 2v6h-2V6c0-1.1-.9-2-2-2z"
        />
      </g>
    </svg>
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
