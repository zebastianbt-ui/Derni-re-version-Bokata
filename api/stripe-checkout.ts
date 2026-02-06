import type { VercelRequest, VercelResponse } from "@vercel/node";
import Stripe from "stripe";

const getEnv = (key: string) => process.env[key] ?? "";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  const RATE_LIMIT_WINDOW_MS = 60_000;
  const RATE_LIMIT_MAX = 10;
  const rateLimitStore = (globalThis as any).__bokataStripeRateLimit ?? new Map<string, { count: number; resetAt: number }>();
  (globalThis as any).__bokataStripeRateLimit = rateLimitStore;
  const getClientIp = () => {
    const xfwd = req.headers["x-forwarded-for"];
    const ip = Array.isArray(xfwd) ? xfwd[0] : xfwd;
    return (ip || req.socket.remoteAddress || "unknown").split(",")[0].trim();
  };
  const rateLimit = (key: string) => {
    const now = Date.now();
    const entry = rateLimitStore.get(key);
    if (!entry || now > entry.resetAt) {
      rateLimitStore.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
      return { ok: true, remaining: RATE_LIMIT_MAX - 1, resetAt: now + RATE_LIMIT_WINDOW_MS };
    }
    if (entry.count >= RATE_LIMIT_MAX) return { ok: false, remaining: 0, resetAt: entry.resetAt };
    entry.count += 1;
    return { ok: true, remaining: RATE_LIMIT_MAX - entry.count, resetAt: entry.resetAt };
  };
  const limiter = rateLimit(`stripe:${getClientIp()}`);
  if (!limiter.ok) {
    res.status(429).json({ error: "För många försök. Försök igen om en minut." });
    return;
  }

  const secretKey = getEnv("STRIPE_SECRET_KEY");
  const priceMonthly = getEnv("STRIPE_PRICE_MONTHLY");
  const priceYearly = getEnv("STRIPE_PRICE_YEARLY");
  const price2Year = getEnv("STRIPE_PRICE_2YEAR");

  if (!secretKey || !priceMonthly || !priceYearly || !price2Year) {
    res.status(500).json({ error: "Missing Stripe env vars" });
    return;
  }

  const { planKey, email } = (req.body ?? {}) as { planKey?: string; email?: string };
  const priceId =
    planKey === "ettar" ? priceYearly : planKey === "tvar" ? price2Year : priceMonthly;

  const stripe = new Stripe(secretKey, { apiVersion: "2023-10-16" });
  const origin = req.headers.origin || `https://${req.headers.host}`;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_collection: "always",
      allow_promotion_codes: true,
      customer_email: email || undefined,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: { trial_period_days: 14 },
      success_url: `${origin}/?checkout=success`,
      cancel_url: `${origin}/?checkout=cancel`,
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("Stripe checkout error", err);
    res.status(500).json({ error: "Stripe checkout failed" });
  }
}
