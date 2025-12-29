export type Appointment = {
  id: string;

  patient_id: string;
  patient_name: string;

  start_at: string; // ISO
  end_at: string;   // ISO

  status?: string;      // es: "Non ancora eseguito"
  appointment_type?: string; // es: "Prima visita"

  service_id?: string;
  service_name?: string; // es: "FASDAC"
  price_label?: string;  // es: "FASDAC (€ 70.00)"
  duration?: number | string;
  duration_label?: string; // es: "1 ora"

  therapist_id?: string;
  therapist_name?: string; // es: "Andrea Franceschelli"
  location_id?: string;
  location_name?: string;  // es: "SEDE DI BOLOGNA"

  tipi_erogati?: string[] | string;
  valutazioni_ids?: string[];
  trattamenti_ids?: string[];
  erogato_id?: string;
  caso_clinico_id?: string;
  vendita_id?: string;

  quick_note?: string;
  notes?: string;
  internal_note?: string;
  patient_note?: string;

  confirmed_by_patient?: boolean;
  confirmed_in_platform?: boolean;
};
