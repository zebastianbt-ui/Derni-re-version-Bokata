import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../supabaseClient";
import bokataFork from "../assets/bokata-fork.png";
import forkTransparent from "../assets/fork-transparent.png";

// NOTE: Tu as collé un bloc très long avec plein de caractères cassés (×, retours, underscores, etc.).
// Cette version est une *reconstruction fidèle* du dashboard que tu décris (calendrier + timeline + modals + settings + preview IA),
// mais en code propre et exécutable pour que tu puisses le *voir en preview*.

type Meal = "Alla" | "Frukost" | "Lunch" | "Middag";
type MealKey = "Frukost" | "Lunch" | "Middag";
type MealRangeMap = Record<MealKey, [string, string]>;

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
  createdAt?: string;
  color?: string;
};

type BookingRow = {
  id: string;
  restaurant_id: string;
  date: string;
  time: string;
  name: string;
  guests: number;
  notes: string | null;
  table_id: number | null;
  duration_min: number | null;
  status: string | null;
  source: string | null;
  created_at: string;
};

type PetsPolicy = "none" | "terrace" | "everywhere";

const DAYS_SV = ["söndag", "måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag"] as const;

type DayName = (typeof DAYS_SV)[number];

const DAYS_ORDER: DayName[] = ["måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag", "söndag"];

type HoursPeriod = {
  id: string;
  name?: string;
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  days: Record<DayName, { closed: boolean; open: string; close: string }>;
};

type FloorplanTable = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  seats: number;
  label?: string;
  orientation?: "h" | "v";
};

type FloorplanZone = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  name: string;
};

type Floorplan = {
  width: number;
  height: number;
  tables: FloorplanTable[];
  zones: FloorplanZone[];
};

type TableCap = { id: number; cap: number; label?: string };

const makeDefaultDays = () => ({
  söndag: { closed: false, open: "11:00", close: "17:00" },
  måndag: { closed: false, open: "11:00", close: "17:00" },
  tisdag: { closed: false, open: "11:00", close: "17:00" },
  onsdag: { closed: false, open: "11:00", close: "17:00" },
  torsdag: { closed: false, open: "11:00", close: "17:00" },
  fredag: { closed: false, open: "11:00", close: "17:00" },
  lördag: { closed: false, open: "11:00", close: "17:00" },
});

const cloneDays = (days: Record<DayName, { closed: boolean; open: string; close: string }>) =>
  DAYS_ORDER.reduce(
    (acc, day) => {
      acc[day] = { ...days[day] };
      return acc;
    },
    {} as Record<DayName, { closed: boolean; open: string; close: string }>
  );

type Settings = {
  info: { email: string };
  seating: {
    groupThreshold: number;
    highChairs: number;
    allowCombineTables: boolean;
    maxGuests: number;
    maxTables: number;
    maxBookingDurationMin: 60 | 90 | 120;
    mealRanges: MealRangeMap;
    followUpEnabled: boolean;
    followUpDelayDays: number;
    followUpEmail: string;
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
    periods: HoursPeriod[];
  };
  ai: {
    name: string;
    allowAutoConfirm: boolean;
    outOfScopeReply: string;
    languages: string[];
    knowledge: string;
    faq: string;
    webSearch: {
      enabled: boolean;
      siteUrl: string;
      googleMapsUrl: string;
      facebookUrl: string;
      instagramUrl: string;
    };
  };
  escalation: { maxGuestsPerReservation: number; manualReviewKeywords: string[] };
  notifications: {
    to: string;
    notifyOnNewBooking: boolean;
    requireManualConfirmation: boolean;
  };
};

const DEFAULT_MEAL_RANGES: MealRangeMap = {
  Frukost: ["08:00", "10:59"],
  Lunch: ["11:00", "14:30"],
  Middag: ["17:00", "21:30"],
};
const ALL_DAY_RANGE: [string, string] = ["00:00", "23:59"];

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

const HOLIDAYS_BY_YEAR: Record<number, { date: string; name: string }[]> = {
  2026: [
    { date: "2026-01-01", name: "Nyårsdagen" },
    { date: "2026-01-06", name: "Trettondedag" },
    { date: "2026-04-03", name: "Långfredagen" },
    { date: "2026-04-05", name: "Påskdagen" },
    { date: "2026-04-06", name: "Annandag påsk" },
    { date: "2026-05-01", name: "Första maj" },
    { date: "2026-05-14", name: "Kristi himmelsfärdsdag" },
    { date: "2026-05-24", name: "Pingstdagen" },
    { date: "2026-06-06", name: "Nationaldagen" },
    { date: "2026-06-20", name: "Midsommardagen" },
    { date: "2026-10-31", name: "Alla helgons dag" },
    { date: "2026-12-25", name: "Juldagen" },
    { date: "2026-12-26", name: "Annandag jul" },
  ],
  2027: [
    { date: "2027-01-01", name: "Nyårsdagen" },
    { date: "2027-01-06", name: "Trettondedag" },
    { date: "2027-03-26", name: "Långfredagen" },
    { date: "2027-03-28", name: "Påskdagen" },
    { date: "2027-03-29", name: "Annandag påsk" },
    { date: "2027-05-01", name: "Första maj" },
    { date: "2027-05-06", name: "Kristi himmelsfärdsdag" },
    { date: "2027-05-16", name: "Pingstdagen" },
    { date: "2027-06-06", name: "Nationaldagen" },
    { date: "2027-06-26", name: "Midsommardagen" },
    { date: "2027-11-06", name: "Alla helgons dag" },
    { date: "2027-12-25", name: "Juldagen" },
    { date: "2027-12-26", name: "Annandag jul" },
  ],
};

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
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

const tableSizeForSeats = (seats: number, orientation: "h" | "v" = "h") => {
  const base =
    seats <= 2 ? { w: 80, h: 60 } :
    seats <= 4 ? { w: 90, h: 60 } :
    seats <= 6 ? { w: 110, h: 70 } :
    seats <= 8 ? { w: 130, h: 80 } :
    { w: 150, h: 90 };
  return orientation === "v" ? { w: base.h, h: base.w } : base;
};

const normalizeTable = (t: FloorplanTable): FloorplanTable => {
  const orientation = t.orientation ?? "h";
  const size = tableSizeForSeats(t.seats || 0, orientation);
  return { ...t, ...size, orientation };
};

const toIsoDate = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const defaultPeriodRange = () => {
  const y = new Date().getFullYear();
  return { from: `${y}-01-01`, to: `${y}-12-31` };
};
const makeHoursPeriod = (
  days: Record<DayName, { closed: boolean; open: string; close: string }>,
  from?: string,
  to?: string,
  name?: string
): HoursPeriod => {
  const range = defaultPeriodRange();
  return {
    id: uid(),
    name,
    from: from ?? range.from,
    to: to ?? range.to,
    days: cloneDays(days),
  };
};
const normalizeHours = (hours?: Settings["hours"] | null) => {
  const baseDays = makeDefaultDays();
  if (!hours) {
    const normal = cloneDays(baseDays);
    return { normal, special: [], periods: [makeHoursPeriod(normal)] };
  }
  const normal = hours.normal ? cloneDays(hours.normal) : cloneDays(baseDays);
  const special = Array.isArray(hours.special) ? hours.special : [];
  const periodsRaw = Array.isArray(hours.periods) ? hours.periods : [];
  const periods =
    periodsRaw.length > 0
      ? periodsRaw.map((p) => ({
          ...p,
          name: p.name ?? "",
          days: p.days ? cloneDays(p.days as Record<DayName, { closed: boolean; open: string; close: string }>) : cloneDays(normal),
        }))
      : [makeHoursPeriod(normal)];
  return { normal, special, periods };
};

const isValidTime = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) && h >= 0 && h <= 23 && m >= 0 && m <= 59;
};

const normalizeMealRanges = (raw?: Partial<MealRangeMap> | null): MealRangeMap => {
  const out: MealRangeMap = { ...DEFAULT_MEAL_RANGES };
  (["Frukost", "Lunch", "Middag"] as MealKey[]).forEach((key) => {
    const val = raw?.[key];
    if (Array.isArray(val) && val.length === 2 && isValidTime(val[0]) && isValidTime(val[1])) {
      out[key] = [val[0], val[1]];
    }
  });
  return out;
};

const mealForWithRanges = (t: string, ranges: MealRangeMap): Meal => {
  const x = timeToMin(t);
  for (const m of ["Frukost", "Lunch", "Middag"] as MealKey[]) {
    const [a, b] = ranges[m];
    if (x >= timeToMin(a) && x <= timeToMin(b)) return m;
  }
  return "Alla";
};

const mealRangeFor = (meal: Meal, ranges: MealRangeMap): [string, string] => {
  if (meal === "Alla") return ALL_DAY_RANGE;
  return ranges[meal];
};

function assignTablesForDate(date: string, input: Booking[], mealRanges: MealRangeMap = DEFAULT_MEAL_RANGES): Booking[] {
  return assignTablesForDateWithTables(date, input, ENGINE.tables.map((cap, i) => ({ id: i + 1, cap })), mealRanges);
}

function parseTableNumber(label?: string | null) {
  if (!label) return null;
  const match = label.match(/\d+/);
  return match ? Number(match[0]) : null;
}

function buildTableCaps(plan?: Floorplan | null): TableCap[] {
  if (!plan?.tables?.length) return ENGINE.tables.map((cap, i) => ({ id: i + 1, cap }));
  const byId = new Map<number, TableCap>();
  plan.tables.forEach((t, idx) => {
    const id = parseTableNumber(t.label) ?? idx + 1;
    if (!byId.has(id)) {
      byId.set(id, {
        id,
        cap: Math.max(1, t.seats || 0),
        label: t.label?.trim() || `Bord ${id}`,
      });
    }
  });
  return Array.from(byId.values()).sort((a, b) => a.id - b.id);
}

function assignTablesForDateWithTables(
  date: string,
  input: Booking[],
  tables: TableCap[],
  mealRanges: MealRangeMap = DEFAULT_MEAL_RANGES
): Booking[] {
  const tableList = tables.length ? tables : ENGINE.tables.map((cap, i) => ({ id: i + 1, cap }));
  const day = input
    .filter((b) => b.date === date)
    .map((b) => ({ ...b }))
    .sort((a, b) => b.guests - a.guests || timeToMin(a.time) - timeToMin(b.time));

  const out: Booking[] = [];

  for (const b of day) {
    const meal = mealForWithRanges(b.time, mealRanges);
    const dur = b.durationMin ?? (meal in ENGINE.durations ? ENGINE.durations[meal as keyof typeof ENGINE.durations] : 90);
    const s = timeToMin(round30(b.time));
    const e = s + dur;

    let chosen: number | null = null;

    if (b.tableId) {
      const pref = tableList.find((t) => t.id === b.tableId);
      if (pref && pref.cap >= b.guests) {
        const conflict = out.some((x) => {
        if (x.tableId !== pref.id) return false;
        const xs = timeToMin(round30(x.time));
        const xd =
          x.durationMin ??
          (mealForWithRanges(x.time, mealRanges) in ENGINE.durations
            ? ENGINE.durations[mealForWithRanges(x.time, mealRanges) as keyof typeof ENGINE.durations]
            : 90);
        const xe = xs + xd;
        return overlap(s, e, xs, xe);
      });
        if (!conflict) chosen = pref.id;
      }
    }

    for (const t of tableList.filter((t) => t.cap >= b.guests).sort((a, b) => a.cap - b.cap)) {
      if (chosen != null) break;
      const conflict = out.some((x) => {
        if (x.tableId !== t.id) return false;
        const xs = timeToMin(round30(x.time));
        const xd =
          x.durationMin ??
          (mealForWithRanges(x.time, mealRanges) in ENGINE.durations
            ? ENGINE.durations[mealForWithRanges(x.time, mealRanges) as keyof typeof ENGINE.durations]
            : 90);
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

function findAvailableTable(args: {
  date: string;
  time: string;
  guests: number;
  bookings: Booking[];
  durationMin: number;
  tables: TableCap[];
  mealRanges?: MealRangeMap;
}): number | null {
  const mealRanges = args.mealRanges ?? DEFAULT_MEAL_RANGES;
  const when = round30(args.time);
  const dur = args.durationMin;
  const s = timeToMin(when);
  const e = s + dur;

  const tableList = args.tables.length ? args.tables : ENGINE.tables.map((cap, i) => ({ id: i + 1, cap }));

  for (const t of tableList) {
    const id = t.id;
    const cap = t.cap;
    if (cap < args.guests) continue;

    const conflict = args.bookings.some((b) => {
      if (b.date !== args.date) return false;
      if (b.tableId !== id) return false;
      const bs = timeToMin(round30(b.time));
      const bd =
        b.durationMin ??
        (mealForWithRanges(b.time, mealRanges) in ENGINE.durations
          ? ENGINE.durations[mealForWithRanges(b.time, mealRanges) as keyof typeof ENGINE.durations]
          : 90);
      const be = bs + bd;
      return overlap(s, e, bs, be);
    });

    if (!conflict) return id;
  }

  return null;
}

function isTableAvailable(args: {
  date: string;
  time: string;
  tableId: number;
  bookings: Booking[];
  durationMin: number;
  mealRanges?: MealRangeMap;
}) {
  const mealRanges = args.mealRanges ?? DEFAULT_MEAL_RANGES;
  const when = round30(args.time);
  const s = timeToMin(when);
  const e = s + args.durationMin;
  return !args.bookings.some((b) => {
    if (b.date !== args.date) return false;
    if (b.tableId !== args.tableId) return false;
    const bs = timeToMin(round30(b.time));
    const bd =
      b.durationMin ??
      (mealForWithRanges(b.time, mealRanges) in ENGINE.durations
        ? ENGINE.durations[mealForWithRanges(b.time, mealRanges) as keyof typeof ENGINE.durations]
        : 90);
    const be = bs + bd;
    return overlap(s, e, bs, be);
  });
}

export default function ReservationDashboard() {
  const [session, setSession] = useState<Session | null>(null);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const location = useLocation();
  const [authMsg, setAuthMsg] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [accessDenied, setAccessDenied] = useState<string | null>(null);
  const [settingsSaveError, setSettingsSaveError] = useState<string | null>(null);
  const [profileName, setProfileName] = useState("");
  const [profileEmail, setProfileEmail] = useState("");
  const [restaurantId, setRestaurantId] = useState<string | null>(null);
  const [restaurantName, setRestaurantName] = useState("");
  const [restaurantRole, setRestaurantRole] = useState<string | null>(null);
  const [bookingLinkStatus, setBookingLinkStatus] = useState("");
  const [settingsReady, setSettingsReady] = useState(false);
  const [aiSaveState, setAiSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [aiSaveMessage, setAiSaveMessage] = useState<string>("");
  const saveTimer = useRef<number | null>(null);
  const profileTimer = useRef<number | null>(null);
  const bookingSaveTimer = useRef<number | null>(null);

  const [activeMeal, setActiveMeal] = useState<Meal>("Alla");
  const [openBooking, setOpenBooking] = useState<Booking | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"overview" | "tableplan">("overview");

  const today = useMemo(() => new Date(), []);

  const bookingPublicUrl = useMemo(() => {
    if (!restaurantId || typeof window === "undefined") return "";
    return `${window.location.origin}/booking?r=${restaurantId}`;
  }, [restaurantId]);

  const copyBookingPublicUrl = async () => {
    if (!bookingPublicUrl) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(bookingPublicUrl);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = bookingPublicUrl;
        textarea.setAttribute("readonly", "true");
        textarea.style.position = "absolute";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setBookingLinkStatus("Kopierad");
    } catch {
      setBookingLinkStatus("Kunde inte kopiera");
    } finally {
      window.setTimeout(() => setBookingLinkStatus(""), 2000);
    }
  };
  const [month, setMonth] = useState(today.getMonth());
  const [year, setYear] = useState(today.getFullYear());
  const [selectedDay, setSelectedDay] = useState(today.getDate());
  const dateSel = `${year}-${pad2(month + 1)}-${pad2(selectedDay)}`;

  const defaultSettings: Settings = useMemo(
    () => ({
      info: { email: "bookings@example.se" },
      seating: {
        groupThreshold: 0,
        highChairs: 0,
        allowCombineTables: false,
        maxGuests: 0,
        maxTables: 0,
        maxBookingDurationMin: 90,
        mealRanges: DEFAULT_MEAL_RANGES,
        followUpEnabled: false,
        followUpDelayDays: 3,
        followUpEmail:
          "Tack för ert besök! Vi hoppas att ni hade en härlig stund.\nOm du vill får du gärna lämna en Google‑recension.",
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
        normal: makeDefaultDays(),
        special: [
          { date: "2025-05-29", closed: false, open: "09:00", close: "17:00" },
          { date: "2025-06-06", closed: false, open: "11:00", close: "17:00" },
          { date: "2025-06-20", closed: false, open: "11:00", close: "16:00" },
        ],
        periods: [makeHoursPeriod(makeDefaultDays())],
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
        webSearch: {
          enabled: false,
          siteUrl: "",
          googleMapsUrl: "",
          facebookUrl: "",
          instagramUrl: "",
        },
      },
      escalation: { maxGuestsPerReservation: 0, manualReviewKeywords: ["privat event", "bröllop", "afterwork"] },
      notifications: {
        to: "bookings@example.se",
        notifyOnNewBooking: true,
        requireManualConfirmation: false,
      },
    }),
    []
  );

  const [config, setConfig] = useState<Settings>(defaultSettings);
  const [openPeriods, setOpenPeriods] = useState<Record<string, boolean>>({});
  const [showHolidays, setShowHolidays] = useState(true);
  const mealRanges = useMemo(() => normalizeMealRanges(config.seating.mealRanges), [config.seating.mealRanges]);

  useEffect(() => {
    const ids = config.hours.periods?.map((p) => p.id) ?? [];
    setOpenPeriods((prev) => {
      const next: Record<string, boolean> = { ...prev };
      let changed = false;
      for (const id of ids) {
        if (next[id] === undefined) {
          next[id] = true;
          changed = true;
        }
      }
      for (const key of Object.keys(next)) {
        if (!ids.includes(key)) {
          delete next[key];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [config.hours.periods]);

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [floorplan, setFloorplan] = useState<Floorplan>({
    width: 900,
    height: 520,
    tables: [
      { id: uid(), x: 80, y: 80, ...tableSizeForSeats(2), seats: 2, label: "T1", orientation: "h" },
      { id: uid(), x: 200, y: 80, ...tableSizeForSeats(2), seats: 2, label: "T2", orientation: "h" },
      { id: uid(), x: 320, y: 80, ...tableSizeForSeats(4), seats: 4, label: "T3", orientation: "h" },
      { id: uid(), x: 80, y: 180, ...tableSizeForSeats(6), seats: 6, label: "T4", orientation: "h" },
    ],
    zones: [
      { id: uid(), x: 520, y: 70, w: 280, h: 160, name: "Terrass" },
    ],
  });
  const [selectedItem, setSelectedItem] = useState<{ type: "table" | "zone"; id: string } | null>(null);
  const [dragging, setDragging] = useState<{ type: "table" | "zone"; id: string; offsetX: number; offsetY: number } | null>(
    null
  );
  const floorplanSaveTimer = useRef<number | null>(null);
  const tableCaps = useMemo(() => buildTableCaps(floorplan), [floorplan]);
  const tableOptions = useMemo(
    () => tableCaps.map((t) => ({ id: t.id, label: t.label ?? `Bord ${t.id}`, cap: t.cap })),
    [tableCaps]
  );

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
    const loadPlan = async () => {
      if (!restaurantId) return;
      const { data, error } = await supabase
        .from("floorplans")
        .select("layout")
        .eq("restaurant_id", restaurantId)
        .maybeSingle();
      if (error) return;
      const layout = (data as { layout?: Floorplan })?.layout;
      if (layout?.tables && layout?.zones) {
        setFloorplan({
          ...layout,
          tables: layout.tables.map((t) => normalizeTable(t)),
        });
      }
    };
    loadPlan();
  }, [restaurantId]);

  useEffect(() => {
    if (!restaurantId || restaurantRole !== "owner") return;
    if (floorplanSaveTimer.current) window.clearTimeout(floorplanSaveTimer.current);
    floorplanSaveTimer.current = window.setTimeout(async () => {
      await supabase.from("floorplans").upsert(
        {
          restaurant_id: restaurantId,
          layout: floorplan,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "restaurant_id" }
      );
    }, 800);
    return () => {
      if (floorplanSaveTimer.current) window.clearTimeout(floorplanSaveTimer.current);
    };
  }, [floorplan, restaurantId, restaurantRole]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = clamp(e.clientX - rect.left - dragging.offsetX, 0, rect.width - 40);
      const y = clamp(e.clientY - rect.top - dragging.offsetY, 0, rect.height - 40);
      if (dragging.type === "table") {
        setFloorplan((prev) => ({
          ...prev,
          tables: prev.tables.map((t) => (t.id === dragging.id ? { ...t, x, y } : t)),
        }));
      } else {
        setFloorplan((prev) => ({
          ...prev,
          zones: prev.zones.map((z) => (z.id === dragging.id ? { ...z, x, y } : z)),
        }));
      }
    };
    const onUp = () => setDragging(null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragging]);

  useEffect(() => {
    const load = async () => {
      if (!session?.user?.id) return;
      const userId = session.user.id;
      const userEmail = (session.user.email ?? "").trim().toLowerCase();

      setAccessDenied(null);
      const { data: member, error: memberError } = await supabase
        .from("memberships")
        .select("id")
        .eq("user_id", userId)
        .limit(1)
        .maybeSingle();
      if (memberError) {
        console.error("Membership lookup error", memberError);
      }

      const { data: sub, error: subError } = userEmail
        ? await supabase
            .from("stripe_subscriptions")
            .select("status")
            .or(`email.eq.${userEmail},supabase_user_id.eq.${userId}`)
            .in("status", ["active", "trialing"])
            .limit(1)
            .maybeSingle()
        : { data: null, error: null };
      if (subError) {
        console.error("Stripe subscription lookup error", subError);
      }

      if (!member && !sub) {
        const baseMsg = "Du saknar aktivt abonnemang. Kontakta oss om du behöver åtkomst.";
        const emailMsg = userEmail ? ` (${userEmail})` : "";
        const memberErrMsg = memberError ? ` | membership: ${memberError.message}` : "";
        const subErrMsg = subError ? ` | subscription: ${subError.message}` : "";
        setAccessDenied(`${baseMsg}${emailMsg}${memberErrMsg}${subErrMsg}`.trim());
        await supabase.auth.signOut();
        return;
      }

      let restaurant: { restaurantId: string | null; role?: string | null; name?: string | null } | null = null;
      try {
        const token = session?.access_token || "";
        restaurant = await fetchRestaurantFromApi(token);
        if (!restaurant?.restaurantId) {
          const baseName = profileName.trim() ? `${profileName.trim()} Restaurant` : "Bokäta Restaurant";
          restaurant = await createRestaurantFromApi(token, baseName);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Kunde inte hämta restaurang";
        console.error(msg);
      }

      if (restaurant?.restaurantId) {
        setRestaurantId(restaurant.restaurantId);
        setRestaurantName(restaurant.name ?? "");
        setRestaurantRole(restaurant.role ?? null);
      }

      const [{ data: profile }, { data: settings }, { data: bookingSettings }] = await Promise.all([
        supabase.from("profiles").select("full_name,email").eq("user_id", userId).maybeSingle(),
        restaurant?.restaurantId
          ? supabase
              .from("ai_settings")
              .select("knowledge,assistant_name,web_search_enabled,site_url,google_maps_url,facebook_url,instagram_url")
              .eq("restaurant_id", restaurant.restaurantId)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        restaurant?.restaurantId
          ? supabase
              .from("booking_public_settings")
              .select("hours,seating,notify_email,notify_enabled,require_manual_confirmation,knowledge_public")
              .eq("public_id", restaurant.restaurantId)
              .maybeSingle()
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
            webSearch: {
              enabled: settings.web_search_enabled ?? prev.ai.webSearch.enabled,
              siteUrl: settings.site_url ?? prev.ai.webSearch.siteUrl,
              googleMapsUrl: settings.google_maps_url ?? prev.ai.webSearch.googleMapsUrl,
              facebookUrl: settings.facebook_url ?? prev.ai.webSearch.facebookUrl,
              instagramUrl: settings.instagram_url ?? prev.ai.webSearch.instagramUrl,
            },
          },
        }));
      }

      if (bookingSettings) {
        setConfig((prev) => ({
          ...prev,
          hours: normalizeHours(bookingSettings.hours ?? prev.hours),
          seating: {
            ...prev.seating,
            maxGuests: bookingSettings.seating?.maxGuests ?? prev.seating.maxGuests,
            maxBookingDurationMin: bookingSettings.seating?.maxBookingDurationMin ?? prev.seating.maxBookingDurationMin,
            groupThreshold: bookingSettings.seating?.groupThreshold ?? prev.seating.groupThreshold,
            maxTables: bookingSettings.seating?.maxTables ?? prev.seating.maxTables,
            highChairs: bookingSettings.seating?.highChairs ?? prev.seating.highChairs,
            mealRanges: normalizeMealRanges(bookingSettings.seating?.mealRanges ?? prev.seating.mealRanges),
            followUpEnabled: bookingSettings.seating?.followUpEnabled ?? prev.seating.followUpEnabled,
            followUpDelayDays: bookingSettings.seating?.followUpDelayDays ?? prev.seating.followUpDelayDays,
            followUpEmail: bookingSettings.seating?.followUpEmail ?? prev.seating.followUpEmail,
          },
          escalation: {
            ...prev.escalation,
            maxGuestsPerReservation: bookingSettings.seating?.maxGuestsPerReservation ?? prev.escalation.maxGuestsPerReservation,
          },
          info: {
            ...prev.info,
            email: bookingSettings.notify_email ?? prev.info.email,
          },
          notifications: {
            ...prev.notifications,
            to: bookingSettings.notify_email ?? prev.notifications.to,
            notifyOnNewBooking: bookingSettings.notify_enabled ?? prev.notifications.notifyOnNewBooking,
            requireManualConfirmation: bookingSettings.require_manual_confirmation ?? prev.notifications.requireManualConfirmation,
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

  const [bookings, setBookings] = useState<Booking[]>(() =>
    assignTablesForDateWithTables(dateSel, seed, tableCaps, mealRanges)
  );
  const [editBookingDraft, setEditBookingDraft] = useState<Booking | null>(null);
  const [bookingsReady, setBookingsReady] = useState(false);
  const [newBookingCount, setNewBookingCount] = useState(0);
  const [newBookingDetail, setNewBookingDetail] = useState<string | null>(null);
  const [newBookingItems, setNewBookingItems] = useState<Array<{ id: string; date: string; time: string; guests: number; name: string }>>([]);
  const [showNewBookings, setShowNewBookings] = useState(false);
  const lastBookingIdsRef = useRef<Set<string>>(new Set());
  const bookingNoticeTimer = useRef<number | null>(null);

  const formatTimeShort = (t?: string | null) => {
    if (!t) return "";
    const parts = t.split(":");
    if (parts.length < 2) return t;
    return `${parts[0]}:${parts[1]}`;
  };

  useEffect(() => {
    setBookings((prev) => assignTablesForDateWithTables(dateSel, prev, tableCaps, mealRanges));
  }, [dateSel, tableCaps, mealRanges]);

  useEffect(() => {
    setBookings((prev) => {
      const updated = prev.map((b) => ({ ...b, durationMin: config.seating.maxBookingDurationMin }));
      const dates = Array.from(new Set<string>(updated.map((b) => b.date)));
      let out = updated;
      for (const d of dates) out = assignTablesForDateWithTables(d, out, tableCaps, mealRanges);
      return out;
    });
  }, [config.seating.maxBookingDurationMin, tableCaps, mealRanges]);

  const fetchBookings = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!restaurantId || !settingsReady) return;
      const { data, error } = await supabase
        .from("bookings")
        .select("id,restaurant_id,date,time,name,guests,notes,table_id,duration_min,status,source,created_at")
        .eq("restaurant_id", restaurantId);
      if (error) return;
      const rows = (data ?? []) as BookingRow[];
      const mapped = rows.map((r) => ({
        id: r.id,
        date: r.date,
        time: r.time,
        name: r.name,
        guests: r.guests,
        notes: r.notes ?? "",
        note: !!r.notes,
        tableId: r.table_id ?? null,
        durationMin: r.duration_min ?? config.seating.maxBookingDurationMin,
        status: (r.status as BookingStatus) ?? "confirmed",
        source: (r.source as Booking["source"]) ?? "walkin",
        createdAt: r.created_at ?? undefined,
        color: "bg-pink-100",
      }));

      const incomingIds = new Set(mapped.map((b) => b.id));
      if (lastBookingIdsRef.current.size) {
        const newOnes = mapped.filter((b) => !lastBookingIdsRef.current.has(b.id));
        if (newOnes.length && !opts?.silent) {
          setNewBookingCount((prev) => prev + newOnes.length);
          const latest = newOnes
            .slice()
            .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""))
            .at(-1);
          if (latest) {
            setNewBookingDetail(`Ny bokning: ${latest.date} · ${formatTimeShort(latest.time)} · ${latest.guests} gäster`);
            if (bookingNoticeTimer.current) window.clearTimeout(bookingNoticeTimer.current);
            bookingNoticeTimer.current = window.setTimeout(() => {
              setNewBookingDetail(null);
            }, 5000);
          }
          const items = newOnes.map((b) => ({
            id: b.id,
            date: b.date,
            time: formatTimeShort(b.time),
            guests: b.guests,
            name: b.name,
          }));
          setNewBookingItems((prev) => [...items, ...prev].slice(0, 10));
        }
      }
      lastBookingIdsRef.current = incomingIds;

      setBookings(assignTablesForDateWithTables(dateSel, mapped, tableCaps, mealRanges));
      setBookingsReady(true);
    },
    [restaurantId, settingsReady, config.seating.maxBookingDurationMin, dateSel, tableCaps, mealRanges]
  );

  useEffect(() => {
    fetchBookings();
  }, [fetchBookings]);

  useEffect(() => {
    if (!restaurantId || !settingsReady) return;
    const id = window.setInterval(() => {
      fetchBookings();
    }, 30000);
    return () => window.clearInterval(id);
  }, [restaurantId, settingsReady, fetchBookings]);

  useEffect(() => {
    if (!session?.user?.id || !settingsReady || !restaurantId) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);

    saveTimer.current = window.setTimeout(async () => {
      setAiSaveState("saving");
      setAiSaveMessage("");
      const { error } = await supabase.from("ai_settings").upsert(
        {
          restaurant_id: restaurantId,
          knowledge: config.ai.knowledge,
          assistant_name: config.ai.name,
          web_search_enabled: config.ai.webSearch.enabled,
          site_url: config.ai.webSearch.siteUrl || null,
          google_maps_url: config.ai.webSearch.googleMapsUrl || null,
          facebook_url: config.ai.webSearch.facebookUrl || null,
          instagram_url: config.ai.webSearch.instagramUrl || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "restaurant_id" }
      );
      if (error) {
        setAiSaveState("error");
        setAiSaveMessage(error.message);
      } else {
        setAiSaveState("saved");
        setAiSaveMessage("Sparad");
      }
    }, 600);

    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [
    config.ai.knowledge,
    config.ai.name,
    config.ai.webSearch.enabled,
    config.ai.webSearch.siteUrl,
    config.ai.webSearch.googleMapsUrl,
    config.ai.webSearch.facebookUrl,
    config.ai.webSearch.instagramUrl,
    session?.user?.id,
    settingsReady,
    restaurantId,
  ]);


  useEffect(() => {
    if (!session?.user?.id || !settingsReady || !restaurantId) return;
    if (bookingSaveTimer.current) window.clearTimeout(bookingSaveTimer.current);
    bookingSaveTimer.current = window.setTimeout(async () => {
      try {
        const token = session?.access_token || "";
        const resp = await fetch("/api/booking-settings", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            restaurantId,
            hours: config.hours,
            seating: {
              maxGuests: config.seating.maxGuests,
              maxGuestsPerReservation: config.escalation.maxGuestsPerReservation,
              groupThreshold: config.seating.groupThreshold,
              maxBookingDurationMin: config.seating.maxBookingDurationMin,
              maxTables: config.seating.maxTables,
              highChairs: config.seating.highChairs,
              mealRanges: config.seating.mealRanges,
            },
            notify_email: config.info.email || config.notifications.to || null,
            notify_enabled: config.notifications.notifyOnNewBooking,
            require_manual_confirmation: config.notifications.requireManualConfirmation,
            knowledge_public: buildPublicKnowledge(config.ai.knowledge, config.ai.webSearch),
          }),
        });
        if (!resp.ok) {
          const data = await resp.json().catch(() => ({}));
          const msg = data?.error || `Save failed (${resp.status})`;
          console.error("booking_public_settings save failed", msg);
          setSettingsSaveError(msg);
          return;
        }
        setSettingsSaveError(null);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Save failed";
        console.error("booking_public_settings save failed", msg);
        setSettingsSaveError(msg);
      }
    }, 700);
    return () => {
      if (bookingSaveTimer.current) window.clearTimeout(bookingSaveTimer.current);
    };
  }, [
    config.hours,
    config.seating,
    config.escalation.maxGuestsPerReservation,
    config.info.email,
    config.notifications.to,
    config.notifications.notifyOnNewBooking,
    config.notifications.requireManualConfirmation,
    restaurantId,
    settingsReady,
  ]);

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
    const mins = [mealRanges.Frukost[0], mealRanges.Lunch[0], mealRanges.Middag[0]].map(timeToMin);
    const maxs = [mealRanges.Frukost[1], mealRanges.Lunch[1], mealRanges.Middag[1]].map(timeToMin);
    const out: string[] = [];
    for (let s = Math.min(...mins), e = Math.max(...maxs); s <= e; s += ENGINE.slotStepMin) out.push(minToTime(s));
    return out;
  }, [mealRanges]);

  const dayBookings = useMemo(() => bookings.filter((b) => b.date === dateSel), [bookings, dateSel]);

  const bookingDates = useMemo(() => {
    const set = new Set<string>();
    bookings.forEach((b) => set.add(b.date));
    return set;
  }, [bookings]);

  const isClosedDate = (iso: string) => {
    const special = config.hours.special.find((s) => s.date === iso);
    if (special) return special.closed;
    const dt = new Date(iso + "T00:00:00Z");
    if (Number.isNaN(dt.getTime())) return false;
    const dayName = DAYS_SV[dt.getUTCDay()];
    const periods = config.hours.periods ?? [];
    const matches = periods.filter((p) => iso >= p.from && iso <= p.to);
    const period =
      matches.length > 0
        ? matches.sort((a, b) => {
            const spanA = Math.max(0, Math.floor((new Date(a.to).getTime() - new Date(a.from).getTime()) / 86400000));
            const spanB = Math.max(0, Math.floor((new Date(b.to).getTime() - new Date(b.from).getTime()) / 86400000));
            return spanA - spanB;
          })[0]
        : periods[periods.length - 1];
    const day = (period?.days ?? config.hours.normal)[dayName];
    return day?.closed ?? false;
  };

  const weekStats = useMemo(() => {
    const toISO = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const startOfWeek = (d: Date) => {
      const copy = new Date(d);
      const day = (copy.getDay() + 6) % 7;
      copy.setDate(copy.getDate() - day);
      copy.setHours(0, 0, 0, 0);
      return copy;
    };
    const addDays = (d: Date, n: number) => {
      const c = new Date(d);
      c.setDate(c.getDate() + n);
      return c;
    };
    const start = startOfWeek(today);
    const end = addDays(start, 7);
    const prevStart = addDays(start, -7);
    const prevEnd = start;
    const inRange = (iso: string, a: Date, b: Date) => iso >= toISO(a) && iso < toISO(b);
    const curGuests = bookings.filter((b) => inRange(b.date, start, end)).reduce((s, b) => s + b.guests, 0);
    const prevGuests = bookings.filter((b) => inRange(b.date, prevStart, prevEnd)).reduce((s, b) => s + b.guests, 0);
    const diff = curGuests - prevGuests;
    const pct = prevGuests > 0 ? Math.round((diff / prevGuests) * 100) : null;
    return { curGuests, prevGuests, diff, pct };
  }, [bookings, today]);

  const filtered = useMemo(() => {
    const [a, b] = mealRangeFor(activeMeal, mealRanges);
    const s = timeToMin(a),
      e = timeToMin(b);
    return dayBookings
      .filter((bk) => {
        const t = timeToMin(bk.time);
        return t >= s && t <= e;
      })
      .sort((x, y) => timeToMin(x.time) - timeToMin(y.time));
  }, [activeMeal, dayBookings, mealRanges]);

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
      const mf = mealForWithRanges(b.time, mealRanges);
      m[mf] += b.guests;
      m.Alla += b.guests;
    });
    return m;
  }, [dayBookings, mealRanges]);

  const updateMealRange = (meal: MealKey, idx: 0 | 1, value: string) => {
    setConfig((prev) => {
      const ranges = normalizeMealRanges(prev.seating.mealRanges);
      const nextRange: [string, string] = [...ranges[meal]] as [string, string];
      nextRange[idx] = value;
      return {
        ...prev,
        seating: {
          ...prev.seating,
          mealRanges: {
            ...ranges,
            [meal]: nextRange,
          },
        },
      };
    });
  };

  // --- AI preview (MVP, deterministic)
  const [aiMsg, setAiMsg] = useState("");
  const [aiPreview, setAiPreview] = useState("");
  const [aiHistory, setAiHistory] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [showDrafts, setShowDrafts] = useState(true);
  const [newFaq, setNewFaq] = useState<string>("");
  const [faqSuccess, setFaqSuccess] = useState(false);
  const faqTimeoutRef = useRef<number | null>(null);
  const [testRunning, setTestRunning] = useState(false);
  const [testResults, setTestResults] = useState<{ q: string; reply: string; ok: boolean }[]>([]);
  const currentYear = new Date().getFullYear();
  const [holidayYear, setHolidayYear] = useState<number>(currentYear);
  const [onboardingDirty, setOnboardingDirty] = useState(false);
  const [onboarding, setOnboarding] = useState({
    restaurantName: "",
    address: "",
    distance: "",
    phone: "",
    email: "",
    payment: "",
    allergies: "",
    kidsChair: false,
    kidsMenu: false,
    kidsNote: "",
    wheelchair: false,
    outdoorSeating: false,
    dogFriendly: false,
    alcoholLicense: false,
    kitchenCloseMinutes: "",
    restaurantType: "",
    restaurantDescription: "",
    foodType: "",
    groupEvents: "",
    pets: "",
    parking: "",
    transport: "",
  });
  const [onboardingFaqs, setOnboardingFaqs] = useState<{ q: string; a: string }[]>([]);
  const [showTemplate, setShowTemplate] = useState(false);
  const onboardInitRef = useRef(false);

  const fetchRestaurantFromApi = async (token: string) => {
    const resp = await fetch("/api/restaurant", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error(data?.error || `Kunde inte hämta restaurang (${resp.status})`);
    }
    return data as { restaurantId: string | null; role?: string | null; name?: string | null };
  };

  const createRestaurantFromApi = async (token: string, name: string) => {
    const resp = await fetch("/api/restaurant", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error(data?.error || `Kunde inte skapa restaurang (${resp.status})`);
    }
    return data as { restaurantId: string | null; role?: string | null; name?: string | null };
  };

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
    "Har ni alkoholtillstånd?",
    "Har ni lunchmeny?",
    "Kan man boka bord online?",
    "Vilken adress har ni?",
    "Hur kontaktar man er?",
  ];
  const extendedFaqs = [
    "Har ni brunch på helgerna?",
    "Kan vi boka ett fönsterbord?",
    "Finns det tystare bord för möten?",
    "Har ni barnvänliga rätter?",
    "Har ni en fast meny?",
    "Kan man få kvitto via e‑post?",
    "Finns det laddning för elbil i närheten?",
    "Är ni öppna på helgdagar?",
    "Har ni presentkort?",
    "Tar ni emot företagsevent?",
    "Kan man ändra eller avboka en bokning?",
    "Hur långt i förväg kan man boka?",
    "Är köket öppet hela öppettiden?",
    "Finns det allergivänliga alternativ?",
    "Kan vi ta med egen tårta?",
    "Har ni privat rum?",
  ];

  const addCoreFaqs = () => {
    commonFaqs.forEach((q) => addOnboardingFaq(q));
  };

  const knowledgeTemplate = useMemo(() => {
    const lines = [
      "INFOS:",
      "Namn: ...",
      "Typ av restaurang: ...",
      "Adress: ...",
      "Avstånd: ... (ex: 12 km från Göteborg)",
      "E-post: ...",
      "Telefon: ...",
      "Webbplats: ...",
      "Beskrivning / stämning: ...",
      "Mat & meny: ...",
      "Grupp & event: ...",
      "Betalning: ...",
      "Allergier: ...",
      "Barn: barnstol, barnmeny",
      "Uteservering: Ja/Nej",
      "Hundvänligt: Ja/Nej",
      "Rullstolsanpassad: Ja/Nej",
      "Alkoholtillstånd: Ja/Nej",
      "Köket stänger: ... min före stängning",
      "Max gäster per bokning: ... (vid X gäster eller fler, kontakta oss på ...)",
      "Djurpolicy: ...",
      "Parkering: ...",
      "Kollektivtrafik: ...",
      "",
      ...commonFaqs.flatMap((q) => [`FRÅGA: ${q}`, "SVAR: ...", ""]),
    ];
    return lines.join("\n").trim();
  }, []);

  const addOnboardingFaq = (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setOnboardingFaqs((prev) => {
      if (prev.some((x) => x.q.toLowerCase() === trimmed.toLowerCase())) return prev;
      return [...prev, { q: trimmed, a: "" }];
    });
    setOnboardingDirty(true);
  };

  const generateCommonQuestion = () => {
    const existing = new Set(onboardingFaqs.map((x) => x.q.toLowerCase()));
    const common = new Set(commonFaqs.map((x) => x.toLowerCase()));
    const available = extendedFaqs.filter((q) => !existing.has(q.toLowerCase()) && !common.has(q.toLowerCase()));
    const pool = available.length ? available : extendedFaqs.filter((q) => !existing.has(q.toLowerCase()));
    const pick = pool.length ? pool[Math.floor(Math.random() * pool.length)] : extendedFaqs[Math.floor(Math.random() * extendedFaqs.length)];
    addOnboardingFaq(pick);
  };

  const buildKnowledge = (data: typeof onboarding, faqs: { q: string; a: string }[], webSearch: Settings["ai"]["webSearch"]) => {
    const web = webSearch?.enabled ? webSearch : null;
    const kidsParts = [
      data.kidsChair ? "barnstol" : "",
      data.kidsMenu ? "barnmeny" : "",
      data.kidsNote ? `barnmeny: ${data.kidsNote}` : "",
    ].filter(Boolean);
    const kidsLine = kidsParts.length ? `Barn: ${kidsParts.join(", ")}` : "";
    const kitchenCloseLine = data.kitchenCloseMinutes
      ? `Köket stänger: ${data.kitchenCloseMinutes} min före stängning`
      : "";
    const contactEmail = config.info.email || config.notifications.to || "";
    const maxPer = config.escalation.maxGuestsPerReservation;
    const groupLine =
      contactEmail && maxPer > 0
        ? `Max gäster per bokning: ${maxPer}. Vid ${maxPer} gäster eller fler, kontakta oss på ${contactEmail}.`
        : "";
    const lines = [
      "INFOS:",
      data.restaurantName ? `Namn: ${data.restaurantName}` : "",
      data.restaurantType ? `Typ av restaurang: ${data.restaurantType}` : "",
      data.address ? `Adress: ${data.address}` : "",
      data.distance ? `Avstånd: ${data.distance}` : "",
      data.email ? `E-post: ${data.email}` : "",
      data.phone ? `Telefon: ${data.phone}` : "",
      web?.siteUrl ? `Webbplats: ${web.siteUrl}` : "",
      web?.googleMapsUrl ? `Google Maps: ${web.googleMapsUrl}` : "",
      web?.facebookUrl ? `Facebook: ${web.facebookUrl}` : "",
      web?.instagramUrl ? `Instagram: ${web.instagramUrl}` : "",
      data.restaurantDescription ? `Beskrivning: ${data.restaurantDescription}` : "",
      data.foodType ? `Mat: ${data.foodType}` : "",
      data.groupEvents ? `Grupp & event: ${data.groupEvents}` : "",
      data.payment ? `Betalning: ${data.payment}` : "",
      data.allergies ? `Allergier: ${data.allergies}` : "",
      kidsLine,
      data.outdoorSeating ? "Uteservering: Ja" : "Uteservering: Nej",
      data.dogFriendly ? "Hundvänligt: Ja" : "Hundvänligt: Nej",
      data.wheelchair ? "Rullstolsanpassad: Ja" : "Rullstolsanpassad: Nej",
      data.alcoholLicense ? "Alkoholtillstånd: Ja" : "Alkoholtillstånd: Nej",
      kitchenCloseLine,
      groupLine,
      data.pets ? `Djurpolicy: ${data.pets}` : "",
      data.parking ? `Parkering: ${data.parking}` : "",
      data.transport ? `Kollektivtrafik: ${data.transport}` : "",
      "",
    ].filter((x) => x !== "");
    const qa = faqs.flatMap((f) => [`FRÅGA: ${f.q}`, `SVAR: ${f.a || ""}`, ""]);
    return [...lines, ...qa].join("\n").trim();
  };

  const buildPublicKnowledge = (base: string, webSearch: Settings["ai"]["webSearch"]) => {
    const lines = (base || "").split(/\r?\n/).map((l) => l.trim());
    const getLabelValue = (label: string) => {
      const line = lines.find((l) => l.toLowerCase().startsWith(label.toLowerCase() + ":"));
      if (!line) return "";
      return line.split(":").slice(1).join(":").trim();
    };
    const hasValue = (label: string) => Boolean(getLabelValue(label));
    const append = (label: string, value?: string) => {
      if (!value || hasValue(label)) return;
      lines.push(`${label}: ${value}`);
    };
    if (webSearch?.enabled) {
      append("Webbplats", webSearch.siteUrl || "");
      append("Google Maps", webSearch.googleMapsUrl || "");
      append("Facebook", webSearch.facebookUrl || "");
      append("Instagram", webSearch.instagramUrl || "");
    }
    const contactEmail = config.info.email || config.notifications.to || "";
    const maxPer = config.escalation.maxGuestsPerReservation;
    if (contactEmail && maxPer > 0) {
      append(
        "Max gäster per bokning",
        `Vid ${maxPer} gäster eller fler, kontakta oss på ${contactEmail}.`
      );
    }
    return lines.filter(Boolean).join("\n").trim();
  };

  useEffect(() => {
    if (!onboardingDirty) return;
    const next = buildKnowledge(onboarding, onboardingFaqs, config.ai.webSearch);
    setConfig((prev) => ({ ...prev, ai: { ...prev.ai, knowledge: next } }));
  }, [
    onboarding,
    onboardingFaqs,
    onboardingDirty,
    config.ai.webSearch.enabled,
    config.ai.webSearch.siteUrl,
    config.ai.webSearch.googleMapsUrl,
    config.ai.webSearch.facebookUrl,
    config.ai.webSearch.instagramUrl,
    config.escalation.maxGuestsPerReservation,
    config.info.email,
    config.notifications.to,
  ]);

  useEffect(() => {
    if (onboardingDirty) return;
    if (onboardInitRef.current) return;
    const k = config.ai.knowledge || "";
    if (!k.trim()) return;
    const lines = k.split(/\r?\n/).map((l) => l.trim());
    const data = { ...onboarding };
    const mapField = (label: string) => {
      const line = lines.find((l) => l.toLowerCase().startsWith(label.toLowerCase() + ":"));
      return line ? line.split(":").slice(1).join(":").trim() : "";
    };
    data.restaurantName = mapField("Namn");
    data.address = mapField("Adress");
    data.distance = mapField("Avstånd") || mapField("Distance");
    data.phone = mapField("Telefon");
    data.email = mapField("E-post");
    data.restaurantType = mapField("Typ av restaurang");
    data.restaurantDescription = mapField("Beskrivning") || mapField("Stämning");
    data.foodType = mapField("Mat") || mapField("Mat & meny");
    data.groupEvents = mapField("Grupp & event");
    data.payment = mapField("Betalning");
    data.allergies = mapField("Allergier");
    data.kitchenCloseMinutes = mapField("Köket stänger").match(/\d+/)?.[0] || "";
    const barnLine = mapField("Barn");
    const barnstolField = mapField("Barnstol");
    const barnmenyField = mapField("Barnmeny");
    const barnTokens = barnLine
      .split(/[,;]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    const hasBarnstol = /barnstol/i.test(barnLine) || /^(ja|yes|true)$/i.test(barnstolField);
    const barnmenyMatch = barnLine.match(/barnmeny\s*:\s*([^,;]+)/i);
    const barnmenyText = barnmenyField || (barnmenyMatch ? barnmenyMatch[1].trim() : "");
    const hasBarnmeny = /barnmeny/i.test(barnLine) || /^(ja|yes|true)$/i.test(barnmenyField) || !!barnmenyText;
    data.kidsChair = hasBarnstol;
    data.kidsMenu = hasBarnmeny;
    data.kidsNote = barnmenyText || barnTokens.filter((t) => !/barnstol|barnmeny/i.test(t)).join(", ");
    data.outdoorSeating = /^(ja|yes|true)$/i.test(mapField("Uteservering"));
    data.dogFriendly = /^(ja|yes|true)$/i.test(mapField("Hundvänligt"));
    data.wheelchair = /^(ja|yes|true)$/i.test(mapField("Rullstolsanpassad"));
    data.alcoholLicense = /^(ja|yes|true)$/i.test(mapField("Alkoholtillstånd"));
    data.pets = mapField("Djurpolicy");
    data.parking = mapField("Parkering");
    data.transport = mapField("Kollektivtrafik");

    const faqs: { q: string; a: string }[] = [];
    let curQ: string | null = null;
    for (const l of lines) {
      if (l.toLowerCase().startsWith("fråga:")) {
        curQ = l.slice(6).trim();
        continue;
      }
      if (l.toLowerCase().startsWith("svar:") && curQ) {
        const ans = l.slice(5).trim();
        faqs.push({ q: curQ, a: ans });
        curQ = null;
      }
    }
    setOnboarding(data);
    setOnboardingFaqs(faqs);
    onboardInitRef.current = true;
  }, [config.ai.knowledge, onboardingDirty]);

  const knowledgeScore = useMemo(() => {
    const k = (config.ai.knowledge || "").toLowerCase();
    const anyOpenDay = (config.hours.periods?.length
      ? config.hours.periods.some((p) => DAYS_ORDER.some((d) => !p.days[d].closed))
      : DAYS_ORDER.some((d) => !config.hours.normal[d].closed));
    const checks = [
      { key: "Öppettider", ok: anyOpenDay },
      { key: "Adress", ok: /adress/.test(k) },
      { key: "Telefon", ok: /telefon|tel|phone/.test(k) },
      { key: "E-post", ok: /e-post|email|mail/.test(k) },
      { key: "Bordsbokningstid", ok: config.seating.maxBookingDurationMin > 0 },
      { key: "Max gäster", ok: config.seating.maxGuests > 0 },
      { key: "Betalning", ok: /betala|kort|kontant|swish|visa|mastercard|amex/.test(k) },
      { key: "Allergier", ok: /allergi|gluten|laktos|nöt/.test(k) },
      { key: "Barn", ok: /barnstol|barnvagn|barnmeny|barn/.test(k) },
      { key: "Djurpolicy", ok: /hund|djur|terrass/.test(k) },
      { key: "Uteservering", ok: /uteservering/.test(k) },
      { key: "Rullstol", ok: /rullstol/.test(k) },
      { key: "Alkohol", ok: /alkohol/.test(k) },
      { key: "Kök stänger", ok: /kök\s*stänger/.test(k) },
      { key: "Restaurangtyp", ok: /typ\s+av\s+restaurang/.test(k) },
      { key: "Mat", ok: /mat:|serverar/.test(k) },
      { key: "Stämning", ok: /beskrivning|stämning/.test(k) },
      { key: "Parkering", ok: /parkering/.test(k) },
      { key: "Kollektivtrafik", ok: /kollektivtrafik|buss|tunnelbana|tram|spårvagn/.test(k) },
    ];
    const ok = checks.filter((c) => c.ok).length;
    const score = Math.round((ok / checks.length) * 100);
    const missing = checks.filter((c) => !c.ok).map((c) => c.key);
    return { score, missing };
  }, [config.ai.knowledge, config.hours, config.seating]);

  const draftFaqs = useMemo(() => onboardingFaqs.filter((f) => !f.a?.trim()), [onboardingFaqs]);

  const callAi = async (text: string) => {
    const r = await fetch("/api/ai", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify({
        message: text,
        knowledge: buildPublicKnowledge(config.ai?.knowledge ?? "", config.ai.webSearch),
        history: aiHistory,
        context: {
          baseDate: dateSel,
          nowTime: `${pad2(new Date().getHours())}:${pad2(new Date().getMinutes())}`,
          restaurant: {
            name: onboarding.restaurantName || restaurantName || "",
            address: onboarding.address || "",
            email: onboarding.email || config.info.email || config.notifications.to || "",
            website: config.ai.webSearch.siteUrl || "",
            facebook: config.ai.webSearch.facebookUrl || "",
            instagram: config.ai.webSearch.instagramUrl || "",
            googleMaps: config.ai.webSearch.googleMapsUrl || "",
          },
          seating: {
            maxGuests: config.seating.maxGuests,
            maxGuestsPerReservation: config.escalation.maxGuestsPerReservation,
            groupThreshold: config.seating.groupThreshold,
            maxBookingDurationMin: config.seating.maxBookingDurationMin,
          },
          hours: {
            normal: config.hours.normal,
            special: config.hours.special,
            periods: config.hours.periods,
          },
          tables: tableCaps.map((t) => t.cap),
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
    const raw = await r.text();
    let data: { reply?: string; error?: string } = {};
    try {
      data = raw ? (JSON.parse(raw) as { reply?: string; error?: string }) : {};
    } catch {
      data = {};
    }
    if (!r.ok) {
      throw new Error(data?.error || raw || "AI error");
    }
    return data.reply || "Inget svar.";
  };

  const runAiTests = async () => {
    const prompts = [
      "öppet måndag?",
      "Har ni öppet på Måndag?",
      "Öppettider?",
      "Vegan?",
      "Har ni veganska alternativ?",
      "Glutenfritt?",
      "Laktosfritt?",
      "Parkering?",
      "Tar ni Swish?",
      "Tar ni kontanter?",
      "Tar ni kort?",
      "Finns barnstolar?",
      "Barnvagn?",
      "Hundar tillåtna?",
      "Hur länge är en bordsbokning?",
      "Boka bord för 4 imorgon kl 19",
      "Boka bord för 12 på fredag kl 18",
      "Var ligger ni?",
      "Vad heter ägaren till OpenAI?",
    ];
    setTestRunning(true);
    setTestResults([]);
    const out: { q: string; reply: string; ok: boolean }[] = [];
    for (const q of prompts) {
      try {
        const reply = await callAi(q);
        const ok =
          !/Jag kan tyvärr bara svara på frågor om restaurangen\./i.test(reply) &&
          !/Jag kan tyvärr inte svara säkert/i.test(reply) &&
          !/Fel vid AI-anrop\./i.test(reply);
        out.push({ q, reply, ok });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "AI error";
        out.push({ q, reply: `Fel vid AI-anrop. ${msg}`.trim(), ok: false });
      }
    }
    setTestResults(out);
    setTestRunning(false);
  };

  const addFaq = () => {
    const q = newFaq.trim();
    if (!q) return;
    addOnboardingFaq(q);

    setNewFaq("");
    if (faqTimeoutRef.current) window.clearTimeout(faqTimeoutRef.current);
    setFaqSuccess(true);
    faqTimeoutRef.current = window.setTimeout(() => {
      setFaqSuccess(false);
    }, 1000);
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
    if (config.escalation.maxGuestsPerReservation > 0 && guests >= config.escalation.maxGuestsPerReservation) {
      const contactEmail = config.info.email || config.notifications.to || "";
      return `För ${guests} gäster behöver ni kontakta oss direkt${contactEmail ? ` på ${contactEmail}` : ""}.`;
    }

    const tableId = findAvailableTable({
      date: dateSel,
      time: "12:00",
      guests,
      bookings,
      durationMin: config.seating.maxBookingDurationMin,
      tables: tableCaps,
      mealRanges,
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
  const [formTableId, setFormTableId] = useState<number | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (createOpen) {
      setFormDate(dateSel);
      setFormTime("12:00");
      setFormName("");
      setFormGuests(2);
      setFormNotes("");
      setFormTableId(null);
      setFormError(null);
    }
  }, [createOpen, dateSel]);

  function createReservation(d: { date: string; time: string; name: string; guests: number; notes?: string; tableId?: number | null }) {
    if (!d.name.trim()) return { ok: false, error: "Namn krävs." };
    if (!d.date) return { ok: false, error: "Datum krävs." };
    if (!d.time) return { ok: false, error: "Tid krävs." };
    if (d.guests < 1) return { ok: false, error: "Ogiltigt antal gäster." };
    if (config.escalation.maxGuestsPerReservation > 0 && d.guests >= config.escalation.maxGuestsPerReservation) {
      const contactEmail = config.info.email || config.notifications.to || "";
      return {
        ok: false,
        error: `För ${d.guests} gäster behöver ni kontakta oss direkt${contactEmail ? ` på ${contactEmail}` : ""}.`,
      };
    }

    const when = round30(d.time);
    const durationMin = config.seating.maxBookingDurationMin;
    let tableId = d.tableId ?? null;
    if (tableId != null) {
      const table = tableCaps.find((t) => t.id === tableId);
      if (!table) return { ok: false, error: "Valt bord finns inte." };
      if (table.cap < d.guests) return { ok: false, error: `Valt bord har bara ${table.cap} platser.` };
      if (!isTableAvailable({ date: d.date, time: when, tableId, bookings, durationMin, mealRanges })) {
        return { ok: false, error: "Valt bord är redan upptaget vid den tiden." };
      }
    } else {
      tableId = findAvailableTable({ date: d.date, time: when, guests: d.guests, bookings, durationMin, tables: tableCaps, mealRanges });
      if (tableId == null) return { ok: false, error: "Ingen ledig passande bord i detta tidsintervall." };
    }

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
    if (restaurantId && settingsReady) {
      (async () => {
        const { data } = await supabase
          .from("bookings")
          .insert({
            restaurant_id: restaurantId,
            date: b.date,
            time: b.time,
            name: b.name,
            guests: b.guests,
            notes: b.notes || null,
            table_id: b.tableId ?? null,
            duration_min: b.durationMin ?? config.seating.maxBookingDurationMin,
            status: b.status ?? "confirmed",
            source: b.source ?? "walkin",
          })
          .select("id")
          .single();
        if (data?.id) {
          setBookings((prev) =>
            assignTablesForDateWithTables(
              d.date,
              prev.map((x) => (x.id === b.id ? { ...x, id: data.id } : x)),
              tableCaps,
              mealRanges
            )
          );
        }
      })().catch(() => {});
    }

    setBookings((prev) => assignTablesForDateWithTables(d.date, [...prev, b], tableCaps, mealRanges));
    return { ok: true };
  }

  const handleCreate = () => {
    const res = createReservation({
      date: formDate,
      time: formTime,
      name: formName,
      guests: formGuests,
      notes: formNotes,
      tableId: formTableId,
    });
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

  const addHoursPeriod = () => {
    setConfig((prev) => {
      const baseDays = prev.hours.periods?.[0]?.days ?? prev.hours.normal;
      const next = [...(prev.hours.periods ?? []), makeHoursPeriod(baseDays, undefined, undefined, `Period ${prev.hours.periods.length + 1}`)];
      return { ...prev, hours: { ...prev.hours, periods: next } };
    });
  };

  const removeHoursPeriod = (id: string) => {
    setConfig((prev) => {
      const next = (prev.hours.periods ?? []).filter((p) => p.id !== id);
      if (!next.length) return prev;
      return { ...prev, hours: { ...prev.hours, periods: next } };
    });
  };
  // --- Custom closures (manual dates / periods)
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

  const closedRanges = useMemo(() => {
    const dates = config.hours.special
      .filter((s) => s.closed)
      .map((s) => s.date)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    if (!dates.length) return [] as { from: string; to: string; count: number }[];
    const out: { from: string; to: string; count: number }[] = [];
    let start = dates[0];
    let prev = dates[0];
    let count = 1;
    const toDate = (iso: string) => new Date(iso + "T00:00:00Z");
    const nextDay = (iso: string) => {
      const d = toDate(iso);
      d.setUTCDate(d.getUTCDate() + 1);
      return d.toISOString().slice(0, 10);
    };
    for (let i = 1; i < dates.length; i++) {
      const d = dates[i];
      if (d === nextDay(prev)) {
        prev = d;
        count += 1;
      } else {
        out.push({ from: start, to: prev, count });
        start = d;
        prev = d;
        count = 1;
      }
    }
    out.push({ from: start, to: prev, count });
    return out;
  }, [config.hours.special]);

  const removeClosedRange = (from: string, to: string) => {
    setConfig((prev) => {
      const toDate = (iso: string) => new Date(iso + "T00:00:00");
      const start = toDate(from);
      const end = toDate(to);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return prev;
      const keep = prev.hours.special.filter((s) => {
        if (!s.closed) return true;
        const d = toDate(s.date);
        return d < start || d > end;
      });
      return { ...prev, hours: { ...prev.hours, special: keep } };
    });
  };

  const handleMagicLink = async () => {
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

  const handlePasswordLogin = async () => {
    const email = authEmail.trim();
    const password = authPassword;
    if (!email || !password) return;
    setAuthLoading(true);
    setAuthMsg(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setAuthLoading(false);
    setAuthMsg(error ? `Inloggning misslyckades: ${error.message}` : null);
  };

  const handleGoogleLogin = async () => {
    setAuthLoading(true);
    setAuthMsg(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/dashboard` },
    });
    if (error) {
      setAuthLoading(false);
      setAuthMsg(`Inloggning misslyckades: ${error.message}`);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const email = params.get("email");
    if (email) setAuthEmail(email);
  }, [location.search]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const settingsDateInputClass =
    "mt-1 w-full min-w-0 max-w-[150px] mx-auto rounded-lg border border-gray-300 px-2 py-1.5 text-center text-xs focus:outline-none focus:ring-2 focus:ring-pink-400 focus:border-pink-300 sm:mx-0 sm:max-w-none sm:text-base sm:px-3 sm:py-2";
  const settingsTimeInputClass =
    "w-full min-w-0 max-w-[110px] mx-auto rounded-md border border-gray-300 px-2 py-1 text-center text-[11px] disabled:opacity-60 sm:mx-0 sm:max-w-none sm:text-sm";
  const settingsTimeGridClass =
    "grid grid-cols-2 gap-1 justify-items-center sm:gap-2 sm:justify-items-stretch";

  if (!session) {
    return (
      <div className="min-h-screen bg-pink-50 p-6 flex items-center justify-center">
        <div className="w-full max-w-md rounded-2xl border border-pink-200 bg-white p-6 shadow-lg">
          <h1 className="text-2xl font-bold text-gray-900">Logga in</h1>
          <p className="mt-1 text-sm text-gray-600">Logga in med Google, lösenord eller magisk länk.</p>
          <label className="mt-4 block text-sm font-semibold text-gray-700">E‑post</label>
          <input
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-pink-400 focus:border-pink-300"
            value={authEmail}
            onChange={(e) => setAuthEmail(e.target.value)}
            placeholder="name@restaurant.se"
          />
          <label className="mt-4 block text-sm font-semibold text-gray-700">Lösenord</label>
          <input
            type="password"
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-pink-400 focus:border-pink-300"
            value={authPassword}
            onChange={(e) => setAuthPassword(e.target.value)}
            placeholder="••••••••"
            onKeyDown={(e) => {
              if (e.key === "Enter") handlePasswordLogin();
            }}
          />
          <button
            className="mt-4 w-full rounded-lg bg-pink-600 px-4 py-2 font-semibold text-white hover:bg-pink-700 disabled:opacity-60"
            onClick={handlePasswordLogin}
            disabled={authLoading || !authEmail || !authPassword}
          >
            Logga in
          </button>
          <button
            className="mt-3 w-full rounded-lg border border-pink-300 px-4 py-2 font-semibold text-pink-700 hover:bg-pink-50 disabled:opacity-60"
            onClick={handleGoogleLogin}
            disabled={authLoading}
          >
            Logga in med Google
          </button>
          <button
            className="mt-3 w-full rounded-lg border border-gray-300 px-4 py-2 font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
            onClick={handleMagicLink}
            disabled={authLoading || !authEmail}
          >
            Skicka magisk länk
          </button>
          {authMsg ? <div className="mt-3 text-sm text-gray-700">{authMsg}</div> : null}
          {accessDenied ? <div className="mt-3 text-sm text-rose-700">{accessDenied}</div> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-pink-50 p-6">
      <header className="-mx-1 mb-8 rounded-2xl bg-gradient-to-br from-[#2b0a4f] via-[#4b0c73] to-[#c0167a] px-6 py-10 text-white shadow-lg relative overflow-hidden">
        <img
          src={forkTransparent}
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute right-16 top-1/2 hidden md:block h-64 lg:h-72 w-auto -translate-y-1/2 opacity-95"
        />
        <div className="max-w-6xl mx-auto text-center relative">
          <div className="flex items-center justify-center gap-4">
            <h1 className="text-4xl md:text-6xl font-black tracking-tight">Dashboard</h1>
          </div>
          <p className="mt-3 text-lg md:text-xl text-white/85 max-w-2xl mx-auto">Övervaka bokningar, gäster och AI-svar i realtid.</p>
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
            <button
              className="rounded-full px-6 py-3 font-semibold text-white/90 bg-white/10 border border-white/20 hover:bg-white/15"
              onClick={handleLogout}
            >
              Logga ut
            </button>
          </div>
        </div>
      </header>

      {newBookingCount > 0 ? (
        <div className="mb-4">
          <div
            className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-[#e6007a] bg-[#e6007a] px-4 py-3 text-sm text-white shadow-sm"
            onClick={() => setShowNewBookings((prev) => !prev)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") setShowNewBookings((prev) => !prev);
            }}
          >
            <span>
              {newBookingDetail ??
                (newBookingCount === 1
                  ? "1 ny bokning mottagen."
                  : `${newBookingCount} nya bokningar mottagna.`)}
            </span>
            <button
              className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-full text-white/90 hover:bg-white/15"
              onClick={(e) => {
                e.stopPropagation();
                setNewBookingCount(0);
                setNewBookingDetail(null);
                setNewBookingItems([]);
                setShowNewBookings(false);
              }}
              aria-label="Stäng"
              type="button"
            >
              ×
            </button>
          </div>
          {showNewBookings && newBookingItems.length ? (
            <div className="mt-2 rounded-xl border border-pink-200 bg-white/90 px-4 py-3 text-sm text-gray-700">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-pink-700">Nya bokningar</div>
              <div className="space-y-1">
                {newBookingItems.map((b) => (
                  <div key={b.id} className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-medium text-gray-900">
                      {b.date} · {b.time}
                    </div>
                    <div className="text-gray-600">
                      {b.guests} gäster{b.name ? ` · ${b.name}` : ""}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mb-6 flex flex-wrap gap-2">
        <button
          className={`px-4 py-2 rounded-full text-sm font-semibold border ${
            activeTab === "overview" ? "bg-white text-pink-700 border-pink-300" : "bg-pink-100 text-pink-700 border-pink-200"
          }`}
          onClick={() => setActiveTab("overview")}
        >
          Översikt
        </button>
        <button
          className={`px-4 py-2 rounded-full text-sm font-semibold border ${
            activeTab === "tableplan" ? "bg-white text-pink-700 border-pink-300" : "bg-pink-100 text-pink-700 border-pink-200"
          }`}
          onClick={() => setActiveTab("tableplan")}
        >
          Tableplan
        </button>
      </div>

      {activeTab === "overview" ? (
        <>
          {/* Top stats */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <Stat icon="📅" label="Bokningar idag" value={String(dayBookings.length)} />
            <Stat icon="👥" label="Antal gäster idag" value={String(totalGuestsDay)} />
            <Stat icon="🕒" label="Mest bokade tid" value={busiestLeast.max} />
            <Stat icon="🕘" label="Minst bokade tid" value={busiestLeast.min} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <Stat icon="💗" label="Stammiskunder" value="0" />
            <Stat
              icon={<img src={forkTransparent} alt="Bokata" className="h-4 w-4" />}
              label="Svar skickade av AI"
              value="0"
              sub="denna vecka"
            />
            <Stat icon="📈" label="Totalt denna vecka" value={String(weekStats.curGuests)} sub="gäster" />
            <Stat
              icon="↕️"
              label="Vs förra veckan"
              value={`${weekStats.diff >= 0 ? "+" : ""}${weekStats.diff} gäster`}
              sub={weekStats.pct != null ? `${weekStats.pct >= 0 ? "+" : ""}${weekStats.pct}%` : "—"}
            />
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
                const isClosed = isClosedDate(dateStr);
                const hasBooking = bookingDates.has(dateStr);
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
                    <div className="text-sm font-semibold flex items-center gap-1">
                      {c.day}
                      {hasBooking ? <span className="text-[9px] leading-none">🔴</span> : null}
                    </div>
                    {isClosed && <div className="text-[10px] text-gray-500">Stängt</div>}
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

            {activeMeal !== "Alla" && (
              <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-gray-600">
                <span className="font-semibold text-gray-600">Tider för {activeMeal}:</span>
                <input
                  type="time"
                  className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700"
                  value={mealRanges[activeMeal as MealKey][0]}
                  onChange={(e) => updateMealRange(activeMeal as MealKey, 0, e.target.value)}
                />
                <span className="text-gray-400">–</span>
                <input
                  type="time"
                  className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700"
                  value={mealRanges[activeMeal as MealKey][1]}
                  onChange={(e) => updateMealRange(activeMeal as MealKey, 1, e.target.value)}
                />
              </div>
            )}

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
                                "cursor-pointer hover:brightness-95"
                              }`}
                              onClick={() => setOpenBooking(b)}
                              title={b.note ? "Visa anteckning" : "Redigera bokning"}
                            >
                              <div className="flex items-center gap-2 font-medium">
                                <span>{b.name}</span>
                                {b.note && (
                                  <span
                                    className="inline-flex items-center rounded-full bg-pink-200 text-pink-800 text-[10px] px-2 py-0.5 font-semibold"
                                    title={b.notes || "Särskilt önskemål"}
                                  >
                                    📎
                                  </span>
                                )}
                              </div>
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
        </>
      ) : (
        <div className="bg-white shadow rounded-lg p-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-bold text-gray-700">Tableplan</h3>
              <p className="text-sm text-gray-500">Dra och släpp bord samt zoner.</p>
            </div>
            <div className="flex gap-2">
              <button
                className="px-3 py-2 rounded-lg border border-pink-200 text-pink-700 bg-pink-50 hover:bg-pink-100 text-sm disabled:opacity-60"
                disabled={restaurantRole !== "owner"}
                onClick={() =>
                  setFloorplan((prev) => ({
                    ...prev,
                    tables: [
                      ...prev.tables,
                      {
                        id: uid(),
                        x: 80,
                        y: 80,
                        ...tableSizeForSeats(4),
                        seats: 4,
                        label: `T${prev.tables.length + 1}`,
                        orientation: "h",
                      },
                    ],
                  }))
                }
              >
                + Bord
              </button>
              <button
                className="px-3 py-2 rounded-lg border border-pink-200 text-pink-700 bg-pink-50 hover:bg-pink-100 text-sm disabled:opacity-60"
                disabled={restaurantRole !== "owner"}
                onClick={() =>
                  setFloorplan((prev) => ({
                    ...prev,
                    zones: [
                      ...prev.zones,
                      { id: uid(), x: 460, y: 90, w: 260, h: 140, name: `Zon ${prev.zones.length + 1}` },
                    ],
                  }))
                }
              >
                + Zon
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
            <div className="lg:col-span-3">
              <div className="w-full overflow-x-auto">
                <div
                  ref={canvasRef}
                  className="relative rounded-2xl border border-pink-200 bg-gradient-to-br from-pink-50 to-purple-50 overflow-hidden"
                  style={{ width: floorplan.width, height: floorplan.height }}
                >
                  {floorplan.zones.map((z) => (
                    <div
                      key={z.id}
                      onPointerDown={(e) => {
                        if (restaurantRole !== "owner") return;
                        const rect = canvasRef.current?.getBoundingClientRect();
                        if (!rect) return;
                        setSelectedItem({ type: "zone", id: z.id });
                        setDragging({
                          type: "zone",
                          id: z.id,
                          offsetX: e.clientX - rect.left - z.x,
                          offsetY: e.clientY - rect.top - z.y,
                        });
                      }}
                      className={`absolute rounded-xl border-2 border-dashed ${
                        selectedItem?.type === "zone" && selectedItem.id === z.id ? "border-pink-400" : "border-pink-200"
                      } bg-white/60`}
                      style={{ left: z.x, top: z.y, width: z.w, height: z.h }}
                    >
                      <div className="text-xs font-semibold text-pink-700 px-2 py-1">{z.name}</div>
                    </div>
                  ))}
                  {floorplan.tables.map((t) => (
                    (() => {
                      const size = tableSizeForSeats(t.seats || 0, t.orientation ?? "h");
                      return (
                    <div
                      key={t.id}
                      onPointerDown={(e) => {
                        if (restaurantRole !== "owner") return;
                        const rect = canvasRef.current?.getBoundingClientRect();
                        if (!rect) return;
                        setSelectedItem({ type: "table", id: t.id });
                        setDragging({
                          type: "table",
                          id: t.id,
                          offsetX: e.clientX - rect.left - t.x,
                          offsetY: e.clientY - rect.top - t.y,
                        });
                      }}
                      className={`absolute rounded-xl border ${
                        selectedItem?.type === "table" && selectedItem.id === t.id ? "border-pink-500" : "border-pink-300"
                      } bg-white shadow-sm flex items-center justify-center`}
                      style={{ left: t.x, top: t.y, width: size.w, height: size.h }}
                    >
                      <div className="text-center">
                        <div className="text-xs font-semibold text-gray-700">{t.label || "Bord"}</div>
                        <div className="text-[11px] text-gray-500">{t.seats} platser</div>
                      </div>
                    </div>
                      );
                    })()
                  ))}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-pink-200 bg-white p-4">
              <div className="text-sm font-semibold text-gray-700 mb-3">Egenskaper</div>
              {restaurantRole !== "owner" ? (
                <div className="text-xs text-gray-500 mb-3">Endast ägaren kan redigera tableplan.</div>
              ) : null}
              {selectedItem ? (
                selectedItem.type === "table" ? (
                  (() => {
                    const t = floorplan.tables.find((x) => x.id === selectedItem.id);
                    if (!t) return null;
                    return (
                      <div className="space-y-3 text-sm">
                        <Field label="Label">
                          <input
                            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
                            value={t.label ?? ""}
                            disabled={restaurantRole !== "owner"}
                            onChange={(e) =>
                              setFloorplan((prev) => ({
                                ...prev,
                                tables: prev.tables.map((x) => (x.id === t.id ? { ...x, label: e.target.value } : x)),
                              }))
                            }
                          />
                        </Field>
                        <Field label="Platser">
                          <input
                            type="number"
                            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
                            value={t.seats}
                            disabled={restaurantRole !== "owner"}
                            onChange={(e) =>
                              setFloorplan((prev) => ({
                                ...prev,
                                tables: prev.tables.map((x) =>
                                  x.id === t.id
                                    ? {
                                        ...x,
                                        seats: Number(e.target.value) || 0,
                                        ...tableSizeForSeats(Number(e.target.value) || 0, x.orientation ?? "h"),
                                      }
                                    : x
                                ),
                              }))
                            }
                          />
                        </Field>
                        <Field label="Orientering">
                          <div className="mt-1 flex gap-2">
                            <button
                              type="button"
                              className={`px-3 py-2 rounded-lg border text-sm ${
                                (t.orientation ?? "h") === "h"
                                  ? "border-pink-400 bg-pink-50 text-pink-700"
                                  : "border-gray-300 text-gray-600"
                              }`}
                              disabled={restaurantRole !== "owner"}
                              onClick={() =>
                                setFloorplan((prev) => ({
                                  ...prev,
                                  tables: prev.tables.map((x) =>
                                    x.id === t.id
                                      ? {
                                          ...x,
                                          orientation: "h",
                                          ...tableSizeForSeats(x.seats || 0, "h"),
                                        }
                                      : x
                                  ),
                                }))
                              }
                            >
                              Horisontell
                            </button>
                            <button
                              type="button"
                              className={`px-3 py-2 rounded-lg border text-sm ${
                                (t.orientation ?? "h") === "v"
                                  ? "border-pink-400 bg-pink-50 text-pink-700"
                                  : "border-gray-300 text-gray-600"
                              }`}
                              disabled={restaurantRole !== "owner"}
                              onClick={() =>
                                setFloorplan((prev) => ({
                                  ...prev,
                                  tables: prev.tables.map((x) =>
                                    x.id === t.id
                                      ? {
                                          ...x,
                                          orientation: "v",
                                          ...tableSizeForSeats(x.seats || 0, "v"),
                                        }
                                      : x
                                  ),
                                }))
                              }
                            >
                              Vertikal
                            </button>
                          </div>
                        </Field>
                        <button
                          className="w-full rounded-lg border border-rose-200 bg-rose-50 text-rose-700 px-3 py-2 disabled:opacity-60"
                          disabled={restaurantRole !== "owner"}
                          onClick={() =>
                            setFloorplan((prev) => ({
                              ...prev,
                              tables: prev.tables.filter((x) => x.id !== t.id),
                            }))
                          }
                        >
                          Ta bort bord
                        </button>
                      </div>
                    );
                  })()
                ) : (
                  (() => {
                    const z = floorplan.zones.find((x) => x.id === selectedItem.id);
                    if (!z) return null;
                    return (
                      <div className="space-y-3 text-sm">
                        <Field label="Namn">
                          <input
                            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
                            value={z.name}
                            disabled={restaurantRole !== "owner"}
                            onChange={(e) =>
                              setFloorplan((prev) => ({
                                ...prev,
                                zones: prev.zones.map((x) => (x.id === z.id ? { ...x, name: e.target.value } : x)),
                              }))
                            }
                          />
                        </Field>
                        <div className="grid grid-cols-2 gap-2">
                          <Field label="Bredd">
                            <input
                              type="number"
                              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
                              value={z.w}
                              disabled={restaurantRole !== "owner"}
                              onChange={(e) =>
                                setFloorplan((prev) => ({
                                  ...prev,
                                  zones: prev.zones.map((x) =>
                                    x.id === z.id ? { ...x, w: Number(e.target.value) || 80 } : x
                                  ),
                                }))
                              }
                            />
                          </Field>
                          <Field label="Höjd">
                            <input
                              type="number"
                              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
                              value={z.h}
                              disabled={restaurantRole !== "owner"}
                              onChange={(e) =>
                                setFloorplan((prev) => ({
                                  ...prev,
                                  zones: prev.zones.map((x) =>
                                    x.id === z.id ? { ...x, h: Number(e.target.value) || 80 } : x
                                  ),
                                }))
                              }
                            />
                          </Field>
                        </div>
                        <button
                          className="w-full rounded-lg border border-rose-200 bg-rose-50 text-rose-700 px-3 py-2 disabled:opacity-60"
                          disabled={restaurantRole !== "owner"}
                          onClick={() =>
                            setFloorplan((prev) => ({
                              ...prev,
                              zones: prev.zones.filter((x) => x.id !== z.id),
                            }))
                          }
                        >
                          Ta bort zon
                        </button>
                      </div>
                    );
                  })()
                )
              ) : (
                <div className="text-xs text-gray-500">Klicka på ett bord eller en zon.</div>
              )}
            </div>
          </div>
        </div>
      )}

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

          <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Datum">
              <input
                type="date"
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-pink-400 focus:border-pink-300"
                value={editBookingDraft?.date ?? openBooking.date}
                onChange={(e) =>
                  setEditBookingDraft((prev) => ({ ...(prev ?? openBooking), date: e.target.value }))
                }
              />
            </Field>
            <Field label="Tid">
              <select
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-pink-400 focus:border-pink-300"
                value={editBookingDraft?.time ?? openBooking.time}
                onChange={(e) =>
                  setEditBookingDraft((prev) => ({ ...(prev ?? openBooking), time: e.target.value }))
                }
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
                value={editBookingDraft?.name ?? openBooking.name}
                onChange={(e) =>
                  setEditBookingDraft((prev) => ({ ...(prev ?? openBooking), name: e.target.value }))
                }
              />
            </Field>
            <Field label="Gäster">
              <input
                type="number"
                min={1}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-pink-400 focus:border-pink-300"
                value={editBookingDraft?.guests ?? openBooking.guests}
                onChange={(e) =>
                  setEditBookingDraft((prev) => ({
                    ...(prev ?? openBooking),
                    guests: Number(e.target.value || 1),
                  }))
                }
              />
            </Field>
            <Field label="Kommentar / önskemål">
              <textarea
                rows={3}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-pink-400 focus:border-pink-300"
                value={editBookingDraft?.notes ?? openBooking.notes ?? ""}
                onChange={(e) =>
                  setEditBookingDraft((prev) => ({ ...(prev ?? openBooking), notes: e.target.value }))
                }
              />
            </Field>
          </div>

          <div className="mt-5 flex flex-wrap justify-between gap-2">
            <button
              className="px-4 py-2 rounded-lg border border-red-200 text-red-600 hover:bg-red-50"
              onClick={() => {
                if (!window.confirm("Ta bort bokningen?")) return;
                setBookings((prev) => prev.filter((b) => b.id !== openBooking.id));
                if (restaurantId && settingsReady) {
                  supabase.from("bookings").delete().eq("id", openBooking.id).eq("restaurant_id", restaurantId);
                }
                setOpenBooking(null);
              }}
            >
              Ta bort
            </button>
            <div className="flex gap-2">
              <button
                className="px-4 py-2 rounded-lg border"
                onClick={() => {
                  setEditBookingDraft(null);
                  setOpenBooking(null);
                }}
              >
                Stäng
              </button>
              <button
                className="px-4 py-2 rounded-lg bg-pink-500 text-white hover:bg-pink-600 shadow"
                onClick={() => {
                  const next = editBookingDraft ?? openBooking;
                  setBookings((prev) => {
                    const updated = prev.map((b) =>
                      b.id === openBooking.id ? { ...b, ...next, note: !!next.notes } : b
                    );
                    const dates = Array.from(new Set<string>(updated.map((b) => b.date)));
                    let out = updated;
                    for (const d of dates) out = assignTablesForDateWithTables(d, out, tableCaps, mealRanges);
                    return out;
                  });
                  if (restaurantId && settingsReady) {
                    supabase
                      .from("bookings")
                      .update({
                        date: next.date,
                        time: next.time,
                        name: next.name,
                        guests: next.guests,
                        notes: next.notes || null,
                        table_id: next.tableId ?? null,
                        duration_min: next.durationMin ?? config.seating.maxBookingDurationMin,
                      })
                      .eq("id", openBooking.id)
                      .eq("restaurant_id", restaurantId);
                  }
                  setEditBookingDraft(null);
                  setOpenBooking(null);
                }}
              >
                Spara ändring
              </button>
            </div>
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

            <Field label="Bord (valfritt)">
              <select
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-pink-400 focus:border-pink-300"
                value={formTableId == null ? "" : String(formTableId)}
                onChange={(e) => {
                  const next = e.target.value ? Number(e.target.value) : null;
                  setFormTableId(Number.isNaN(next as number) ? null : (next as number | null));
                }}
              >
                <option value="">Auto (välj bord automatiskt)</option>
                {tableOptions.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label} · {t.cap} platser
                  </option>
                ))}
              </select>
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
              {settingsSaveError ? (
                <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  Kunde inte spara inställningar: {settingsSaveError}
                </div>
              ) : null}
              <Field label="Bokningslänk">
                <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    className="w-full flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700"
                    value={bookingPublicUrl || "Laddar..."}
                    readOnly
                  />
                  <button
                    type="button"
                    onClick={copyBookingPublicUrl}
                    disabled={!bookingPublicUrl}
                    className="rounded-lg bg-pink-500 px-3 py-2 text-sm font-semibold text-white hover:bg-pink-600 disabled:opacity-50"
                  >
                    Kopiera
                  </button>
                  {bookingLinkStatus ? <span className="text-xs text-gray-500">{bookingLinkStatus}</span> : null}
                </div>
                <div className="mt-2 text-xs text-gray-500 leading-relaxed">
                  Klistra in på din webbplats eller Facebook för att leda gäster till Bokätas bokningssida.
                </div>
              </Field>
              <div className="mt-4">
                <Field label="E-post för bokningar & aviseringar">
                  <input
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-pink-400 focus:border-pink-300"
                    value={config.info.email || config.notifications.to}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        info: { ...config.info, email: e.target.value },
                        notifications: { ...config.notifications, to: e.target.value },
                      })
                    }
                  />
                </Field>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-2 text-sm">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={config.notifications.notifyOnNewBooking}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        notifications: { ...config.notifications, notifyOnNewBooking: e.target.checked },
                      })
                    }
                  />
                  Email till restaurang vid ny bokning
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={config.notifications.requireManualConfirmation}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        notifications: { ...config.notifications, requireManualConfirmation: e.target.checked },
                      })
                    }
                  />
                  Manuell bekräftelse krävs innan kundens bekräftelsemail
                </label>
              </div>
            </Section>

            <Section title="Följa upp gäster, erbjudanden & omdömen">
              <div className="grid grid-cols-1 gap-3 text-sm">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={config.seating.followUpEnabled}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        seating: { ...config.seating, followUpEnabled: e.target.checked },
                      })
                    }
                  />
                  Skicka uppföljningsmail efter besök
                </label>
                <Field label="Skicka efter (dagar)">
                  <input
                    type="number"
                    min={1}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-pink-400 focus:border-pink-300"
                    value={config.seating.followUpDelayDays}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        seating: {
                          ...config.seating,
                          followUpDelayDays: Math.max(1, Number(e.target.value) || 1),
                        },
                      })
                    }
                    disabled={!config.seating.followUpEnabled}
                  />
                </Field>
                <Field label="Follow up">
                  <textarea
                    rows={3}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-pink-400 focus:border-pink-300"
                    placeholder="Tack för ert besök! Vi hoppas att ni hade en härlig stund. Om du vill får du gärna lämna en Google‑recension."
                    value={config.seating.followUpEmail}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        seating: { ...config.seating, followUpEmail: e.target.value },
                      })
                    }
                    disabled={!config.seating.followUpEnabled}
                  />
                </Field>
                <div className="text-xs text-gray-500">
                  Det här sparar texten och inställningen. Utskick aktiveras när funktionen kopplas på.
                </div>
              </div>
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
                  <div className="mt-1 text-xs text-gray-500">
                    Vid {config.escalation.maxGuestsPerReservation} gäster eller fler ska gästen kontakta er via e‑post.
                  </div>
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
                <div className="flex items-center justify-between mb-2">
                  <div className="text-base font-bold text-gray-800">Öppettider</div>
                  <button
                    type="button"
                    className="px-3 py-1.5 rounded-lg text-sm bg-pink-500 text-white hover:bg-pink-600 shadow"
                    onClick={addHoursPeriod}
                  >
                    Lägg till period
                  </button>
                </div>
                <div className="space-y-4">
                  {config.hours.periods.map((period, idx) => (
                    <div key={period.id} className="rounded-lg border border-pink-200 bg-pink-50/40 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                        <input
                          type="text"
                          className="text-sm font-semibold text-violet-700 bg-violet-100/60 border border-transparent focus:border-violet-300 focus:outline-none w-full max-w-[220px] rounded-md px-2 py-1"
                          value={period.name ?? `Period ${idx + 1}`}
                          onFocus={() => {
                            if (!period.name) {
                              setConfig((prev) => ({
                                ...prev,
                                hours: {
                                  ...prev.hours,
                                  periods: prev.hours.periods.map((p) =>
                                    p.id === period.id ? { ...p, name: `Period ${idx + 1}` } : p
                                  ),
                                },
                              }));
                            }
                          }}
                          onChange={(e) =>
                            setConfig((prev) => ({
                              ...prev,
                              hours: {
                                ...prev.hours,
                                periods: prev.hours.periods.map((p) =>
                                  p.id === period.id ? { ...p, name: e.target.value } : p
                                ),
                              },
                            }))
                          }
                        />
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            className="text-xs text-gray-600 hover:text-gray-900"
                            onClick={() =>
                              setOpenPeriods((prev) => ({ ...prev, [period.id]: !prev[period.id] }))
                            }
                          >
                            {openPeriods[period.id] ? "Dölj" : "Visa"}
                          </button>
                          {config.hours.periods.length > 1 && (
                            <button
                              type="button"
                              className="text-xs text-pink-700 hover:text-pink-800"
                              onClick={() => removeHoursPeriod(period.id)}
                            >
                              Ta bort period
                            </button>
                          )}
                        </div>
                      </div>
                      {openPeriods[period.id] ? (
                        <>
                          <div className="grid grid-cols-1 sm:grid-cols-2 items-end gap-2">
                            <div>
                              <Field label="Från">
                                <input
                                  type="date"
                                  className={settingsDateInputClass}
                                  value={period.from}
                                  onChange={(e) =>
                                    setConfig((prev) => ({
                                      ...prev,
                                      hours: {
                                        ...prev.hours,
                                        periods: prev.hours.periods.map((p) =>
                                          p.id === period.id ? { ...p, from: e.target.value } : p
                                        ),
                                      },
                                    }))
                                  }
                                />
                              </Field>
                            </div>
                            <div>
                              <Field label="Till">
                                <input
                                  type="date"
                                  className={settingsDateInputClass}
                                  value={period.to}
                                  onChange={(e) =>
                                    setConfig((prev) => ({
                                      ...prev,
                                      hours: {
                                        ...prev.hours,
                                        periods: prev.hours.periods.map((p) =>
                                          p.id === period.id ? { ...p, to: e.target.value } : p
                                        ),
                                      },
                                    }))
                                  }
                                />
                              </Field>
                            </div>
                          </div>
                          <div className="mt-3 divide-y rounded-lg border border-pink-200 bg-white/70">
                            {DAYS_ORDER.map((day) => {
                              const d = period.days[day];
                              return (
                                <div key={day} className="grid grid-cols-1 sm:grid-cols-12 items-center gap-2 px-3 py-2">
                                  <div className="flex items-center justify-between sm:col-span-4">
                                    <div className="capitalize">{day}</div>
                                    <label className="inline-flex items-center gap-2 text-sm whitespace-nowrap">
                                      <input
                                        type="checkbox"
                                        checked={d.closed}
                                        onChange={(e) =>
                                          setConfig((prev) => ({
                                            ...prev,
                                            hours: {
                                              ...prev.hours,
                                              periods: prev.hours.periods.map((p) =>
                                                p.id === period.id
                                                  ? {
                                                      ...p,
                                                      days: {
                                                        ...p.days,
                                                        [day]: { ...p.days[day], closed: e.target.checked },
                                                      },
                                                    }
                                                  : p
                                              ),
                                            },
                                          }))
                                        }
                                      />
                                      Stängt
                                    </label>
                                  </div>
                                  <div className={`${settingsTimeGridClass} sm:col-span-8`}>
                                    <input
                                      type="time"
                                      className={settingsTimeInputClass}
                                      value={d.open}
                                      onChange={(e) =>
                                        setConfig((prev) => ({
                                          ...prev,
                                          hours: {
                                            ...prev.hours,
                                            periods: prev.hours.periods.map((p) =>
                                              p.id === period.id
                                                ? {
                                                    ...p,
                                                    days: {
                                                      ...p.days,
                                                      [day]: { ...p.days[day], open: e.target.value },
                                                    },
                                                  }
                                                : p
                                            ),
                                          },
                                        }))
                                      }
                                      disabled={d.closed}
                                    />
                                    <input
                                      type="time"
                                      className={settingsTimeInputClass}
                                      value={d.close}
                                      onChange={(e) =>
                                        setConfig((prev) => ({
                                          ...prev,
                                          hours: {
                                            ...prev.hours,
                                            periods: prev.hours.periods.map((p) =>
                                              p.id === period.id
                                                ? {
                                                    ...p,
                                                    days: {
                                                      ...p.days,
                                                      [day]: { ...p.days[day], close: e.target.value },
                                                    },
                                                  }
                                                : p
                                            ),
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
                        </>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-6">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-base font-bold text-gray-800">Röda dagar (helgdagar)</div>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      className="text-xs text-gray-600 hover:text-gray-900"
                      onClick={() => setShowHolidays((prev) => !prev)}
                    >
                      {showHolidays ? "Dölj" : "Visa"}
                    </button>
                    <select
                      className="h-9 rounded-lg border border-gray-300 bg-white px-3 text-sm"
                      value={holidayYear}
                      onChange={(e) => setHolidayYear(Number(e.target.value))}
                    >
                      {[currentYear, currentYear + 1].map((y) => (
                        <option key={y} value={y}>
                          {y}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {showHolidays ? (
                  <div className="space-y-2">
                    {(HOLIDAYS_BY_YEAR[holidayYear] ?? []).map((h) => {
                      const sp =
                        config.hours.special.find((s) => s.date === h.date) ||
                        ({ date: h.date, closed: true, open: "11:00", close: "17:00" } as const);

                      return (
                        <div key={h.date} className="grid grid-cols-1 sm:grid-cols-12 items-center gap-2">
                          <div className="sm:col-span-4">
                            {h.name}
                            <div className="text-xs text-gray-500">{h.date}</div>
                          </div>
                          <div className="flex items-center justify-between sm:col-span-4">
                            <label className="inline-flex items-center gap-2 text-sm whitespace-nowrap">
                              <input
                                type="checkbox"
                                checked={sp.closed}
                                onChange={(e) => upsertSpecialByDate(h.date, { closed: e.target.checked })}
                              />
                              Stängt
                            </label>
                          </div>
                          <div className={`${settingsTimeGridClass} sm:col-span-4`}>
                            <input
                              type="time"
                              className={settingsTimeInputClass}
                              value={sp.open}
                              onChange={(e) => upsertSpecialByDate(h.date, { open: e.target.value })}
                              disabled={sp.closed}
                            />
                            <input
                              type="time"
                              className={settingsTimeInputClass}
                              value={sp.close}
                              onChange={(e) => upsertSpecialByDate(h.date, { close: e.target.value })}
                              disabled={sp.closed}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : null}

                <div className="mt-6 rounded-lg border border-pink-200 bg-pink-50/40 p-3">
                  <div className="text-base font-bold text-gray-800 mb-2">Stängda perioder</div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 items-end gap-2">
                    <div>
                      <Field label="Från">
                        <input
                          type="date"
                          className={settingsDateInputClass}
                          value={customClosureFrom}
                          onChange={(e) => setCustomClosureFrom(e.target.value)}
                        />
                      </Field>
                    </div>
                    <div>
                      <Field label="Till">
                        <input
                          type="date"
                          className={settingsDateInputClass}
                          value={customClosureTo}
                          onChange={(e) => setCustomClosureTo(e.target.value)}
                        />
                      </Field>
                    </div>
                    <div>
                      <button
                        type="button"
                        className="w-full px-4 py-2 rounded-lg bg-pink-500 text-white hover:bg-pink-600 shadow"
                        onClick={addCustomClosures}
                      >
                        Lägg till period
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-gray-500">Ex: semester 15–31 juli</div>

                  <div className="mt-3 space-y-2">
                    {closedRanges.length ? (
                      closedRanges.map((r) => (
                        <div key={`${r.from}-${r.to}`} className="flex items-center justify-between text-sm bg-white/70 border border-pink-200 rounded-lg px-3 py-2">
                          <div className="text-gray-800">
                            {r.from === r.to ? r.from : `${r.from} → ${r.to}`} <span className="text-xs text-gray-500">({r.count} dagar)</span>
                          </div>
                          <button
                            type="button"
                            className="text-xs text-pink-700 hover:text-pink-800"
                            onClick={() => removeClosedRange(r.from, r.to)}
                          >
                            Ta bort
                          </button>
                        </div>
                      ))
                    ) : (
                      <div className="text-xs text-gray-500">Inga stängda perioder sparade.</div>
                    )}
                  </div>
                </div>
              </div>

            </Section>

            <Section title="AI-profil & kunskapsbas">
              <div className="mb-3 text-sm text-gray-600">Inloggad: {profileEmail || "—"}</div>

              <Field label="Namn (kundprofil)" labelClassName="text-base font-bold text-gray-800">
                <input
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-pink-400 focus:border-pink-300"
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  placeholder="Förnamn Efternamn"
                />
              </Field>

              <Field label="Namn på assistent" labelClassName="text-base font-bold text-gray-800">
                <input
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-pink-400 focus:border-pink-300"
                  value={config.ai.name}
                  onChange={(e) => setConfig({ ...config, ai: { ...config.ai, name: e.target.value } })}
                />
              </Field>

              <div className="mt-3 text-sm font-semibold text-violet-700 whitespace-nowrap">
                Ju mer info du lägger in, desto bättre svarar assistenten.
              </div>

              <div className="mt-2 rounded-lg border border-pink-200 bg-pink-50/30 p-3">
              <div className="text-sm font-semibold text-gray-700 mb-2">Kunskapsbas</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                <input
                  className="w-full rounded-lg border border-gray-300 px-3 py-2"
                  placeholder="Namn på restaurang"
                  value={onboarding.restaurantName}
                  onChange={(e) => {
                    setOnboarding({ ...onboarding, restaurantName: e.target.value });
                    setOnboardingDirty(true);
                  }}
                />
                <input
                  className="w-full rounded-lg border border-gray-300 px-3 py-2"
                  placeholder="Typ av restaurang (ex: Café & bistro, vinbar...)"
                  value={onboarding.restaurantType}
                  onChange={(e) => {
                    setOnboarding({ ...onboarding, restaurantType: e.target.value });
                    setOnboardingDirty(true);
                  }}
                />
                <input
                  className="w-full rounded-lg border border-gray-300 px-3 py-2"
                  placeholder="Adress"
                  value={onboarding.address}
                  onChange={(e) => {
                    setOnboarding({ ...onboarding, address: e.target.value });
                    setOnboardingDirty(true);
                  }}
                />
                <input
                  className="w-full rounded-lg border border-gray-300 px-3 py-2"
                  placeholder="Avstånd (ex: 12 km från Göteborg)"
                  value={onboarding.distance}
                  onChange={(e) => {
                    setOnboarding({ ...onboarding, distance: e.target.value });
                    setOnboardingDirty(true);
                  }}
                />
                <input
                  className="w-full rounded-lg border border-gray-300 px-3 py-2"
                  placeholder="E‑post"
                  value={onboarding.email}
                  onChange={(e) => {
                    setOnboarding({ ...onboarding, email: e.target.value });
                    setOnboardingDirty(true);
                  }}
                />
                <input
                  className="w-full rounded-lg border border-gray-300 px-3 py-2"
                  placeholder="Telefon"
                  value={onboarding.phone}
                  onChange={(e) => {
                    setOnboarding({ ...onboarding, phone: e.target.value });
                    setOnboardingDirty(true);
                  }}
                />
                  <textarea
                    rows={3}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 md:col-span-2"
                    placeholder="Hur skulle du beskriva din restaurang? (stämning, målgrupp...)"
                    value={onboarding.restaurantDescription}
                    onChange={(e) => {
                      setOnboarding({ ...onboarding, restaurantDescription: e.target.value });
                      setOnboardingDirty(true);
                    }}
                  />
                  <textarea
                    rows={3}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 md:col-span-2"
                    placeholder="Vilken typ av mat serverar ni? (ex: husmanskost, vegetarisk...)"
                    value={onboarding.foodType}
                    onChange={(e) => {
                      setOnboarding({ ...onboarding, foodType: e.target.value });
                      setOnboardingDirty(true);
                    }}
                  />
                  <textarea
                    rows={3}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 md:col-span-2"
                    placeholder="Grupp & event (ex: födelsedag, större sällskap, företagsevent...)"
                    value={onboarding.groupEvents}
                    onChange={(e) => {
                      setOnboarding({ ...onboarding, groupEvents: e.target.value });
                      setOnboardingDirty(true);
                    }}
                  />
                  <input
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 md:col-span-2"
                    placeholder="Betalning (ex: kort, kontant, Swish)"
                    value={onboarding.payment}
                    onChange={(e) => {
                      setOnboarding({ ...onboarding, payment: e.target.value });
                      setOnboardingDirty(true);
                    }}
                  />
                  <input
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 md:col-span-2"
                    placeholder="Allergier (ex: gluten/laktos/nötter)"
                    value={onboarding.allergies}
                    onChange={(e) => {
                      setOnboarding({ ...onboarding, allergies: e.target.value });
                      setOnboardingDirty(true);
                    }}
                  />
                  <label className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={onboarding.kidsChair}
                      onChange={(e) => {
                        setOnboarding({ ...onboarding, kidsChair: e.target.checked });
                        setOnboardingDirty(true);
                      }}
                    />
                    Barnstol
                  </label>
                  <label className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={onboarding.outdoorSeating}
                      onChange={(e) => {
                        setOnboarding({ ...onboarding, outdoorSeating: e.target.checked });
                        setOnboardingDirty(true);
                      }}
                    />
                    Uteservering
                  </label>
                  <input
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 md:col-span-2"
                    placeholder="Barnmeny (ex: pannkakor, köttbullar, mindre portioner)"
                    value={onboarding.kidsNote}
                    onChange={(e) => {
                      setOnboarding({ ...onboarding, kidsNote: e.target.value });
                      setOnboardingDirty(true);
                    }}
                  />
                  <label className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={onboarding.dogFriendly}
                      onChange={(e) => {
                        setOnboarding({ ...onboarding, dogFriendly: e.target.checked });
                        setOnboardingDirty(true);
                      }}
                    />
                    Hundvänligt
                  </label>
                  <label className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={onboarding.wheelchair}
                      onChange={(e) => {
                        setOnboarding({ ...onboarding, wheelchair: e.target.checked });
                        setOnboardingDirty(true);
                      }}
                    />
                    Rullstolsanpassad
                  </label>
                  <label className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={onboarding.alcoholLicense}
                      onChange={(e) => {
                        setOnboarding({ ...onboarding, alcoholLicense: e.target.checked });
                        setOnboardingDirty(true);
                      }}
                    />
                    Alkoholtillstånd
                  </label>
                  <input
                    type="number"
                    min={0}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2"
                    placeholder="Köket stänger (min före stängning)"
                    value={onboarding.kitchenCloseMinutes}
                    onChange={(e) => {
                      setOnboarding({ ...onboarding, kitchenCloseMinutes: e.target.value });
                      setOnboardingDirty(true);
                    }}
                  />
                  <input
                    className="w-full rounded-lg border border-gray-300 px-3 py-2"
                    placeholder="Djurpolicy"
                    value={onboarding.pets}
                    onChange={(e) => {
                      setOnboarding({ ...onboarding, pets: e.target.value });
                      setOnboardingDirty(true);
                    }}
                  />
                  <input
                    className="w-full rounded-lg border border-gray-300 px-3 py-2"
                    placeholder="Parkering"
                    value={onboarding.parking}
                    onChange={(e) => {
                      setOnboarding({ ...onboarding, parking: e.target.value });
                      setOnboardingDirty(true);
                    }}
                  />
                  <input
                    className="w-full rounded-lg border border-gray-300 px-3 py-2"
                    placeholder="Kollektivtrafik"
                    value={onboarding.transport}
                    onChange={(e) => {
                      setOnboarding({ ...onboarding, transport: e.target.value });
                      setOnboardingDirty(true);
                    }}
                  />
                </div>

                <div className="mt-4 rounded-lg border border-gray-200 bg-white/70 p-3">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-gray-700">Webbsökning (beta)</div>
                    <label className="inline-flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={config.ai.webSearch.enabled}
                        onChange={(e) =>
                          setConfig((prev) => ({
                            ...prev,
                            ai: { ...prev.ai, webSearch: { ...prev.ai.webSearch, enabled: e.target.checked } },
                          }))
                        }
                      />
                      Tillåt webbsökning
                    </label>
                  </div>
                  <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                    <input
                      className="w-full rounded-lg border border-gray-300 px-3 py-2"
                      placeholder="Site officiel (https://...)"
                      value={config.ai.webSearch.siteUrl}
                      onChange={(e) =>
                        setConfig((prev) => ({
                          ...prev,
                          ai: { ...prev.ai, webSearch: { ...prev.ai.webSearch, siteUrl: e.target.value } },
                        }))
                      }
                    />
                    <input
                      className="w-full rounded-lg border border-gray-300 px-3 py-2"
                      placeholder="Google Maps (lien)"
                      value={config.ai.webSearch.googleMapsUrl}
                      onChange={(e) =>
                        setConfig((prev) => ({
                          ...prev,
                          ai: { ...prev.ai, webSearch: { ...prev.ai.webSearch, googleMapsUrl: e.target.value } },
                        }))
                      }
                    />
                    <input
                      className="w-full rounded-lg border border-gray-300 px-3 py-2"
                      placeholder="Facebook (lien page)"
                      value={config.ai.webSearch.facebookUrl}
                      onChange={(e) =>
                        setConfig((prev) => ({
                          ...prev,
                          ai: { ...prev.ai, webSearch: { ...prev.ai.webSearch, facebookUrl: e.target.value } },
                        }))
                      }
                    />
                    <input
                      className="w-full rounded-lg border border-gray-300 px-3 py-2"
                      placeholder="Instagram (lien profil)"
                      value={config.ai.webSearch.instagramUrl}
                      onChange={(e) =>
                        setConfig((prev) => ({
                          ...prev,
                          ai: { ...prev.ai, webSearch: { ...prev.ai.webSearch, instagramUrl: e.target.value } },
                        }))
                      }
                    />
                  </div>
                  <div className="mt-2 text-xs text-gray-500">
                    Vi hämtar endast info från de länkar du anger här.
                  </div>
                </div>

                <div className="mt-3">
                  <div className="text-sm font-semibold text-gray-700 mb-2">Sparade frågor (kunskapsbas)</div>
                  {onboardingFaqs.filter((f) => f.a?.trim()).length ? (
                    <div className="space-y-2">
                      {onboardingFaqs
                        .filter((f) => f.a?.trim())
                        .map((f, i) => (
                        <div key={`${f.q}-${i}`} className="rounded-lg border border-gray-200 bg-white p-2">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-sm font-semibold text-gray-800">{f.q}</div>
                            <button
                              type="button"
                              className="text-xs text-pink-700 hover:text-pink-800"
                              onClick={() => {
                                setOnboardingFaqs((prev) => prev.filter((x) => x.q !== f.q));
                                setOnboardingDirty(true);
                              }}
                            >
                              Ta bort fråga
                            </button>
                          </div>
                          <input
                            className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
                            placeholder="Skriv svar..."
                            value={f.a}
                            onChange={(e) => {
                              const v = e.target.value;
                              setOnboardingFaqs((prev) =>
                                prev.map((x) => (x.q === f.q ? { ...x, a: v } : x))
                              );
                              setOnboardingDirty(true);
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-gray-500">Inga sparade frågor ännu.</div>
                  )}
                </div>
              </div>

              <div className="mt-2 text-xs text-gray-500">
                {aiSaveState === "saving" && "Autosparar…"}
                {aiSaveState === "saved" && "Autosparat"}
                {aiSaveState === "error" && `Kunde inte spara: ${aiSaveMessage}`}
              </div>

              <div className="text-sm mt-2">
                <div className="flex items-center gap-2 w-full">
                  <input
                    className="h-9 flex-1 rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-pink-400 focus:border-pink-300"
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
                  <button
                    type="button"
                    className="h-9 px-3 rounded-lg border border-gray-300 text-xs"
                    onClick={generateCommonQuestion}
                  >
                    Generera fråga
                  </button>
                </div>
                {faqSuccess && <div className="mt-2 text-center text-xs text-green-700">Fråga tillagd</div>}
              </div>

              {draftFaqs.length ? (
                <div className="mt-3 rounded-lg border border-gray-200 bg-white p-2">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-sm font-semibold text-gray-700">
                      Utkast (lägg till svar och spara) ({draftFaqs.length})
                    </div>
                    <button
                      type="button"
                      className="text-xs text-gray-600 hover:text-gray-900"
                      onClick={() => setShowDrafts((prev) => !prev)}
                    >
                      {showDrafts ? "Dölj" : "Visa"}
                    </button>
                  </div>
                  {showDrafts ? (
                    <div className="space-y-2">
                      {draftFaqs.map((f, i) => (
                        <div key={`${f.q}-${i}`} className="rounded-lg border border-gray-200 bg-white p-2">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-sm font-semibold text-gray-800">{f.q}</div>
                            <button
                              type="button"
                              className="text-xs text-pink-700 hover:text-pink-800"
                              onClick={() => {
                                setOnboardingFaqs((prev) => prev.filter((x) => x.q !== f.q));
                                setOnboardingDirty(true);
                              }}
                            >
                              Ta bort fråga
                            </button>
                          </div>
                          <input
                            className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
                            placeholder="Skriv svar..."
                            value={f.a}
                            onChange={(e) => {
                              const v = e.target.value;
                              setOnboardingFaqs((prev) =>
                                prev.map((x) => (x.q === f.q ? { ...x, a: v } : x))
                              );
                              setOnboardingDirty(true);
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

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
      setAiHistory((prev) => [...prev, { role: "user", content: aiMsg }, { role: "assistant", content: reply }].slice(-12));
    } catch (err) {
      setAiPreview(`Fel vid AI-anrop. ${err instanceof Error ? err.message : ""}`.trim());
    }
  }}
>
  Förhandsvisa
</button>

                  <button
                    className="px-4 py-2 rounded-lg border"
                    onClick={() => {
                      setAiPreview("");
                      setAiMsg("");
                      setAiHistory([]);
                    }}
                  >
                    Rensa
                  </button>
                </div>

                {aiPreview && (
                  <div className="mt-3 p-3 rounded-lg border border-pink-200 bg-gray-50 text-sm text-gray-800 whitespace-pre-wrap">
                    <div className="text-xs text-gray-500">Contexte : {dateSel} • 12:00</div>
                    <div className="mb-1 font-semibold text-pink-700">Svar från {config.ai.name}</div>
                    <div>{linkify(aiPreview)}</div>
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
                        <div className="flex items-center justify-between text-gray-700">
                          <div><strong>Q:</strong> {t.q}</div>
                          <span className={`text-xs font-semibold ${t.ok ? "text-green-600" : "text-amber-600"}`}>
                            {t.ok ? "OK" : "À améliorer"}
                          </span>
                        </div>
                        <div className="text-gray-800"><strong>A:</strong> {t.reply}</div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </Section>

            <div className="flex justify-end gap-2">
              <button className="px-4 py-2 rounded-lg border" onClick={() => setSettingsOpen(false)}>
                Stäng
              </button>
            </div>
          </div>
        </Drawer>
      )}

      <footer className="mt-12 text-center text-sm text-gray-400">© 2026 Bokäta. Stockholm, Sweden. All rights reserved.</footer>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  sub,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="bg-white p-4 shadow-lg rounded-lg border border-pink-300">
      <p className="text-sm text-gray-500 flex items-center gap-2">
        {icon ? <span className="text-base">{icon}</span> : null}
        <span>{label}</span>
      </p>
      <h2 className="text-xl font-bold text-gray-800">{value}</h2>
      {sub ? <p className="text-xs text-gray-500 mt-1">{sub}</p> : null}
    </div>
  );
}

function linkify(text: string) {
  const nodes: React.ReactNode[] = [];
  const mdLink = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null = null;
  let key = 0;

  const pushPlain = (segment: string) => {
    const parts = segment.split(/(https?:\/\/[^\s)]+)\b/);
    parts.forEach((part) => {
      if (!part) return;
      if (/^https?:\/\//i.test(part)) {
        nodes.push(
          <a key={`url-${key++}`} href={part} target="_blank" rel="noreferrer" className="text-pink-700 underline">
            {part}
          </a>
        );
        return;
      }
      nodes.push(<React.Fragment key={`txt-${key++}`}>{part}</React.Fragment>);
    });
  };

  while ((match = mdLink.exec(text))) {
    if (match.index > lastIndex) {
      pushPlain(text.slice(lastIndex, match.index));
    }
    const label = match[1];
    const url = match[2];
    nodes.push(
      <a key={`md-${key++}`} href={url} target="_blank" rel="noreferrer" className="text-pink-700 underline">
        {label}
      </a>
    );
    lastIndex = mdLink.lastIndex;
  }

  if (lastIndex < text.length) {
    pushPlain(text.slice(lastIndex));
  }

  return nodes;
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

function Field({
  label,
  children,
  className,
  labelClassName,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
  labelClassName?: string;
}) {
  return (
    <label className={`block text-sm ${className ?? ""}`}>
      <span className={`text-gray-600 ${labelClassName ?? ""}`}>{label}</span>
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
