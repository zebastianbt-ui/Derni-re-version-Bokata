import type { VercelRequest, VercelResponse } from "@vercel/node";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export const config = {
  api: {
    bodyParser: false,
  },
};

const getEnv = (key: string) => process.env[key] ?? "";

const readRawBody = (req: VercelRequest) =>
  new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  const secretKey = getEnv("STRIPE_SECRET_KEY");
  const webhookSecret = getEnv("STRIPE_WEBHOOK_SECRET");
  if (!secretKey || !webhookSecret) {
    res.status(500).send("Missing Stripe env vars");
    return;
  }

  const stripe = new Stripe(secretKey, { apiVersion: "2023-10-16" });
  const supabaseUrl = getEnv("SUPABASE_URL") || getEnv("VITE_SUPABASE_URL");
  const serviceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  const supabase =
    supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } }) : null;
  if (!supabase) {
    res.status(500).send("Missing Supabase env vars");
    return;
  }
  const resendKey = getEnv("RESEND_API_KEY");
  const resendFrom = getEnv("RESEND_FROM") || "Bokäta <no-reply@bokata.se>";
  const sig = req.headers["stripe-signature"];
  if (!sig || typeof sig !== "string") {
    res.status(400).send("Missing Stripe signature");
    return;
  }

  let event: Stripe.Event;
  try {
    const rawBody = await readRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error("Stripe webhook error", err);
    res.status(400).send("Webhook Error");
    return;
  }

  const sendEmail = async (to: string, subject: string, html: string) => {
    if (!resendKey) return;
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resendKey}`,
      },
      body: JSON.stringify({ from: resendFrom, to, subject, html }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      console.error("Resend error", resp.status, text || resp.statusText);
    }
  };

  const upsertSubscription = async (sub: Stripe.Subscription) => {
    const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
    let email: string | null = null;
    if (customerId) {
      const customer = await stripe.customers.retrieve(customerId);
      if (!("deleted" in customer)) {
        email = (customer.email ?? null) as string | null;
      }
    }
    if (email) email = email.trim().toLowerCase();
    const { error } = await supabase.from("stripe_subscriptions").upsert(
      {
        stripe_subscription_id: sub.id,
        stripe_customer_id: customerId,
        email,
        status: sub.status,
        current_period_end: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
        cancel_at_period_end: sub.cancel_at_period_end ?? false,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "stripe_subscription_id" }
    );
    if (error) {
      console.error("Stripe webhook upsert error", error);
    }
  };

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const email = session.customer_details?.email || session.customer_email || "";
      if (email) {
        await sendEmail(
          email,
          "Välkommen till Bokäta",
          `
            <h2>Välkommen!</h2>
            <p>Ditt abonnemang är nu aktivt. Du kan logga in och komma igång direkt.</p>
            <p>Har du frågor? Svara på detta mail så hjälper vi dig.</p>
          `
        );
      }
      if (session.subscription) {
        try {
          const subId = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
          if (subId) {
            const sub = await stripe.subscriptions.retrieve(subId);
            await upsertSubscription(sub);
          }
        } catch (err) {
          console.error("Stripe webhook checkout upsert error", err);
        }
      }
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      await upsertSubscription(sub);
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      await upsertSubscription({ ...sub, status: "canceled" } as Stripe.Subscription);
      break;
    }
    default:
      break;
  }

  res.status(200).json({ received: true });
}
