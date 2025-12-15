"use client";

import * as React from "react";
import Link from "next/link";
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
      const res = await fetch(`/api/appointments/${appt.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: form.status ?? null,
          service_name: form.service_name ?? null,
          price_label: form.price_label ?? null,
          duration_label: form.duration_label ?? null,
          therapist_name: form.therapist_name ?? null,
          location_name: form.location_name ?? null,
          internal_note: form.internal_note ?? null,
          patient_note: form.patient_note ?? null,
          confirmed_by_patient: !!form.confirmed_by_patient,
          confirmed_in_platform: !!form.confirmed_in_platform,
        }),
      });

      if (!res.ok) throw new Error(await res.text());
      const updated = (await res.json()) as Appointment;
      onSaved?.(updated);
      onClose();
    } catch (e) {
      console.error(e);
      alert("Errore salvataggio appuntamento. Controlla console/log.");
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
            <div className="oe-modal__patientname">{appt.patient_name}</div>
            <Link className="oe-modal__patientlink" href={`/pazienti/${appt.patient_id}`}>
              Apri scheda paziente
            </Link>
          </div>

          <div className="oe-grid">
            <label className="oe-field">
              <span>Esito appuntamento</span>
              <input
                value={form.status ?? ""}
                onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))}
                placeholder="Es. Non ancora eseguito"
              />
            </label>

            <label className="oe-field">
              <span>Voce prezzario</span>
              <input
                value={form.price_label ?? ""}
                onChange={(e) => setForm((p) => ({ ...p, price_label: e.target.value }))}
                placeholder="Es. FASDAC (€ 70.00)"
              />
            </label>

            <label className="oe-field">
              <span>Servizio</span>
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
              <span>Agenda / Operatore</span>
              <input
                value={form.therapist_name ?? ""}
                onChange={(e) => setForm((p) => ({ ...p, therapist_name: e.target.value }))}
                placeholder="Es. Andrea Franceschelli"
              />
            </label>

            <label className="oe-field">
              <span>Luogo</span>
              <input
                value={form.location_name ?? ""}
                onChange={(e) => setForm((p) => ({ ...p, location_name: e.target.value }))}
                placeholder="Es. SEDE DI BOLOGNA"
              />
            </label>

            <label className="oe-field oe-field--check">
              <input
                type="checkbox"
                checked={!!form.confirmed_by_patient}
                onChange={(e) =>
                  setForm((p) => ({ ...p, confirmed_by_patient: e.target.checked }))
                }
              />
              <span>Confermato dal paziente</span>
            </label>

            <label className="oe-field oe-field--check">
              <input
                type="checkbox"
                checked={!!form.confirmed_in_platform}
                onChange={(e) =>
                  setForm((p) => ({ ...p, confirmed_in_platform: e.target.checked }))
                }
              />
              <span>Conferma in piattaforma</span>
            </label>

            <label className="oe-field oe-field--wide">
              <span>Note interne</span>
              <textarea
                value={form.internal_note ?? ""}
                onChange={(e) => setForm((p) => ({ ...p, internal_note: e.target.value }))}
                maxLength={255}
              />
            </label>

            <label className="oe-field oe-field--wide">
              <span>Note visibili al paziente</span>
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
