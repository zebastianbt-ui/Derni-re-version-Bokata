import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const getEnv = (key: string) => process.env[key] ?? "";

const signUnsub = (secret: string, restaurantId: string, email: string) => {
  return crypto.createHmac("sha256", secret).update(`${restaurantId}:${email}`).digest("hex");
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  const rid = String(req.query?.rid || "");
  const email = String(req.query?.email || "").toLowerCase().trim();
  const sig = String(req.query?.sig || "");

  const supabaseUrl = getEnv("SUPABASE_URL") || getEnv("VITE_SUPABASE_URL");
  const serviceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  const secret = getEnv("FOLLOWUP_UNSUB_SECRET") || serviceKey;

  if (!supabaseUrl || !serviceKey || !secret) {
    res.status(500).send("Missing server configuration.");
    return;
  }

  if (!rid || !email || !sig) {
    res.status(400).send("Ogiltig länk.");
    return;
  }

  const expected = signUnsub(secret, rid, email);
  if (expected !== sig) {
    res.status(403).send("Ogiltig eller utgången länk.");
    return;
  }

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  await supabase
    .from("email_unsubscribes")
    .upsert({ restaurant_id: rid, email, created_at: new Date().toISOString() }, { onConflict: "restaurant_id,email" });

  res.status(200).send(`
    <html><body style="font-family:Arial,Helvetica,sans-serif;padding:24px;">
      <h2>Du är nu avregistrerad</h2>
      <p>Du kommer inte längre få uppföljningsmail från restaurangen.</p>
    </body></html>
  `);
}
