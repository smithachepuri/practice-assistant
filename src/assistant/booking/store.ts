export interface Appointment {
  confirmationCode: string;
  patientName: string;
  /** Ten digits, no formatting. */
  phone: string;
  reason: string;
  /** Local start time, "YYYY-MM-DDTHH:mm". */
  start: string;
  durationMinutes: number;
  status: "booked" | "cancelled";
}

/**
 * Where appointments are kept. The demo uses memory; a host application supplies
 * its own implementation (for example, backed by a database table).
 */
export interface AppointmentStore {
  list(): Promise<Appointment[]>;
  findByCode(confirmationCode: string): Promise<Appointment | undefined>;
  save(appointment: Appointment): Promise<void>;
}

export class InMemoryAppointmentStore implements AppointmentStore {
  private readonly appointments = new Map<string, Appointment>();

  async list(): Promise<Appointment[]> {
    return [...this.appointments.values()].map((appointment) => ({ ...appointment }));
  }

  async findByCode(confirmationCode: string): Promise<Appointment | undefined> {
    const found = this.appointments.get(confirmationCode.toUpperCase());
    return found ? { ...found } : undefined;
  }

  async save(appointment: Appointment): Promise<void> {
    this.appointments.set(appointment.confirmationCode.toUpperCase(), { ...appointment });
  }
}
