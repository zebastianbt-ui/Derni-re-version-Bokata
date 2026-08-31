import type { VercelRequest, VercelResponse } from "../lib/vercelTypes";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const getEnv = (key: string) => process.env[key] ?? "";
const getSiteUrl = () => getEnv("SITE_URL") || "https://www.bokata.se";

const toIsoDate = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

const toHtml = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p style="margin:0 0 10px;">${line.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`)
    .join("");

const signUnsub = (secret: string, restaurantId: string, email: string) => {
  return crypto.createHmac("sha256", secret).update(`${restaurantId}:${email}`).digest("hex");
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  const cronHeader = req.headers["x-vercel-cron"];
  const token = (req.query?.token as string) || "";
  const secret = getEnv("CRON_SECRET");
  if (!cronHeader && !(secret && token && token === secret)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const supabaseUrl = getEnv("SUPABASE_URL") || getEnv("VITE_SUPABASE_URL");
  const serviceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  const resendKey = getEnv("RESEND_API_KEY");
  const resendFrom = getEnv("RESEND_FROM") || "Bokäta <no-reply@bokata.se>";
  const unsubSecret = getEnv("FOLLOWUP_UNSUB_SECRET") || serviceKey;

  if (!supabaseUrl || !serviceKey) {
    res.status(500).json({ error: "Missing Supabase env vars" });
    return;
  }
  if (!resendKey) {
    res.status(500).json({ error: "Missing RESEND_API_KEY" });
    return;
  }

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data: settingsRows, error: settingsError } = await supabase
    .from("booking_public_settings")
    .select("public_id,seating")
    .limit(5000);

  if (settingsError) {
    res.status(500).json({ error: settingsError.message });
    return;
  }

  const enabledRows = (settingsRows ?? []).filter((row: any) => row?.seating?.followUpEnabled);
  if (!enabledRows.length) {
    res.status(200).json({ ok: true, sent: 0 });
    return;
  }

  const restaurantIds = enabledRows.map((r: any) => r.public_id);
  const { data: restaurants } = await supabase.from("restaurants").select("id,name").in("id", restaurantIds);
  const nameMap = new Map<string, string>();
  (restaurants ?? []).forEach((r: any) => nameMap.set(r.id, r.name || "Bokäta"));

  const todayIso = toIsoDate(new Date());
  let totalSent = 0;

  for (const row of enabledRows as any[]) {
    const restaurantId = row.public_id as string;
    const seating = row.seating ?? {};
    const followUpDelayDays = Math.max(1, Number(seating.followUpDelayDays) || 3);
    const followUpEmail = String(seating.followUpEmail || "").trim();
    if (!followUpEmail) continue;

    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - followUpDelayDays);
    const cutoffIso = toIsoDate(cutoff);

    if (cutoffIso > todayIso) continue;

    const { data: unsubscribed } = await supabase
      .from("email_unsubscribes")
      .select("email")
      .eq("restaurant_id", restaurantId);
    const unsubSet = new Set((unsubscribed ?? []).map((u: any) => String(u.email || "").toLowerCase()));

    const { data: bookings } = await supabase
      .from("bookings")
      .select("id,client_email,name,date,time,status,follow_up_sent_at")
      .eq("restaurant_id", restaurantId)
      .eq("status", "confirmed")
      .lte("date", cutoffIso)
      .is("follow_up_sent_at", null)
      .not("client_email", "is", null)
      .limit(200);

    if (!bookings?.length) continue;

    for (const b of bookings as any[]) {
      const email = String(b.client_email || "").toLowerCase().trim();
      if (!email || unsubSet.has(email)) continue;

      const name = nameMap.get(restaurantId) || "Bokäta";
      const sig = signUnsub(unsubSecret, restaurantId, email);
      const unsubUrl = `${getSiteUrl()}/api/followup-unsubscribe?rid=${encodeURIComponent(
        restaurantId
      )}&email=${encodeURIComponent(email)}&sig=${sig}`;

      const html = `
        <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.5;color:#111;">
          ${toHtml(followUpEmail)}
          <p style="margin:16px 0 0;color:#666;font-size:12px;">
            Vill du inte få fler uppföljningar? <a href="${unsubUrl}">Avsluta utskick</a>.
          </p>
        </div>
      `.trim();

      const subject = `Tack för ditt besök hos ${name}`;
      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${resendKey}`,
        },
        body: JSON.stringify({ from: resendFrom, to: email, subject, html }),
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        console.error("Follow-up Resend error", resp.status, text || resp.statusText, { email });
        continue;
      }

      await supabase
        .from("bookings")
        .update({ follow_up_sent_at: new Date().toISOString() })
        .eq("id", b.id);

      totalSent += 1;
    }
  }

  res.status(200).json({ ok: true, sent: totalSent });
}
