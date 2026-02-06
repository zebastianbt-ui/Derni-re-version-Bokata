import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const getEnv = (key: string) => process.env[key] ?? "";
const getSiteUrl = () => getEnv("SITE_URL") || "https://www.bokata.se";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const token = String(req.query.token || "");
  const action = String(req.query.action || "");
  if (!token || !["confirm", "decline"].includes(action)) {
    res.status(400).send("Ogiltig länk.");
    return;
  }

  const supabaseUrl = getEnv("SUPABASE_URL") || getEnv("VITE_SUPABASE_URL");
  const serviceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  const resendKey = getEnv("RESEND_API_KEY");
  const resendFrom = getEnv("RESEND_FROM") || "Bokäta <no-reply@bokata.se>";

  if (!supabaseUrl || !serviceKey) {
    res.status(500).send("Serverfel.");
    return;
  }

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const { data: booking } = await supabase
    .from("bookings")
    .select("id,name,date,time,guests,client_email,confirm_token,status")
    .eq("confirm_token", token)
    .maybeSingle();

  if (!booking) {
    res.status(404).send("Bokningen hittades inte.");
    return;
  }

  const nextStatus = action === "confirm" ? "confirmed" : "cancelled";
  await supabase
    .from("bookings")
    .update({ status: nextStatus, confirm_token: null })
    .eq("id", booking.id);

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

  if (booking.client_email && action === "confirm") {
    await sendEmail(
      booking.client_email,
      "Din bokning är bekräftad",
      `
        <h2>Bokning bekräftad</h2>
        <p>Hej ${booking.name}!</p>
        <p>Din bokning är bekräftad: ${booking.date} kl ${booking.time} • ${booking.guests} gäster.</p>
        <p>Välkommen!</p>
      `
    );
  }

  if (booking.client_email && action === "decline") {
    await sendEmail(
      booking.client_email,
      "Din bokning kunde inte bekräftas",
      `
        <h2>Bokning nekad</h2>
        <p>Hej ${booking.name}!</p>
        <p>Tyvärr kunde vi inte bekräfta din bokning.</p>
      `
    );
  }

  res.status(200).send(
    action === "confirm"
      ? "Bokningen är bekräftad. Kunden har informerats."
      : `Bokningen är avböjd.`
  );
}
