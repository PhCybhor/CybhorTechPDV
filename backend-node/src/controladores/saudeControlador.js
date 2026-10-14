import { pingar } from "../db.js";

/** Liveness + ping barato no banco. Sem detalhes internos no corpo. */
export async function saude(_req, res) {
  const bancoOk = await pingar();
  res.status(bancoOk ? 200 : 503).json({ ok: bancoOk, db: bancoOk });
}
