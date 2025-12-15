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
          service_name: form.service_name ?? "",
          duration_label: form.duration_label ?? "",
          therapist_name: form.therapist_name ?? "",
          internal_note: form.internal_note ?? "",
          patient_note: form.patient_note ?? "",
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(json));

      onSaved?.(json as Appointment);
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
            <div className="oe-modal__patientname">{appt.patient_name || "Paziente"}</div>

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
              <span>Stato</span>
              <input
                value={form.status ?? ""}
                onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))}
                placeholder="Es. Non ancora eseguito"
              />
            </label>

            <label className="oe-field">
              <span>Prestazione</span>
              <input
                value={form.service_name ?? ""}
                onChange={(e) => setForm((p) => ({ ...p, service_name: e.target.value }))}
                placeholder="Es. FASDAC"
              />
            </label>

            <label className="oe-field">
              <span>Durata</span>
              <input
                value={form.duration_label ?? ""}
                onChange={(e) => setForm((p) => ({ ...p, duration_label: e.target.value }))}
                placeholder="Es. 1 ora"
              />
            </label>

            <label className="oe-field">
              <span>Operatore</span>
              <input
                value={form.therapist_name ?? ""}
                onChange={(e) => setForm((p) => ({ ...p, therapist_name: e.target.value }))}
                placeholder="Es. Andrea Franceschelli"
              />
            </label>

            <label className="oe-field oe-field--wide">
              <span>Nota rapida (interna)</span>
              <textarea
                value={form.internal_note ?? ""}
                onChange={(e) => setForm((p) => ({ ...p, internal_note: e.target.value }))}
                maxLength={255}
              />
            </label>

            <label className="oe-field oe-field--wide">
              <span>Note</span>
              <textarea
                value={form.patient_note ?? ""}
                onChange={(e) => setForm((p) => ({ ...p, patient_note: e.target.value }))}
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
