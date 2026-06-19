-- ============================================================
-- SQL SCHEMA FOR LISANDRO'S CONSORCIOS APP
-- Represents a relational PostgreSQL representation of db.json
-- ============================================================

CREATE SCHEMA IF NOT EXISTS app;
SET search_path TO app, public;

-- ============================================================
-- CONSORCIOS
-- ============================================================
CREATE TABLE consorcios (
    cuit              VARCHAR(20) PRIMARY KEY, -- Cleaned CUIT (digits only)
    nombre            VARCHAR(255) NOT NULL,
    suterh_key        VARCHAR(255),
    bank_name         VARCHAR(255),
    bank_titular      VARCHAR(255),
    bank_account_number VARCHAR(255),
    bank_cbu          VARCHAR(22),
    bank_alias        VARCHAR(255),
    interest_rate     NUMERIC(5, 4) DEFAULT 0.03,
    due_day           INTEGER DEFAULT 10,
    divisor_a         INTEGER DEFAULT 100,
    divisor_b         INTEGER DEFAULT 100,
    category          VARCHAR(50),
    cochera           BOOLEAN DEFAULT false,
    jardin            BOOLEAN DEFAULT false,
    pileta            BOOLEAN DEFAULT false,
    movimiento_coches BOOLEAN DEFAULT false,
    zona_desfavorable BOOLEAN DEFAULT false,
    caldera           BOOLEAN DEFAULT false,
    art_rate          NUMERIC(5, 4),
    scvo_fijo         NUMERIC(10, 2),
    created_at        TIMESTAMPTZ DEFAULT now(),
    updated_at        TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- UNIDADES FUNCIONALES
-- ============================================================
CREATE TABLE unidades (
    id                SERIAL PRIMARY KEY,
    consorcio_cuit    VARCHAR(20) NOT NULL REFERENCES consorcios(cuit) ON DELETE CASCADE,
    uf                INTEGER NOT NULL,
    depto             VARCHAR(50),
    nombre_propietario VARCHAR(255),
    email             VARCHAR(255),
    phone             VARCHAR(50),
    coef_a            NUMERIC(7, 4) NOT NULL CHECK (coef_a >= 0),
    coef_b            NUMERIC(7, 4) NOT NULL CHECK (coef_b >= 0),
    created_at        TIMESTAMPTZ DEFAULT now(),
    updated_at        TIMESTAMPTZ DEFAULT now(),
    UNIQUE (consorcio_cuit, uf)
);

-- ============================================================
-- EMPLEADOS
-- ============================================================
CREATE TABLE empleados (
    cuil              VARCHAR(20) PRIMARY KEY, -- Cleaned CUIL (digits only)
    nombre            VARCHAR(255) NOT NULL,
    consorcio_cuit    VARCHAR(20) NOT NULL REFERENCES consorcios(cuit) ON DELETE CASCADE,
    fecha_ingreso     DATE NOT NULL,
    categoria         VARCHAR(50),
    funcion           VARCHAR(255),
    banco             VARCHAR(255),
    cbu               VARCHAR(255),
    plus_jardin       BOOLEAN DEFAULT false,
    plus_pileta       BOOLEAN DEFAULT false,
    plus_cochera      BOOLEAN DEFAULT false,
    plus_movimiento_coches BOOLEAN DEFAULT false,
    created_at        TIMESTAMPTZ DEFAULT now(),
    updated_at        TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- PERIODOS DE LIQUIDACION
-- ============================================================
CREATE TABLE periodos (
    id                SERIAL PRIMARY KEY,
    consorcio_cuit    VARCHAR(20) NOT NULL REFERENCES consorcios(cuit) ON DELETE CASCADE,
    periodo           VARCHAR(7) NOT NULL CHECK (periodo ~ '^\d{4}-\d{2}$'), -- Formato "YYYY-MM"
    file_found        BOOLEAN DEFAULT false,
    is_sac_separate   BOOLEAN DEFAULT false,
    total_pagos_a_b   NUMERIC(12, 2) DEFAULT 0,
    total_gastos_particulares NUMERIC(12, 2) DEFAULT 0,
    total_previsiones NUMERIC(12, 2) DEFAULT 0,
    total_prorrateo_a_b NUMERIC(12, 2) DEFAULT 0,
    
    -- ResCuenta Totals
    res_totals_saldo_anterior NUMERIC(12, 2) DEFAULT 0,
    res_totals_su_pago       NUMERIC(12, 2) DEFAULT 0,
    res_totals_expensas_a    NUMERIC(12, 2) DEFAULT 0,
    res_totals_expensas_b    NUMERIC(12, 2) DEFAULT 0,
    res_totals_s_asamblea    NUMERIC(12, 2) DEFAULT 0,
    res_totals_otros         NUMERIC(12, 2) DEFAULT 0,
    res_totals_gast_part     NUMERIC(12, 2) DEFAULT 0,
    res_totals_total_mes     NUMERIC(12, 2) DEFAULT 0,
    res_totals_deuda         NUMERIC(12, 2) DEFAULT 0,
    res_totals_intereses     NUMERIC(12, 2) DEFAULT 0,
    res_totals_total_pagar   NUMERIC(12, 2) DEFAULT 0,
    
    created_at        TIMESTAMPTZ DEFAULT now(),
    updated_at        TIMESTAMPTZ DEFAULT now(),
    UNIQUE (consorcio_cuit, periodo)
);

-- ============================================================
-- GASTOS DEL PERIODO (Inputs y categorizados)
-- ============================================================
CREATE TABLE gastos_periodo (
    id                SERIAL PRIMARY KEY,
    periodo_id        INTEGER NOT NULL REFERENCES periodos(id) ON DELETE CASCADE,
    categoria         VARCHAR(50) NOT NULL, -- Rubros 1 a 10 (ej: "1" para Administración, "4" para reparaciones)
    descripcion       VARCHAR(500) NOT NULL,
    monto             NUMERIC(12, 2) NOT NULL CHECK (monto >= 0),
    tipo              VARCHAR(10) NOT NULL CHECK (tipo IN ('A', 'B')), -- Coeficiente A o B
    
    -- Campos opcionales para gastos que aplican a unidades específicas
    uf                INTEGER,
    depto             VARCHAR(50),
    nombre            VARCHAR(255),
    
    created_at        TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- DETALLE DE CUENTAS CORRIENTES POR PERIODO (resCuenta)
-- ============================================================
CREATE TABLE res_cuenta_periodo (
    id                SERIAL PRIMARY KEY,
    periodo_id        INTEGER NOT NULL REFERENCES periodos(id) ON DELETE CASCADE,
    uf                INTEGER NOT NULL,
    depto             VARCHAR(50),
    nombre            VARCHAR(255),
    coef_a            NUMERIC(7, 4) NOT NULL,
    coef_b            NUMERIC(7, 4) NOT NULL,
    saldo_anterior    NUMERIC(12, 2) DEFAULT 0,
    su_pago           NUMERIC(12, 2) DEFAULT 0,
    expensas_a        NUMERIC(12, 2) DEFAULT 0,
    expensas_b        NUMERIC(12, 2) DEFAULT 0,
    s_asamblea        NUMERIC(12, 2) DEFAULT 0,
    otros             NUMERIC(12, 2) DEFAULT 0,
    gast_part         NUMERIC(12, 2) DEFAULT 0,
    total_mes         NUMERIC(12, 2) DEFAULT 0,
    deuda             NUMERIC(12, 2) DEFAULT 0,
    intereses         NUMERIC(12, 2) DEFAULT 0,
    total_pagar       NUMERIC(12, 2) DEFAULT 0,
    created_at        TIMESTAMPTZ DEFAULT now(),
    UNIQUE (periodo_id, uf)
);

-- ============================================================
-- PAGOS PENDIENTES (Comprobantes de transferencia por mail)
-- ============================================================
CREATE TABLE pending_payments (
    id                VARCHAR(100) PRIMARY KEY,
    sender            VARCHAR(255) NOT NULL,
    subject           VARCHAR(500) NOT NULL,
    body              TEXT,
    attachment_name   VARCHAR(255),
    
    -- Datos extraídos
    extracted_amount  NUMERIC(12, 2),
    extracted_date    VARCHAR(100),
    extracted_cuit    VARCHAR(20),
    extracted_sender_name VARCHAR(255),
    extracted_target_cbu  VARCHAR(22),
    
    -- Datos emparejados
    matched_cuit_consorcio VARCHAR(20) REFERENCES consorcios(cuit) ON DELETE SET NULL,
    matched_uf        INTEGER,
    matched_confidence VARCHAR(50), -- 'high', 'medium', 'low', 'none'
    matched_reason    TEXT,
    
    status            VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'approved', 'rejected')),
    timestamp         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices para optimizar las consultas comunes
CREATE INDEX idx_unidades_consorcio ON unidades(consorcio_cuit);
CREATE INDEX idx_empleados_consorcio ON empleados(consorcio_cuit);
CREATE INDEX idx_periodos_consorcio ON periodos(consorcio_cuit);
CREATE INDEX idx_gastos_periodo ON gastos_periodo(periodo_id);
CREATE INDEX idx_res_cuenta_periodo ON res_cuenta_periodo(periodo_id);
