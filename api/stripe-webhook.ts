import type { VercelRequest, VercelResponse } from "@vercel/node";
import Stripe from "stripe";

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
      break;
    }
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      break;
    default:
      break;
  }

  res.status(200).json({ received: true });
}
