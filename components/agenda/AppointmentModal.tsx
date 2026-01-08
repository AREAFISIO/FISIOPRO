"use client";

import * as React from "react";
import type { Appointment } from "./types";

type Props = {
  appt: Appointment | null;
  open: boolean;
  onClose: () => void;
  onSaved?: (updated: Appointment) => void;
};

export function AppointmentModal({ appt, open, onClose, onSaved }: Props) {
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState<Partial<Appointment>>({});

  React.useEffect(() => {
    if (appt) setForm(appt);
  }, [appt]);

  if (!open || !appt) return null;

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/appointments?id=${encodeURIComponent(appt.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: form.status ?? "",
          appointment_type: form.appointment_type ?? "",
          serviceId: form.service_id ?? "",
          collaboratoreId: form.therapist_id ?? "",
          sedeId: form.location_id ?? "",
          durata: form.duration ?? "",
          tipiErogati:
            typeof form.tipi_erogati === "string"
              ? form.tipi_erogati.split(",").map((x) => x.trim()).filter(Boolean)
              : (form.tipi_erogati ?? []),
          valutazioniIds:
            typeof (form.valutazioni_ids as any) === "string"
              ? String(form.valutazioni_ids).split(",").map((x) => x.trim()).filter(Boolean)
              : (form.valutazioni_ids ?? []),
          trattamentiIds:
            typeof (form.trattamenti_ids as any) === "string"
              ? String(form.trattamenti_ids).split(",").map((x) => x.trim()).filter(Boolean)
              : (form.trattamenti_ids ?? []),
          erogatoId: form.erogato_id ?? "",
          casoClinicoId: form.caso_clinico_id ?? "",
          venditaId: form.vendita_id ?? "",
          notaRapida: form.quick_note ?? form.internal_note ?? "",
          note: form.notes ?? form.patient_note ?? "",
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(json));

      const updated = (json?.appointment ?? json) as Appointment;
      onSaved?.(updated);
      onClose();
    } catch (e) {
      console.error(e);
      alert("Errore salvataggio su Airtable. Apri Console/Network per vedere il motivo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="oe-modal__backdrop" role="dialog" aria-modal="true">
      <div className="oe-modal">
        <div className="oe-modal__header">
          <div className="oe-modal__title">Dettagli appuntamento</div>
          <button className="oe-modal__x" onClick={onClose} aria-label="Chiudi">
            ×
          </button>
        </div>

        <div className="oe-modal__body">
          <div className="oe-modal__patientline">
            <div className="oe-modal__patientname">{appt.patient_name || ""}</div>

            {/* LINK scheda paziente:
               nel tuo progetto è una pagina HTML "paziente.html".
               Qui metto un link semplice con query ?id=
            */}
            <a className="oe-modal__patientlink" href={`/pages/paziente.html?id=${encodeURIComponent(appt.patient_id || "")}`}>
              Apri scheda paziente
            </a>
          </div>

          <div className="oe-grid">
            <label className="oe-field">
              <span>Data e ora INIZIO</span>
              <input value={appt.start_at ?? ""} disabled />
            </label>

            <label className="oe-field">
              <span>Data e ora fine</span>
              <input value={appt.end_at ?? ""} disabled />
            </label>

            <label className="oe-field">
              <span>Stato appuntamento</span>
              <input
                value={form.status ?? ""}
                onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))}
                placeholder="Es. Non ancora eseguito"
              />
            </label>

            <label className="oe-field">
              <span>Tipo appuntamento</span>
              <input
                value={form.appointment_type ?? ""}
                onChange={(e) => setForm((p) => ({ ...p, appointment_type: e.target.value }))}
                placeholder="Es. Prima visita"
              />
            </label>

            <label className="oe-field">
              <span>Prestazione (record id)</span>
              <input
                value={form.service_id ?? ""}
                onChange={(e) => setForm((p) => ({ ...p, service_id: e.target.value }))}
                placeholder="rec..."
              />
            </label>

            <label className="oe-field">
              <span>Collaboratore (record id)</span>
              <input
                value={form.therapist_id ?? ""}
                onChange={(e) => setForm((p) => ({ ...p, therapist_id: e.target.value }))}
                placeholder="rec..."
              />
            </label>

            <label className="oe-field">
              <span>Sede (record id)</span>
              <input
                value={form.location_id ?? ""}
                onChange={(e) => setForm((p) => ({ ...p, location_id: e.target.value }))}
                placeholder="rec..."
              />
            </label>

            <label className="oe-field">
              <span>Durata (min)</span>
              <input
                value={String(form.duration ?? "")}
                onChange={(e) => setForm((p) => ({ ...p, duration: e.target.value }))}
                placeholder="60"
              />
            </label>

            <label className="oe-field oe-field--wide">
              <span>Tipi Erogati (separati da virgola)</span>
              <input
                value={Array.isArray(form.tipi_erogati) ? form.tipi_erogati.join(", ") : (form.tipi_erogati ?? "")}
                onChange={(e) => setForm((p) => ({ ...p, tipi_erogati: e.target.value }))}
                placeholder="FKT, MASSO"
              />
            </label>

            <label className="oe-field">
              <span>VALUTAZIONI (ids, virgola)</span>
              <input
                value={(form.valutazioni_ids ?? []).join(", ")}
                onChange={(e) => setForm((p) => ({ ...p, valutazioni_ids: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) }))}
                placeholder="rec..., rec..."
              />
            </label>

            <label className="oe-field">
              <span>TRATTAMENTI (ids, virgola)</span>
              <input
                value={(form.trattamenti_ids ?? []).join(", ")}
                onChange={(e) => setForm((p) => ({ ...p, trattamenti_ids: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) }))}
                placeholder="rec..., rec..."
              />
            </label>

            <label className="oe-field">
              <span>Erogato collegato (id)</span>
              <input
                value={form.erogato_id ?? ""}
                onChange={(e) => setForm((p) => ({ ...p, erogato_id: e.target.value }))}
                placeholder="rec..."
              />
            </label>

            <label className="oe-field">
              <span>Caso clinico (id)</span>
              <input
                value={form.caso_clinico_id ?? ""}
                onChange={(e) => setForm((p) => ({ ...p, caso_clinico_id: e.target.value }))}
                placeholder="rec..."
              />
            </label>

            <label className="oe-field">
              <span>Vendita collegata (id)</span>
              <input
                value={form.vendita_id ?? ""}
                onChange={(e) => setForm((p) => ({ ...p, vendita_id: e.target.value }))}
                placeholder="rec..."
              />
            </label>

            <label className="oe-field oe-field--wide">
              <span>Nota rapida</span>
              <textarea
                value={form.quick_note ?? form.internal_note ?? ""}
                onChange={(e) => setForm((p) => ({ ...p, quick_note: e.target.value }))}
                maxLength={255}
              />
            </label>

            <label className="oe-field oe-field--wide">
              <span>Note</span>
              <textarea
                value={form.notes ?? form.patient_note ?? ""}
                onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                maxLength={255}
              />
            </label>
          </div>
        </div>

        <div className="oe-modal__footer">
          <button className="oe-btn" onClick={onClose} disabled={saving}>
            Annulla
          </button>
          <button className="oe-btn oe-btn--primary" onClick={save} disabled={saving}>
            {saving ? "Salvataggio..." : "Chiudi"}
          </button>
        </div>
      </div>
    </div>
  );
}
