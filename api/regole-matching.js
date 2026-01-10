import { ensureRes, requireRoles } from "./_auth.js";
import { norm, readJsonBody } from "./_common.js";
import {
  airtableList,
  airtableUpdate,
  airtableUpsertByPrimary,
  escAirtableString as esc,
  resolveLinkedIds,
} from "../lib/airtableClient.js";

function toBool(v) {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return false;
  return s === "1" || s === "true" || s === "yes" || s === "si" || s === "sì" || s === "ok";
}

export default async function handler(req, res) {
  ensureRes(res);
  const user = requireRoles(req, res, ["back", "manager"]);
  if (!user) return;

  try {
    if (req.method === "GET") {
      const attivaRaw = norm(req.query?.attiva);
      const parts = [];
      if (attivaRaw) {
        const v = toBool(attivaRaw);
        parts.push(v ? `{Attiva}=TRUE()` : `OR({Attiva}=FALSE(), {Attiva}=BLANK())`);
      }
      const filterByFormula = parts.length ? `AND(${parts.join(",")})` : "";

      const { records } = await airtableList("REGOLE MATCHING", {
        filterByFormula,
        maxRecords: 1000,
        sort: [{ field: "Priorità", direction: "desc" }],
        fields: ["Nome Regola", "Direzione", "Qonto Category", "Descrizione contiene", "Categoria", "Sotto-macro", "Confidenza", "Priorità", "Attiva"],
      });

      return res.status(200).json({
        ok: true,
        records: (records || []).map((r) => ({ id: r.id, createdTime: r.createdTime, fields: r.fields || {} })),
      });
    }

    if (req.method === "POST") {
      const body = await readJsonBody(req);
      if (!body) return res.status(400).json({ ok: false, error: "invalid_json" });

      const payload = body.regola || body;
      const recordId = norm(payload.recordId || payload.id);
      const nome = norm(payload["Nome Regola"] || payload.nomeRegola || payload.nome);
      if (!recordId && !nome) return res.status(400).json({ ok: false, error: "missing_nome_regola" });

      const fields = {};
      if (nome) fields["Nome Regola"] = nome;

      const direzione = norm(payload.Direzione || payload.direzione);
      if (direzione) fields["Direzione"] = direzione;

      const qonto = norm(payload["Qonto Category"] || payload.qontoCategory);
      if (qonto) fields["Qonto Category"] = qonto;

      const contains = norm(payload["Descrizione contiene"] || payload.descrizioneContiene);
      if (contains) fields["Descrizione contiene"] = contains;

      const confidenza = payload.Confidenza ?? payload.confidenza;
      if (confidenza !== undefined && confidenza !== null && String(confidenza).trim() !== "") fields["Confidenza"] = confidenza;

      const priorita = payload["Priorità"] ?? payload.priorita;
      if (priorita !== undefined && priorita !== null && String(priorita).trim() !== "") fields["Priorità"] = priorita;

      if (payload.Attiva !== undefined || payload.attiva !== undefined) fields["Attiva"] = toBool(payload.Attiva ?? payload.attiva);

      // Links
      const categoriaVal = payload.Categoria ?? payload.categoria;
      if (categoriaVal !== undefined) {
        if (categoriaVal === null || String(categoriaVal).trim() === "") fields["Categoria"] = [];
        else {
          const ids = await resolveLinkedIds({ table: "CATEGORIE CONTABILI", values: categoriaVal, allowMissing: true });
          fields["Categoria"] = ids.length ? [ids[0]] : [];
        }
      }

      const sottoMacroVal = payload["Sotto-macro"] ?? payload.sottoMacro;
      if (sottoMacroVal !== undefined) {
        if (sottoMacroVal === null || String(sottoMacroVal).trim() === "") fields["Sotto-macro"] = [];
        else {
          const ids = await resolveLinkedIds({ table: "SOTTO MACRO", values: sottoMacroVal, allowMissing: true });
          fields["Sotto-macro"] = ids.length ? [ids[0]] : [];
        }
      }

      const out = recordId
        ? await airtableUpdate("REGOLE MATCHING", recordId, fields)
        : (await airtableUpsertByPrimary("REGOLE MATCHING", "Nome Regola", nome, fields)).record;

      return res.status(200).json({ ok: true, record: { id: out.id, fields: out.fields || {}, createdTime: out.createdTime || "" } });
    }

    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  } catch (e) {
    const status = e.status || 500;
    return res.status(status).json({ ok: false, error: e.message || "server_error" });
  }
}

