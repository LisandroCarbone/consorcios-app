const fs = require('fs');
const path = require('path');

// Helper to format currency
function fmtCurr(val) {
    if (val === undefined || val === null) return '$ 0.00';
    const num = Number(val);
    return '$ ' + num.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Helper to format dates from YYYY-MM-DD to DD/MM/YYYY
function fmtDate(dateStr) {
    if (!dateStr) return '';
    if (typeof dateStr === 'number') {
        const excelEpoch = new Date(1899, 11, 30);
        const d = new Date(excelEpoch.getTime() + dateStr * 24 * 60 * 60 * 1000);
        return d.toLocaleDateString('es-AR');
    }
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return String(dateStr);
    return d.toLocaleDateString('es-AR');
}

function formatConceptDescription(c, p) {
    let details = '';
    const codeNum = parseInt(c.code, 10);
    
    // Find basic salary if needed
    const basicConcept = p.concepts.find(x => x.code === "1000");
    const basicSalaryValue = basicConcept ? basicConcept.amount : 0;
    
    if (codeNum >= 5000 && codeNum <= 5350) {
        // Standard Deductions
        details = `Base: ${fmtCurr(p.totalRemunerativo)} | Alíc: ${c.unidad}`;
    } else if (c.code === "1000" && c.unidad) {
        // Suplencia
        details = `Base/Día: ${fmtCurr(c.valorUnitario)} | Cant: ${c.unidad} d.`;
    } else if (c.code === "1050") {
        // Suplencia 100%
        details = `Base/Hora: ${fmtCurr(c.valorUnitario)} | Cant: ${c.unidad} hs.`;
    } else if (c.code === "1100") {
        // Retiro de residuos
        details = `Base/UF: ${fmtCurr(c.valorUnitario)} | Cant: ${c.unidad} UFs`;
    } else if (c.code === "1250" || c.code === "1300") {
        // Plus antigüedad (1% and 2%)
        details = `Base/Año: ${fmtCurr(c.valorUnitario)} | Cant: ${c.unidad} años`;
    } else if (c.code === "1550") {
        // Plus Zona Desfavorable (50% of basic)
        details = `Base: ${fmtCurr(basicSalaryValue)} | Alíc: 50%`;
    } else if (c.code === "1600") {
        // Título (10% of basic)
        details = `Base: ${fmtCurr(basicSalaryValue)} | Alíc: 10%`;
    } else if (c.code === "1750" && c.unidad) {
        // CCT ARM Suplente
        details = `Base/Hora: ${fmtCurr(c.valorUnitario)} | Cant: ${c.unidad} hs.`;
    } else if (c.code === "1800" || c.code === "1850" || c.code === "1900") {
        // Horas extras / Feriados
        details = `Base/Hora: ${fmtCurr(c.valorUnitario)} | Cant: ${c.unidad} hs.`;
    } else if (c.code === "2000" || c.code === "2050" || c.code === "2100") {
        // Ausencias / Licencia / Vacaciones
        details = `Base/Día: ${fmtCurr(c.valorUnitario)} | Cant: ${c.unidad} d.`;
    } else if (c.code === "2200") {
        // SAC
        const cantText = c.unidad ? `${c.unidad}` : '180 d.';
        details = `Semestre | Cant: ${cantText}`;
    }
    
    if (details) {
        return `<div class="concept-name-txt">${c.name}</div>
                <div class="concept-details">${details}</div>`;
    }
    return `<div class="concept-name-txt">${c.name}</div>`;
}

function generatePayslipHTML(p) {
    // Generate a single A4 page containing both ORIGINAL and DUPLICADO
    // Separated by a dashed line for easy cutting

    const buildReceiptHTML = (type) => {
        const remunerativeRows = p.concepts.filter(c => c.type === 'C');
        const discountRows = p.concepts.filter(c => c.type === 'D');
        const nonRemunerativeRows = p.concepts.filter(c => c.type === 'NR');

        // Create rows for the table. We want to display Remunerativo on the left, Descuento on the right.
        const maxLen = Math.max(remunerativeRows.length, discountRows.length, nonRemunerativeRows.length);
        let tableRowsHTML = '';

        for (let i = 0; i < maxLen; i++) {
            const rem = remunerativeRows[i] || nonRemunerativeRows[i - remunerativeRows.length] || null;
            const desc = discountRows[i] || null;

            let remCode = '', remDescHtml = '', remAmount = '';
            if (rem) {
                remCode = rem.code;
                remDescHtml = formatConceptDescription(rem, p);
                remAmount = fmtCurr(rem.amount);
            }

            let descCode = '', descDescHtml = '', descAmount = '';
            if (desc) {
                descCode = desc.code;
                descDescHtml = formatConceptDescription(desc, p);
                descAmount = fmtCurr(desc.amount);
            }

            tableRowsHTML += `
                <tr>
                    <td class="code">${remCode}</td>
                    <td>${remDescHtml}</td>
                    <td class="amount text-right">${remAmount}</td>
                    <td class="code line-left">${descCode}</td>
                    <td>${descDescHtml}</td>
                    <td class="amount text-right">${descAmount}</td>
                </tr>
            `;
        }

        // Shorten contribution names for spacing
        const shortenName = (name) => {
            return name
                .replace(" (Seguro Colectivo de Vida Obligatorio)", "")
                .replace(" (Riesgos del Trabajo)", "")
                .replace(" (Contribución)", "")
                .replace(" (Contribuci\u00f3n)", "")
                .replace("Seguridad Social (SIPA/INSSJP/FNE/Asig)", "Seg. Social (SIPA/INSSJP)")
                .replace("Obra Social Empleador", "Obra Social Patronal");
        };

        // Render contributions table rows
        let contributionsRowsHTML = '';
        const contribs = p.contributions || [];
        contribs.forEach(c => {
            const shortened = shortenName(c.name);
            let details = '';
            if (c.rate > 0) {
                details = `Base: ${fmtCurr(p.totalRemunerativo)} | Alíc: ${(c.rate * 100).toFixed(2)}%`;
            } else if (c.name.includes("SCVO")) {
                details = `Importe Fijo`;
            }

            contributionsRowsHTML += `
                <tr>
                    <td>
                        <div class="concept-name-txt">${shortened}</div>
                        ${details ? `<div class="concept-details">${details}</div>` : ''}
                    </td>
                    <td class="text-right" style="vertical-align: middle;">${fmtCurr(c.amount)}</td>
                </tr>
            `;
        });

        // Calculate Costo Laboral Total
        const totalLaborCost = p.totalGross + (p.totalContributions || 0);

        // Calculate percentages
        const netPct = totalLaborCost > 0 ? (p.netSalary / totalLaborCost) * 100 : 0;
        const descPct = totalLaborCost > 0 ? (p.totalDescuentos / totalLaborCost) * 100 : 0;
        const contribPct = totalLaborCost > 0 ? ((p.totalContributions || 0) / totalLaborCost) * 100 : 0;

        //Son pesos text converter (simple Spanish fallback or static representation)
        const totalNetWord = "PESOS " + p.netSalary.toString().toUpperCase() + " con 00/100 M.N."; // Simple placeholder

        return `
        <div class="receipt-box">
            <div class="receipt-header">
                <div class="company-info">
                    <h2>${p.consorcioName}</h2>
                    <p>CUIT: ${p.cuit}</p>
                    <p>Domicilio: ${p.address || 'Capital Federal'}</p>
                </div>
                <div class="receipt-title">
                    <div style="display: flex; gap: 4px; justify-content: flex-end; align-items: center;">
                        <span class="badge" style="background-color: #fef3c7; color: #d97706; font-size: 8px;">Dec. 407/2026</span>
                        <div class="badge">${type}</div>
                    </div>
                    <h1>RECIBO DE HABERES</h1>
                    <p class="period">Período: <strong>${p.periodText}</strong></p>
                </div>
            </div>

            <div class="receipt-main-content">
                <!-- COLUMNA IZQUIERDA: Liquidación Salarial -->
                <div class="receipt-column-left">
                    <div class="employee-card">
                        <div class="grid-col">
                            <p><span>Legajo:</span> ${p.legajo || '99'}</p>
                            <p><span>Empleado:</span> <strong>${p.employeeName}</strong></p>
                            <p><span>CUIL:</span> ${p.cuil}</p>
                            <p><span>Fecha de Ingreso:</span> ${fmtDate(p.hireDate)}</p>
                        </div>
                        <div class="grid-col">
                            <p><span>Función/Categoría:</span> ${p.function} (${p.category})</p>
                            <p><span>Antigüedad:</span> ${p.seniority} años</p>
                            <p><span>Banco:</span> ${p.bank || 'N/A'}</p>
                            <p><span>CBU:</span> ${p.cbu || 'N/A'}</p>
                        </div>
                    </div>

                    <table class="concepts-table">
                        <thead>
                            <tr>
                                <th style="width: 8%">Cód</th>
                                <th style="width: 48%">Concepto (Haberes)</th>
                                <th style="width: 18%" class="text-right">Importe</th>
                                <th style="width: 8%" class="line-left">Cód</th>
                                <th style="width: 48%">Concepto (Descuentos)</th>
                                <th style="width: 18%" class="text-right">Importe</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${tableRowsHTML}
                        </tbody>
                        <tfoot>
                            <tr class="totals-row">
                                <td colspan="2">TOTAL HABERES</td>
                                <td class="text-right">${fmtCurr(p.totalGross)}</td>
                                <td colspan="2" class="line-left">TOTAL DESCUENTOS</td>
                                <td class="text-right">${fmtCurr(p.totalDescuentos)}</td>
                            </tr>
                            <tr class="net-row">
                                <td colspan="3">Son: <span class="son-pesos">${totalNetWord}</span></td>
                                <td colspan="2" class="line-left net-label">NETO A COBRAR</td>
                                <td class="text-right net-val">${fmtCurr(p.netSalary)}</td>
                            </tr>
                        </tfoot>
                    </table>

                    <div class="receipt-footer">
                        <div class="signature-box">
                            <p class="date-line">Recibí el importe de este recibo de conformidad.</p>
                            <div class="signature-line">
                                <span>Firma del Empleado</span>
                            </div>
                        </div>
                        <div class="signature-box">
                            <p class="date-line">Lugar y Fecha de Pago: C.A.B.A., ____/____/2026</p>
                            <div class="signature-line">
                                <span>Firma del Empleador</span>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- COLUMNA DERECHA: Costo Patronal y Gráfico -->
                <div class="receipt-column-right">
                    <div style="width: 100%;">
                        <div class="section-title">SECCIÓN II: COSTO PATRONAL</div>
                        <table class="contributions-table">
                            <thead>
                                <tr>
                                    <th>Contribución Patronal</th>
                                    <th class="text-right">Importe</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${contributionsRowsHTML}
                            </tbody>
                        </table>
                    </div>

                    <div style="width: 100%; margin-top: auto;">
                        <div class="labor-cost-summary">
                            <div class="labor-cost-row">
                                <span>Salario Bruto:</span>
                                <strong>${fmtCurr(p.totalGross)}</strong>
                            </div>
                            <div class="labor-cost-row">
                                <span>Contribuciones:</span>
                                <strong>${fmtCurr(p.totalContributions || 0)}</strong>
                            </div>
                            <div class="labor-cost-row total-cost">
                                <span>Costo Laboral:</span>
                                <strong>${fmtCurr(totalLaborCost)}</strong>
                            </div>
                        </div>

                        <div class="chart-section">
                            <div class="pie-chart" style="background: conic-gradient(
                                #3b82f6 0% ${netPct.toFixed(1)}%, 
                                #ef4444 ${netPct.toFixed(1)}% ${(netPct + descPct).toFixed(1)}%, 
                                #8b5cf6 ${(netPct + descPct).toFixed(1)}% 100%
                            );"></div>
                            <div class="chart-legend">
                                <div class="legend-item">
                                    <span class="legend-color" style="background-color: #3b82f6;"></span>
                                    <span>Neto: <strong>${netPct.toFixed(0)}%</strong></span>
                                </div>
                                <div class="legend-item">
                                    <span class="legend-color" style="background-color: #ef4444;"></span>
                                    <span>Aportes: <strong>${descPct.toFixed(0)}%</strong></span>
                                </div>
                                <div class="legend-item">
                                    <span class="legend-color" style="background-color: #8b5cf6;"></span>
                                    <span>Patronal: <strong>${contribPct.toFixed(0)}%</strong></span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        `;
    };

    return `
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <title>Recibo de Sueldo - ${p.employeeName} - ${p.periodText}</title>
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap');
            
            * {
                box-sizing: border-box;
            }
            
            @page {
                size: A4;
                margin: 0;
            }
            
            body {
                font-family: 'Outfit', sans-serif;
                margin: 0;
                padding: 10mm;
                background-color: #f8fafc;
                color: #1e293b;
                font-size: 11px;
                -webkit-print-color-adjust: exact;
            }

            .container {
                display: flex;
                flex-direction: column;
                height: 277mm; /* Full A4 height minus padding */
                justify-content: space-between;
            }

            .receipt-box {
                background: white;
                border: 1px solid #e2e8f0;
                border-radius: 12px;
                padding: 8px 12px;
                box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.05);
                height: 130mm; /* Fit exactly twice on A4 */
                display: flex;
                flex-direction: column;
                justify-content: space-between;
            }

            .receipt-header {
                display: flex;
                justify-content: space-between;
                border-bottom: 2px solid #3b82f6;
                padding-bottom: 4px;
                margin-bottom: 4px;
            }

            .company-info h2 {
                margin: 0 0 4px 0;
                color: #1e3a8a;
                font-size: 15px;
                font-weight: 700;
            }

            .company-info p {
                margin: 0 0 2px 0;
                color: #64748b;
                font-size: 10px;
            }

            .receipt-title {
                text-align: right;
            }

            .receipt-title h1 {
                margin: 4px 0 2px 0;
                font-size: 14px;
                color: #1e293b;
                font-weight: 600;
            }

            .receipt-title .period {
                margin: 0;
                font-size: 10px;
                color: #64748b;
            }

            .badge {
                display: inline-block;
                background-color: #dbeafe;
                color: #1e40af;
                padding: 2px 8px;
                border-radius: 6px;
                font-weight: 600;
                font-size: 9px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }

            .receipt-main-content {
                display: flex;
                gap: 12px;
                flex-grow: 1;
                min-height: 0;
            }
            
            .receipt-column-left {
                flex: 2.2;
                display: flex;
                flex-direction: column;
                justify-content: flex-start;
                min-width: 0;
            }
            
            .receipt-column-right {
                flex: 1.1;
                border-left: 1px solid #cbd5e1;
                padding-left: 12px;
                display: flex;
                flex-direction: column;
                justify-content: flex-start;
                min-width: 0;
            }
            
            .section-title {
                font-size: 8.5px;
                font-weight: 700;
                color: #1e3a8a;
                border-bottom: 1.5px solid #3b82f6;
                padding-bottom: 2px;
                margin-bottom: 4px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            
            .contributions-table {
                width: 100%;
                border-collapse: collapse;
                font-size: 8.5px;
                margin-bottom: 4px;
            }
            
            .contributions-table th {
                background-color: #f1f5f9;
                color: #475569;
                font-weight: 600;
                text-align: left;
                padding: 2px 4px;
                border-bottom: 1px solid #cbd5e1;
                font-size: 8px;
            }
            
            .contributions-table td {
                padding: 1px 4px;
                border-bottom: 1px dotted #e2e8f0;
                color: #334155;
                font-size: 8px;
                line-height: 1.1;
            }
            
            .labor-cost-summary {
                background-color: #f8fafc;
                border: 1px solid #f1f5f9;
                border-radius: 6px;
                padding: 4px 6px;
                margin-bottom: 4px;
            }
            
            .labor-cost-row {
                display: flex;
                justify-content: space-between;
                font-size: 8.5px;
                margin-bottom: 2px;
                color: #475569;
            }
            
            .labor-cost-row span {
                font-weight: 500;
            }
            
            .labor-cost-row.total-cost {
                border-top: 1px solid #cbd5e1;
                padding-top: 3px;
                margin-top: 3px;
                margin-bottom: 0;
                font-size: 9px;
                color: #1e293b;
            }
            
            .labor-cost-row.total-cost strong {
                color: #1e3a8a;
            }
            
            .chart-section {
                display: flex;
                align-items: center;
                gap: 6px;
                padding: 3px 4px;
                background-color: #f8fafc;
                border-radius: 6px;
                border: 1px dashed #cbd5e1;
            }
            
            .pie-chart {
                width: 40px;
                height: 40px;
                border-radius: 50%;
                flex-shrink: 0;
                box-shadow: inset 0 0 0 1px rgba(0,0,0,0.05);
            }
            
            .chart-legend {
                font-size: 8px;
                color: #475569;
                display: flex;
                flex-direction: column;
                gap: 2px;
                width: 100%;
            }
            
            .legend-item {
                display: flex;
                align-items: center;
                gap: 4px;
            }
            
            .legend-color {
                display: inline-block;
                width: 6px;
                height: 6px;
                border-radius: 1.5px;
                flex-shrink: 0;
            }

            .employee-card {
                background-color: #f8fafc;
                border: 1px solid #f1f5f9;
                border-radius: 8px;
                padding: 3px 6px;
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 2px;
                margin-bottom: 4px;
            }

            .employee-card p {
                margin: 0;
                font-size: 8.5px;
            }

            .employee-card span {
                color: #64748b;
                font-weight: 500;
            }

            .concepts-table {
                width: 100%;
                border-collapse: collapse;
                margin-bottom: 4px;
                flex-grow: 1;
            }

            .concepts-table th {
                background-color: #f1f5f9;
                color: #475569;
                font-weight: 600;
                text-align: left;
                padding: 3px 4px;
                border-bottom: 1px solid #cbd5e1;
                font-size: 8.5px;
            }

            .concepts-table td {
                padding: 1px 4px;
                border-bottom: 1px dotted #e2e8f0;
                vertical-align: middle;
                font-size: 8px;
                line-height: 1.1;
            }

            .concepts-table td.code {
                color: #94a3b8;
                font-family: monospace;
            }

            .qty-badge {
                font-size: 9px;
                color: #64748b;
                background: #f1f5f9;
                padding: 1px 4px;
                border-radius: 4px;
                margin-left: 4px;
            }

            .concept-name-txt {
                font-weight: 500;
            }

            .concept-details {
                font-size: 7.5px;
                color: #64748b;
                margin-top: 1px;
                font-weight: 400;
                text-transform: none;
            }

            .line-left {
                border-left: 1px solid #cbd5e1 !important;
            }

            .text-right {
                text-align: right;
            }

            .totals-row td {
                font-weight: 600;
                background-color: #f8fafc;
                border-top: 1px solid #cbd5e1;
                border-bottom: 1px solid #cbd5e1;
                padding: 3px 4px;
                font-size: 8.5px;
            }

            .net-row td {
                font-weight: 700;
                background-color: #eff6ff;
                border-bottom: 2px solid #3b82f6;
                padding: 4px;
            }

            .net-label {
                color: #1e40af;
                font-size: 9px;
            }

            .net-val {
                color: #1e3a8a;
                font-size: 11px;
            }

            .son-pesos {
                font-weight: 400;
                color: #64748b;
                font-style: italic;
            }

            .receipt-footer {
                display: flex;
                justify-content: space-between;
                margin-top: auto;
                padding-top: 4px;
            }

            .signature-box {
                width: 48%;
                display: flex;
                flex-direction: column;
                justify-content: flex-end;
                gap: 2px;
            }

            .signature-box p {
                margin: 0;
                color: #64748b;
                font-size: 8.5px;
            }

            .signature-line {
                border-top: 1px solid #94a3b8;
                margin-top: 8px;
                text-align: center;
                padding-top: 2px;
            }

            .signature-line span {
                color: #64748b;
                font-size: 8px;
            }

            .cut-line {
                border-top: 1px dashed #94a3b8;
                text-align: center;
                margin: 6px 0;
                position: relative;
            }

            .cut-line span {
                position: absolute;
                top: -7px;
                left: 50%;
                transform: translateX(-50%);
                background: #f8fafc;
                padding: 0 12px;
                color: #64748b;
                font-size: 10px;
                font-weight: 500;
                display: flex;
                align-items: center;
                gap: 4px;
            }
        </style>
    </head>
    <body>
        <div class="container">
            ${buildReceiptHTML('ORIGINAL')}
            <div class="cut-line">
                <span>✂ Cortar aquí</span>
            </div>
            ${buildReceiptHTML('DUPLICADO')}
        </div>
    </body>
    </html>
    `;
}

function generateExpensesReceiptHTML(exp, ufVal) {
    // Generate building expenses summary (Liquidacion Prorrateo)
    // and payment slip (Aviso de Pago) for a specific resident unit (UF)

    const u = exp.resCuenta.find(r => r.uf === ufVal);
    if (!u) {
        throw new Error(`Unit ${ufVal} not found in expenses results.`);
    }

    // Build categories rows for expenses
    const categoriesLabels = {
        '1': 'REMUNERACIONES AL PERSONAL Y CARGAS SOCIALES',
        '2': 'SERVICIOS PUBLICOS Y TASAS',
        '3': 'ABONOS DE SERVICIOS',
        '4': 'MANTENIMIENTO DE PARTES COMUNES',
        '5': 'TRABAJOS DE REPARACIONES EN UNIDADES',
        '6': 'GASTOS BANCARIOS',
        '7': 'GASTOS DE LIMPIEZA',
        '8': 'GASTOS DE ADMINISTRACION Y LEGALES',
        '9': 'SEGUROS',
        '10': 'OTROS'
    };

    let expensesTableHTML = '';
    for (let c = 1; c <= 10; c++) {
        const catItems = exp.categorizedItems[String(c)] || [];
        if (catItems.length === 0) continue;

        // Header for Category
        expensesTableHTML += `
            <tr class="category-header-row">
                <td class="cat-num">${c}</td>
                <td colspan="3" class="cat-title">${categoriesLabels[String(c)]}</td>
                <td class="text-right cat-sum">${fmtCurr(exp.categoryTotals[String(c)])}</td>
            </tr>
        `;

        // Rows inside Category
        catItems.forEach(item => {
            const isParticular = item.type === 'Particular';
            expensesTableHTML += `
                <tr class="${isParticular ? 'item-particular-row' : ''}">
                    <td></td>
                    <td class="item-desc">${item.description}</td>
                    <td class="text-right item-val">${!isParticular ? fmtCurr(item.amount) : ''}</td>
                    <td class="text-right item-val">${isParticular ? fmtCurr(item.amount) : ''}</td>
                    <td></td>
                </tr>
            `;
        });
    }

    // Build provisions table rows
    let provisionsTableHTML = '';
    if (exp.previsionesItems && exp.previsionesItems.length > 0) {
        expensesTableHTML += `
            <tr class="category-header-row">
                <td class="cat-num">P</td>
                <td colspan="3" class="cat-title">PREVISIONES Y FONDOS</td>
                <td class="text-right cat-sum">${fmtCurr(exp.totalPrevisiones)}</td>
            </tr>
        `;
        exp.previsionesItems.forEach(item => {
            expensesTableHTML += `
                <tr>
                    <td></td>
                    <td class="item-desc">${item.description}</td>
                    <td class="text-right item-val">${fmtCurr(item.amount)}</td>
                    <td class="text-right item-val"></td>
                    <td></td>
                </tr>
            `;
        });
    }

    // Unpaid/paid balance rows for print
    const remanente = u.saldoAnterior - u.suPago;
    const dateFormatted = new Date().toLocaleDateString('es-AR');

    let vencimientoStr = '';
    if (exp.period && exp.consorcio.dueDay) {
        const [year, month] = exp.period.split('-').map(Number);
        let nextMonth = month + 1;
        let nextYear = year;
        if (nextMonth > 12) {
            nextMonth = 1;
            nextYear += 1;
        }
        const dueDayStr = String(exp.consorcio.dueDay).padStart(2, '0');
        const dueMonthStr = String(nextMonth).padStart(2, '0');
        vencimientoStr = `${dueDayStr}/${dueMonthStr}/${nextYear}`;
    } else {
        vencimientoStr = '10/06/2026';
    }
    const interestRatePct = exp.consorcio.interestRate !== undefined ? (exp.consorcio.interestRate * 100).toFixed(0) : '3';

    return `
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <title>Expensas - ${exp.consorcio.name} - UF ${u.uf} - ${exp.period}</title>
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap');
            
            @page {
                size: A4;
                margin: 10mm;
            }
            
            body {
                font-family: 'Outfit', sans-serif;
                margin: 0;
                background-color: #f8fafc;
                color: #1e293b;
                font-size: 10px;
                -webkit-print-color-adjust: exact;
            }

            .header-card {
                background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%);
                color: white;
                padding: 16px 20px;
                border-radius: 12px;
                margin-bottom: 16px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);
            }

            .header-title h1 {
                margin: 0 0 4px 0;
                font-size: 16px;
                font-weight: 700;
                letter-spacing: 0.5px;
            }

            .header-title p {
                margin: 0;
                font-size: 11px;
                opacity: 0.9;
            }

            .header-period {
                text-align: right;
            }

            .header-period h2 {
                margin: 0 0 4px 0;
                font-size: 18px;
                font-weight: 800;
            }

            .header-period p {
                margin: 0;
                font-size: 11px;
                background: rgba(255, 255, 255, 0.2);
                padding: 2px 8px;
                border-radius: 6px;
                display: inline-block;
            }

            .info-section {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 16px;
                margin-bottom: 16px;
            }

            .info-card {
                background: white;
                border: 1px solid #e2e8f0;
                border-radius: 10px;
                padding: 12px;
                box-shadow: 0 2px 4px -1px rgb(0 0 0 / 0.02);
            }

            .info-card h3 {
                margin: 0 0 8px 0;
                font-size: 11px;
                color: #1e3a8a;
                border-bottom: 1px solid #e2e8f0;
                padding-bottom: 4px;
                font-weight: 600;
            }

            .info-card p {
                margin: 0 0 4px 0;
                font-size: 10.5px;
                display: flex;
                justify-content: space-between;
            }

            .info-card p span {
                color: #64748b;
            }

            .payment-card {
                background: #eff6ff;
                border: 1px solid #bfdbfe;
            }

            .payment-card h3 {
                color: #1d4ed8;
                border-bottom-color: #bfdbfe;
            }

            .payment-card p.total-to-pay {
                font-size: 14px;
                font-weight: 700;
                color: #1e3a8a;
                margin-top: 8px;
                border-top: 1px solid #bfdbfe;
                padding-top: 6px;
            }

            .bank-card {
                background-color: #faf5ff;
                border: 1px solid #e9d5ff;
            }

            .bank-card h3 {
                color: #7e22ce;
                border-bottom-color: #e9d5ff;
            }

            .table-title {
                font-size: 12px;
                font-weight: 700;
                color: #1e3a8a;
                margin: 16px 0 8px 0;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }

            .table-title span {
                font-size: 10px;
                font-weight: 500;
                color: #64748b;
            }

            .expenses-table {
                width: 100%;
                border-collapse: collapse;
                background: white;
                border: 1px solid #e2e8f0;
                border-radius: 8px;
                overflow: hidden;
                box-shadow: 0 2px 4px -1px rgb(0 0 0 / 0.02);
                margin-bottom: 16px;
            }

            .expenses-table th {
                background-color: #f1f5f9;
                color: #475569;
                font-weight: 600;
                padding: 6px 10px;
                border-bottom: 1.5px solid #cbd5e1;
                text-align: left;
            }

            .expenses-table td {
                padding: 5px 10px;
                border-bottom: 1px solid #f1f5f9;
                vertical-align: middle;
            }

            .category-header-row {
                background-color: #f8fafc;
            }

            .category-header-row td {
                border-top: 1.5px solid #e2e8f0;
                border-bottom: 1.5px solid #cbd5e1;
                font-weight: 600;
                color: #1e3a8a;
                padding: 6px 10px;
            }

            .cat-num {
                font-family: monospace;
                text-align: center;
                background-color: #e2e8f0;
                color: #475569;
                border-radius: 4px;
            }

            .item-particular-row {
                background-color: #fef2f2;
                color: #991b1b;
            }

            .item-desc {
                font-size: 9.5px;
            }

            .item-val {
                font-family: monospace;
            }

            .totals-summary-card {
                background: white;
                border: 1px solid #cbd5e1;
                border-radius: 10px;
                padding: 12px;
                margin-top: 16px;
                box-shadow: 0 2px 4px -1px rgb(0 0 0 / 0.02);
            }

            .totals-grid {
                display: grid;
                grid-template-columns: repeat(4, 1fr);
                gap: 12px;
                text-align: center;
            }

            .totals-grid-item {
                border-right: 1px solid #e2e8f0;
            }

            .totals-grid-item:last-child {
                border-right: none;
            }

            .totals-grid-item h4 {
                margin: 0 0 4px 0;
                font-size: 9.5px;
                color: #64748b;
                text-transform: uppercase;
                font-weight: 500;
            }

            .totals-grid-item p {
                margin: 0;
                font-size: 13px;
                font-weight: 700;
                color: #1e3a8a;
            }

            .state-card {
                background-color: #f0fdf4;
                border: 1px solid #bbf7d0;
                color: #166534;
            }

            .state-card h3 {
                color: #166534;
                border-bottom-color: #bbf7d0;
            }

            .text-right {
                text-align: right;
            }

            .footer-info {
                text-align: center;
                color: #94a3b8;
                font-size: 9px;
                margin-top: 24px;
                border-top: 1px solid #e2e8f0;
                padding-top: 12px;
            }
        </style>
    </head>
    <body>

        <!-- Header -->
        <div class="header-card">
            <div class="header-title">
                <h1>${exp.consorcio.name}</h1>
                <p>CUIT: ${exp.consorcio.cuit} | Domicilio: ${exp.consorcio.address}</p>
                <p>Clave SUTERH: ${exp.consorcio.suterhKey || 'N/A'}</p>
            </div>
            <div class="header-period">
                <h2>${exp.period}</h2>
                <p>Vencimiento: ${vencimientoStr}</p>
            </div>
        </div>

        <!-- Info Grid -->
        <div class="info-section">
            <div class="info-card">
                <h3>DATOS DE LA UNIDAD FUNCIONAL</h3>
                <p><span>U.F. N°:</span> <strong>${u.uf}</strong></p>
                <p><span>Departamento:</span> ${u.depto}</p>
                <p><span>Propietario:</span> <strong>${u.nombre}</strong></p>
                <p><span>Coeficiente de Prorrateo A:</span> ${u.coefA}%</p>
            </div>

            <div class="info-card payment-card">
                <h3>RESUMEN DE CUENTA</h3>
                <p><span>Saldo Anterior:</span> ${fmtCurr(u.saldoAnterior)}</p>
                <p><span>Su Pago del Período:</span> - ${fmtCurr(u.suPago)}</p>
                <p><span>Saldo Remanente:</span> ${fmtCurr(remanente)}</p>
                <p><span>Expensas del Mes:</span> ${fmtCurr(u.totalMes)}</p>
                <p><span>Intereses por Mora (${interestRatePct}%):</span> ${fmtCurr(u.intereses)}</p>
                <p class="total-to-pay"><span>TOTAL A PAGAR:</span> ${fmtCurr(u.totalDue)}</p>
            </div>
        </div>

        <div class="info-section">
            <div class="info-card bank-card">
                <h3>DATOS PARA EL PAGO</h3>
                <p><span>Banco:</span> ${exp.consorcio.bankInfo.bankName || 'SANTANDER'}</p>
                <p><span>Cuenta:</span> ${exp.consorcio.bankInfo.accountNumber || 'Cta. Cte. $ N°210-001841/8'}</p>
                <p><span>CBU:</span> ${exp.consorcio.bankInfo.cbu || '0720210220000000184186'}</p>
                <p><span>Alias:</span> ${exp.consorcio.bankInfo.alias || 'CARDO.BARCO.COPA'}</p>
                <p><span>Enviar Comprobante:</span> ${exp.consorcio.bankInfo.email || 'masoca_administraciones@hotmail.com'}</p>
            </div>

            <div class="info-card state-card">
                <h3>ESTADO FINANCIERO DE CAJA</h3>
                <p><span>Saldo de Caja Anterior:</span> ${fmtCurr(exp.caja.saldoAnterior)}</p>
                <p><span>Cobranzas de Expensas (+):</span> ${fmtCurr(exp.caja.cobranzas)}</p>
                <p><span>Pagos de Gastos A y B (-):</span> ${fmtCurr(Math.abs(exp.caja.pagosAyB))}</p>
                <p><span>Pagos Particulares (-):</span> ${fmtCurr(Math.abs(exp.caja.pagosPart))}</p>
                <p style="font-weight: 700; border-top: 1px solid #bbf7d0; padding-top: 4px; margin-top: 4px;"><span>SALDO AL CIERRE DE CAJA:</span> ${fmtCurr(exp.caja.saldoCierre)}</p>
            </div>
        </div>

        <!-- Detailed Expenses -->
        <div class="table-title">
            LIQUIDACION DETALLADA DE GASTOS
            <span>Periodo de Prorrateo: ${exp.period}</span>
        </div>

        <table class="expenses-table">
            <thead>
                <tr>
                    <th style="width: 5%">Cód</th>
                    <th style="width: 55%">Detalle de los Gastos Realizados</th>
                    <th style="width: 15%" class="text-right">Gastos A y B</th>
                    <th style="width: 15%" class="text-right">Gastos Part.</th>
                    <th style="width: 10%"></th>
                </tr>
            </thead>
            <tbody>
                ${expensesTableHTML}
            </tbody>
        </table>

        <!-- Summary Totals -->
        <div class="totals-summary-card">
            <div class="totals-grid">
                <div class="totals-grid-item">
                    <h4>Total Pagos A y B</h4>
                    <p>${fmtCurr(exp.totalPagosAyB)}</p>
                </div>
                <div class="totals-grid-item">
                    <h4>Previsiones/Fondos</h4>
                    <p>${fmtCurr(exp.totalPrevisiones)}</p>
                </div>
                <div class="totals-grid-item">
                    <h4>Total Prorrateo</h4>
                    <p>${fmtCurr(exp.totalProrrateoAyB)}</p>
                </div>
                <div class="totals-grid-item">
                    <h4>Gastos Particulares</h4>
                    <p>${fmtCurr(exp.totalGastosParticulares)}</p>
                </div>
            </div>
        </div>

        <div class="footer-info">
            <p>Documento oficial de liquidación de expensas emitido de forma automatizada por Antigravity Automa.</p>
            <p>${exp.consorcio.address || exp.consorcio.name} | Buenos Aires, Argentina | Emitido el ${dateFormatted}</p>
        </div>

    </body>
    </html>
    `;
}

function generateAllExpensesReceiptsHTML(exp) {
    if (!exp.resCuenta || exp.resCuenta.length === 0) return '';
    let receiptsContent = '';
    for (let i = 0; i < exp.resCuenta.length; i++) {
        const u = exp.resCuenta[i];
        const fullHtml = generateExpensesReceiptHTML(exp, u.uf);
        const bodyStart = fullHtml.indexOf('<body>') + 6;
        const bodyEnd = fullHtml.indexOf('</body>');
        const bodyContent = fullHtml.substring(bodyStart, bodyEnd);
        receiptsContent += `
            <div class="receipt-page">
                ${bodyContent}
            </div>
            ${i < exp.resCuenta.length - 1 ? '<div class="page-break"></div>' : ''}
        `;
    }
    const firstHtml = generateExpensesReceiptHTML(exp, exp.resCuenta[0].uf);
    const headStart = firstHtml.indexOf('<head>');
    const headEnd = firstHtml.indexOf('</head>') + 7;
    const headContent = firstHtml.substring(headStart, headEnd);
    const styleInject = `
        <style>
            @media print {
                .page-break {
                    page-break-before: always;
                    break-before: page;
                    clear: both;
                }
                body {
                    background-color: white !important;
                    margin: 0 !important;
                    padding: 0 !important;
                }
            }
            .receipt-page {
                page-break-inside: avoid;
                break-inside: avoid;
                margin-bottom: 20px;
            }
        </style>
    `;
    const finalHead = headContent.replace('</head>', `${styleInject}</head>`);
    return `
    <!DOCTYPE html>
    <html lang="es">
    ${finalHead}
    <body>
        ${receiptsContent}
    </body>
    </html>
    `;
}

module.exports = { generatePayslipHTML, generateExpensesReceiptHTML, generateAllExpensesReceiptsHTML };
