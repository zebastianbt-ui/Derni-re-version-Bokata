import type { VercelRequest, VercelResponse } from "@vercel/node";
import Stripe from "stripe";

const getEnv = (key: string) => process.env[key] ?? "";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
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
