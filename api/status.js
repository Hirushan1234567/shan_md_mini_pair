import { sessions, cleanNumber, validNumber } from "./_lib/db.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  try {
    const number = cleanNumber(req.query?.number);
    if (!validNumber(number)) return res.status(400).json({ status: "invalid" });

    const doc = await (await sessions()).findOne(
      { _id: number },
      { projection: { status: 1, active: 1 } }
    );

    if (doc?.status === "ready") return res.json({ status: doc.active ? "active" : "linked" });

    res.json({ status: "none" });
  } catch {
    res.json({ status: "none" });
  }
}
