# Explicación Detallada: Pestaña "Liquidación Detallada"

Esta pestaña reúne el listado consolidado de todos los gastos que forman parte de la liquidación de expensas del período. Se compone de dos tipos de gastos:

1. **Gastos Fijos y de Sueldos (Categoría 1):** Son generados automáticamente por el sistema a partir de las liquidaciones de haberes de los empleados y las obligaciones de seguridad social e impositivas asociadas a la nómina.
2. **Gastos Variables y Servicios (Categorías 2 a 10):** Son gastos manuales (cargados en la misma pestaña) o importados de las planillas mensuales (servicios públicos, abonos de ascensor, reparaciones, etc.).

---

## 1. Gastos Generados Automáticamente (Categoría 1)

El sistema genera automáticamente 8 tipos de conceptos de gastos generales (Tipo A - Comunes) para cada consorcio a partir de la liquidación de sueldos:

### A. Sueldo Neto de cada Empleado
* **Concepto:** `[NOMBRE EMPLEADO] ([CUIL]): sueldo neto`
* **De dónde sale el valor:** Se calcula restando los descuentos sindicales y previsionales (jubilación, obra social, ley 19032, cuotas sindicales) del total bruto remunerativo, menos los anticipos entregados.
* **Fórmula:**
  $$\text{Sueldo Neto} = \text{Sueldo Bruto (Total Remunerativo)} - \text{Retenciones Obligatorias} - \text{Anticipo}$$
  * *Sueldo Bruto:* Suma del salario básico (según función del empleado y categoría de edificio en la escala) más adicionales y plus (antigüedad, horas extras 50% y 100%, feriados, plus jardín, pileta, cochera, zona desfavorable, título, retiro de residuos).
  * *Retenciones Obligatorias:* Jubilación (11%), Ley 19032 (3%), Obra Social (3%), SUTERH (2%), FATERYH (2%).

### B. SAC y Bonificaciones (si aplica)
* **Concepto:** `[NOMBRE EMPLEADO] ([CUIL]): 1° aguinaldo y bonificación`
* **De dónde sale el valor:** Se genera en los períodos correspondientes a aguinaldos (Junio y Diciembre) o cuando se liquida de manera separada. Representa el sueldo anual complementario imponible neto.

### C. ARCA AFIP F. 931: Cargas sociales: SIJP y Obra social
* **Concepto:** Aportes y contribuciones patronales a la seguridad social y obra social del período anterior (devengado en el mes anterior y abonado en el mes actual).
* **De dónde sale el valor:** Suma de aportes patronales y contribuciones del formulario 931 calculados sobre las bases imponibles del empleado:
  $$\text{Total F.931 Cargas Sociales} = \text{Aportes SS} + \text{Contribuciones SS} + \text{Aportes OS} + \text{Contribuciones OS}$$
  * **Aportes SS (Seguridad Social):** $14.45\%$ de la Remuneración Remunerativa ($11\%$ jubilación + $3\%$ Ley 19032 + $0.45\%$ ANSSAL).
  * **Aportes OS (Obra Social):** $2.55\%$ de la base de Obra Social.
  * **Contribuciones OS (Obra Social):** $5.10\%$ de la base de Obra Social.
  * **Contribuciones SS (Seguridad Social):** $18\%$ de la base de contribuciones (Remuneración Remunerativa menos la detracción de ley) + $0.90\%$ (ANSSAL Contribución) sobre la base de Obra Social.
  * *Detracción Aplicable:* Se descuenta un mínimo no imponible antes de calcular las contribuciones patronales de seguridad social:
    * Jornada completa: $\$7,003.68$
    * Media jornada: $\$3,501.84$
    * Suplentes: proporcional según los días trabajados ($\$7,003.68 \times \text{días} / 30$).
  * *Base Obra Social:* Para empleados de media jornada, el aporte y contribución de Obra Social se calcula sobre base de jornada completa aplicando el concepto de diferencia de obra social mínima (código 5150).

### D. ARCA AFIP F. 931: ART (Aseguradora de Riesgos del Trabajo)
* **Concepto:** Costo mensual de la cobertura de accidentes laborales.
* **De dónde sale el valor:** Se calcula aplicando el porcentaje de alícuota de ART sobre el sueldo bruto del empleado.
* **Fórmula:**
  $$\text{ART} = \text{Sueldo Bruto} \times \text{Alícuota ART Variable}$$
  * *Alícuota ART Variable:* Campo `% VARIABLE` definido para el consorcio en la pestaña de configuración (o `artRate` en `db.json`). Si no se define, el sistema aplica un valor por defecto del **6.39%** (`0.0639`).

### E. ARCA AFIP F. 931: SCVO (Seguro Colectivo de Vida Obligatorio)
* **Concepto:** Prima fija del seguro de vida obligatorio por empleado.
* **De dónde sale el valor:** Sumatoria del monto fijo definido para el consorcio por cada empleado activo.
* **Fórmula:**
  $$\text{SCVO Total} = \text{Cantidad de Empleados} \times \text{Costo Fijo SCVO}$$
  * *Costo Fijo SCVO:* Campo `$ SEGURO VIDA FIJO` del consorcio (o `scvoFijo` en `db.json`). Si no se define, se toma el valor obligatorio por defecto de **$424.62** por empleado.

### F. SUTERH Aportes y Contribuciones
* **Concepto:** `SUTERH [PERÍODO]`
* **De dónde sale el valor:** Contribución patronal del 4.5% obligatoria para el sindicato.
* **Fórmula:**
  $$\text{SUTERH} = \text{Sueldo Bruto (Total Remunerativo)} \times 4.5\%$$

### G. FATERYH Aportes y Contribuciones
* **Concepto:** `FATERYH [PERÍODO]`
* **De dónde sale el valor:** Aporte y contribución patronal del 6.5% obligatorio para la federación de trabajadores de edificios.
* **Fórmula:**
  $$\text{FATERYH} = \text{Sueldo Bruto (Total Remunerativo)} \times 6.5\%$$

### H. FATERYH SERACARH
* **Concepto:** `FATERYH SERACARH [PERÍODO]`
* **De dónde sale el valor:** Contribución del 0.5% destinada a financiar el Servicio de Resolución de Conflictos y capacitación.
* **Fórmula:**
  $$\text{SERACARH} = \text{Sueldo Bruto (Total Remunerativo)} \times 0.5\%$$

---

## 2. Datos Obligatorios para Evitar Fallos en la Liquidación

Para poder realizar la liquidación mensual de un consorcio de manera exitosa y evitar errores matemáticos o caídas en el sistema, es obligatorio tener cargados y correctos los siguientes datos en la base de datos (`db.json`):

### 1. Datos del Consorcio (Configuración)
* **CUIT:** Requerido para relacionar los empleados y procesar los archivos TXT de AFIP. Formato de 11 dígitos sin guiones.
* **Categoría del Edificio:** Debe indicarse si es "1° Cat.", "2° Cat.", etc., ya que define el básico salarial de los encargados.
* **Datos Bancarios Completos:** Nombre de Banco, Titular, CBU (22 dígitos) y Alias. Se usan para los recibos de expensas de los vecinos.
* **Interés por Mora (Mora Pct):** Porcentaje mensual de recargo para deudas de expensas vencidas (ej: 0.03 para 3%).
* **Día de Vencimiento:** Día del mes en que vencen las expensas (usado para calcular intereses).
* **Parámetros de Obra Social y ART:**
  * Alícuota variable de ART (generalmente entre 3% y 7%).
  * Costo fijo de SCVO por empleado.

### 2. Datos del Empleado (Configuración)
* **CUIL:** Clave única del empleado (11 dígitos).
* **CUIT Empleador:** Debe coincidir exactamente con el CUIT del consorcio que lo liquida.
* **Fecha de Ingreso:** Crucial para el cálculo automático de los años de antigüedad (el sistema paga un porcentaje por año acumulado según convenio).
* **Función / Puesto:** Define el puesto (ej: "Encargado Permanente con vivienda", "Suplente", etc.) para buscar el sueldo básico en las escalas salariales.
* **Adicionales Específicos (Plus):** Se debe indicar si el empleado realiza tareas que devenguen plus (jardín, pileta, cochera, movimiento de coches, etc.).

### 3. Novedades del Mes
* **Días Trabajados:** 30 días para personal de jornada completa, o los días reales trabajados si es suplente.
* **Horas Extras al 50% y 100%:** Cantidad de horas en el mes (si tiene).
* **Feriados Trabajados:** Horas trabajadas en feriados nacionales.
* **Anticipos y Descuentos:** Montos entregados a cuenta en el mes.

### 4. Archivo de Escalas del Período (`scales_YYYY-MM.json`)
* El sistema busca un archivo de escala salarial de SUTERH para el período liquidado (ej: `scales_2026-05.json`).
* Debe contener los valores básicos actualizados de cada puesto y de cada adicional (plus) establecidos por convenio colectivo para ese mes específico. Si no existe, el sistema cae en un "Fallback" a la escala de Mayo 2026.
