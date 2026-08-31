import type { VercelRequest, VercelResponse } from "../lib/vercelTypes";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const getEnv = (key: string) => process.env[key] ?? "";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  const sessionIdRaw = req.query.session_id;
  const sessionId = Array.isArray(sessionIdRaw) ? sessionIdRaw[0] : sessionIdRaw;
  if (!sessionId) {
    res.status(400).json({ error: "Missing session_id" });
    return;
  }

  const secretKey = getEnv("STRIPE_SECRET_KEY");
  const supabaseUrl = getEnv("SUPABASE_URL") || getEnv("VITE_SUPABASE_URL");
  const serviceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  const siteUrl = getEnv("SITE_URL") || "https://www.bokata.se";

  if (!secretKey || !supabaseUrl || !serviceKey) {
    res.status(500).json({ error: "Missing env vars" });
    return;
  }

  const stripe = new Stripe(secretKey, { apiVersion: "2023-10-16" });

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const email = session.customer_details?.email || session.customer_email;
    if (!email) {
      res.writeHead(302, { Location: `${siteUrl}/login` });
      res.end();
      return;
    }

    const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    // Säkra att användaren finns
    await supabase.auth.admin.createUser({ email, email_confirm: true }).catch(() => null);

    // Skapa en magisk länk som loggar in direkt
    const { data, error } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo: `${siteUrl}/dashboard` },
    });

    const actionLink =
      (data as any)?.action_link ||
      (data as any)?.properties?.action_link ||
      (data as any)?.properties?.actionLink;

    if (error || !actionLink) {
      const fallback = `${siteUrl}/login?email=${encodeURIComponent(email)}`;
      res.writeHead(302, { Location: fallback });
      res.end();
      return;
    }

    res.writeHead(302, { Location: actionLink });
    res.end();
  } catch (err) {
    console.error("Checkout complete error", err);
    res.status(500).json({ error: "Checkout completion failed" });
  }
}
