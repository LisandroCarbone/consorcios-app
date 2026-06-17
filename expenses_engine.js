const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

// Helper to format numbers to 2 decimal places
function round2(num) {
    return Math.round((num + Number.EPSILON) * 100) / 100;
}

// Calculate employer obligations (F.931, SUTERH, FATERYH, etc.) for an employee payroll record
function calculateEmployerObligations(payrollRecord, boss = {}) {
    const R = payrollRecord.totalRemunerativo;
    
    // Determine detracción
    let detraccion = 0;
    const isSuplente = String(payrollRecord.function || '').toLowerCase().includes('suplente');
    
    // Find if suplente worked days or default to 30
    let diasTrabajados = 30;
    const basicConcept = payrollRecord.concepts ? payrollRecord.concepts.find(c => c.code === '1000') : null;
    if (isSuplente && basicConcept && typeof basicConcept.unidad === 'number') {
        diasTrabajados = basicConcept.unidad;
    }

    if (String(payrollRecord.function || '').toLowerCase().includes('media') || 
        String(payrollRecord.category || '').toLowerCase().includes('media')) {
        detraccion = 3501.84;
    } else if (isSuplente) {
        detraccion = round2(7003.68 * diasTrabajados / 30);
    } else {
        detraccion = 7003.68;
    }

    const base1 = R;
    // Difference in Obra Social for part-time (media jornada)
    let diffOsVal = 0;
    if (payrollRecord.concepts) {
        const diffOsConcept = payrollRecord.concepts.find(c => c.code === '5150');
        if (diffOsConcept) {
            diffOsVal = Math.abs(diffOsConcept.amount);
        }
    }
    const base4 = R + (diffOsVal > 0 ? (diffOsVal / 0.03) : 0);
    const base10 = Math.max(0, R - detraccion);

    // AFIP F.931 Split
    const aportesSS = round2(base1 * 0.1445); // Jubilación 11% + Ley 19032 3% + ANSSAL 0.45%
    const aportesOS = round2(base4 * 0.0255); // OS 2.55%
    const contribucionesOS = round2(base4 * 0.051); // OS 5.10%
    const contribucionesSS = round2(base10 * 0.18 + base4 * 0.009); // SS 18% + ANSSAL 0.9%

    const f931 = round2(aportesSS + contribucionesSS + aportesOS + contribucionesOS);
    
    const artRate = boss["% VARIABLE"] || 0.0639; // Default from Arenales 2120 model
    const art = round2(R * artRate);
    
    const scvo = boss["$ SEGURO VIDA FIJO"] || 424.62;
    
    // Union obligations (SUTERH 4.5%, FATERYH 6.5%, SERACARH 0.5%)
    const suterh = round2(R * 0.045);
    const fateryh = round2(R * 0.065);
    const seracarh = round2(R * 0.005);

    return { f931, art, scvo, suterh, fateryh, seracarh };
}

// Dynamically parse the monthly expenses Excel workbook
function parseExpensesWorkbook(filePath) {
    const wb = XLSX.readFile(filePath);
    
    const sheetRc = wb.Sheets['RES CUENTA'];
    const sheetLiq = wb.Sheets['LIQ'];
    
    if (!sheetRc || !sheetLiq) {
        throw new Error(`Workbook at ${filePath} is missing required sheets 'RES CUENTA' or 'LIQ'.`);
    }

    // 1. Parse rules, bank info, and titles from RES CUENTA
    const rcRange = XLSX.utils.decode_range(sheetRc['!ref'] || 'A1:A1');
    let bankInfo = {};
    let interestRate = 0.03; // default
    let dueDay = 10; // default
    let consorcioName = "CONSORCIO DE PROPIETARIOS";
    let cuit = "";
    let suterhKey = "";
    
    // Look up titles and bank info
    for (let r = 0; r <= rcRange.e.r; r++) {
        const cellA = sheetRc[XLSX.utils.encode_cell({ r, c: 0 })];
        const cellN = sheetRc[XLSX.utils.encode_cell({ r, c: 13 })]; // Col N is usually where title is
        
        if (cellN && cellN.v !== undefined) {
            const valN = String(cellN.v).trim();
            if (valN.includes("URUGUAY")) consorcioName = valN;
            if (valN.toUpperCase().includes("CUIT:")) {
                cuit = valN.replace(/[^0-9-]/g, '').trim();
            }
            if (valN.toUpperCase().includes("SUTERH")) {
                const parts = valN.split(':');
                if (parts[1]) suterhKey = parts[1].trim();
            }
        }
        
        // Check Col A for bank labels and rules
        if (cellA && cellA.v !== undefined) {
            const valA = String(cellA.v).trim();
            const valA_upper = valA.toUpperCase();
            
            let valVal = '';
            for (let c = 1; c < 8; c++) {
                const valCell = sheetRc[XLSX.utils.encode_cell({ r, c })];
                if (valCell && valCell.v !== undefined && String(valCell.v).trim()) {
                    valVal = String(valCell.v).trim();
                    break;
                }
            }
            
            if (valA_upper.includes("TITULAR:")) {
                bankInfo.titular = valVal;
            } else if (valA_upper.includes("BANCO:")) {
                bankInfo.bankName = valVal;
            } else if (valA_upper.includes("CUENTA:") || valA_upper.includes("N°CUENTA:")) {
                bankInfo.accountNumber = valVal;
            } else if (valA_upper.includes("CBU:")) {
                bankInfo.cbu = valVal;
            } else if (valA_upper.includes("ALIAS:")) {
                bankInfo.alias = valVal;
            }
            
            // Extract due day and interest rate
            if (valA_upper.includes("VENCEN") || valA_upper.includes("INTERÉS") || valA_upper.includes("INTERES")) {
                const matchInterest = valA.match(/(\d+)\s*%\s*DE\s*INTERÉ?S/i) || valA.match(/INTERÉ?S\s*MENSUAL\s*DE?L?\s*(\d+)\s*%/i) || valA.match(/(\d+)\s*%\s*MENSUAL/i);
                if (matchInterest) {
                    interestRate = Number(matchInterest[1]) / 100;
                }
                const matchDue = valA.match(/VENCEN\s*EL\s*DIA\s*(\d+)/i) || valA.match(/VENCIMIENTO\s*(\d+)/i) || valA.match(/VENCEN\s*EL\s*(\d+)/i);
                if (matchDue) {
                    dueDay = Number(matchDue[1]);
                }
            }
        }
    }
    
    // Try to get building CUIT and Name from top rows if not set
    if (!cuit || !consorcioName) {
        for (let r = 0; r < 10; r++) {
            const cellM = sheetRc[XLSX.utils.encode_cell({ r, c: 12 })] || sheetRc[XLSX.utils.encode_cell({ r, c: 13 })];
            if (cellM && cellM.v) {
                const val = String(cellM.v);
                if (val.toUpperCase().includes("ARENALES")) {
                    consorcioName = "CONSORCIO DE PROPIETARIOS ARENALES 2120/24";
                    cuit = "30-54088775-2";
                }
            }
        }
    }
    
    // 2. Parse main RES CUENTA table units and carryovers
    let headerRow = -1;
    for (let r = 0; r < 30; r++) {
        for (let c = 0; c < 10; c++) {
            const cell = sheetRc[XLSX.utils.encode_cell({ r, c })];
            if (cell && cell.v !== undefined) {
                const valStr = String(cell.v).toUpperCase().trim();
                if (valStr === "NOMBRE" || valStr === "COPROPIETARIO" || valStr.includes("NOMBRE Y APELLIDO")) {
                    headerRow = r;
                    break;
                }
            }
        }
        if (headerRow !== -1) break;
    }
    if (headerRow === -1) {
        throw new Error("Could not find header row in RES CUENTA");
    }
    
    const colMap = {};
    for (let c = 0; c <= rcRange.e.c; c++) {
        const cell = sheetRc[XLSX.utils.encode_cell({ r: headerRow, c })];
        if (cell && cell.v !== undefined) {
            const val = String(cell.v).toUpperCase().replace(/\s+/g, ' ').trim();
            if (colMap.uf === undefined && (val.includes("U.F.") || val === "DTO" || val === "DTO.")) colMap.uf = c;
            else if (colMap.nombre === undefined && (val.includes("NOMBRE") || val.includes("COPROPIETARIO") || val.includes("NOMBRE Y APELLIDO"))) colMap.nombre = c;
            else if (colMap.saldoAnterior === undefined && val.includes("SALDO ANTERIOR")) colMap.saldoAnterior = c;
            else if (colMap.suPago === undefined && (val.includes("SU PAGO") || val.includes("PAGO"))) colMap.suPago = c;
            else if (val === "%" || val.includes("% A") || val.includes("COEFICIENTE") || val.includes("COEF.")) {
                if (colMap.coefA === undefined) {
                    colMap.coefA = c;
                } else if (colMap.coefB === undefined) {
                    colMap.coefB = c;
                }
            }
            else if (colMap.coefB === undefined && (val.includes("% B") || val.includes("%B"))) colMap.coefB = c;
            else if (colMap.expensasA === undefined && (val.includes("EXPENSAS A") || val.includes("EXP. A") || val.includes("EXPENSAS DEL MES") || val.includes("EXP. ORDIN") || val.includes("TOTAL DEL MES"))) colMap.expensasA = c;
            else if (colMap.expensasB === undefined && (val.includes("EXPENSAS B") || val.includes("EXP. B") || val.includes("EXTRA") || val.includes("CUOTA EXTRA"))) colMap.expensasB = c;
            else if (colMap.gastosParticulares === undefined && (val.includes("GASTOS PARTIC") || val.includes("GASTOS PART"))) colMap.gastosParticulares = c;
            else if (colMap.sAsamblea === undefined && val.includes("S/ASAMBLEA")) colMap.sAsamblea = c;
            else if (colMap.otros === undefined && val.includes("OTROS")) colMap.otros = c;
            else if (colMap.deuda === undefined && val.includes("DEUDA")) colMap.deuda = c;
            else if (colMap.intereses === undefined && (val.includes("INTERE-SES") || val.includes("INTERESES"))) colMap.intereses = c;
            else if (colMap.total === undefined && val.includes("TOTAL")) colMap.total = c;
        }
    }
    
    // Default fallback columns if some headers are not detected
    if (colMap.uf === undefined) colMap.uf = 1;
    if (colMap.nombre === undefined) colMap.nombre = 3;
    if (colMap.saldoAnterior === undefined) colMap.saldoAnterior = 4;
    if (colMap.suPago === undefined) colMap.suPago = 5;
    if (colMap.coefA === undefined) colMap.coefA = 6;
    
    // 2. Parse main RES CUENTA table units and carryovers
    // Locate the Totals row dynamically first
    let totalsRow = -1;
    for (let r = headerRow + 1; r <= rcRange.e.r; r++) {
        // Check 1: Does any cell in cols 0 to 5 contain "TOTALES" or "TOTAL"
        let hasTotalText = false;
        for (let c = 0; c <= 5; c++) {
            const cell = sheetRc[XLSX.utils.encode_cell({ r, c })];
            if (cell && cell.v !== undefined) {
                const str = String(cell.v).toUpperCase().trim();
                if (str.includes("TOTALES") || str === "TOTAL" || str.startsWith("TOTAL ")) {
                    hasTotalText = true;
                    break;
                }
            }
        }
        if (hasTotalText) {
            totalsRow = r;
            break;
        }

        // Check 2: Sum of coefficients is close to 100 or 1.0, with an empty name
        if (colMap.coefA !== undefined) {
            const cellCoef = sheetRc[XLSX.utils.encode_cell({ r, c: colMap.coefA })];
            if (cellCoef && typeof cellCoef.v === 'number') {
                const val = cellCoef.v;
                if (Math.abs(val - 100) < 0.1 || Math.abs(val - 1.0) < 0.001) {
                    const cellName = sheetRc[XLSX.utils.encode_cell({ r, c: colMap.nombre })];
                    const nameVal = cellName && cellName.v !== undefined ? String(cellName.v).trim() : '';
                    if (!nameVal) {
                        totalsRow = r;
                        break;
                    }
                }
            }
        }
    }

    let divisorA = 100;
    let divisorB = 100;
    if (totalsRow !== -1) {
        const coefASumCell = colMap.coefA !== undefined ? sheetRc[XLSX.utils.encode_cell({ r: totalsRow, c: colMap.coefA })] : null;
        if (coefASumCell && typeof coefASumCell.v === 'number') {
            const val = coefASumCell.v;
            if (Math.abs(val - 1.0) < 0.05) {
                divisorA = 1;
            }
        }
        const coefBSumCell = colMap.coefB !== undefined ? sheetRc[XLSX.utils.encode_cell({ r: totalsRow, c: colMap.coefB })] : null;
        if (coefBSumCell && typeof coefBSumCell.v === 'number') {
            const val = coefBSumCell.v;
            if (Math.abs(val - 1.0) < 0.05) {
                divisorB = 1;
            }
        }
    }

    const units = [];
    const periodState = {};
    let totalExpensasA_Billed = 0;
    let totalExpensasB_Billed = 0;
    let totalExpensasC_Billed = 0;
    let totalSAsamblea_Billed = 0;

    if (totalsRow !== -1) {
        totalExpensasA_Billed = colMap.expensasA !== undefined && sheetRc[XLSX.utils.encode_cell({ r: totalsRow, c: colMap.expensasA })] ? Number(sheetRc[XLSX.utils.encode_cell({ r: totalsRow, c: colMap.expensasA })].v || 0) : 0;
        totalExpensasB_Billed = colMap.expensasB !== undefined && sheetRc[XLSX.utils.encode_cell({ r: totalsRow, c: colMap.expensasB })] ? Number(sheetRc[XLSX.utils.encode_cell({ r: totalsRow, c: colMap.expensasB })].v || 0) : 0;
        totalSAsamblea_Billed = colMap.sAsamblea !== undefined && sheetRc[XLSX.utils.encode_cell({ r: totalsRow, c: colMap.sAsamblea })] ? Number(sheetRc[XLSX.utils.encode_cell({ r: totalsRow, c: colMap.sAsamblea })].v || 0) : 0;
    }

    const endRow = totalsRow !== -1 ? totalsRow : rcRange.e.r + 1;

    for (let r = headerRow + 1; r < endRow; r++) {
        const cellNombre = sheetRc[XLSX.utils.encode_cell({ r, c: colMap.nombre })];
        if (!cellNombre || cellNombre.v === undefined) continue;
        const nombre = String(cellNombre.v).trim();
        if (!nombre) continue; // Skip spacer rows
        
        // Skip rows that look like descriptions or forms under the table
        if (nombre.toUpperCase().includes("VENCEN") || nombre.toUpperCase().includes("INTERÉS") || nombre.toUpperCase().includes("INTERES") || nombre.toUpperCase().includes("PAGO")) {
            continue;
        }

        const uf = sheetRc[XLSX.utils.encode_cell({ r, c: colMap.uf })]?.v;
        const depto = sheetRc[XLSX.utils.encode_cell({ r, c: colMap.uf - 1 })]?.v || sheetRc[XLSX.utils.encode_cell({ r, c: 0 })]?.v;
        
        const coefA = colMap.coefA !== undefined && sheetRc[XLSX.utils.encode_cell({ r, c: colMap.coefA })] ? Number(sheetRc[XLSX.utils.encode_cell({ r, c: colMap.coefA })].v || 0) : 0;
        const coefB = colMap.coefB !== undefined && sheetRc[XLSX.utils.encode_cell({ r, c: colMap.coefB })] ? Number(sheetRc[XLSX.utils.encode_cell({ r, c: colMap.coefB })].v || 0) : 0;
        
        const saldoAnterior = colMap.saldoAnterior !== undefined && sheetRc[XLSX.utils.encode_cell({ r, c: colMap.saldoAnterior })] ? Number(sheetRc[XLSX.utils.encode_cell({ r, c: colMap.saldoAnterior })].v || 0) : 0;
        const suPago = colMap.suPago !== undefined && sheetRc[XLSX.utils.encode_cell({ r, c: colMap.suPago })] ? Number(sheetRc[XLSX.utils.encode_cell({ r, c: colMap.suPago })].v || 0) : 0;
        const gastosParticulares = colMap.gastosParticulares !== undefined && sheetRc[XLSX.utils.encode_cell({ r, c: colMap.gastosParticulares })] ? Number(sheetRc[XLSX.utils.encode_cell({ r, c: colMap.gastosParticulares })].v || 0) : 0;
        const sAsamblea = colMap.sAsamblea !== undefined && sheetRc[XLSX.utils.encode_cell({ r, c: colMap.sAsamblea })] ? Number(sheetRc[XLSX.utils.encode_cell({ r, c: colMap.sAsamblea })].v || 0) : 0;
        const otros = colMap.otros !== undefined && sheetRc[XLSX.utils.encode_cell({ r, c: colMap.otros })] ? Number(sheetRc[XLSX.utils.encode_cell({ r, c: colMap.otros })].v || 0) : 0;
        
        if (uf !== undefined) {
            units.push({ uf, depto, nombre, coefA, coefB });
            periodState[uf] = { saldoAnterior, suPago, gastosParticulares, sAsamblea, otros };
        }
    }
    
    // 3. Parse LIQ sheet expenses, categories, provisions
    const liqRange = XLSX.utils.decode_range(sheetLiq['!ref'] || 'A1:A1');
    
    let liqHeaderRow = 8;
    for (let r = 0; r < 20; r++) {
        const cell = sheetLiq[XLSX.utils.encode_cell({ r, c: 1 })]; // Col B
        if (cell && String(cell.v).includes("PAGOS DEL PERIODO")) {
            liqHeaderRow = r;
            break;
        }
    }
    
    let colGastosA = -1;
    let colGastosB = -1;
    let colParticulares = -1;
    
    for (let c = 0; c <= liqRange.e.c; c++) {
        const cell = sheetLiq[XLSX.utils.encode_cell({ r: liqHeaderRow, c })];
        if (cell && cell.v !== undefined) {
            const val = String(cell.v).toUpperCase();
            if (val.includes("GASTOS \"A\"") || val.includes("GASTOS \"A\" Y \"B\"") || val.includes("GASTOS A Y B") || val.includes("GASTOS A")) {
                colGastosA = c;
            } else if (val.includes("GASTOS \"B\"") || val.includes("GASTOS B")) {
                colGastosB = c;
            } else if (val.includes("PART")) {
                colParticulares = c;
            }
        }
    }
    
    const gastos = [];
    const provisions = [];
    let currentCategory = '10';
    let isProvisions = false;
    let totalPagosAyB = 0;
    let totalGastosParticulares = 0;
    
    for (let r = liqHeaderRow + 1; r <= liqRange.e.r; r++) {
        const cellA = sheetLiq[XLSX.utils.encode_cell({ r, c: 0 })]; // Col A
        const cellB = sheetLiq[XLSX.utils.encode_cell({ r, c: 1 })]; // Col B
        
        if (cellA && cellA.v !== undefined && !isNaN(Number(cellA.v))) {
            currentCategory = String(Math.floor(Number(cellA.v)));
        }
        
        if (!cellB || cellB.v === undefined) continue;
        const desc = String(cellB.v).trim();
        if (!desc) continue;
        
        if (desc.toUpperCase().includes("TOTAL DE PAGOS") || desc.toUpperCase().includes("TOTAL PAGOS")) {
            // Read total values
            totalPagosAyB = colGastosA !== -1 && sheetLiq[XLSX.utils.encode_cell({ r, c: colGastosA })] ? Number(sheetLiq[XLSX.utils.encode_cell({ r, c: colGastosA })].v || 0) : 0;
            totalGastosParticulares = colParticulares !== -1 && sheetLiq[XLSX.utils.encode_cell({ r, c: colParticulares })] ? Number(sheetLiq[XLSX.utils.encode_cell({ r, c: colParticulares })].v || 0) : 0;
            continue;
        }
        if (desc.toUpperCase().includes("PREVISIONES")) {
            isProvisions = true;
            continue;
        }
        if (desc.toUpperCase().includes("ESTADO FINANCIERO") || desc.toUpperCase().includes("SALDO AL CIERRE")) {
            break; // Stop parsing expenses/provisions
        }
        
        // Parse amounts
        const amountA = colGastosA !== -1 && sheetLiq[XLSX.utils.encode_cell({ r, c: colGastosA })] ? Number(sheetLiq[XLSX.utils.encode_cell({ r, c: colGastosA })].v || 0) : 0;
        const amountB = colGastosB !== -1 && sheetLiq[XLSX.utils.encode_cell({ r, c: colGastosB })] ? Number(sheetLiq[XLSX.utils.encode_cell({ r, c: colGastosB })].v || 0) : 0;
        const amountPart = colParticulares !== -1 && sheetLiq[XLSX.utils.encode_cell({ r, c: colParticulares })] ? Number(sheetLiq[XLSX.utils.encode_cell({ r, c: colParticulares })].v || 0) : 0;
        
        const totalAmount = amountA + amountB + amountPart;
        if (totalAmount === 0) continue;
        
        if (isProvisions) {
            provisions.push({
                description: desc,
                amount: Math.abs(totalAmount),
                type: totalAmount < 0 ? 'reverse' : 'add'
            });
        } else {
            // Skip Category 1 which is sueldos/obligations, we parse it as employee details later
            if (currentCategory === '1') continue;
            
            gastos.push({
                category: currentCategory,
                description: desc,
                amount: totalAmount,
                amountA,
                amountB,
                amountPart,
                type: amountPart > 0 ? 'Particular' : (amountB > 0 ? 'B' : 'A')
            });
        }
    }
    
    // 4. Parse financials & bank reconciliation
    let estadoFinancieroRow = -1;
    let bankReconcilRow = -1;
    let bankColLabel = -1;
    
    for (let r = 0; r <= liqRange.e.r; r++) {
        for (let c = 0; c <= liqRange.e.c; c++) {
            const cell = sheetLiq[XLSX.utils.encode_cell({ r, c })];
            if (cell && cell.v !== undefined) {
                const valStr = String(cell.v).toUpperCase();
                if (valStr.includes("ESTADO FINANCIERO")) {
                    estadoFinancieroRow = r;
                }
                if (valStr.includes("S INICIAL") || valStr === "BANCO" || valStr.includes("CONCILIACION BANCARIA")) {
                    if (bankReconcilRow === -1) {
                        bankReconcilRow = r;
                        bankColLabel = c;
                    }
                }
            }
        }
    }
    
    // Extract Estado Financiero values
    let saldoAnteriorCaja = 0;
    let cobranzasPeriodoCaja = 0;
    let pagosAyB_Caja = 0;
    let pagosPart_Caja = 0;
    let saldoCierreCaja = 0;
    
    if (estadoFinancieroRow !== -1) {
        for (let r = estadoFinancieroRow + 1; r <= estadoFinancieroRow + 10; r++) {
            const labelCell = sheetLiq[XLSX.utils.encode_cell({ r, c: 1 })];
            if (!labelCell || labelCell.v === undefined) continue;
            const label = String(labelCell.v).toUpperCase();
            if (label.includes("AFIP F.931") || label.includes("CUILES") || label.includes("TOTAL DE PAGOS")) break;
            
            let val = 0;
            for (let c of [5, 6, 7, 8]) {
                const cell = sheetLiq[XLSX.utils.encode_cell({ r, c })];
                if (cell && typeof cell.v === 'number') {
                    val = cell.v;
                    break;
                }
            }
            if (label.includes("SALDO ANTERIOR")) saldoAnteriorCaja = val;
            else if (label.includes("COBRANZAS")) cobranzasPeriodoCaja = val;
            else if (label.includes("PAGOS DEL PERÍODO GASTOS \"A\"") || label.includes("PAGOS DEL PERÍODO GASTOS A Y B") || label.includes("PAGOS DEL PERIODO GASTOS A Y B") || label.includes("GASTOS \"A\"")) pagosAyB_Caja = val;
            else if (label.includes("PARTICULARES")) pagosPart_Caja = val;
            else if (label.includes("SALDO AL CIERRE")) saldoCierreCaja = val;
        }
    }
    
    // Extract Bank Reconciliation details
    const bankReconciliation = [];
    if (bankReconcilRow !== -1 && bankColLabel !== -1) {
        for (let r = bankReconcilRow - 1; r <= bankReconcilRow + 20; r++) {
            const labelCell = sheetLiq[XLSX.utils.encode_cell({ r, c: bankColLabel })];
            if (!labelCell || labelCell.v === undefined) continue;
            const label = String(labelCell.v).trim();
            if (!label) continue;
            if (label.toUpperCase().includes("AFIP F.931") || label.toUpperCase().includes("CUILES")) {
                if (label.toUpperCase().includes("total") && r > bankReconcilRow + 10) break;
            }
            
            let val = "";
            for (let c = bankColLabel + 1; c <= bankColLabel + 4; c++) {
                const cell = sheetLiq[XLSX.utils.encode_cell({ r, c })];
                if (cell && cell.v !== undefined) {
                    val = cell.v;
                    break;
                }
            }
            bankReconciliation.push({
                label,
                value: val
            });
        }
    }
    
    // 5. Parse employee sueldos and obligations from Category 1 in LIQ sheet
    const sueldosParsed = [];
    const obligationsParsed = [];
    let currentEmp = null;
    let detailCol = -1;
    
    for (let r = liqHeaderRow + 1; r <= liqRange.e.r; r++) {
        const cellA = sheetLiq[XLSX.utils.encode_cell({ r, c: 0 })]; // Col A
        const cellB = sheetLiq[XLSX.utils.encode_cell({ r, c: 1 })]; // Col B
        
        if (cellA && cellA.v !== undefined && !isNaN(Number(cellA.v)) && Number(cellA.v) > 1) {
            break;
        }
        
        if (!cellB || cellB.v === undefined) continue;
        const desc = String(cellB.v).trim();
        if (!desc) continue;
        
        if (desc.toUpperCase().includes("SERVICIOS PUBLICOS") || desc.toUpperCase().includes("ABONOS")) {
            break;
        }
        
        const match = desc.match(/^(.+?)\s*\(([0-9-]+)\):\s*(?:sueldo\s*neto|1°\s*aguinado|2°\s*aguinado|aguinaldo)/i);
        if (match) {
            const empName = match[1].trim();
            const cuil = match[2].trim();
            
            const amountA = colGastosA !== -1 && sheetLiq[XLSX.utils.encode_cell({ r, c: colGastosA })] ? Number(sheetLiq[XLSX.utils.encode_cell({ r, c: colGastosA })].v || 0) : 0;
            const amountB = colGastosB !== -1 && sheetLiq[XLSX.utils.encode_cell({ r, c: colGastosB })] ? Number(sheetLiq[XLSX.utils.encode_cell({ r, c: colGastosB })].v || 0) : 0;
            const amountPart = colParticulares !== -1 && sheetLiq[XLSX.utils.encode_cell({ r, c: colParticulares })] ? Number(sheetLiq[XLSX.utils.encode_cell({ r, c: colParticulares })].v || 0) : 0;
            
            currentEmp = {
                employeeName: empName,
                cuil: cuil,
                type: desc.toUpperCase().includes("AGUINALDO") || desc.toUpperCase().includes("AGUINADO") ? "aguinaldo" : "sueldo",
                amountA,
                amountB,
                amountPart,
                netSalary: amountA + amountB + amountPart,
                details: []
            };
            sueldosParsed.push(currentEmp);
            continue;
        }
        
        // If it matches an employer obligation (e.g. AFIP F.931, SUTERH, FATERYH, SERACARH)
        const isOb = desc.toUpperCase().includes("AFIP") || desc.toUpperCase().includes("SUTERH") || desc.toUpperCase().includes("FATERYH") || desc.toUpperCase().includes("SERACARH");
        if (isOb && !currentEmp) {
            const amountA = colGastosA !== -1 && sheetLiq[XLSX.utils.encode_cell({ r, c: colGastosA })] ? Number(sheetLiq[XLSX.utils.encode_cell({ r, c: colGastosA })].v || 0) : 0;
            const amountB = colGastosB !== -1 && sheetLiq[XLSX.utils.encode_cell({ r, c: colGastosB })] ? Number(sheetLiq[XLSX.utils.encode_cell({ r, c: colGastosB })].v || 0) : 0;
            const amountPart = colParticulares !== -1 && sheetLiq[XLSX.utils.encode_cell({ r, c: colParticulares })] ? Number(sheetLiq[XLSX.utils.encode_cell({ r, c: colParticulares })].v || 0) : 0;
            
            obligationsParsed.push({
                description: desc,
                amount: amountA + amountB + amountPart,
                amountA,
                amountB,
                amountPart
            });
            continue;
        }
        
        if (currentEmp) {
            if (detailCol === -1) {
                for (let c of [3, 4]) {
                    const cell = sheetLiq[XLSX.utils.encode_cell({ r, c })];
                    if (cell && typeof cell.v === 'number') {
                        detailCol = c;
                        break;
                    }
                }
            }
            const detailValCell = detailCol !== -1 ? sheetLiq[XLSX.utils.encode_cell({ r, c: detailCol })] : null;
            if (detailValCell && typeof detailValCell.v === 'number') {
                currentEmp.details.push({
                    concept: desc,
                    amount: detailValCell.v
                });
            }
        }
    }
    
    return {
        consorcio: {
            name: consorcioName,
            cuit: cuit,
            suterhKey: suterhKey,
            bankInfo: bankInfo,
            interestRate: interestRate,
            dueDay: dueDay,
            divisorA: divisorA,
            divisorB: divisorB
        },
        units,
        periodState,
        gastos,
        provisions,
        sueldosParsed,
        obligationsParsed,
        totalExpensasA_Billed,
        totalExpensasB_Billed,
        totalSAsamblea_Billed,
        caja: {
            saldoAnterior: saldoAnteriorCaja,
            cobranzas: cobranzasPeriodoCaja,
            pagosAyB: pagosAyB_Caja,
            pagosPart: pagosPart_Caja,
            saldoCierre: saldoCierreCaja
        },
        bankReconciliation
    };
}

// Calculate expenses prorrateo and carryovers based on parsed Excel data
function calculateExpensesFromFile(filePath, targetPeriod, currentPayroll = []) {
    // 1. Parse Excel data dynamically
    const parsedData = parseExpensesWorkbook(filePath);
    
    const {
        consorcio,
        units,
        periodState,
        gastos,
        provisions,
        sueldosParsed,
        obligationsParsed,
        totalExpensasA_Billed,
        totalExpensasB_Billed,
        totalSAsamblea_Billed,
        caja,
        bankReconciliation
    } = parsedData;

    // 2. Build Category 1 items using parsed sueldos and obligations from the file
    // This guarantees 100% agreement with the Excel file for billing owners!
    const cat1Items = [];
    
    sueldosParsed.forEach(s => {
        cat1Items.push({
            description: `${s.employeeName} (${s.cuil}): sueldo neto`,
            amount: s.netSalary,
            amountA: s.amountA,
            amountB: s.amountB,
            amountPart: s.amountPart,
            type: s.amountPart > 0 ? 'Particular' : (s.amountB > 0 ? 'B' : 'A')
        });
    });
    
    obligationsParsed.forEach(ob => {
        cat1Items.push({
            description: ob.description,
            amount: ob.amount,
            amountA: ob.amountA,
            amountB: ob.amountB,
            amountPart: ob.amountPart,
            type: ob.amountPart > 0 ? 'Particular' : (ob.amountB > 0 ? 'B' : 'A')
        });
    });

    const cat1Total = cat1Items.reduce((sum, item) => sum + item.amount, 0);

    // 3. Group and categorize all items (1 to 10)
    const categoryTotals = {
        '1': cat1Total,
        '2': 0, '3': 0, '4': 0, '5': 0, '6': 0, '7': 0, '8': 0, '9': 0, '10': 0
    };

    const categorizedItems = {
        '1': cat1Items,
        '2': [], '3': [], '4': [], '5': [], '6': [], '7': [], '8': [], '9': [], '10': []
    };

    for (let c = 2; c <= 10; c++) {
        const catGastos = gastos.filter(g => g.category === String(c));
        categorizedItems[String(c)] = catGastos;
        categoryTotals[String(c)] = catGastos.reduce((sum, g) => sum + g.amount, 0);
    }

    // Determine actual totals
    let totalPagosA = 0;
    let totalPagosB = 0;
    let totalGastosPart = 0;

    // Sum all categories
    for (let c = 1; c <= 10; c++) {
        const items = categorizedItems[String(c)];
        items.forEach(item => {
            if (item.type === 'Particular') {
                totalGastosPart += item.amount;
            } else if (item.type === 'B') {
                totalPagosB += item.amount;
            } else {
                totalPagosA += item.amount;
            }
        });
    }

    const totalPagosAyB = round2(totalPagosA + totalPagosB);

    // Previsions
    let totalPrevisiones = provisions.reduce((sum, p) => p.type === 'reverse' ? sum - p.amount : sum + p.amount, 0);
    totalPrevisiones = round2(totalPrevisiones);

    // Total Prorrateo Gastos A y B (Billed)
    const totalProrrateoAyB = round2(totalExpensasA_Billed + totalExpensasB_Billed);

    // 4. Calculate RES CUENTA records for each unit
    const resCuentaRecords = [];
    let sumExpensasA = 0;
    let sumExpensasB = 0;
    let sumSAsamblea = 0;
    let sumTotalesMes = 0;
    let sumDeuda = 0;
    let sumIntereses = 0;
    let sumTotalDue = 0;
    let sumSaldoAnterior = 0;
    let sumSuPago = 0;
    let sumOtros = 0;
    let sumFondo = 0;

    const divisorA = consorcio.divisorA || 100;
    const divisorB = consorcio.divisorB || 100;

    for (const uf of units) {
        const state = periodState[uf.uf] || {};
        
        // Expensas A = totalExpensasA_Billed * coefA / divisorA
        const expensasA = round2(totalExpensasA_Billed * uf.coefA / divisorA);
        
        // Expensas B = totalExpensasB_Billed * coefB / divisorB
        // Wait, if coefB is 0 (like units 1 and 2), expensas B is 0.
        // For other units, we use their coefB.
        const expensasB = round2(totalExpensasB_Billed * uf.coefB / divisorB);
        
        const sAsamblea = round2(totalSAsamblea_Billed * uf.coefA / divisorA) || state.sAsamblea || 0;
        const otros = state.otros || 0;
        const gastPart = round2(state.gastosParticulares || 0);
        
        const totalMes = round2(expensasA + expensasB + sAsamblea + otros + gastPart);

        // Carryover and Payments
        const saldoAnterior = Number(state.saldoAnterior || 0);
        const suPago = Number(state.suPago || 0);
        
        // Deuda = Saldo Anterior - Su Pago (if positive, otherwise 0 or credit)
        const deuda = round2(saldoAnterior - Math.abs(suPago));
        
        // Interest is calculated based on the interest rate of the consorcio
        const intereses = deuda > 0 ? round2(deuda * consorcio.interestRate) : 0;
        
        const totalDue = round2(totalMes + deuda + intereses);

        sumExpensasA += expensasA;
        sumExpensasB += expensasB;
        sumSAsamblea += sAsamblea;
        sumOtros += otros;
        sumTotalesMes += totalMes;
        sumDeuda += deuda;
        sumIntereses += intereses;
        sumTotalDue += totalDue;
        sumSaldoAnterior += saldoAnterior;
        sumSuPago += suPago;

        resCuentaRecords.push({
            uf: uf.uf,
            depto: uf.depto,
            nombre: uf.nombre,
            coefA: uf.coefA,
            coefB: uf.coefB,
            saldoAnterior,
            suPago,
            expensasA,
            expensasB,
            sAsamblea,
            otros,
            gastPart,
            totalMes,
            deuda,
            intereses,
            totalDue
        });
    }

    return {
        consorcio: {
            name: consorcio.name,
            cuit: consorcio.cuit,
            address: consorcio.bankInfo.titular || consorcio.name,
            suterhKey: consorcio.suterhKey,
            bankInfo: consorcio.bankInfo,
            interestRate: consorcio.interestRate,
            dueDay: consorcio.dueDay
        },
        period: targetPeriod,
        categoryTotals: {
            '1': round2(cat1Total),
            '2': round2(categoryTotals['2']),
            '3': round2(categoryTotals['3']),
            '4': round2(categoryTotals['4']),
            '5': round2(categoryTotals['5']),
            '6': round2(categoryTotals['6']),
            '7': round2(categoryTotals['7']),
            '8': round2(categoryTotals['8']),
            '9': round2(categoryTotals['9']),
            '10': round2(categoryTotals['10'])
        },
        categorizedItems,
        totalPagosAyB,
        totalGastosParticulares: round2(totalGastosPart),
        totalPrevisiones,
        totalProrrateoAyB,
        previsionesItems: provisions,
        resCuenta: resCuentaRecords,
        resCuentaTotals: {
            saldoAnterior: round2(sumSaldoAnterior),
            suPago: round2(sumSuPago),
            expensasA: round2(sumExpensasA),
            expensasB: round2(sumExpensasB),
            sAsamblea: round2(sumSAsamblea),
            otros: round2(sumOtros),
            gastPart: round2(totalGastosPart),
            totalMes: round2(sumTotalesMes),
            deuda: round2(sumDeuda),
            intereses: round2(sumIntereses),
            totalDue: round2(sumTotalDue)
        },
        caja,
        bankReconciliation
    };
}

function calculateExpenses(consorcio, unidadesFuncionales, periodState, targetPeriod, inputParams) {
    const {
        gastos = [],
        provisions = [],
        currentPayroll = [],
        previousPayroll = [],
        payrollPaidOverrides = null
    } = inputParams;

    // 1. Group employee payroll costs
    let sueldoNetoTotal = 0;
    let aguinaldoNetoTotal = 0;
    
    // Detailed list of payroll expenses for current month
    const currentPayrollCosts = [];
    for (const p of currentPayroll) {
        if (String(p.cuit) !== String(consorcio.CUIT || consorcio.cuit)) continue;
        
        // Sum basic sueldo net
        const sacConcept = p.concepts ? p.concepts.find(c => c.code === '2200') : null;
        const sacAmount = sacConcept ? Math.abs(sacConcept.amount) : 0;
        
        let netRegular = p.netSalary;
        let netAguinaldo = 0;
        
        if (sacAmount > 0) {
            const totalRemunRegular = p.totalRemunerativo - p.concepts.filter(c => ['2200', '2250'].includes(c.code)).reduce((sum, c) => sum + c.amount, 0);
            const regCredits = p.concepts.filter(c => c.type === 'C' && !['2200', '2250'].includes(c.code)).reduce((sum, c) => sum + c.amount, 0);
            const regRetentions = p.concepts.filter(c => c.type === 'D' && !['5400', '5450', '5500'].includes(c.code)).reduce((sum, c) => sum + c.amount, 0);
            
            const ratio = totalRemunRegular / p.totalRemunerativo;
            const regularNetBeforeRounding = regCredits - (Math.abs(regRetentions) * ratio);
            netRegular = Math.ceil(regularNetBeforeRounding);
            netAguinaldo = p.netSalary - netRegular;
        }

        sueldoNetoTotal += netRegular;
        aguinaldoNetoTotal += netAguinaldo;

        currentPayrollCosts.push({
            employeeName: p.employeeName,
            cuil: p.cuil,
            netRegular,
            netAguinaldo,
            obligations: calculateEmployerObligations(p, consorcio)
        });
    }

    // Determine actual paid employer obligations (usually from previous month)
    let paidObligations = { f931: 0, art: 0, scvo: 0, suterh: 0, fateryh: 0, seracarh: 0 };
    
    if (payrollPaidOverrides) {
        paidObligations = { ...paidObligations, ...payrollPaidOverrides };
    } else if (previousPayroll && previousPayroll.length > 0) {
        for (const p of previousPayroll) {
            if (String(p.cuit) !== String(consorcio.CUIT || consorcio.cuit)) continue;
            const ob = calculateEmployerObligations(p, consorcio);
            paidObligations.f931 += ob.f931;
            paidObligations.art += ob.art;
            paidObligations.scvo += ob.scvo;
            paidObligations.suterh += ob.suterh;
            paidObligations.fateryh += ob.fateryh;
            paidObligations.seracarh += ob.seracarh;
        }
    } else {
        for (const cpc of currentPayrollCosts) {
            paidObligations.f931 += cpc.obligations.f931;
            paidObligations.art += cpc.obligations.art;
            paidObligations.scvo += cpc.obligations.scvo;
            paidObligations.suterh += cpc.obligations.suterh;
            paidObligations.fateryh += cpc.obligations.fateryh;
            paidObligations.seracarh += cpc.obligations.seracarh;
        }
    }

    // Round paid obligations totals
    paidObligations.f931 = round2(paidObligations.f931);
    paidObligations.art = round2(paidObligations.art);
    paidObligations.scvo = round2(paidObligations.scvo);
    paidObligations.suterh = round2(paidObligations.suterh);
    paidObligations.fateryh = round2(paidObligations.fateryh);
    paidObligations.seracarh = round2(paidObligations.seracarh);

    // 2. Build Category 1 items
    const cat1Items = [];
    currentPayrollCosts.forEach(cpc => {
        cat1Items.push({
            description: `${cpc.employeeName} (${cpc.cuil}): sueldo neto`,
            amount: cpc.netRegular,
            type: 'A'
        });
        if (cpc.netAguinaldo > 0) {
            cat1Items.push({
                description: `${cpc.employeeName} (${cpc.cuil}): 1° aguinaldo y bonificación`,
                amount: cpc.netAguinaldo,
                type: 'A'
            });
        }
    });

    const prevMonthName = (monthStr) => {
        const months = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
        const [y, m] = monthStr.split('-').map(Number);
        const prev = new Date(y, m - 2, 1);
        return `${String(prev.getMonth() + 1).padStart(2, '0')}/${String(prev.getFullYear()).substring(2)}`;
    };

    const prevPeriodText = prevMonthName(targetPeriod);
    
    cat1Items.push({ description: `ARCA AFIP F. 931: Cargas sociales: SIJP y Obra social ${prevPeriodText}`, amount: paidObligations.f931, type: 'A' });
    cat1Items.push({ description: `ARCA AFIP F. 931: ART ${prevPeriodText}`, amount: paidObligations.art, type: 'A' });
    cat1Items.push({ description: `ARCA AFIP F. 931: SCVO ${prevPeriodText}`, amount: paidObligations.scvo, type: 'A' });
    cat1Items.push({ description: `SUTERH ${prevPeriodText}`, amount: paidObligations.suterh, type: 'A' });
    cat1Items.push({ description: `FATERYH ${prevPeriodText}`, amount: paidObligations.fateryh, type: 'A' });
    cat1Items.push({ description: `FATERYH SERACARH ${prevPeriodText}`, amount: paidObligations.seracarh, type: 'A' });

    // Calculate Category 1 total
    const cat1Total = cat1Items.reduce((sum, item) => sum + item.amount, 0);

    // 3. Process categories 2 to 10 from general input expenses
    const categoryTotals = {
        '1': cat1Total,
        '2': 0, '3': 0, '4': 0, '5': 0, '6': 0, '7': 0, '8': 0, '9': 0, '10': 0
    };

    const categorizedItems = {
        '1': cat1Items,
        '2': [], '3': [], '4': [], '5': [], '6': [], '7': [], '8': [], '9': [], '10': []
    };

    // Gastos Particulares collected from the expenses list
    const gastParticularesByUf = {};
    unidadesFuncionales.forEach(uf => {
        gastParticularesByUf[uf.uf] = 0;
    });

    for (const g of gastos) {
        const cat = String(g.category || '10');
        if (cat === '1') continue; // Handled separately
        
        const amount = Number(g.amount || 0);
        const type = g.type || 'A';
        
        if (type === 'Particular') {
            const target = Number(g.targetUf);
            if (gastParticularesByUf[target] !== undefined) {
                gastParticularesByUf[target] += amount;
            }
        } else {
            if (categorizedItems[cat]) {
                categorizedItems[cat].push({
                    description: g.description,
                    amount,
                    type
                });
                categoryTotals[cat] += amount;
            }
        }
    }

    // 4. Calculate total Gastos Particulares
    unidadesFuncionales.forEach(uf => {
        const state = periodState[uf.uf] || {};
        if (state.gastosParticulares) {
            gastParticularesByUf[uf.uf] += Number(state.gastosParticulares);
        }
    });

    const totalGastosParticulares = Object.values(gastParticularesByUf).reduce((sum, v) => sum + v, 0);

    if (totalGastosParticulares > 0) {
        categorizedItems['2'].push({
            description: `Gastos Particulares de Unidades Funcionales (AYSA / Otros)`,
            amount: totalGastosParticulares,
            type: 'Particular'
        });
    }

    // Calculate total general expenses A y B separately
    let totalPagosA = 0;
    let totalPagosB = 0;
    for (let c = 1; c <= 10; c++) {
        const items = categorizedItems[String(c)];
        items.forEach(item => {
            if (item.type === 'B') {
                totalPagosB += item.amount;
            } else if (item.type !== 'Particular') {
                totalPagosA += item.amount;
            }
        });
    }
    totalPagosA = round2(totalPagosA);
    totalPagosB = round2(totalPagosB);
    const totalPagosAyB = round2(totalPagosA + totalPagosB);

    // 5. Previsiones (Category 11) - applied to common expenses A
    let totalPrevisiones = 0;
    const prevItems = [];
    for (const p of provisions) {
        const amount = Number(p.amount || 0);
        prevItems.push({
            description: p.description,
            amount: p.type === 'reverse' ? -amount : amount
        });
        totalPrevisiones += p.type === 'reverse' ? -amount : amount;
    }
    totalPrevisiones = round2(totalPrevisiones);

    // Total Prorrateo Gastos A y B separately
    const totalProrrateoA = round2(totalPagosA + totalPrevisiones);
    const totalProrrateoB = round2(totalPagosB);
    const totalProrrateoAyB = round2(totalProrrateoA + totalProrrateoB);

    // 6. Prorate among functional units
    const resCuentaRecords = [];
    let sumExpensasA = 0;
    let sumExpensasB = 0;
    let sumTotalesMes = 0;
    let sumDeuda = 0;
    let sumIntereses = 0;
    let sumTotalDue = 0;
    let sumSaldoAnterior = 0;
    let sumSuPago = 0;

    for (const uf of unidadesFuncionales) {
        const state = periodState[uf.uf] || {};
        const coefA = Number(uf.coefA || 0);
        const coefB = Number(uf.coefB || 0);
        
        const expensasA = round2(totalProrrateoA * coefA / 100);
        const expensasB = round2(totalProrrateoB * coefB / 100);
        const gastPart = round2(gastParticularesByUf[uf.uf] || 0);
        
        const totalMes = round2(expensasA + expensasB + gastPart);

        // Carryover and Payments
        const saldoAnterior = Number(state.saldoAnterior || 0);
        const suPago = Number(state.suPago || 0);
        
        const deuda = round2(saldoAnterior - suPago);
        const interestRate = consorcio && consorcio.interestRate !== undefined ? Number(consorcio.interestRate) : 0.03;
        const intereses = deuda > 0 ? round2(deuda * interestRate) : 0;
        
        const totalDue = round2(totalMes + deuda + intereses);

        sumExpensasA += expensasA;
        sumExpensasB += expensasB;
        sumTotalesMes += totalMes;
        sumDeuda += deuda;
        sumIntereses += intereses;
        sumTotalDue += totalDue;
        sumSaldoAnterior += saldoAnterior;
        sumSuPago += suPago;

        resCuentaRecords.push({
            uf: uf.uf,
            depto: uf.depto,
            nombre: uf.nombre,
            coefA,
            coefB,
            saldoAnterior,
            suPago,
            expensasA,
            expensasB,
            gastPart,
            totalMes,
            deuda,
            intereses,
            totalDue
        });
    }

    // 7. Calculate Financial State
    const saldoAnteriorCaja = Number(consorcio.SALDO_ANTERIOR_CAJA || 0);
    const totalCobranzas = sumSuPago;
    const pagosAyB = -totalPagosAyB;
    const pagosPart = -totalGastosParticulares;
    const saldoCierreCaja = round2(saldoAnteriorCaja + totalCobranzas + pagosAyB + pagosPart);

    return {
        consorcio: {
            name: consorcio["RAZON SOCIAL"] || consorcio.name,
            cuit: consorcio.CUIT || consorcio.cuit,
            address: consorcio.DIRECCION || consorcio.address,
            suterhKey: consorcio.SUTERH_KEY || consorcio.suterhKey,
            bankInfo: consorcio.bankInfo || {},
            interestRate: consorcio.interestRate !== undefined ? consorcio.interestRate : 0.03,
            dueDay: consorcio.dueDay !== undefined ? consorcio.dueDay : 10
        },
        period: targetPeriod,
        categoryTotals: {
            '1': round2(cat1Total),
            '2': round2(categoryTotals['2']),
            '3': round2(categoryTotals['3']),
            '4': round2(categoryTotals['4']),
            '5': round2(categoryTotals['5']),
            '6': round2(categoryTotals['6']),
            '7': round2(categoryTotals['7']),
            '8': round2(categoryTotals['8']),
            '9': round2(categoryTotals['9']),
            '10': round2(categoryTotals['10'])
        },
        categorizedItems,
        totalPagosAyB,
        totalGastosParticulares: round2(totalGastosParticulares),
        totalPrevisiones,
        totalProrrateoAyB,
        previsionesItems: prevItems,
        resCuenta: resCuentaRecords,
        resCuentaTotals: {
            saldoAnterior: round2(sumSaldoAnterior),
            suPago: round2(sumSuPago),
            expensasA: round2(sumExpensasA),
            expensasB: round2(sumExpensasB),
            gastPart: round2(totalGastosParticulares),
            totalMes: round2(sumTotalesMes),
            deuda: round2(sumDeuda),
            intereses: round2(sumIntereses),
            totalDue: round2(sumTotalDue)
        },
        caja: {
            saldoAnterior: saldoAnteriorCaja,
            cobranzas: totalCobranzas,
            pagosAyB,
            pagosPart,
            saldoCierre: saldoCierreCaja
        }
    };
}

module.exports = {
    calculateExpenses,
    calculateEmployerObligations,
    parseExpensesWorkbook,
    calculateExpensesFromFile
};
