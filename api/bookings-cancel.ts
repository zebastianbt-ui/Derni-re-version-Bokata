import type { VercelRequest, VercelResponse } from "../lib/vercelTypes";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const getEnv = (key: string) => process.env[key] ?? "";

const signBookingCancel = (secret: string, bookingId: string, email: string) => {
  return crypto.createHmac("sha256", secret).update(`${bookingId}:${email.toLowerCase().trim()}`).digest("hex");
};

const safeEqual = (a: string, b: string) => {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const html = (title: string, message: string, details?: string) => `
  <html>
    <body style="font-family:Arial,Helvetica,sans-serif;padding:24px;line-height:1.5;">
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(message)}</p>
      ${details ? `<p style="color:#374151">${escapeHtml(details)}</p>` : ""}
    </body>
  </html>
`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  const bookingId = String(req.query?.bid || "").trim();
  const email = String(req.query?.email || "").toLowerCase().trim();
  const sig = String(req.query?.sig || "").trim();

  if (!bookingId || !email || !sig) {
    res.status(400).send(html("Ogiltig länk", "Länken saknar nödvändig information."));
    return;
  }

  const supabaseUrl = getEnv("SUPABASE_URL") || getEnv("VITE_SUPABASE_URL");
  const serviceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  const cancelSecret = getEnv("BOOKING_CANCEL_SECRET") || serviceKey;

  if (!supabaseUrl || !serviceKey || !cancelSecret) {
    res.status(500).send(html("Serverfel", "Saknar serverkonfiguration."));
    return;
  }

  const expectedSig = signBookingCancel(cancelSecret, bookingId, email);
  if (!safeEqual(sig, expectedSig)) {
    res.status(403).send(html("Ogiltig länk", "Länken är ogiltig eller har ändrats."));
    return;
  }

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select("id,name,date,time,guests,status,client_email")
    .eq("id", bookingId)
    .maybeSingle();

  if (bookingError) {
    res.status(500).send(html("Serverfel", bookingError.message));
    return;
  }

  if (!booking) {
    res.status(404).send(html("Bokning saknas", "Vi kunde inte hitta bokningen."));
    return;
  }

  const bookingEmail = String(booking.client_email || "").toLowerCase().trim();
  if (!bookingEmail || bookingEmail !== email) {
    res.status(403).send(html("Ogiltig länk", "Länken matchar inte bokningen."));
    return;
  }

  if (booking.status === "cancelled") {
    res.status(200).send(
      html(
        "Bokningen är redan avbokad",
        "Den här bokningen var redan avbokad tidigare.",
        `${booking.date} kl ${booking.time} • ${booking.guests} gäster`
      )
    );
    return;
  }

  const { error: updateError } = await supabase
    .from("bookings")
    .update({ status: "cancelled" })
    .eq("id", booking.id);

  if (updateError) {
    res.status(500).send(html("Serverfel", updateError.message));
    return;
  }

  res.status(200).send(
    html(
      "Bokningen är avbokad",
      "Din avbokning är registrerad.",
      `${booking.date} kl ${booking.time} • ${booking.guests} gäster`
    )
  );
}
