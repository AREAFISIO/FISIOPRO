import { ensureRes, requireRoles, airtableFetch } from "../_auth.js";
import { readJsonBody, escAirtableString } from "../_common.js";
import {
  ficApiFetch,
  ficEnsureAccessToken,
  fattureListAll,
  fattureUpsertByFicDocumentId,
} from "../_fic.js";

function enc(x) {
  return encodeURIComponent(String(x ?? ""));
}
function nowIso() {
  return new Date().toISOString();
}
function toYmd(dRaw) {
  const d = dRaw ? new Date(dRaw) : new Date();
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

const TABLE_CLIENTI = process.env.AIRTABLE_CLIENTI_FIC_TABLE || "CLIENTI_FIC";

async function airtableGetClientiFicRecord(airtableId) {
  const id = String(airtableId || "").trim();
  if (!id) return null;
  const tableEnc = enc(TABLE_CLIENTI);
  return await airtableFetch(`${tableEnc}/${enc(id)}`);
}

function buildFilterFormula({ anno, stato, clienteAirtableId, from, to } = {}) {
  const parts = [];
  const y = String(anno || "").trim();
  if (y) parts.push(`VALUE({Anno})=${Number(y) || 0}`);
  const s = String(stato || "").trim();
  if (s) parts.push(`{Stato}="${escAirtableString(s)}"`);
  const c = String(clienteAirtableId || "").trim();
  if (c) parts.push(`FIND("${escAirtableString(c)}", ARRAYJOIN({Cliente}))`);

  const f = String(from || "").trim();
  if (f) parts.push(`IS_AFTER({Data}, DATETIME_PARSE("${escAirtableString(f)}"))`);
  const t = String(to || "").trim();
  if (t) parts.push(`IS_BEFORE({Data}, DATETIME_PARSE("${escAirtableString(t)}"))`);

  if (!parts.length) return "";
  return `AND(${parts.join(",")})`;
}

export default async function handler(req, res) {
  ensureRes(res);
  const user = requireRoles(req, res, ["front", "manager"]);
  if (!user) return;

  try {
    if (req.method === "GET") {
      const formula = buildFilterFormula({
        anno: req.query?.anno,
        stato: req.query?.stato,
        clienteAirtableId: req.query?.cliente,
        from: req.query?.from,
        to: req.query?.to,
      });
      const records = await fattureListAll({ filterFormula: formula, maxRecords: 1000 });
      const items = (records || []).map((r) => {
        const f = r.fields || {};
        return {
          airtableId: r.id,
          ficDocumentId: String(f["FIC Document ID"] || ""),
          numero: String(f["Numero"] || ""),
          anno: String(f["Anno"] || ""),
          data: String(f["Data"] || ""),
          cliente: Array.isArray(f["Cliente"]) ? String(f["Cliente"][0] || "") : "",
          importoTotale: f["Importo Totale"] ?? null,
          stato: String(f["Stato"] || ""),
          tipoDocumento: String(f["Tipo Documento"] || ""),
          pdfUrl: String(f["PDF URL Temporaneo"] || ""),
          createdAt: String(f["Data creazione"] || ""),
          creatoDa: String(f["Creato da"] || ""),
        };
      });
      return res.status(200).json({ ok: true, items });
    }

    if (req.method === "POST") {
      const body = await readJsonBody(req);
      if (!body) return res.status(400).json({ ok: false, error: "invalid_json" });

      const clienteAirtableId = String(body.clienteAirtableId || body.cliente || "").trim();
      if (!clienteAirtableId) return res.status(400).json({ ok: false, error: "missing_cliente" });

      const tipoDocumento = String(body.tipoDocumento || "fattura").trim().toLowerCase();
      const ficType = tipoDocumento === "ricevuta" ? "receipt" : "invoice";

      // Medical VAT exemption (Art. 10)
      // Enforced server-side to prevent mistakes from frontend.
      const esenteArt10 = Boolean(body.esenteArt10);
      const ART10_REASON = String(process.env.FIC_ART10_EXEMPT_REASON || "Esente IVA art. 10 DPR 633/72").trim();
      // For e-invoicing, nature "N4" is commonly used for exemptions.
      // If your FIC account/document type doesn't accept it, set FIC_ART10_VAT_NATURE="" to omit.
      const ART10_NATURE = String(process.env.FIC_ART10_VAT_NATURE || "N4").trim();

      const righe = Array.isArray(body.righe) ? body.righe : [];
      if (!righe.length) return res.status(400).json({ ok: false, error: "missing_righe" });

      const dataDoc = toYmd(body.data || body.dataDocumento);
      const note = String(body.note || "").trim();

      const clienteRec = await airtableGetClientiFicRecord(clienteAirtableId);
      const ficClientId = String(clienteRec?.fields?.["FIC Client ID"] || "").trim();
      if (!ficClientId) return res.status(409).json({ ok: false, error: "cliente_fic_missing" });

      const { companyId, accessToken } = await ficEnsureAccessToken();

      const items_list = righe.map((r) => {
        const descr = String(r.descrizione || r.name || "").trim() || "Prestazione";
        const qty = Number(r.qty ?? r.quantita ?? 1) || 1;
        const net = Number(r.net_price ?? r.prezzo ?? r.importo ?? 0) || 0;
        const iva = r.ivaPercent !== undefined ? Number(r.ivaPercent) : Number(r.iva ?? 0);

        // VAT handling:
        // - if esenteArt10 => force VAT 0 + exemption reason
        // - else => use IVA% from row, optional exempt_reason
        const vat = esenteArt10
          ? {
              value: 0,
              exempt_reason: ART10_REASON,
              ...(ART10_NATURE ? { nature: ART10_NATURE } : {}),
            }
          : (Number.isFinite(iva) ? { value: iva } : { value: 0 });

        const exempt = String(r.esenzione || r.exempt_reason || "").trim();
        if (!esenteArt10 && exempt) vat.exempt_reason = exempt;

        return {
          name: descr,
          qty,
          net_price: net,
          vat,
        };
      });

      // Create issued document on FIC.
      const created = await ficApiFetch(`/v2/entities/${enc(companyId)}/issued_documents`, {
        method: "POST",
        accessToken,
        jsonBody: {
          type: ficType,
          entity: { client_id: ficClientId },
          date: dataDoc,
          subject: note || undefined,
          items_list,
        },
      });

      const doc = created?.data || created;
      const documentId = String(doc?.id ?? "").trim();
      if (!documentId) return res.status(502).json({ ok: false, error: "fic_document_create_failed" });

      const numero = doc?.number ?? doc?.numeration ?? "";
      const anno = doc?.year ?? new Date(dataDoc).getFullYear();
      const importoTotale = doc?.amount_gross ?? doc?.total ?? doc?.amount_total ?? null;
      const stato = String(doc?.status ?? "created");

      const pdfUrl = `/api/fic/fatture/${encodeURIComponent(documentId)}/pdf`;

      // Track into Airtable
      await fattureUpsertByFicDocumentId(documentId, {
        Numero: String(numero ?? ""),
        Anno: Number(anno) || new Date().getFullYear(),
        Data: dataDoc,
        Cliente: [clienteAirtableId],
        "Importo Totale": importoTotale ?? null,
        Stato: stato,
        "Tipo Documento": tipoDocumento,
        "PDF URL Temporaneo": pdfUrl,
        "PDF Scaricato": false,
        "Data creazione": nowIso(),
        "Creato da": String(user.email || ""),
      });

      return res.status(200).json({
        ok: true,
        documentId,
        pdfUrl,
        numero: String(numero ?? ""),
        anno: Number(anno) || null,
        importoTotale: importoTotale ?? null,
        stato,
      });
    }

    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  } catch (e) {
    const status = e?.status || 500;
    return res.status(status).json({
      ok: false,
      error: e?.message || "server_error",
      detail: e?.fic || undefined,
    });
  }
}

