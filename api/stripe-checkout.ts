import type { VercelRequest, VercelResponse } from "@vercel/node";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { rateLimit } from "./_rateLimit";

const getEnv = (key: string) => process.env[key] ?? "";
const getSiteUrl = () => getEnv("SITE_URL") || "https://www.bokata.se";
const normalizeEmail = (value?: string | null) => (value ?? "").trim().toLowerCase();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  const RATE_LIMIT_WINDOW_MS = 60_000;
  const RATE_LIMIT_MAX = 10;
  const getClientIp = () => {
    const xfwd = req.headers["x-forwarded-for"];
    const ip = Array.isArray(xfwd) ? xfwd[0] : xfwd;
    return (ip || req.socket.remoteAddress || "unknown").split(",")[0].trim();
  };
  const limiter = await rateLimit(`stripe:${getClientIp()}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
  if (!limiter.ok) {
    res.status(429).json({ error: "För många försök. Försök igen om en minut." });
    return;
  }

  const secretKey = getEnv("STRIPE_SECRET_KEY");
  const priceMonthly = getEnv("STRIPE_PRICE_MONTHLY");
  const priceYearly = getEnv("STRIPE_PRICE_YEARLY");
  const price2Year = getEnv("STRIPE_PRICE_2YEAR");
  const supabaseUrl = getEnv("SUPABASE_URL") || getEnv("VITE_SUPABASE_URL");
  const serviceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");

  if (!secretKey || !priceMonthly || !priceYearly || !price2Year) {
    res.status(500).json({ error: "Missing Stripe env vars" });
    return;
  }
  if (!supabaseUrl || !serviceKey) {
    res.status(500).json({ error: "Missing Supabase env vars" });
    return;
  }

  const { planKey, email } = (req.body ?? {}) as { planKey?: string; email?: string };
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    res.status(400).json({ error: "E-post krävs för att starta provperioden." });
    return;
  }
  const priceId =
    planKey === "ettar" ? priceYearly : planKey === "tvar" ? price2Year : priceMonthly;

  const stripe = new Stripe(secretKey, { apiVersion: "2023-10-16" });
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const origin = getSiteUrl();

  try {
    const { data: priorSub, error: priorError } = await supabase
      .from("stripe_subscriptions")
      .select("id,status")
      .ilike("email", normalizedEmail)
      .limit(1)
      .maybeSingle();
    if (priorError) {
      console.error("Stripe subscription lookup error", priorError);
    }
    const allowTrial = !priorSub && !priorError;
    const subscriptionData = allowTrial
      ? {
          trial_period_days: 14,
          trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
        }
      : undefined;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_collection: allowTrial ? "if_required" : "always",
      allow_promotion_codes: true,
      customer_email: normalizedEmail,
      line_items: [{ price: priceId, quantity: 1 }],
      ...(subscriptionData ? { subscription_data: subscriptionData } : {}),
      success_url: `${origin}/?checkout=success`,
      cancel_url: `${origin}/?checkout=cancel`,
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("Stripe checkout error", err);
    res.status(500).json({ error: "Stripe checkout failed" });
  }
}
