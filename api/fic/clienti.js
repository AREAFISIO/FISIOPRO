import { ensureRes, requireRoles } from "../_auth.js";
import { readJsonBody } from "../_common.js";
import { airtableFetch } from "../_auth.js";
import {
  clientiFicFindByPatientId,
  clientiFicListAll,
  ficApiFetch,
  ficEnsureAccessToken,
} from "../_fic.js";

function enc(x) {
  return encodeURIComponent(String(x ?? ""));
}

function nowIso() {
  return new Date().toISOString();
}

const TABLE_CLIENTI = process.env.AIRTABLE_CLIENTI_FIC_TABLE || "CLIENTI_FIC";

async function airtableCreateClientMapping(fields) {
  const tableEnc = enc(TABLE_CLIENTI);
  return await airtableFetch(`${tableEnc}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ records: [{ fields }] }),
  });
}

async function airtableUpdateClientMapping(recordId, fields) {
  const tableEnc = enc(TABLE_CLIENTI);
  return await airtableFetch(`${tableEnc}/${enc(recordId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields }),
  });
}

export default async function handler(req, res) {
  ensureRes(res);
  const user = requireRoles(req, res, ["front", "manager"]);
  if (!user) return;

  try {
    if (req.method === "GET") {
      const patientId = String(req.query?.patientId || "").trim();
      if (patientId) {
        const existing = await clientiFicFindByPatientId(patientId);
        const f = existing?.fields || {};
        return res.status(200).json({
          ok: true,
          item: existing
            ? {
                airtableId: existing.id,
                patientId,
                ficClientId: String(f["FIC Client ID"] || ""),
                nome: String(f["Nome"] || ""),
                cognome: String(f["Cognome"] || ""),
                email: String(f["Email"] || ""),
                codiceFiscale: String(f["Codice Fiscale"] || ""),
                creatoSuFic: Boolean(f["Creato su FIC"]),
                ultimaSync: String(f["Ultima sincronizzazione"] || ""),
              }
            : null,
        });
      }

      const records = await clientiFicListAll({ maxRecords: 1000 });
      const items = (records || []).map((r) => {
        const f = r.fields || {};
        return {
          airtableId: r.id,
          patientId: Array.isArray(f["Paziente"]) ? String(f["Paziente"][0] || "") : "",
          ficClientId: String(f["FIC Client ID"] || ""),
          nome: String(f["Nome"] || ""),
          cognome: String(f["Cognome"] || ""),
          email: String(f["Email"] || ""),
          codiceFiscale: String(f["Codice Fiscale"] || ""),
          creatoSuFic: Boolean(f["Creato su FIC"]),
          ultimaSync: String(f["Ultima sincronizzazione"] || ""),
        };
      });
      return res.status(200).json({ ok: true, items });
    }

    if (req.method === "POST") {
      const body = await readJsonBody(req);
      if (!body) return res.status(400).json({ ok: false, error: "invalid_json" });

      const patientId = String(body.patientId || "").trim();
      if (!patientId) return res.status(400).json({ ok: false, error: "missing_patientId" });

      const nome = String(body.nome || "").trim();
      const cognome = String(body.cognome || "").trim();
      const email = String(body.email || "").trim();
      const codiceFiscale = String(body.codiceFiscale || "").trim();

      const existing = await clientiFicFindByPatientId(patientId);
      const existingFicId = String(existing?.fields?.["FIC Client ID"] || "").trim();
      const existingCreated = Boolean(existing?.fields?.["Creato su FIC"]);

      if (existing && existingFicId && existingCreated) {
        return res.status(200).json({
          ok: true,
          alreadyExists: true,
          airtableId: existing.id,
          ficClientId: existingFicId,
        });
      }

      const { companyId, accessToken } = await ficEnsureAccessToken();

      // FIC client create (minimal payload, compatible with most configurations).
      const ficClient = await ficApiFetch(`/v2/entities/${enc(companyId)}/clients`, {
        method: "POST",
        accessToken,
        jsonBody: {
          name: [cognome, nome].filter(Boolean).join(" ").trim() || [nome, cognome].filter(Boolean).join(" "),
          email: email || undefined,
          tax_code: codiceFiscale || undefined,
        },
      });

      const ficClientId =
        String(ficClient?.data?.id ?? ficClient?.id ?? ficClient?.client_id ?? "").trim();
      if (!ficClientId) return res.status(502).json({ ok: false, error: "fic_client_create_failed" });

      const fields = {
        Paziente: [patientId],
        "FIC Client ID": ficClientId,
        Nome: nome,
        Cognome: cognome,
        "Codice Fiscale": codiceFiscale,
        Email: email,
        "Creato su FIC": true,
        "Ultima sincronizzazione": nowIso(),
      };

      let airtableId = "";
      if (existing?.id) {
        await airtableUpdateClientMapping(existing.id, fields);
        airtableId = existing.id;
      } else {
        const created = await airtableCreateClientMapping(fields);
        airtableId = created?.records?.[0]?.id || "";
      }

      return res.status(200).json({
        ok: true,
        airtableId,
        ficClientId,
      });
    }

    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  } catch (e) {
    const status = e?.status || 500;
    return res.status(status).json({ ok: false, error: e?.message || "server_error" });
  }
}

