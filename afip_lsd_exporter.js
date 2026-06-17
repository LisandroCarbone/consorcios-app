const fs = require('fs');
const path = require('path');

// Helper to format string fields (left-aligned, right-padded with spaces)
function fmtStr(val, len) {
    const s = String(val === undefined || val === null ? '' : val).trim();
    return s.padEnd(len, ' ').substring(0, len);
}

// Helper to format numeric fields with 2 decimal places (no decimal separator, left-padded with zeroes)
function fmtNum(val, len) {
    const num = Math.round(Number(val || 0) * 100);
    return String(num).padStart(len, '0').substring(0, len);
}

// Helper to format integer fields (left-padded with zeroes)
function fmtInt(val, len) {
    const num = Math.round(Number(val || 0));
    return String(num).padStart(len, '0').substring(0, len);
}

// Helper to get clean CUIT/CUIL digits
function cleanId(idStr) {
    return String(idStr || '').replace(/\D/g, '');
}

// Helper to get clean CBU (only digits, pad/truncate to 22)
function cleanCbu(cbuStr) {
    const clean = String(cbuStr || '').replace(/\D/g, '');
    if (clean.length === 22) return clean;
    if (clean.length > 22) return clean.substring(0, 22);
    // If not a valid 22-digit CBU, return spaces
    return '';
}

// Export function
function exportToAFIPLSD(results, employees, employers, period, liqNum = 1, paymentDate = '') {
    let output = '';

    // If no payment date is provided, default to the last day of the month or a valid date
    let formattedPaymentDate = paymentDate;
    if (!formattedPaymentDate) {
        const [year, month] = period.split('-').map(Number);
        // Last day of the target month
        const lastDay = new Date(year, month, 0).getDate();
        formattedPaymentDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    }

    // Since we can have multiple consorcios (employers) in the same run,
    // AFIP expects a separate import file per CUIT/employer.
    // However, if the user runs it for one consorcio at a time, we will filter.
    // If there are multiple, we will group by CUIT and return an object of CUIT -> fileContent.
    const groupedResults = {};
    for (const res of results) {
        const cuit = cleanId(res.cuit);
        if (!groupedResults[cuit]) {
            groupedResults[cuit] = [];
        }
        groupedResults[cuit].push(res);
    }

    const filesMap = {};

    for (const [employerCuit, records] of Object.entries(groupedResults)) {
        let fileLines = [];
        
        // 1. Build Register 01 (Cabecera)
        // Count of Register 04 records is equal to the number of employees for this employer
        const qtyReg04 = records.length;
        const r01 = '01' +
            fmtStr(employerCuit, 11) +
            'SJ' +
            fmtStr(period.replace('-', ''), 6) +
            'M' +
            fmtInt(liqNum, 5) +
            '030' +
            fmtInt(qtyReg04, 5);
        fileLines.push(r01);

        // 2. Build Register 02 & 03 (grouped by employee)
        for (const res of records) {
            const cuil = cleanId(res.cuil);
            const emp = employees.find(e => cleanId(e.CUIL) === cuil) || {};
            const cleanCbuVal = cleanCbu(emp.CBU || res.cbu);
            
            // Build Register 02
            const r02 = '02' +
                fmtStr(cuil, 11) +
                fmtStr(res.legajo || emp.LEGAJO || '0', 10) +
                fmtStr('', 50) + // Dependencia (all spaces)
                fmtStr(cleanCbuVal, 22) +
                '030' + // Days tope
                fmtStr(formattedPaymentDate.replace(/-/g, ''), 8) +
                '00000000' + // Rubrica date
                (cleanCbuVal ? '3' : '1'); // Forma pago: 3 = bank transfer, 1 = cash
            fileLines.push(r02);

            // Build Register 03 for each concept in the receipt
            for (const c of res.concepts) {
                if (c.amount === 0) continue; // Skip zero-value concepts
                
                const absAmount = Math.abs(c.amount);
                // Map debit/credit indicator
                let indicator = 'C'; // default is credit/haber
                if (c.type === 'D') {
                    indicator = 'D'; // debit/discount
                } else if (c.type === 'NR') {
                    // For non-remunerative like rounding, check if positive
                    indicator = c.amount >= 0 ? 'C' : 'D';
                }

                // Determine quantity and unit of measure
                let qty = 0;
                let unit = ' ';
                
                if (c.code === '1000' && String(emp.JORNADA).toLowerCase().includes('suplente')) {
                    qty = Number(c.unidad || 0);
                    unit = 'D'; // measured in days
                } else if (c.code === '1050' || c.code === '1800' || c.code === '1850' || c.code === '1900') {
                    qty = Number(c.unidad || 0);
                    unit = 'H'; // measured in hours
                } else if (c.code === '2000' || c.code === '2050' || c.code === '2100') {
                    qty = Number(c.unidad || 0);
                    unit = 'D'; // measured in days
                } else if (['5000', '5050', '5100', '5200', '5250', '5300', '5350'].includes(c.code)) {
                    // Deductions percentages
                    if (c.unidad && String(c.unidad).includes('%')) {
                        qty = parseFloat(c.unidad.replace('%', ''));
                    } else if (c.valorUnitario) {
                        qty = Number(c.valorUnitario) * 100;
                    }
                }

                const r03 = '03' +
                    fmtStr(cuil, 11) +
                    fmtStr(c.code, 10) +
                    fmtNum(qty, 5) +
                    fmtStr(unit, 1) +
                    fmtNum(absAmount, 15) +
                    fmtStr(indicator, 1) +
                    '      '; // Adjust (spaces)
                fileLines.push(r03);
            }
        }

        // 3. Build Register 04 (Atributos F.931) at the end, ordered by CUIL
        // Sort records by CUIL to ensure proper order
        const sortedRecords = [...records].sort((a, b) => cleanId(a.cuil).localeCompare(cleanId(b.cuil)));

        for (const res of sortedRecords) {
            const cuil = cleanId(res.cuil);
            const emp = employees.find(e => cleanId(e.CUIL) === cuil) || {};
            const boss = employers.find(b => cleanId(b.CUIT) === employerCuit) || {};

            // Helper to get concept values
            const getConceptVal = (code) => {
                const c = res.concepts.find(x => String(x.code) === String(code));
                return c ? Math.abs(c.amount) : 0;
            };

            const getConceptQty = (code) => {
                const c = res.concepts.find(x => String(x.code) === String(code));
                return c ? Number(c.unidad || 0) : 0;
            };

            // Calculate split remuneration components
            const sueldoAmount = getConceptVal('1000'); // basic or suplencia
            const sacAmount = getConceptVal('2200');
            const vacAmount = getConceptVal('2100');
            const noRemunAmount = res.totalNoRemunerativo; // rounding, etc.
            const adicionalesAmount = Math.max(0, Math.round((res.totalRemunerativo - sueldoAmount - sacAmount - vacAmount) * 100) / 100);

            // Determine detracción amount
            let detraccion = 0;
            const isSuplente = String(emp.FUNCION).toLowerCase().includes('suplente') || String(emp.JORNADA).toLowerCase().includes('suplente');
            const diasTrabajados = isSuplente ? (getConceptQty('1000') || 30) : 30;

            if (String(emp.JORNADA).toLowerCase().includes('media')) {
                detraccion = 3501.84;
            } else if (isSuplente) {
                detraccion = Math.round((7003.68 * diasTrabajados / 30) * 100) / 100;
            } else {
                detraccion = 7003.68;
            }

            // Calculate bases imponibles
            const remunTotal = Math.round((res.totalRemunerativo + res.totalNoRemunerativo) * 100) / 100;
            const base1 = res.totalRemunerativo; // SIPA Aportes
            const base2 = res.totalRemunerativo; // SIPA Contribuciones
            const base3 = res.totalRemunerativo; // FNE
            
            // Obra Social bases (Base 4 & Base 8)
            const diffOsVal = getConceptVal('5150'); // Differencia Obra Social
            const base4 = Math.round((res.totalRemunerativo + (diffOsVal > 0 ? (diffOsVal / 0.03) : 0)) * 100) / 100;
            const base5 = res.totalRemunerativo; // INSSJP Aportes
            const base8 = base4; // Obra Social Contribuciones
            const base9 = res.totalRemunerativo; // LRT base
            const base10 = Math.max(0, Math.round((res.totalRemunerativo - detraccion) * 100) / 100); // SS base after detracción

            // Map family data (Cónyuge, Hijos, Adherentes) if available, otherwise default
            // In CCT 589/10, Obra Social and other charges can depend on these.
            const conyugeInd = (emp.Cónyuge === 'SI' || emp.Cónyuge === 'Yes' || emp.Cónyuge === '1') ? '1' : '0';
            const hijosQty = Number(emp.Hijos || 0);
            const adherentesQty = Number(emp.Adherentes || 0);

            // Build Register 04
            const r04 = '04' +
                fmtStr(cuil, 11) +
                conyugeInd + // 14
                fmtInt(hijosQty, 2) + // 15-16
                '000' + // 17-19 (Tarea Diferencial)
                fmtStr(emp['COD OBRA SOCIAL'] || '106500', 6) + // 20-25
                fmtInt(adherentesQty, 2) + // 26-27
                '0' + // 28 (Código de reducción)
                '01' + // 29-30 (Código de situación: 01 = active)
                '01' + // 31-32 (Código de condición: 01 = active)
                '049' + // 33-35 (Código de actividad: 049 = horizontal property)
                '01' + // 36-37 (Situación de revista 1)
                '01' + // 38-39 (Día inicio de situación de revista 1)
                '00' + // 40-41 (Situación de revista 2)
                '00' + // 42-43 (Día inicio de situación de revista 2)
                '00' + // 44-45 (Situación de revista 3)
                '00' + // 46-47 (Día inicio de situación de revista 3)
                fmtInt(diasTrabajados, 3) + // 48-50
                '000' + // 51-53 (Horas trabajadas)
                fmtNum(sueldoAmount, 15) + // 54-68
                fmtNum(adicionalesAmount, 15) + // 69-83
                fmtNum(0, 15) + // 84-98 (Premios)
                fmtNum(sacAmount, 15) + // 99-113
                fmtNum(vacAmount, 15) + // 114-128
                fmtNum(noRemunAmount, 15) + // 129-143
                fmtNum(0, 15) + // 144-158 (Maternidad)
                '00' + // 159-160 (Código de siniestrado)
                fmtNum(remunTotal, 15) + // 161-175
                fmtNum(base1, 15) + // 176-190
                fmtNum(base2, 15) + // 191-205
                fmtNum(base3, 15) + // 206-220
                fmtNum(base4, 15) + // 221-235
                fmtNum(base5, 15) + // 236-250
                fmtNum(0, 15) + // 251-265 (Base 6)
                fmtNum(0, 15) + // 266-280 (Base 7)
                fmtNum(base8, 15) + // 281-295
                fmtNum(base9, 15) + // 296-310
                fmtNum(base10, 15) + // 311-325
                fmtNum(detraccion, 15) + // 326-340
                fmtStr('1', 4) + // 341-344 (Localidad: 1 = CABA)
                fmtNum(0, 15) + // 345-359 (Aporte adicional OS)
                fmtNum(0, 15) + // 360-374 (Contribución adicional OS)
                fmtNum(0, 15) + // 375-389 (Aporte adicional SS)
                fmtNum(0, 15); // 390-404 (Contribución adicional SS)
            fileLines.push(r04);
        }

        // Return ANSI formatted file contents (line by line separated by CRLF)
        filesMap[employerCuit] = fileLines.join('\r\n') + '\r\n';
    }

    return filesMap;
}

module.exports = { exportToAFIPLSD };
