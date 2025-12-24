// Shared small helpers for Vercel serverless functions (Airtable-backed).

export function enc(x) {
  return encodeURIComponent(String(x ?? ""));
}

export function norm(v) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

export function asLinkArray(id) {
  const s = norm(id);
  if (!s) return null;
  return [s];
}

export async function readJsonBody(req) {
  // Vercel may populate req.body (object or string).
  if (req?.body && typeof req.body === "object") return req.body;
  if (typeof req?.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }

  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function escAirtableString(s) {
  return String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, " ")
    .replace(/\n/g, " ")
    .trim();
}

export function filterByLinkedRecordId({ linkField, recordId }) {
  const rid = escAirtableString(recordId);
  const field = String(linkField || "").trim();
  if (!field || !rid) return "";
  return `FIND("${rid}", ARRAYJOIN({${field}}))`;
}

