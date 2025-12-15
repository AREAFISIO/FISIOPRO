"use client";

import * as React from "react";
import type { Appointment } from "./types";

function fmtTime(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

type Props = {
  appt: Appointment;
  open: boolean;
  x: number;
  y: number;
};

export function AppointmentHoverCard({ appt, open, x, y }: Props) {
  if (!open) return null;

  return (
    <div
      className="oe-hovercard"
      style={{ left: x + 12, top: y + 12 }}
      role="dialog"
      aria-label="Dettagli appuntamento (preview)"
    >
      <div className="oe-hovercard__title">{appt.patient_name}</div>

      <div className="oe-hovercard__row">
        <span className="oe-dot" />
        <span>{fmtTime(appt.start_at)}</span>
      </div>

      {appt.status ? (
        <div className="oe-hovercard__row">
          <span className="oe-dot oe-dot--warn" />
          <span>{appt.status}</span>
        </div>
      ) : null}

      {appt.service_name ? (
        <div className="oe-hovercard__row">
          <span className="oe-ic">🏷️</span>
          <span>{appt.service_name}</span>
        </div>
      ) : null}

      {appt.therapist_name ? (
        <div className="oe-hovercard__row">
          <span className="oe-ic">👤</span>
          <span>{appt.therapist_name}</span>
        </div>
      ) : null}

      {appt.location_name ? (
        <div className="oe-hovercard__row">
          <span className="oe-ic">📍</span>
          <span>{appt.location_name}</span>
        </div>
      ) : null}

      {appt.internal_note ? (
        <div className="oe-hovercard__note">{appt.internal_note}</div>
      ) : null}
    </div>
  );
}
