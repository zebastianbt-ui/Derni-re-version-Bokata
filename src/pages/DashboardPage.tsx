import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../supabaseClient";

// NOTE: Tu as collé un bloc très long avec plein de caractères cassés (×, retours, underscores, etc.).
// Cette version est une *reconstruction fidèle* du dashboard que tu décris (calendrier + timeline + modals + settings + preview IA),
// mais en code propre et exécutable pour que tu puisses le *voir en preview*.

type Meal = "Alla" | "Frukost" | "Lunch" | "Middag";

type BookingStatus = "pending" | "confirmed" | "cancelled";

type Booking = {
  id: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  name: string;
  guests: number;
  durationMin?: number;
  tableId?: number | null;
  status?: BookingStatus;
  source?: "web" | "phone" | "walkin";
  note?: boolean;
  notes?: string;
  color?: string;
};

type PetsPolicy = "none" | "terrace" | "everywhere";

const DAYS_SV = ["söndag", "måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag"] as const;

type DayName = (typeof DAYS_SV)[number];

const DAYS_ORDER: DayName[] = ["måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag", "söndag"];

type Settings = {
  info: { email: string };
  seating: {
    groupThreshold: number;
    highChairs: number;
    allowCombineTables: boolean;
    maxGuests: number;
    maxTables: number;
    maxBookingDurationMin: 60 | 90 | 120;
  };
  policies: {
    vegan: boolean;
    glutenFree: boolean;
    lactoseFree: boolean;
    kidsMenu: boolean;
    strollerAllowed: boolean;
    pets: PetsPolicy;
    wheelchair: boolean;
  };
  hours: {
    normal: Record<DayName, { closed: boolean; open: string; close: string }>;
    special: { date: string; closed: boolean; open: string; close: string }[];
  };
  ai: {
    name: string;
    allowAutoConfirm: boolean;
    outOfScopeReply: string;
    languages: string[];
    knowledge: string;
    faq: string;
  };
  escalation: { maxGuestsPerReservation: number; manualReviewKeywords: string[] };
  notifications: { to: string };
};

const MEAL_RANGES: Record<Meal, [string, string]> = {
  Alla: ["00:00", "23:59"],
  Frukost: ["08:00", "10:59"],
  Lunch: ["11:00", "14:30"],
  Middag: ["17:00", "21:30"],
};

const ENGINE = {
  slotStepMin: 30,
  durations: { Frukost: 60, Lunch: 90, Middag: 120 } as const,
  tables: [2, 2, 2, 4, 4, 4, 6, 6],
};

const MONTHS = [
  "januari",
  "februari",
  "mars",
  "april",
  "maj",
  "juni",
  "juli",
  "augusti",
  "september",
  "oktober",
  "november",
  "december",
];

const WD_SHORT = ["Må", "Ti", "On", "To", "Fr", "Lö", "Sö"];
const WD_FULL = ["Söndag", "Måndag", "Tisdag", "Onsdag", "Torsdag", "Fredag", "Lördag"];

const HOLIDAYS_2025 = [
  { date: "2025-01-01", name: "Nyårsdagen" },
  { date: "2025-01-06", name: "Trettondedag jul" },
  { date: "2025-05-01", name: "Första maj" },
  { date: "2025-05-29", name: "Kristi himmelsfärdsdag" },
  { date: "2025-06-06", name: "Nationaldagen" },
  { date: "2025-06-21", name: "Midsommardagen" },
  { date: "2025-12-25", name: "Juldagen" },
  { date: "2025-12-26", name: "Annandag jul" },
];

const pad2 = (n: number) => String(n).padStart(2, "0");
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

const uid = () => Math.random().toString(36).slice(2, 10);

const mealFor = (t: string): Meal => {
  const x = timeToMin(t);
  for (const m of ["Frukost", "Lunch", "Middag"] as Meal[]) {
    const [a, b] = MEAL_RANGES[m];
    if (x >= timeToMin(a) && x <= timeToMin(b)) return m;
  }
  return "Alla";
};

function assignTablesForDate(date: string, input: Booking[]): Booking[] {
  const tables = ENGINE.tables.map((cap, i) => ({ id: i + 1, cap }));
  const day = input
    .filter((b) => b.date === date)
    .map((b) => ({ ...b }))
    .sort((a, b) => b.guests - a.guests || timeToMin(a.time) - timeToMin(b.time));

  const out: Booking[] = [];

  for (const b of day) {
    const meal = mealFor(b.time);
    const dur = b.durationMin ?? (meal in ENGINE.durations ? ENGINE.durations[meal as keyof typeof ENGINE.durations] : 90);
    const s = timeToMin(round30(b.time));
    const e = s + dur;

    let chosen: number | null = null;

    for (const t of tables.filter((t) => t.cap >= b.guests).sort((a, b) => a.cap - b.cap)) {
      const conflict = out.some((x) => {
        if (x.tableId !== t.id) return false;
        const xs = timeToMin(round30(x.time));
        const xd = x.durationMin ?? (mealFor(x.time) in ENGINE.durations ? ENGINE.durations[mealFor(x.time) as keyof typeof ENGINE.durations] : 90);
        const xe = xs + xd;
        return overlap(s, e, xs, xe);
      });
      if (!conflict) {
        chosen = t.id;
        break;
      }
    }

    out.push({ ...b, tableId: chosen, durationMin: dur, time: round30(b.time) });
  }

  return [...input.filter((b) => b.date !== date), ...out];
}

function findAvailableTable(args: { date: string; time: string; guests: number; bookings: Booking[]; durationMin: number }): number | null {
  const when = round30(args.time);
  const dur = args.durationMin;
  const s = timeToMin(when);
  const e = s + dur;

  for (let i = 0; i < ENGINE.tables.length; i++) {
    const id = i + 1;
    const cap = ENGINE.tables[i];
    if (cap < args.guests) continue;

    const conflict = args.bookings.some((b) => {
      if (b.date !== args.date) return false;
      if (b.tableId !== id) return false;
      const bs = timeToMin(round30(b.time));
      const bd = b.durationMin ?? (mealFor(b.time) in ENGINE.durations ? ENGINE.durations[mealFor(b.time) as keyof typeof ENGINE.durations] : 90);
      const be = bs + bd;
      return overlap(s, e, bs, be);
    });

    if (!conflict) return id;
  }

  return null;
}

export default function ReservationDashboard() {
  const [session, setSession] = useState<Session | null>(null);
  const [authEmail, setAuthEmail] = useState("");
  const [authMsg, setAuthMsg] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profileEmail, setProfileEmail] = useState("");
  const [restaurantId, setRestaurantId] = useState<string | null>(null);
  const [restaurantName, setRestaurantName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteMsg, setInviteMsg] = useState<string | null>(null);
  const [members, setMembers] = useState<{ name: string; email: string; role: string }[]>([]);
  const [settingsReady, setSettingsReady] = useState(false);
  const saveTimer = useRef<number | null>(null);
  const profileTimer = useRef<number | null>(null);

  const [activeMeal, setActiveMeal] = useState<Meal>("Lunch");
  const [openBooking, setOpenBooking] = useState<Booking | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [month, setMonth] = useState(8); // Sep (0-index)
  const [year, setYear] = useState(2025);
  const [selectedDay, setSelectedDay] = useState(5);
  const dateSel = `${year}-${pad2(month + 1)}-${pad2(selectedDay)}`;

  const defaultSettings: Settings = useMemo(
    () => ({
      info: { email: "bookings@example.se" },
      seating: {
        groupThreshold: 6,
        highChairs: 3,
        allowCombineTables: false,
        maxGuests: 60,
        maxTables: 20,
        maxBookingDurationMin: 90,
      },
      policies: {
        vegan: true,
        glutenFree: true,
        lactoseFree: true,
        kidsMenu: true,
        strollerAllowed: true,
        pets: "terrace",
        wheelchair: true,
      },
      hours: {
        normal: {
          söndag: { closed: false, open: "11:00", close: "17:00" },
          måndag: { closed: false, open: "11:00", close: "17:00" },
          tisdag: { closed: false, open: "11:00", close: "17:00" },
          onsdag: { closed: false, open: "11:00", close: "17:00" },
          torsdag: { closed: false, open: "11:00", close: "17:00" },
          fredag: { closed: false, open: "11:00", close: "17:00" },
          lördag: { closed: false, open: "11:00", close: "17:00" },
        },
        special: [
          { date: "2025-05-29", closed: false, open: "09:00", close: "17:00" },
          { date: "2025-06-06", closed: false, open: "11:00", close: "17:00" },
          { date: "2025-06-20", closed: false, open: "11:00", close: "16:00" },
        ],
      },
      ai: {
        name: "Bokäta Assistant",
        allowAutoConfirm: true,
        outOfScopeReply:
          "Jag kan bara hjälpa till med bordsbokningar och relaterade frågor. Kontakta oss på {email}.",
        languages: ["sv", "en", "fr"],
        knowledge: "",
        faq: [
          "Tar ni emot kontanter?",
          "Tar ni kort (Visa/Mastercard/Amex)? Swish?",
          "Vilka är era öppettider per dag?",
          "Hur lång är bordsbokningstiden per sittning?",
          "Hur tar man sig till er med kollektivtrafik?",
          "Finns det parkering i närheten?",
          "Tillgänglig entré och toalett?",
          "Erbjuder ni vegan-, gluten- och laktosfria alternativ?",
          "Finns barnstolar? Barnvagn? Barnmeny?",
          "Hundpolicy (ej/terrass/överallt)?",
          "Max antal gäster per bokning?",
        ].join("\n"),
      },
      escalation: { maxGuestsPerReservation: 22, manualReviewKeywords: ["privat event", "bröllop", "afterwork"] },
      notifications: { to: "bookings@example.se" },
    }),
    []
  );

  const [config, setConfig] = useState<Settings>(defaultSettings);

  useEffect(() => {
    let active = true;

    const init = async () => {
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      setSession(data.session ?? null);
      if (data.session?.user?.email) setProfileEmail(data.session.user.email);
    };

    init();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
      setProfileEmail(sess?.user?.email ?? "");
      if (!sess) setSettingsReady(false);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const load = async () => {
      if (!session?.user?.id) return;
      const userId = session.user.id;
      const userEmail = session.user.email ?? "";

      const { data: pendingInvites } = await supabase
        .from("invites")
        .select("id,restaurant_id")
        .eq("email", userEmail)
        .is("accepted_at", null);

      if (pendingInvites?.length) {
        for (const inv of pendingInvites) {
          await supabase.from("memberships").insert({ restaurant_id: inv.restaurant_id, user_id: userId, role: "member" });
          await supabase.from("invites").update({ accepted_at: new Date().toISOString() }).eq("id", inv.id);
        }
      }

      let membership = await supabase
        .from("memberships")
        .select("restaurant_id,role")
        .eq("user_id", userId)
        .maybeSingle();

      if (!membership.data) {
        const baseName = profileName.trim() ? `${profileName.trim()} Restaurant` : "Bokäta Restaurant";
        const { data: rest } = await supabase
          .from("restaurants")
          .insert({ name: baseName, owner_id: userId })
          .select("id,name")
          .single();

        if (rest?.id) {
          await supabase.from("memberships").insert({ restaurant_id: rest.id, user_id: userId, role: "owner" });
          membership = { data: { restaurant_id: rest.id, role: "owner" } } as typeof membership;
        }
      }

      if (membership.data) {
        setRestaurantId(membership.data.restaurant_id);
        const { data: rest } = await supabase
          .from("restaurants")
          .select("name")
          .eq("id", membership.data.restaurant_id)
          .maybeSingle();
        setRestaurantName(rest?.name ?? "");
      }

      const [{ data: profile }, { data: settings }] = await Promise.all([
        supabase.from("profiles").select("full_name,email").eq("user_id", userId).maybeSingle(),
        membership.data?.restaurant_id
          ? supabase.from("ai_settings").select("knowledge,assistant_name").eq("restaurant_id", membership.data.restaurant_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);

      if (profile) {
        if (profile.full_name) setProfileName(profile.full_name);
        if (profile.email) setProfileEmail(profile.email);
      } else if (session.user.email) {
        setProfileEmail(session.user.email);
      }

      if (settings) {
        setConfig((prev) => ({
          ...prev,
          ai: {
            ...prev.ai,
            knowledge: settings.knowledge ?? prev.ai.knowledge,
            name: settings.assistant_name ?? prev.ai.name,
          },
        }));
      }

      setSettingsReady(true);
    };

    load();
  }, [session?.user?.id]);

  const seed: Booking[] = useMemo(() => {
    const base: Booking[] = [
      {
        id: uid(),
        date: "2025-09-05",
        time: "11:00",
        name: "Emma Larsson",
        guests: 2,
        color: "bg-green-200",
        note: true,
        notes: "Allergi: nötter (inga spår).",
      },
      { id: uid(), date: "2025-09-05", time: "11:30", name: "Klara Nyman", guests: 2, color: "bg-green-200" },
      { id: uid(), date: "2025-09-05", time: "12:00", name: "Sara Lind", guests: 3, color: "bg-yellow-200", note: true, notes: "Vegan + glutenfritt." },
      { id: uid(), date: "2025-09-05", time: "12:30", name: "Henrik Holm", guests: 6, color: "bg-purple-200" },
      { id: uid(), date: "2025-09-05", time: "13:00", name: "Familjen Sjögren", guests: 4, color: "bg-green-200", note: true, notes: "Barnstol. Hörnbord om möjligt." },
      { id: uid(), date: "2025-09-05", time: "18:00", name: "Familjen Karlsson", guests: 8, color: "bg-yellow-200", note: true, notes: "Jordnöt – inga spår." },
    ];
    const durationMin = defaultSettings.seating.maxBookingDurationMin;
    return base.map((b) => ({ ...b, durationMin }));
  }, [defaultSettings.seating.maxBookingDurationMin]);

  const [bookings, setBookings] = useState<Booking[]>(() => assignTablesForDate(dateSel, seed));

  useEffect(() => {
    setBookings((prev) => assignTablesForDate(dateSel, prev));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateSel]);

  useEffect(() => {
    setBookings((prev) => {
      const updated = prev.map((b) => ({ ...b, durationMin: config.seating.maxBookingDurationMin }));
      const dates = Array.from(new Set<string>(updated.map((b) => b.date)));
      let out = updated;
      for (const d of dates) out = assignTablesForDate(d, out);
      return out;
    });
  }, [config.seating.maxBookingDurationMin]);

  useEffect(() => {
    if (!session?.user?.id || !settingsReady || !restaurantId) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);

    saveTimer.current = window.setTimeout(async () => {
      await supabase.from("ai_settings").upsert(
        {
          restaurant_id: restaurantId,
          knowledge: config.ai.knowledge,
          assistant_name: config.ai.name,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "restaurant_id" }
      );
    }, 600);

    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [config.ai.knowledge, config.ai.name, session?.user?.id, settingsReady, restaurantId]);

  useEffect(() => {
    if (!session?.user?.id) return;
    if (profileTimer.current) window.clearTimeout(profileTimer.current);

    profileTimer.current = window.setTimeout(async () => {
      await supabase.from("profiles").upsert(
        {
          user_id: session.user.id,
          full_name: profileName || null,
          email: profileEmail || session.user.email || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );
    }, 600);

    return () => {
      if (profileTimer.current) window.clearTimeout(profileTimer.current);
    };
  }, [profileName, profileEmail, session?.user?.id]);

  const ALL_TIMES = useMemo(() => {
    const mins = [MEAL_RANGES.Frukost[0], MEAL_RANGES.Lunch[0], MEAL_RANGES.Middag[0]].map(timeToMin);
    const maxs = [MEAL_RANGES.Frukost[1], MEAL_RANGES.Lunch[1], MEAL_RANGES.Middag[1]].map(timeToMin);
    const out: string[] = [];
    for (let s = Math.min(...mins), e = Math.max(...maxs); s <= e; s += ENGINE.slotStepMin) out.push(minToTime(s));
    return out;
  }, []);

  const dayBookings = useMemo(() => bookings.filter((b) => b.date === dateSel), [bookings, dateSel]);

  const filtered = useMemo(() => {
    const [a, b] = MEAL_RANGES[activeMeal];
    const s = timeToMin(a),
      e = timeToMin(b);
    return dayBookings
      .filter((bk) => {
        const t = timeToMin(bk.time);
        return t >= s && t <= e;
      })
      .sort((x, y) => timeToMin(x.time) - timeToMin(y.time));
  }, [activeMeal, dayBookings]);

  const groupedByTime = useMemo(() => {
    const g: Record<string, Booking[]> = {};
    for (const b of filtered.map((x) => ({ ...x, time: round30(x.time) }))) {
      (g[b.time] ??= []).push(b);
    }
    return g;
  }, [filtered]);

  const totalGuestsDay = useMemo(() => dayBookings.reduce((s, b) => s + b.guests, 0), [dayBookings]);

  const totals = useMemo(
    () => filtered.reduce((a, b) => ({ count: a.count + 1, guests: a.guests + b.guests }), { count: 0, guests: 0 }),
    [filtered]
  );

  const busiestLeast = useMemo(() => {
    const map = new Map<number, number>();
    dayBookings.forEach((b) => {
      const h = Math.floor(timeToMin(b.time) / 60);
      map.set(h, (map.get(h) || 0) + 1);
    });
    if (!map.size) return { max: "–", min: "–" };
    let maxH = -1,
      maxV = -1,
      minH = -1,
      minV = 1e9;
    map.forEach((v, h) => {
      if (v > maxV) {
        maxV = v;
        maxH = h;
      }
      if (v < minV) {
        minV = v;
        minH = h;
      }
    });
    const hr = (h: number) => `${pad2(h)}:00 – ${pad2((h + 1) % 24)}:00`;
    return { max: hr(maxH), min: hr(minH) };
  }, [dayBookings]);

  const guestsByMeal = useMemo(() => {
    const m: Record<Meal, number> = { Alla: 0, Frukost: 0, Lunch: 0, Middag: 0 };
    dayBookings.forEach((b) => {
      const mf = mealFor(b.time);
      m[mf] += b.guests;
      m.Alla += b.guests;
    });
    return m;
  }, [dayBookings]);

  // --- AI preview (MVP, deterministic)
  const [aiMsg, setAiMsg] = useState("");
  const [aiPreview, setAiPreview] = useState("");
  const knowledgeRef = useRef<HTMLTextAreaElement>(null);
  const [newFaq, setNewFaq] = useState<string>("");
  const [faqSuccess, setFaqSuccess] = useState(false);
  const faqTimeoutRef = useRef<number | null>(null);
  const [testRunning, setTestRunning] = useState(false);
  const [testResults, setTestResults] = useState<{ q: string; reply: string }[]>([]);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [onboarding, setOnboarding] = useState({
    restaurantName: "",
    address: "",
    phone: "",
    email: "",
    hours: "",
    bookingDuration: "90",
    maxGuests: "",
    payment: "",
    allergies: "",
    kids: "",
    pets: "",
    parking: "",
    transport: "",
  });

  const knowledgeTemplate = `INFOS:
Namn:
Adress:
Telefon:
E-post:
Öppettider:
Bordsbokningstid:
Max gäster per bokning:
Betalning:
Allergier:
Barn:
Djurpolicy:
Parkering:
Kollektivtrafik:

FRÅGA: Har ni öppet på måndagar?
SVAR:

FRÅGA: Tar ni emot kontanter?
SVAR:
`;

  const commonFaqs = [
    "Har ni öppet på måndagar?",
    "Vilka är era öppettider per dag?",
    "Tar ni emot kontanter?",
    "Tar ni kort (Visa/Mastercard/Amex)?",
    "Tar ni Swish?",
    "Har ni veganska alternativ?",
    "Har ni glutenfria alternativ?",
    "Har ni laktosfria alternativ?",
    "Kan ni hantera allergier?",
    "Finns barnstolar?",
    "Finns barnmeny?",
    "Får man ta med hund?",
    "Har ni uteservering?",
    "Är lokalen rullstolsanpassad?",
    "Finns parkering i närheten?",
    "Hur tar man sig till er med kollektivtrafik?",
    "Hur länge är en bordsbokning?",
    "Kan man boka större sällskap?",
    "Vad är max antal gäster per bokning?",
    "Har ni take away?",
    "Serverar ni alkohol?",
    "Har ni lunchmeny?",
    "Kan man boka bord online?",
    "Vilken adress har ni?",
    "Hur kontaktar man er?",
  ];

  const insertCommonFaqs = () => {
    const blocks = commonFaqs.map((q) => `FRÅGA: ${q}\nSVAR: `).join("\n\n");
    setConfig((prev) => {
      const k = prev.ai.knowledge ?? "";
      const toAdd = commonFaqs.filter((q) => !k.toLowerCase().includes(q.toLowerCase()));
      if (!toAdd.length) return prev;
      const addBlock = toAdd.map((q) => `FRÅGA: ${q}\nSVAR: `).join("\n\n");
      const next = k.trim()
        ? k.trim() + "\n\n" + addBlock + "\n"
        : blocks + "\n";
      return { ...prev, ai: { ...prev.ai, knowledge: next } };
    });
    setTimeout(() => knowledgeRef.current?.focus(), 0);
  };

  const applyTemplate = () => {
    setConfig((prev) => ({ ...prev, ai: { ...prev.ai, knowledge: prev.ai.knowledge?.trim() ? prev.ai.knowledge : knowledgeTemplate } }));
    setTimeout(() => knowledgeRef.current?.focus(), 0);
  };

  const applyOnboarding = () => {
    const lines = [
      "INFOS:",
      onboarding.restaurantName ? `Namn: ${onboarding.restaurantName}` : "",
      onboarding.address ? `Adress: ${onboarding.address}` : "",
      onboarding.phone ? `Telefon: ${onboarding.phone}` : "",
      onboarding.email ? `E-post: ${onboarding.email}` : "",
      onboarding.hours ? `Öppettider: ${onboarding.hours}` : "",
      onboarding.bookingDuration ? `Bordsbokningstid: ${onboarding.bookingDuration} min` : "",
      onboarding.maxGuests ? `Max gäster per bokning: ${onboarding.maxGuests}` : "",
      onboarding.payment ? `Betalning: ${onboarding.payment}` : "",
      onboarding.allergies ? `Allergier: ${onboarding.allergies}` : "",
      onboarding.kids ? `Barn: ${onboarding.kids}` : "",
      onboarding.pets ? `Djurpolicy: ${onboarding.pets}` : "",
      onboarding.parking ? `Parkering: ${onboarding.parking}` : "",
      onboarding.transport ? `Kollektivtrafik: ${onboarding.transport}` : "",
      "",
    ].filter(Boolean);
    setConfig((prev) => ({ ...prev, ai: { ...prev.ai, knowledge: lines.join("\n") } }));
    setOnboardingOpen(false);
    setTimeout(() => knowledgeRef.current?.focus(), 0);
  };

  const knowledgeScore = useMemo(() => {
    const k = (config.ai.knowledge || "").toLowerCase();
    const checks = [
      { key: "Öppettider", ok: /öppettid|öppet|tider/.test(k) },
      { key: "Adress", ok: /adress/.test(k) },
      { key: "Telefon", ok: /telefon|tel|phone/.test(k) },
      { key: "E-post", ok: /e-post|email|mail/.test(k) },
      { key: "Bordsbokningstid", ok: /bokningstid|sittning|min/.test(k) },
      { key: "Max gäster", ok: /max.*gäster|max.*guests/.test(k) },
      { key: "Betalning", ok: /betala|kort|kontant|swish|visa|mastercard|amex/.test(k) },
      { key: "Allergier", ok: /allergi|gluten|laktos|nöt/.test(k) },
      { key: "Barn", ok: /barnstol|barnvagn|barnmeny|barn/.test(k) },
      { key: "Djurpolicy", ok: /hund|djur|terrass/.test(k) },
      { key: "Parkering", ok: /parkering/.test(k) },
      { key: "Kollektivtrafik", ok: /kollektivtrafik|buss|tunnelbana|tram|spårvagn/.test(k) },
    ];
    const ok = checks.filter((c) => c.ok).length;
    const score = Math.round((ok / checks.length) * 100);
    const missing = checks.filter((c) => !c.ok).map((c) => c.key);
    return { score, missing };
  }, [config.ai.knowledge]);

  const callAi = async (text: string) => {
    const r = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: text,
        knowledge: config.ai?.knowledge ?? "",
        context: {
          baseDate: dateSel,
          seating: {
            maxGuests: config.seating.maxGuests,
            maxGuestsPerReservation: config.escalation.maxGuestsPerReservation,
            groupThreshold: config.seating.groupThreshold,
            maxBookingDurationMin: config.seating.maxBookingDurationMin,
          },
          hours: {
            normal: config.hours.normal,
            special: config.hours.special,
          },
          tables: ENGINE.tables,
          bookings: dayBookings.map((b) => ({
            date: b.date,
            time: b.time,
            guests: b.guests,
            durationMin: b.durationMin,
            tableId: b.tableId ?? null,
          })),
        },
      }),
    });
    const data = await r.json();
    return data.reply || "Inget svar.";
  };

  const runAiTests = async () => {
    const prompts = [
      "öppet måndag?",
      "Har ni öppet på Måndag?",
      "Vegan?",
      "Glutenfritt?",
      "Parkering?",
      "Tar ni Swish?",
      "Finns barnstolar?",
      "Hur länge är en bordsbokning?",
      "Boka bord för 4 imorgon kl 19",
      "Boka bord för 12 på fredag kl 18",
      "Var ligger ni?",
    ];
    setTestRunning(true);
    setTestResults([]);
    const out: { q: string; reply: string }[] = [];
    for (const q of prompts) {
      try {
        const reply = await callAi(q);
        out.push({ q, reply });
      } catch {
        out.push({ q, reply: "Fel vid AI-anrop." });
      }
    }
    setTestResults(out);
    setTestRunning(false);
  };

  const addFaq = () => {
    const q = newFaq.trim();
    if (!q) return;
    let added = false;

    setConfig((prev) => {
      const lines = prev.ai.faq
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);

      if (lines.some((x) => x.toLowerCase() === q.toLowerCase())) return prev;

      added = true;
      return { ...prev, ai: { ...prev.ai, faq: [...lines, q].join("\n") } };
    });

    setNewFaq("");
    if (added) {
      if (faqTimeoutRef.current) window.clearTimeout(faqTimeoutRef.current);
      setFaqSuccess(true);
      faqTimeoutRef.current = window.setTimeout(() => {
        setFaqSuccess(false);
      }, 1000);
    }
  };

  const faqItems = useMemo(
    () => config.ai.faq.split("\n").map((s) => s.trim()).filter(Boolean),
    [config.ai.faq]
  );

  const insertFaqIntoKnowledge = (q: string) => {
    const block = `Fråga: ${q}\nSvar: \n\n`;
    setConfig((prev) => {
      const exists = prev.ai.knowledge.includes(q);
      const kn = exists
        ? prev.ai.knowledge
        : prev.ai.knowledge
        ? prev.ai.knowledge.endsWith("\n")
          ? prev.ai.knowledge + block
          : prev.ai.knowledge + "\n" + block
        : block;
      return { ...prev, ai: { ...prev.ai, knowledge: kn } };
    });
    setTimeout(() => knowledgeRef.current?.focus(), 0);
  };

  function isBookingIntent(txt: string) {
    const t = txt.toLowerCase();
    return /(boka|booking|reservation|reservera|bord|table)/.test(t) || /\b\d{1,2}[:\.h]\d{2}\b/.test(t) || /\b\d{1,2}\s*(gäster|guests|personer|pers)\b/.test(t);
  }

  function extractGuests(txt: string) {
    const nums = (txt.match(/\d+/g) || []).map(Number).filter((n) => n > 0 && n < 500);
    return nums.length ? Math.max(...nums) : null;
  }

  function aiRespond(text: string) {
    if (!isBookingIntent(text)) return config.ai.outOfScopeReply.replace("{email}", config.notifications.to);
    const guests = extractGuests(text) ?? 2;
    if (guests > config.escalation.maxGuestsPerReservation)
      return `Tack! För ${guests} gäster behöver vi manuell bekräftelse. Vi återkommer snarast.`;

    const tableId = findAvailableTable({
      date: dateSel,
      time: "12:00",
      guests,
      bookings,
      durationMin: config.seating.maxBookingDurationMin,
    });
    const can = tableId != null;
    return can
      ? `Ja, det finns plats. Jag kan boka för ${guests} gäster. (Förslag: ${dateSel} kl 12:00.)`
      : `Jag hittar tyvärr inget ledigt bord i den tidsperioden. Vill du ha väntelista eller annan tid?`;
  }

  // --- create booking modal
  const [formDate, setFormDate] = useState<string>(dateSel);
  const [formTime, setFormTime] = useState<string>("12:00");
  const [formName, setFormName] = useState<string>("");
  const [formGuests, setFormGuests] = useState<number>(2);
  const [formNotes, setFormNotes] = useState<string>("");
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (createOpen) {
      setFormDate(dateSel);
      setFormTime("12:00");
      setFormName("");
      setFormGuests(2);
      setFormNotes("");
      setFormError(null);
    }
  }, [createOpen, dateSel]);

  function createReservation(d: { date: string; time: string; name: string; guests: number; notes?: string }) {
    if (!d.name.trim()) return { ok: false, error: "Namn krävs." };
    if (!d.date) return { ok: false, error: "Datum krävs." };
    if (!d.time) return { ok: false, error: "Tid krävs." };
    if (d.guests < 1) return { ok: false, error: "Ogiltigt antal gäster." };
    if (d.guests > config.escalation.maxGuestsPerReservation) return { ok: false, error: "Kräver manuell bekräftelse (grupp)." };

    const when = round30(d.time);
    const durationMin = config.seating.maxBookingDurationMin;
    const tableId = findAvailableTable({ date: d.date, time: when, guests: d.guests, bookings, durationMin });
    if (tableId == null) return { ok: false, error: "Ingen ledig passande bord i detta tidsintervall." };

    const colors = ["bg-green-200", "bg-blue-200", "bg-yellow-200", "bg-pink-200", "bg-purple-200"];

    const b: Booking = {
      id: uid(),
      date: d.date,
      time: when,
      name: d.name.trim(),
      guests: d.guests,
      notes: d.notes,
      note: !!d.notes,
      color: colors[Math.floor(Math.random() * colors.length)],
      tableId,
      durationMin,
      status: "confirmed",
      source: "web",
    };

    setBookings((prev) => assignTablesForDate(d.date, [...prev, b]));
    return { ok: true };
  }

  const handleCreate = () => {
    const res = createReservation({ date: formDate, time: formTime, name: formName, guests: formGuests, notes: formNotes });
    if (!res.ok) {
      setFormError(res.error || "Kunde inte spara.");
      return;
    }
    setFormError(null);

    const d = new Date(formDate);
    if (!Number.isNaN(d.getTime())) {
      setYear(d.getFullYear());
      setMonth(d.getMonth());
      setSelectedDay(d.getDate());
    }

    setCreateOpen(false);
  };

  const upsertSpecialByDate = (date: string, patch: Partial<{ closed: boolean; open: string; close: string }>) => {
    setConfig((prev) => {
      const arr = prev.hours.special.slice();
      const idx = arr.findIndex((s) => s.date === date);
      if (idx === -1) arr.push({ date, closed: true, open: "11:00", close: "17:00", ...patch });
      else arr[idx] = { ...arr[idx], ...patch } as any;
      return { ...prev, hours: { ...prev.hours, special: arr } };
    });
  };
  // --- Custom closures (manual dates / periods)
  const [customClosureOpen, setCustomClosureOpen] = useState(false);
  const [customClosureMode, setCustomClosureMode] = useState<"single" | "range">("single");
  const [customClosureDate, setCustomClosureDate] = useState<string>("");
  const [customClosureFrom, setCustomClosureFrom] = useState<string>("");
  const [customClosureTo, setCustomClosureTo] = useState<string>("");

  const addDaysISO = (iso: string, add: number) => {
    const d = new Date(iso + "T00:00:00");
    d.setDate(d.getDate() + add);
    const y = d.getFullYear();
    const m = pad2(d.getMonth() + 1);
    const day = pad2(d.getDate());
    return `${y}-${m}-${day}`;
  };

  const addCustomClosures = () => {
    if (customClosureMode === "single") {
      if (!customClosureDate) return;
      upsertSpecialByDate(customClosureDate, { closed: true });
      setCustomClosureDate("");
      return;
    }

    if (!customClosureFrom || !customClosureTo) return;
    const start = new Date(customClosureFrom + "T00:00:00").getTime();
    const end = new Date(customClosureTo + "T00:00:00").getTime();
    if (Number.isNaN(start) || Number.isNaN(end) || start > end) return;

    let cur = customClosureFrom;
    while (new Date(cur + "T00:00:00").getTime() <= end) {
      upsertSpecialByDate(cur, { closed: true });
      cur = addDaysISO(cur, 1);
    }
    setCustomClosureFrom("");
    setCustomClosureTo("");
  };

  // --- Calendar cells
  const monthDays = useMemo(() => new Date(year, month + 1, 0).getDate(), [year, month]);
  const selectedSafe = Math.min(selectedDay, monthDays);

  const calendarCells = useMemo(() => {
    const off = (new Date(year, month, 1).getDay() + 6) % 7; // Monday=0
    const blanks = Array.from({ length: off }, (_, i) => ({ key: `b-${i}`, day: null as number | null }));
    const days = Array.from({ length: monthDays }, (_, i) => ({ key: `d-${i + 1}`, day: i + 1 }));
    return [...blanks, ...days];
  }, [year, month, monthDays]);

  const upcomingClosed = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return config.hours.special
      .filter((s) => s.closed && new Date(s.date + "T00:00:00").getTime() >= today.getTime())
      .map((s) => s.date)
      .sort((a, b) => a.localeCompare(b));
  }, [config.hours.special]);

  const handleLogin = async () => {
    const email = authEmail.trim();
    if (!email) return;
    setAuthLoading(true);
    setAuthMsg(null);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/dashboard` },
    });
    setAuthLoading(false);
    setAuthMsg(
      error
        ? `Inloggning misslyckades: ${error.message}`
        : "Länk skickad! Kolla din e‑post och klicka på länken för att logga in."
    );
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const refreshMembers = async (rid: string) => {
    const { data } = await supabase
      .from("memberships")
      .select("role,profiles(full_name,email)")
      .eq("restaurant_id", rid);
    if (data) {
      setMembers(
        data.map((m) => {
          const p = (m as { profiles?: { full_name?: string; email?: string } }).profiles;
          return { role: m.role ?? "member", name: p?.full_name ?? "", email: p?.email ?? "" };
        })
      );
    }
  };

  const handleInvite = async () => {
    if (!restaurantId) return;
    const email = inviteEmail.trim();
    if (!email) return;
    const { error } = await supabase.from("invites").insert({
      restaurant_id: restaurantId,
      email,
      invited_by: session?.user?.id ?? null,
    });
    setInviteMsg(error ? `Fel: ${error.message}` : "Inbjudan skickad.");
    if (!error) setInviteEmail("");
    if (!error) refreshMembers(restaurantId);
  };

  useEffect(() => {
    if (!restaurantId) return;
    refreshMembers(restaurantId);
  }, [restaurantId]);

  if (!session) {
    return (
      <div className="min-h-screen bg-pink-50 p-6 flex items-center justify-center">
        <div className="w-full max-w-md rounded-2xl border border-pink-200 bg-white p-6 shadow-lg">
          <h1 className="text-2xl font-bold text-gray-900">Logga in</h1>
          <p className="mt-1 text-sm text-gray-600">Skriv din e‑post för att få en inloggningslänk.</p>
          <label className="mt-4 block text-sm font-semibold text-gray-700">E‑post</label>
          <input
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-pink-400 focus:border-pink-300"
            value={authEmail}
            onChange={(e) => setAuthEmail(e.target.value)}
            placeholder="name@restaurant.se"
          />
          <button
            className="mt-4 w-full rounded-lg bg-pink-600 px-4 py-2 font-semibold text-white hover:bg-pink-700 disabled:opacity-60"
            onClick={handleLogin}
            disabled={authLoading}
          >
            Skicka magisk länk
          </button>
          {authMsg ? <div className="mt-3 text-sm text-gray-700">{authMsg}</div> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-pink-50 p-6">
      <header className="-mx-1 mb-8 rounded-2xl bg-gradient-to-br from-[#180033] via-[#2a0146] to-[#3b024f] px-6 py-10 text-white shadow-lg">
        <div className="max-w-6xl mx-auto text-center">
          <h1 className="text-4xl md:text-6xl font-black tracking-tight">Dashboard</h1>
          <p className="mt-3 text-lg md:text-xl text-white/80 max-w-2xl mx-auto">Övervaka bokningar, gäster och AI-svar i realtid.</p>
          <div className="mt-6 flex flex-wrap gap-3 justify-center">
            <button
              className="rounded-full px-6 py-3 font-semibold text-white bg-pink-500 hover:bg-pink-600 shadow-md ring-1 ring-pink-300"
              onClick={() => setCreateOpen(true)}
            >
              Ny bokning
            </button>
            <button
              className="rounded-full px-6 py-3 font-semibold text-white/90 bg-white/10 border border-white/20 hover:bg-white/15"
              onClick={() => setSettingsOpen(true)}
            >
              Inställningar
            </button>
          </div>
        </div>
      </header>

      {/* Top stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Stat label="Bokningar idag" value={String(dayBookings.length)} />
        <Stat label="Antal gäster idag" value={String(totalGuestsDay)} />
        <Stat label="Mest bokade tid" value={busiestLeast.max} />
        <Stat label="Minst bokade tid" value={busiestLeast.min} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Stat label="Totalt denna vecka" value="348" sub="(demo)" />
        <Stat label="Stammiskunder" value="35" sub="(demo)" />
        <Stat label="Google-recensioner" value="4.8 ★" sub="12 nya denna vecka (demo)" />
        <Stat label="Svar skickade av AI" value="37" sub="denna vecka (demo)" />
      </div>

      {/* Calendar + Day view */}
      <div className="bg-white shadow rounded-lg p-4">
        <h3 className="text-lg font-bold text-gray-700 mb-4">
          {(() => {
            const dd = new Date(year, month, selectedSafe);
            return `${WD_FULL[dd.getDay()]} ${selectedSafe} ${MONTHS[month]} ${year}`;
          })()}
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Month */}
          <div className="border border-gray-300 rounded-lg p-4">
            <div className="grid grid-cols-3 items-center mb-2">
              <button
                className="justify-self-start h-8 w-8 rounded-full border border-pink-300 text-pink-700 hover:bg-pink-50"
                onClick={() =>
                  setMonth((m) => {
                    if (m === 0) {
                      setYear((y) => y - 1);
                      return 11;
                    }
                    return m - 1;
                  })
                }
                aria-label="Föregående månad"
              >
                ‹
              </button>
              <p className="justify-self-center text-sm font-bold text-gray-700 text-center">
                {MONTHS[month]} {year}
              </p>
              <button
                className="justify-self-end h-8 w-8 rounded-full border border-pink-300 text-pink-700 hover:bg-pink-50"
                onClick={() =>
                  setMonth((m) => {
                    if (m === 11) {
                      setYear((y) => y + 1);
                      return 0;
                    }
                    return m + 1;
                  })
                }
                aria-label="Nästa månad"
              >
                ›
              </button>
            </div>

            <div className="grid grid-cols-7 text-center text-sm text-gray-700 gap-1">
              {WD_SHORT.map((d) => (
                <div key={d} className="font-semibold text-gray-500">
                  {d}
                </div>
              ))}

              {calendarCells.map((c) => {
                if (!c.day) return <div key={c.key} />;
                const sel = c.day === selectedSafe;
                const dateStr = `${year}-${pad2(month + 1)}-${pad2(c.day)}`;
                const isClosed = config.hours.special.some((s) => s.date === dateStr && s.closed);
                return (
                  <div
                    key={c.key}
                    onClick={() => setSelectedDay(c.day!)}
                    className={`rounded-lg w-9 h-11 flex flex-col items-center justify-center leading-none ${
                      sel
                        ? "bg-pink-500 text-white font-bold ring-2 ring-pink-700"
                        : isClosed
                        ? "bg-gray-100 text-gray-400 hover:bg-gray-100 cursor-pointer"
                        : "text-gray-800 hover:bg-gray-100 cursor-pointer"
                    }`}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="text-sm font-semibold">{c.day}</div>
                    {isClosed && <div className="text-[10px] text-gray-500">Fermé</div>}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Day schedule */}
          <div className="md:col-span-3 border border-gray-300 rounded-lg p-4">
            <div className="flex flex-wrap items-center gap-2 mb-4">
              {(["Alla", "Frukost", "Lunch", "Middag"] as Meal[]).map((m) => {
                const on = activeMeal === m;
                return (
                  <button
                    key={m}
                    className={`px-3 py-1 text-sm rounded transition border focus:outline-none focus:ring-2 focus:ring-pink-400 ${
                      on
                        ? "bg-pink-100 border-pink-500 text-pink-700 font-bold"
                        : "bg-white border-pink-300 text-pink-600 hover:bg-pink-50"
                    }`}
                    onClick={() => setActiveMeal(m)}
                    aria-pressed={on}
                  >
                    {m} ({guestsByMeal[m]})
                  </button>
                );
              })}

              <span className="ml-auto text-xs text-gray-500">
                {totals.count} bokningar • {totals.guests} gäster
              </span>
            </div>

            {Object.keys(groupedByTime).length === 0 ? (
              <div className="text-sm text-gray-500 italic p-3 bg-gray-50 rounded border border-dashed border-gray-300">
                Inga bokningar i denna tidsperiod.
              </div>
            ) : (
              <div className="space-y-2">
                {Object.keys(groupedByTime)
                  .sort((a, b) => timeToMin(a) - timeToMin(b))
                  .map((time) => (
                    <div key={time} className="bg-gray-50 rounded-md p-2 border border-gray-200">
                      <div className="flex items-start gap-3">
                        <div className="w-14 shrink-0 text-sm font-semibold text-gray-700 pt-1">{time}</div>
                        <div className="flex flex-wrap gap-2">
                          {groupedByTime[time].map((b, idx) => (
                            <div
                              key={`${time}-${idx}`}
                              className={`px-2 py-1 rounded shadow border text-sm text-gray-700 ${b.color ?? "bg-pink-100"} ${
                                b.note ? "cursor-pointer hover:brightness-95" : ""
                              }`}
                              onClick={b.note ? () => setOpenBooking(b) : undefined}
                              title={b.note ? "Visa anteckning" : undefined}
                            >
                              <div className="font-medium">{b.name}</div>
                              <div className="text-xs text-gray-600">{b.guests} gäster{b.tableId ? ` • Bord ${b.tableId}` : ""}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Note modal */}
      {openBooking && (
        <Modal onClose={() => setOpenBooking(null)}>
          <h4 className="text-lg font-bold text-gray-800">
            {openBooking.name} – {openBooking.time}
          </h4>
          <p className="text-sm text-gray-500 mb-4">
            {openBooking.guests} gäster{openBooking.tableId ? ` • Bord ${openBooking.tableId}` : ""}
          </p>
          <div className="bg-pink-50 border border-pink-200 rounded-lg p-3 text-gray-800 whitespace-pre-wrap">
            {openBooking.notes || "(Ingen anteckning)"}
          </div>
          <div className="mt-5 flex justify-end">
            <button className="px-4 py-2 rounded-lg bg-pink-500 text-white hover:bg-pink-600 shadow" onClick={() => setOpenBooking(null)}>
              OK
            </button>
          </div>
        </Modal>
      )}

      {/* Create booking */}
      {createOpen && (
        <Modal onClose={() => setCreateOpen(false)}>
          <h4 className="text-lg font-bold text-gray-800">Ny bokning</h4>
          <div className="mt-4 space-y-3">
            <Field label="Datum">
              <input
                type="date"
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-pink-400 focus:border-pink-300"
                value={formDate}
                onChange={(e) => setFormDate(e.target.value)}
              />
            </Field>

            <Field label="Tid">
              <select
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-pink-400 focus:border-pink-300"
                value={formTime}
                onChange={(e) => setFormTime(e.target.value)}
              >
                {ALL_TIMES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Namn">
              <input
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-pink-400 focus:border-pink-300"
                placeholder="För- och efternamn"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
              />
            </Field>

            <Field label="Gäster">
              <input
                type="number"
                min={1}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-pink-400 focus:border-pink-300"
                value={formGuests}
                onChange={(e) => setFormGuests(Math.max(1, Number(e.target.value) || 1))}
              />
            </Field>

            <Field label="Anteckning">
              <textarea
                rows={3}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-pink-400 focus:border-pink-300"
                placeholder="Allergier, barnstol, hund, vegan…"
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
              />
            </Field>
          </div>

          {formError && <div className="pt-2 text-sm text-red-600">{formError}</div>}

          <div className="pt-4 flex justify-end gap-2">
            <button className="px-4 py-2 rounded-lg border border-gray-300" onClick={() => setCreateOpen(false)}>
              Avbryt
            </button>
            <button className="px-4 py-2 rounded-lg bg-pink-500 text-white hover:bg-pink-600 shadow" onClick={handleCreate}>
              Skapa
            </button>
          </div>
        </Modal>
      )}

      {/* Settings drawer */}
      {settingsOpen && (
        <Drawer onClose={() => setSettingsOpen(false)}>
          <div className="space-y-6">
            <Section title="Restauranginfo">
              <Field label="E-post för bokningar">
                <input
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-pink-400 focus:border-pink-300"
                  value={config.info.email}
                  onChange={(e) => setConfig({ ...config, info: { ...config.info, email: e.target.value } })}
                />
              </Field>
            </Section>

            <Section title="Kapacitet & tider">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Max gäster i restaurangen">
                  <input
                    type="number"
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-pink-400 focus:border-pink-300"
                    value={config.seating.maxGuests}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        seating: { ...config.seating, maxGuests: Math.max(1, Number(e.target.value) || 1) },
                      })
                    }
                  />
                </Field>

                <Field label="Max antal bord">
                  <input
                    type="number"
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-pink-400 focus:border-pink-300"
                    value={config.seating.maxTables}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        seating: { ...config.seating, maxTables: Math.max(1, Number(e.target.value) || 1) },
                      })
                    }
                  />
                </Field>

                <Field label="Max gäster per bokning">
                  <input
                    type="number"
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-pink-400 focus:border-pink-300"
                    value={config.escalation.maxGuestsPerReservation}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        escalation: {
                          ...config.escalation,
                          maxGuestsPerReservation: Math.max(1, Number(e.target.value) || 1),
                        },
                      })
                    }
                  />
                </Field>

                <Field label="Gräns för grupp">
                  <input
                    type="number"
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-pink-400 focus:border-pink-300"
                    value={config.seating.groupThreshold}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        seating: { ...config.seating, groupThreshold: Math.max(1, Number(e.target.value) || 1) },
                      })
                    }
                  />
                </Field>

                <Field label="Max tid per bokning (minuter)">
                  <select
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-pink-400 focus:border-pink-300"
                    value={config.seating.maxBookingDurationMin}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        seating: { ...config.seating, maxBookingDurationMin: Number(e.target.value) as 60 | 90 | 120 },
                      })
                    }
                  >
                    <option value={60}>60</option>
                    <option value={90}>90</option>
                    <option value={120}>120</option>
                  </select>
                </Field>

                <Field label="Barnstolar">
                  <input
                    type="number"
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-pink-400 focus:border-pink-300"
                    value={config.seating.highChairs}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        seating: { ...config.seating, highChairs: Math.max(0, Number(e.target.value) || 0) },
                      })
                    }
                  />
                </Field>
              </div>

              <div className="mt-6">
                <div className="text-sm font-semibold text-gray-700 mb-2">Öppettider (normala)</div>
                <div className="divide-y rounded-lg border border-pink-200 bg-pink-50/40">
                  {DAYS_ORDER.map((day) => {
                    const d = config.hours.normal[day];
                    return (
                      <div key={day} className="grid grid-cols-12 items-center gap-2 px-3 py-2">
                        <div className="col-span-3 capitalize">{day}</div>
                        <label className="col-span-2 inline-flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={d.closed}
                            onChange={(e) =>
                              setConfig((prev) => ({
                                ...prev,
                                hours: {
                                  ...prev.hours,
                                  normal: {
                                    ...prev.hours.normal,
                                    [day]: { ...prev.hours.normal[day], closed: e.target.checked },
                                  },
                                },
                              }))
                            }
                          />
                          Stängt
                        </label>
                        <div className="col-span-3">
                          <input
                            type="time"
                            className="w-full rounded-md border border-gray-300 px-2 py-1 disabled:opacity-60"
                            value={d.open}
                            onChange={(e) =>
                              setConfig((prev) => ({
                                ...prev,
                                hours: {
                                  ...prev.hours,
                                  normal: {
                                    ...prev.hours.normal,
                                    [day]: { ...prev.hours.normal[day], open: e.target.value },
                                  },
                                },
                              }))
                            }
                            disabled={d.closed}
                          />
                        </div>
                        <div className="col-span-3">
                          <input
                            type="time"
                            className="w-full rounded-md border border-gray-300 px-2 py-1 disabled:opacity-60"
                            value={d.close}
                            onChange={(e) =>
                              setConfig((prev) => ({
                                ...prev,
                                hours: {
                                  ...prev.hours,
                                  normal: {
                                    ...prev.hours.normal,
                                    [day]: { ...prev.hours.normal[day], close: e.target.value },
                                  },
                                },
                              }))
                            }
                            disabled={d.closed}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

                           <div className="mt-6">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-semibold text-gray-700">Röda dagar (helgdagar)</div>
                  <button
                    type="button"
                    className="h-8 w-8 rounded-full border border-pink-300 text-pink-700 hover:bg-pink-50"
                    onClick={() => setCustomClosureOpen((v) => !v)}
                    aria-label="Lägg till manuellt stängt datum"
                    title="Lägg till manuellt stängt datum"
                  >
                    +
                  </button>
                </div>

                {customClosureOpen && (
                  <div className="mb-3 rounded-lg border border-pink-200 bg-pink-50/40 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className={`px-3 py-1 text-sm rounded border ${
                          customClosureMode === "single"
                            ? "bg-pink-100 border-pink-500 text-pink-700 font-bold"
                            : "bg-white border-pink-300 text-pink-600 hover:bg-pink-50"
                        }`}
                        onClick={() => setCustomClosureMode("single")}
                      >
                        En dag
                      </button>
                      <button
                        type="button"
                        className={`px-3 py-1 text-sm rounded border ${
                          customClosureMode === "range"
                            ? "bg-pink-100 border-pink-500 text-pink-700 font-bold"
                            : "bg-white border-pink-300 text-pink-600 hover:bg-pink-50"
                        }`}
                        onClick={() => setCustomClosureMode("range")}
                      >
                        Period
                      </button>

                      <div className="ml-auto text-xs text-gray-500">Lägg till extra stängda dagar (t.ex. semester)</div>
                    </div>

                    {customClosureMode === "single" ? (
                      <div className="mt-3 grid grid-cols-12 items-end gap-2">
                        <div className="col-span-8">
                          <Field label="Datum">
                            <input
                              type="date"
                              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-pink-400 focus:border-pink-300"
                              value={customClosureDate}
                              onChange={(e) => setCustomClosureDate(e.target.value)}
                            />
                          </Field>
                        </div>
                        <div className="col-span-4">
                          <button
                            type="button"
                            className="w-full px-4 py-2 rounded-lg bg-pink-500 text-white hover:bg-pink-600 shadow"
                            onClick={addCustomClosures}
                          >
                            Lägg till
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-3 grid grid-cols-12 items-end gap-2">
                        <div className="col-span-4">
                          <Field label="Från">
                            <input
                              type="date"
                              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-pink-400 focus:border-pink-300"
                              value={customClosureFrom}
                              onChange={(e) => setCustomClosureFrom(e.target.value)}
                            />
                          </Field>
                        </div>
                        <div className="col-span-4">
                          <Field label="Till">
                            <input
                              type="date"
                              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-pink-400 focus:border-pink-300"
                              value={customClosureTo}
                              onChange={(e) => setCustomClosureTo(e.target.value)}
                            />
                          </Field>
                        </div>
                        <div className="col-span-4">
                          <button
                            type="button"
                            className="w-full px-4 py-2 rounded-lg bg-pink-500 text-white hover:bg-pink-600 shadow"
                            onClick={addCustomClosures}
                          >
                            Lägg till
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="mb-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <div className="text-xs font-semibold text-gray-600 mb-2">Kommande stängda datum</div>
                  {upcomingClosed.length ? (
                    <div className="space-y-2">
                      {upcomingClosed.map((date) => (
                        <div key={date} className="flex items-center justify-between text-sm">
                          <span className="text-gray-700">{date}</span>
                          <button
                            type="button"
                            className="text-xs text-pink-700 hover:text-pink-800"
                            onClick={() =>
                              setConfig((prev) => ({
                                ...prev,
                                hours: { ...prev.hours, special: prev.hours.special.filter((s) => s.date !== date) },
                              }))
                            }
                          >
                            Supprimer
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-gray-500">Aucune date fermée à venir.</div>
                  )}
                </div>

                <div className="space-y-2">
                  {HOLIDAYS_2025.map((h) => {
                    const sp =
                      config.hours.special.find((s) => s.date === h.date) ||
                      ({ date: h.date, closed: true, open: "11:00", close: "17:00" } as const);

                    return (
                      <div key={h.date} className="grid grid-cols-12 items-center gap-2">
                        <div className="col-span-4">
                          {h.name}
                          <div className="text-xs text-gray-500">{h.date}</div>
                        </div>
                        <label className="col-span-2 inline-flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={sp.closed}
                            onChange={(e) => upsertSpecialByDate(h.date, { closed: e.target.checked })}
                          />
                          Stängt
                        </label>
                        <div className="col-span-3">
                          <input
                            type="time"
                            className="w-full rounded-md border border-gray-300 px-2 py-1 disabled:opacity-60"
                            value={sp.open}
                            onChange={(e) => upsertSpecialByDate(h.date, { open: e.target.value })}
                            disabled={sp.closed}
                          />
                        </div>
                        <div className="col-span-3">
                          <input
                            type="time"
                            className="w-full rounded-md border border-gray-300 px-2 py-1 disabled:opacity-60"
                            value={sp.close}
                            onChange={(e) => upsertSpecialByDate(h.date, { close: e.target.value })}
                            disabled={sp.closed}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

            </Section>

            <Section title="Policies">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <Toggle label="Vegan" checked={config.policies.vegan} onChange={(v) => setConfig({ ...config, policies: { ...config.policies, vegan: v } })} />
                <Toggle
                  label="Glutenfri"
                  checked={config.policies.glutenFree}
                  onChange={(v) => setConfig({ ...config, policies: { ...config.policies, glutenFree: v } })}
                />
                <Toggle
                  label="Laktosfri"
                  checked={config.policies.lactoseFree}
                  onChange={(v) => setConfig({ ...config, policies: { ...config.policies, lactoseFree: v } })}
                />
                <Toggle
                  label="Barnmeny"
                  checked={config.policies.kidsMenu}
                  onChange={(v) => setConfig({ ...config, policies: { ...config.policies, kidsMenu: v } })}
                />
                <Toggle
                  label="Barnvagn tillåten"
                  checked={config.policies.strollerAllowed}
                  onChange={(v) => setConfig({ ...config, policies: { ...config.policies, strollerAllowed: v } })}
                />
                <Toggle
                  label="Rullstolsvänligt"
                  checked={config.policies.wheelchair}
                  onChange={(v) => setConfig({ ...config, policies: { ...config.policies, wheelchair: v } })}
                />
                <Field label="Djur" className="col-span-2">
                  <select
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-pink-400 focus:border-pink-300"
                    value={config.policies.pets}
                    onChange={(e) => setConfig({ ...config, policies: { ...config.policies, pets: e.target.value as PetsPolicy } })}
                  >
                    <option value="none">Inga</option>
                    <option value="terrace">Endast terrass</option>
                    <option value="everywhere">Överallt</option>
                  </select>
                </Field>
              </div>
            </Section>

            <Section title="AI-profil & kunskapsbas">
              <div className="mb-3 text-sm text-gray-600 flex items-center justify-between gap-2">
                <div>Inloggad: {profileEmail || "—"}</div>
                <button className="text-pink-700 hover:text-pink-900" onClick={handleLogout}>
                  Logga ut
                </button>
              </div>

              <Field label="Namn (kundprofil)">
                <input
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-pink-400 focus:border-pink-300"
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  placeholder="Förnamn Efternamn"
                />
              </Field>

              <Field label="Namn på assistent">
                <input
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-pink-400 focus:border-pink-300"
                  value={config.ai.name}
                  onChange={(e) => setConfig({ ...config, ai: { ...config.ai, name: e.target.value } })}
                />
              </Field>

              <Field label="Kunskapsbas (affärsinfo för bokning)" className="mt-3">
                <textarea
                  rows={4}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-pink-400 focus:border-pink-300"
                  ref={knowledgeRef}
                  value={config.ai.knowledge}
                  onChange={(e) => setConfig({ ...config, ai: { ...config.ai, knowledge: e.target.value } })}
                />
              </Field>
              <div className="mt-2 flex flex-wrap gap-2">
                <button className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm" onClick={applyTemplate}>
                  Använd mall
                </button>
                <button className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm" onClick={insertCommonFaqs}>
                  Lägg in vanliga frågor
                </button>
                <button
                  className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm"
                  onClick={() => setOnboardingOpen((v) => !v)}
                >
                  {onboardingOpen ? "Stäng onboarding" : "Starta onboarding"}
                </button>
                <div className="text-xs text-gray-500 self-center">
                  Kvalitet: {knowledgeScore.score}% {knowledgeScore.missing.length ? `• Saknas: ${knowledgeScore.missing.join(", ")}` : "• Bra!"}
                </div>
              </div>

              {onboardingOpen && (
                <div className="mt-3 rounded-lg border border-pink-200 bg-pink-50/30 p-3">
                  <div className="text-sm font-semibold text-gray-700 mb-2">Snabb onboarding</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                    <input
                      className="w-full rounded-lg border border-gray-300 px-3 py-2"
                      placeholder="Namn på restaurang"
                      value={onboarding.restaurantName}
                      onChange={(e) => setOnboarding({ ...onboarding, restaurantName: e.target.value })}
                    />
                    <input
                      className="w-full rounded-lg border border-gray-300 px-3 py-2"
                      placeholder="Adress"
                      value={onboarding.address}
                      onChange={(e) => setOnboarding({ ...onboarding, address: e.target.value })}
                    />
                    <input
                      className="w-full rounded-lg border border-gray-300 px-3 py-2"
                      placeholder="Telefon"
                      value={onboarding.phone}
                      onChange={(e) => setOnboarding({ ...onboarding, phone: e.target.value })}
                    />
                    <input
                      className="w-full rounded-lg border border-gray-300 px-3 py-2"
                      placeholder="E‑post"
                      value={onboarding.email}
                      onChange={(e) => setOnboarding({ ...onboarding, email: e.target.value })}
                    />
                    <input
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 md:col-span-2"
                      placeholder="Öppettider (ex: tis–sön 11:00–21:00, måndag stängt)"
                      value={onboarding.hours}
                      onChange={(e) => setOnboarding({ ...onboarding, hours: e.target.value })}
                    />
                    <input
                      className="w-full rounded-lg border border-gray-300 px-3 py-2"
                      placeholder="Bordsbokningstid (min)"
                      value={onboarding.bookingDuration}
                      onChange={(e) => setOnboarding({ ...onboarding, bookingDuration: e.target.value })}
                    />
                    <input
                      className="w-full rounded-lg border border-gray-300 px-3 py-2"
                      placeholder="Max gäster per bokning"
                      value={onboarding.maxGuests}
                      onChange={(e) => setOnboarding({ ...onboarding, maxGuests: e.target.value })}
                    />
                    <input
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 md:col-span-2"
                      placeholder="Betalning (ex: kort, kontant, Swish)"
                      value={onboarding.payment}
                      onChange={(e) => setOnboarding({ ...onboarding, payment: e.target.value })}
                    />
                    <input
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 md:col-span-2"
                      placeholder="Allergier (ex: gluten/laktos/nötter)"
                      value={onboarding.allergies}
                      onChange={(e) => setOnboarding({ ...onboarding, allergies: e.target.value })}
                    />
                    <input
                      className="w-full rounded-lg border border-gray-300 px-3 py-2"
                      placeholder="Barn (barnstol/barnmeny)"
                      value={onboarding.kids}
                      onChange={(e) => setOnboarding({ ...onboarding, kids: e.target.value })}
                    />
                    <input
                      className="w-full rounded-lg border border-gray-300 px-3 py-2"
                      placeholder="Djurpolicy"
                      value={onboarding.pets}
                      onChange={(e) => setOnboarding({ ...onboarding, pets: e.target.value })}
                    />
                    <input
                      className="w-full rounded-lg border border-gray-300 px-3 py-2"
                      placeholder="Parkering"
                      value={onboarding.parking}
                      onChange={(e) => setOnboarding({ ...onboarding, parking: e.target.value })}
                    />
                    <input
                      className="w-full rounded-lg border border-gray-300 px-3 py-2"
                      placeholder="Kollektivtrafik"
                      value={onboarding.transport}
                      onChange={(e) => setOnboarding({ ...onboarding, transport: e.target.value })}
                    />
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button className="px-3 py-1.5 rounded-lg bg-pink-500 text-white" onClick={applyOnboarding}>
                      Generera kunskapsbas
                    </button>
                    <button className="px-3 py-1.5 rounded-lg border" onClick={() => setOnboardingOpen(false)}>
                      Avbryt
                    </button>
                  </div>
                </div>
              )}

              <div className="text-sm">
  <div className="mb-2 flex items-center justify-between gap-2">
    <div className="text-gray-700">Vanliga frågor</div>

    <div className="flex items-center gap-2">
      <input
        className="h-9 w-56 rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-pink-400 focus:border-pink-300"
        placeholder="Lägg till fråga…"
        value={newFaq}
        onChange={(e) => setNewFaq(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") addFaq();
        }}
      />
      <button
        type="button"
        className="h-9 w-9 rounded-lg border border-pink-300 bg-pink-50 text-pink-700 hover:bg-pink-100 hover:border-pink-400 transition"
        onClick={addFaq}
        aria-label="Lägg till fråga"
        title="Lägg till"
      >
        +
      </button>
    </div>
  </div>
  {faqSuccess && <div className="mb-2 text-xs text-green-700">Question ajoutée</div>}

  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
    {faqItems.map((q, i) => (
      <button
        key={i}
        type="button"
        className="border border-pink-300 rounded-lg p-3 bg-pink-50 text-gray-800 hover:bg-pink-100 hover:border-pink-400 transition text-left"
        onClick={() => insertFaqIntoKnowledge(q)}
      >
        {q}
      </button>
    ))}
  </div>
</div>

              <div className="mt-4">
                <textarea
                  rows={2}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2"
                  placeholder="Skriv en fråga för att förhandsvisa svaret"
                  value={aiMsg}
                  onChange={(e) => setAiMsg(e.target.value)}
                />
                <div className="mt-2 flex gap-2">
                  <button
  className="px-4 py-2 rounded-lg bg-pink-500 text-white hover:bg-pink-600 shadow"
  onClick={async () => {
    setAiPreview("Tänker…");
    try {
      const reply = await callAi(aiMsg);
      setAiPreview(reply);
    } catch {
      setAiPreview("Fel vid AI-anrop.");
    }
  }}
>
  Förhandsvisa
</button>

                  <button className="px-4 py-2 rounded-lg border" onClick={() => setAiPreview("")}
                  >
                    Rensa
                  </button>
                </div>

                {aiPreview && (
                  <div className="mt-3 p-3 rounded-lg border border-pink-200 bg-gray-50 text-sm text-gray-800 whitespace-pre-wrap">
                    <div className="text-xs text-gray-500">Contexte : {dateSel} • 12:00</div>
                    <div className="mb-1 font-semibold text-pink-700">Svar från {config.ai.name}</div>
                    {aiPreview}
                  </div>
                )}
              </div>

              <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
                <div className="text-sm font-semibold text-gray-700 mb-2">Snabbtest (AI)</div>
                <button
                  className="px-3 py-1.5 rounded-lg bg-gray-800 text-white text-sm"
                  onClick={runAiTests}
                  disabled={testRunning}
                >
                  {testRunning ? "Testar..." : "Kör test"}
                </button>
                {testResults.length ? (
                  <div className="mt-3 space-y-2 text-sm">
                    {testResults.map((t, i) => (
                      <div key={`${t.q}-${i}`} className="rounded-md border border-gray-200 bg-white p-2">
                        <div className="text-gray-700"><strong>Q:</strong> {t.q}</div>
                        <div className="text-gray-800"><strong>A:</strong> {t.reply}</div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </Section>

            <Section title="Team & åtkomst">
              <div className="text-sm text-gray-600 mb-3">Restaurang: {restaurantName || "—"}</div>

              <Field label="Bjud in via e‑post">
                <div className="mt-1 flex gap-2">
                  <input
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-pink-400 focus:border-pink-300"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="kollega@restaurant.se"
                  />
                  <button
                    type="button"
                    className="px-4 py-2 rounded-lg bg-pink-500 text-white hover:bg-pink-600"
                    onClick={handleInvite}
                  >
                    Bjud in
                  </button>
                </div>
              </Field>
              {inviteMsg ? <div className="mt-2 text-sm text-gray-700">{inviteMsg}</div> : null}

              <div className="mt-4 text-sm">
                <div className="font-semibold text-gray-700 mb-2">Medlemmar</div>
                <div className="space-y-2">
                  {members.length ? (
                    members.map((m, i) => (
                      <div key={`${m.email}-${i}`} className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2">
                        <div>
                          <div className="text-gray-800">{m.name || "—"}</div>
                          <div className="text-xs text-gray-500">{m.email || "—"}</div>
                        </div>
                        <div className="text-xs text-gray-500">{m.role}</div>
                      </div>
                    ))
                  ) : (
                    <div className="text-xs text-gray-500">Inga medlemmar ännu.</div>
                  )}
                </div>
              </div>
            </Section>

            <Section title="Aviseringar">
              <Field label="Mottagare">
                <input
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-pink-400 focus:border-pink-300"
                  value={config.notifications.to}
                  onChange={(e) => setConfig({ ...config, notifications: { ...config.notifications, to: e.target.value } })}
                />
              </Field>
            </Section>

            <div className="flex justify-end gap-2">
              <button className="px-4 py-2 rounded-lg border" onClick={() => setSettingsOpen(false)}>
                Stäng
              </button>
            </div>
          </div>
        </Drawer>
      )}

      <footer className="mt-12 text-center text-sm text-gray-400">© {new Date().getFullYear()} Bokäta</footer>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white p-4 shadow-lg rounded-lg border border-pink-300">
      <p className="text-sm text-gray-500">{label}</p>
      <h2 className="text-xl font-bold text-gray-800">{value}</h2>
      {sub ? <p className="text-xs text-gray-500 mt-1">{sub}</p> : null}
    </div>
  );
}

function Modal({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div role="dialog" aria-modal="true" className="relative bg-white rounded-2xl shadow-xl w-[92vw] max-w-md p-6 border border-pink-200">
        <button className="absolute top-3 right-3 text-gray-500 hover:text-gray-700" onClick={onClose} aria-label="Stäng">
          ✕
        </button>
        {children}
      </div>
    </div>
  );
}

function Drawer({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div className="absolute right-0 top-0 h-full w-full max-w-2xl bg-gradient-to-b from-pink-50 via-white to-purple-50 shadow-xl border-l border-pink-200 p-6 overflow-y-auto">
        <div className="sticky top-0 z-10 flex items-center justify-between mb-4 bg-white/80 backdrop-blur border-b border-pink-200 rounded-t-xl px-1 py-3">
          <h4 className="text-xl font-bold text-gray-800">Inställningar</h4>
          <button className="text-gray-500 hover:text-gray-700" onClick={onClose} aria-label="Stäng">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border border-pink-200 rounded-xl p-4 bg-white shadow-sm">
      <h5 className="font-semibold mb-3 text-pink-700">{title}</h5>
      {children}
    </section>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block text-sm ${className ?? ""}`}>
      <span className="text-gray-600">{label}</span>
      {children}
    </label>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="inline-flex items-center gap-2">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
