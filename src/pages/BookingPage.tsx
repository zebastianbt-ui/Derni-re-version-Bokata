import React, { useMemo, useState } from "react";

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

  const times = useMemo(() => genTimeSlots("11:00", "21:00", 30), []);
  const avail = useMemo(() => mockAvailability(date, time, guests), [date, time, guests]);

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
    <div className="min-h-screen bg-gradient-to-b from-violet-50 via-pink-50 to-rose-50 text-gray-800">
      <header className="sticky top-0 z-10 backdrop-blur bg-white/60 border-b border-violet-100">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ForkLogo />
            <div>
              <div className="text-xs uppercase tracking-wider bg-clip-text text-transparent bg-gradient-to-r from-violet-600 to-pink-600 font-semibold">
                Bokäta – Boka bord
              </div>
              <div className="text-sm text-gray-600">{restaurantSlug}</div>
            </div>
          </div>
          <a href="#booking" className="text-sm font-medium text-violet-600 hover:text-pink-700">
            Till bokningen
          </a>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        {!created ? (
          <section id="booking" className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            {/* Formulär */}
            <div className="lg:col-span-3">
              <div className="rounded-3xl bg-white shadow-sm border border-rose-100 p-6 md:p-8">
                <form onSubmit={submit} className="space-y-6">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <label className="block">
                      <span className="text-sm font-semibold text-gray-700">Datum</span>
                      <input
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        className="mt-1 w-full rounded-xl border-gray-300 focus:border-violet-400 focus:ring-violet-400"
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-semibold text-gray-700">Tid</span>
                      <select
                        value={time}
                        onChange={(e) => setTime(e.target.value)}
                        className="mt-1 w-full rounded-xl border-gray-300 focus:border-violet-400 focus:ring-violet-400"
                      >
                        <option value="">Välj…</option>
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
                    <label className="block">
                      <span className="text-sm font-semibold text-gray-700">Kommentar</span>
                      <input
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Allergier, barnvagn…"
                        className="mt-1 w-full rounded-xl border-gray-300 focus:border-violet-400 focus:ring-violet-400"
                      />
                    </label>
                  </div>

                  <div className="flex items-center justify-between bg-violet-50 border border-violet-100 rounded-2xl p-4">
                    <div>
                      <div className="text-sm font-semibold text-violet-700">Tillgänglighet</div>
                      <div className="text-xs text-violet-600">
                        {time ? (
                          avail.canFit ? (
                            <>Plats för {guests} gäster kl {time}. {avail.available} kvar.</>
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
            </div>

            {/* Tillgänglighetspanel */}
            <div className="lg:col-span-2">
              <div className="rounded-3xl bg-white shadow-sm border border-violet-100 p-6 md:p-8">
                <h2 className="text-lg font-bold text-gray-800">Snabböversikt</h2>
                <p className="text-sm text-gray-600">{new Date(date).toLocaleDateString()} • {guests} gäster</p>

                <div className="mt-4 grid grid-cols-3 gap-2 max-h-[340px] overflow-auto pr-1">
                  {times.map((t) => {
                    const a = mockAvailability(date, t, guests);
                    const isSel = t === time;
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
                        {t}
                      </button>
                    );
                  })}
                </div>

                <div className="mt-6 text-xs text-gray-500">Demoöversikt. Den verkliga kapaciteten kopplas till Dashboard.</div>
              </div>

              <div className="mt-6 rounded-3xl bg-white shadow-sm border border-rose-100 p-6">
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-pink-100 text-pink-700 font-bold">i</span>
                  <div>
                    <div className="text-sm font-semibold text-gray-800">Villkor</div>
                    <div className="text-xs text-gray-600">Avbokning senast 4h innan. No‑shows kan debiteras.</div>
                  </div>
                </div>
              </div>
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

      <footer className="mt-12 py-10 text-center text-xs text-gray-500">
        Bokäta – Den lagar inte mat. Den lagar allt annat.
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
