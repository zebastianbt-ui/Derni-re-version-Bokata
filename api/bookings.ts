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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
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
    .select("seating,notify_email,notify_enabled,require_manual_confirmation")
    .eq("public_id", restaurantId)
    .maybeSingle();

  const s = (settings ?? {}) as BookingSettings;
  const requireManual = !!s.require_manual_confirmation;
  const notifyEnabled = !!s.notify_enabled;
  const notifyEmail = s.notify_email || null;
  const durationMin = s.seating?.maxBookingDurationMin ?? 90;

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
    if (!resendKey) return;
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resendKey}`,
      },
      body: JSON.stringify({ from: resendFrom, to, subject, html }),
    });
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
