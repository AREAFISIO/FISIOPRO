"use client";

import * as React from "react";
import type { Appointment } from "./types";
import { AppointmentHoverCard } from "./AppointmentHoverCard";
import { AppointmentModal } from "./AppointmentModal";

type Props = {
  appt: Appointment;
  children?: React.ReactNode; // se già renderizzi un blocco colorato, lo passi qui
  onUpdated?: (updated: Appointment) => void;
};

export function AppointmentBlock({ appt, children, onUpdated }: Props) {
  const [hover, setHover] = React.useState(false);
  const [pos, setPos] = React.useState({ x: 0, y: 0 });
  const [open, setOpen] = React.useState(false);

  function onMove(e: React.MouseEvent) {
    setPos({ x: e.clientX, y: e.clientY });
  }

  return (
    <>
      <div
        className="oe-apptwrap"
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onMouseMove={onMove}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        {children ?? <div className="oe-apptfallback">{appt.patient_name}</div>}
      </div>

      <AppointmentHoverCard appt={appt} open={hover && !open} x={pos.x} y={pos.y} />

      <AppointmentModal
        appt={appt}
        open={open}
        onClose={() => setOpen(false)}
        onSaved={(u) => onUpdated?.(u)}
      />
    </>
  );
}
