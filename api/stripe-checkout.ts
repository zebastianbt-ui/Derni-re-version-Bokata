import type { VercelRequest, VercelResponse } from "@vercel/node";
import Stripe from "stripe";
import { rateLimit } from "./_rateLimit";

const getEnv = (key: string) => process.env[key] ?? "";
const normalizeEmail = (value?: string | null) => (value ?? "").trim().toLowerCase();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Autoriser uniquement POST
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  // Rate limit simple (anti-abus)
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

  // Variables d’environnement
  const secretKey = getEnv("STRIPE_SECRET_KEY");
  const priceMonthly = getEnv("STRIPE_PRICE_MONTHLY");
  const priceYearly = getEnv("STRIPE_PRICE_YEARLY");
  const price2Year = getEnv("STRIPE_PRICE_2YEAR");
  const priceIdDirect = getEnv("STRIPE_PRICE_ID");
  const siteUrl = getEnv("SITE_URL") || "https://www.bokata.se";
  const successUrl = getEnv("STRIPE_SUCCESS_URL") || `${siteUrl}/?checkout=success`;
  const cancelUrl = getEnv("STRIPE_CANCEL_URL") || `${siteUrl}/?checkout=cancel`;

  if (!secretKey) {
    res.status(500).json({ error: "Missing STRIPE_SECRET_KEY" });
    return;
  }

  const { planKey, email } = (req.body ?? {}) as { planKey?: string; email?: string };
  const normalizedEmail = normalizeEmail(email);

  // Choix du price (priorité à STRIPE_PRICE_ID si fourni)
  const priceId =
    priceIdDirect ||
    (planKey === "ettar" ? priceYearly : planKey === "tvar" ? price2Year : priceMonthly);

  if (!priceId) {
    res.status(500).json({ error: "Missing Stripe price id" });
    return;
  }

  // Init Stripe
  const stripe = new Stripe(secretKey, { apiVersion: "2023-10-16" });

  try {
    // Session Stripe Checkout (mode subscription, trial 14 jours, sans carte)
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      locale: "sv",
      payment_method_collection: "if_required",
      allow_promotion_codes: true,
      customer_email: normalizedEmail || undefined,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        trial_period_days: 30,
        trial_settings: {
          end_behavior: { missing_payment_method: "cancel" },
        },
      },
      custom_text: {
        submit: {
          message: "14 dagar gratis · Inget kort krävs · Avsluta när du vill",
        },
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("Stripe checkout error", err);
    res.status(500).json({ error: "Stripe checkout failed" });
  }
}
