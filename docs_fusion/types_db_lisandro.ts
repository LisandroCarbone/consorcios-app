// ============================================================
// TYPESCRIPT DEFINITIONS FOR LISANDRO'S CONSORCIOS APP
// Covers both the local db.json schema and the relational schema
// ============================================================

// ------------------------------------------------------------
// SECTION 1: Local db.json structure types
// ------------------------------------------------------------

export interface DbJsonStructure {
  consorcios: LocalConsorcio[];
  employees: LocalEmployee[];
  periods: Record<string, LocalPeriodData>; // Keyed by `${cuitClean}_${period}`
  pendingPayments: LocalPendingPayment[];
}

export interface LocalBankInfo {
  bankName: string;
  titular: string;
  accountNumber: string;
  cbu: string;
  alias: string;
}

export interface LocalUnit {
  uf: number;
  depto: string | number;
  nombre: string;
  coefA: number;
  coefB: number;
  email?: string;
  phone?: string;
}

export interface LocalConsorcio {
  cuit: string;
  name: string;
  suterhKey: string;
  bankInfo: LocalBankInfo;
  interestRate: number; // e.g. 0.03 for 3%
  dueDay: number;
  divisorA: number;
  divisorB: number;
  category?: string;
  cochera?: "SI" | "NO";
  jardin?: "SI" | "NO";
  pileta?: "SI" | "NO";
  movimientoCoches?: "SI" | "NO";
  zonaDesfavorable?: "SI" | "NO";
  caldera?: "SI" | "NO";
  artRate?: number;
  scvoFijo?: number;
  units: LocalUnit[];
}

export interface LocalEmployee {
  cuil: string;
  employeeName: string;
  cuitEmployer: string;
  hireDate: string; // YYYY-MM-DD
  category: string; // "1", "2", "3", "4"
  function: string;
  bank: string;
  cbu: string;
  plusJardin?: boolean;
  plusPileta?: boolean;
  plusCochera?: boolean;
  plusMovimientoCoches?: boolean;
}

export interface LocalPeriodGastos {
  category: string | number; // "1" to "10"
  description: string;
  amount: number;
  type: "A" | "B";
  uf?: number;
  depto?: string;
  nombre?: string;
}

export interface LocalResCuentaRow {
  uf: number;
  depto: string | number;
  nombre: string;
  coefA: number;
  coefB: number;
  saldoAnterior: number;
  suPago: number;
  expensasA: number;
  expensasB: number;
  sAsamblea: number;
  otros: number;
  gastPart: number;
  totalMes: number;
  deuda: number;
  intereses: number;
  totalPagar: number;
}

export interface LocalResCuentaTotals {
  saldoAnterior: number;
  suPago: number;
  expensasA: number;
  expensasB: number;
  sAsamblea: number;
  otros: number;
  gastPart: number;
  totalMes: number;
  deuda: number;
  intereses: number;
  totalPagar: number;
}

export interface LocalPeriodData {
  fileFound: boolean;
  consorcio: LocalConsorcio;
  period: string; // "YYYY-MM"
  resCuenta: LocalResCuentaRow[];
  gastos: LocalPeriodGastos[];
  provisions: any[];
  categorizedItems: Record<string, LocalPeriodGastos[]>; // Keys "1" to "10"
  previsionesItems: any[];
  totalPagosAyB: number;
  totalGastosParticulares: number;
  totalPrevisiones: number;
  totalProrrateoAyB: number;
  resCuentaTotals: LocalResCuentaTotals;
  isSacSeparate?: boolean;
  customAcu?: Record<string, number>;
}

export interface LocalPendingPayment {
  id: string;
  sender: string;
  subject: string;
  body: string;
  attachmentName: string;
  extracted: {
    amount: number;
    date: string;
    cuit: string;
    senderName: string;
    targetCbu: string;
  };
  matched: {
    cuitConsorcio: string;
    uf: number;
    confidence: "high" | "medium" | "low" | "none";
    reason: string;
  };
  status: "pending" | "resolved" | "approved" | "rejected";
  timestamp: string; // ISO String
}


// ------------------------------------------------------------
// SECTION 2: Relational SQL / Supabase types matching the schema
// ------------------------------------------------------------

export interface SqlConsorcio {
  cuit: string;
  nombre: string;
  suterh_key: string | null;
  bank_name: string | null;
  bank_titular: string | null;
  bank_account_number: string | null;
  bank_cbu: string | null;
  bank_alias: string | null;
  interest_rate: number;
  due_day: number;
  divisor_a: number;
  divisor_b: number;
  category: string | null;
  cochera: boolean;
  jardin: boolean;
  pileta: boolean;
  movimiento_coches: boolean;
  zona_desfavorable: boolean;
  caldera: boolean;
  art_rate: number | null;
  scvo_fijo: number | null;
  created_at: string;
  updated_at: string;
}

export interface SqlUnidad {
  id: number;
  consorcio_cuit: string;
  uf: number;
  depto: string | null;
  nombre_propietario: string | null;
  email: string | null;
  phone: string | null;
  coef_a: number;
  coef_b: number;
  created_at: string;
  updated_at: string;
}

export interface SqlEmpleado {
  cuil: string;
  nombre: string;
  consorcio_cuit: string;
  fecha_ingreso: string;
  categoria: string | null;
  funcion: string | null;
  banco: string | null;
  cbu: string | null;
  plus_jardin: boolean;
  plus_pileta: boolean;
  plus_cochera: boolean;
  plus_movimiento_coches: boolean;
  created_at: string;
  updated_at: string;
}

export interface SqlPeriodo {
  id: number;
  consorcio_cuit: string;
  periodo: string; // "YYYY-MM"
  file_found: boolean;
  is_sac_separate: boolean;
  total_pagos_a_b: number;
  total_gastos_particulares: number;
  total_previsiones: number;
  total_prorrateo_a_b: number;
  res_totals_saldo_anterior: number;
  res_totals_su_pago: number;
  res_totals_expensas_a: number;
  res_totals_expensas_b: number;
  res_totals_s_asamblea: number;
  res_totals_otros: number;
  res_totals_gast_part: number;
  res_totals_total_mes: number;
  res_totals_deuda: number;
  res_totals_intereses: number;
  res_totals_total_pagar: number;
  created_at: string;
  updated_at: string;
}

export interface SqlGastoPeriodo {
  id: number;
  periodo_id: number;
  categoria: string;
  descripcion: string;
  monto: number;
  tipo: "A" | "B";
  uf: number | null;
  depto: string | null;
  nombre: string | null;
  created_at: string;
}

export interface SqlResCuentaPeriodo {
  id: number;
  periodo_id: number;
  uf: number;
  depto: string | null;
  nombre: string | null;
  coef_a: number;
  coef_b: number;
  saldo_anterior: number;
  su_pago: number;
  expensas_a: number;
  expensas_b: number;
  s_asamblea: number;
  otros: number;
  gast_part: number;
  total_mes: number;
  deuda: number;
  intereses: number;
  total_pagar: number;
  created_at: string;
}

export interface SqlPendingPayment {
  id: string;
  sender: string;
  subject: string;
  body: string | null;
  attachment_name: string | null;
  extracted_amount: number | null;
  extracted_date: string | null;
  extracted_cuit: string | null;
  extracted_sender_name: string | null;
  extracted_target_cbu: string | null;
  matched_cuit_consorcio: string | null;
  matched_uf: number | null;
  matched_confidence: string | null;
  matched_reason: string | null;
  status: "pending" | "resolved" | "approved" | "rejected";
  timestamp: string;
}
