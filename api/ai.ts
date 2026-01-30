import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  const { message, knowledge } = (req.body ?? {}) as {
    message?: string;
    knowledge?: string;
  };

  if (!message || typeof message !== "string") {
    res.status(400).json({ error: "Missing message" });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    return;
  }

  const systemPrompt = `
Du är en restaurangassistent.
Svara alltid på svenska.
Var kort, tydlig och vänlig.

Regler:
- Om svaret finns i KUNSKAPSBAS, använd det.
- Om du inte kan svara säkert: be om ursäkt och skriv:
  "Jag kan tyvärr inte svara säkert på det just nu. Jag vidarebefordrar din fråga och vi återkommer så snart som möjligt."
- Om frågan gäller öppettider och KUNSKAPSBAS innehåller öppettider, svara direkt med dem (ingen vidarebefordran).
- Exempel: om KUNSKAPSBAS säger att måndag är stängt, och användaren frågar om måndag, svara: "Nej, vi har stängt på måndagar."

KUNSKAPSBAS:
${knowledge ?? ""}
`.trim();


  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message },
      ],
    }),
  });

  const data = await r.json();
const reply =
  (data?.choices?.[0]?.message?.content ?? "").trim() ||
  "Jag kan tyvärr inte svara säkert på det just nu. Jag vidarebefordrar din fråga och vi återkommer så snart som möjligt.";

  res.status(200).json({ reply });
}
