export type Appointment = {
  id: string;

  patient_id: string;
  patient_name: string;

  start_at: string; // ISO
  end_at: string;   // ISO

  status?: string;      // es: "Non ancora eseguito"
  service_name?: string; // es: "FASDAC"
  price_label?: string;  // es: "FASDAC (€ 70.00)"
  duration_label?: string; // es: "1 ora"

  therapist_name?: string; // es: "Andrea Franceschelli"
  location_name?: string;  // es: "SEDE DI BOLOGNA"

  internal_note?: string;
  patient_note?: string;

  confirmed_by_patient?: boolean;
  confirmed_in_platform?: boolean;
};
