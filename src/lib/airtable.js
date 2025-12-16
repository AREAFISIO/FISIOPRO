// src/lib/airtable.ts
type AirtableRecord<T> = { id: string; fields: T };

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN!;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID!;
const COLLAB_TABLE = process.env.AIRTABLE_COLLABORATORI_TABLE || "COLLABORATORI";

function mustEnv() {
  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) {
    throw new Error("Missing AIRTABLE_TOKEN or AIRTABLE_BASE_ID");
  }
}

export type CollaboratoreFields = {
  Email?: string;
  Ruolo?: string;
  Attivo?: boolean;
  Nome?: string;
  "Codice accesso"?: string;
};

export async function airtableFindCollaboratoreByEmail(email: string) {
  mustEnv();
  const table = encodeURIComponent(COLLAB_TABLE);
  const filter = encodeURIComponent(`LOWER({Email}) = LOWER("${email}")`);
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${table}?filterByFormula=${filter}&maxRecords=1`;

  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` },
    cache: "no-store",
  });

  if (!r.ok) throw new Error(`Airtable error ${r.status}: ${await r.text()}`);

  const data = await r.json();
  return (data.records?.[0] as AirtableRecord<CollaboratoreFields> | undefined) || null;
}
