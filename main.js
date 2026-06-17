const http = require('http');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

// Import DB manager
const dbManager = require('./db_manager');
const receiptParser = require('./receipt_parser');

// Import engines
const { calculatePayroll } = require('./payroll_engine');
const { exportToAFIPLSD } = require('./afip_lsd_exporter');
const { calculateExpenses, calculateExpensesFromFile } = require('./expenses_engine');
const { generatePayslipHTML, generateExpensesReceiptHTML, generateAllExpensesReceiptsHTML } = require('./pdf_generator');

const CUIT_MAPPING = {
    "30519077635": { keywords: ["sgo", "santiago", "estero", "sant"] },
    "30532673484": { keywords: ["lima"] },
    "30536354154": { keywords: ["san jose", "jose"] },
    "30537480544": { keywords: ["belgrano"] },
    "30538590009": { keywords: ["rodriguez", "pena", "peña", "rod"] },
    "30540887752": { keywords: ["arenales"] },
    "30559333022": { keywords: ["palos"] },
    "30580260906": { keywords: ["uruguay"] },
    "30604528166": { keywords: ["brown"] },
    "30630042670": { keywords: ["arenales", "1648"] },
    "30661488618": { keywords: ["montes", "oca", "m oca"] },
    "30707887628": { keywords: ["yrigoyen", "hipolito"] },
    "30711283338": { keywords: ["salta"] },
    "30711553165": { keywords: ["azcuenaga"] },
    "30711776903": { keywords: ["bustamante", "bustamente"] }
};

function findExpensesFile(cuit, periodStr) {
    const cuitClean = String(cuit).replace(/[^0-9]/g, '');
    const [year, month] = periodStr.split('-');
    const periodShort = `${month}${year.substring(2)}`;
    const periodLong = `${month}${year}`;

    const dirFiles = fs.readdirSync(__dirname);
    const mapping = CUIT_MAPPING[cuitClean];
    if (!mapping) {
        return null;
    }

    let bestFile = null;
    let bestScore = 0;

    for (const file of dirFiles) {
        const fileLower = file.toLowerCase();
        if (!fileLower.endsWith('.xls') && !fileLower.endsWith('.xlsx')) continue;
        if (fileLower.startsWith('liquidacion-') || fileLower.startsWith('~$')) continue;

        // Ensure the file belongs to the requested period
        if (!fileLower.includes(periodShort) && !fileLower.includes(periodLong)) continue;

        let score = 0;
        let keywordMatches = 0;
        for (const kw of mapping.keywords) {
            if (fileLower.includes(kw)) {
                keywordMatches++;
            }
        }
        if (keywordMatches > 0) {
            score += keywordMatches * 5;
        }

        if (cuitClean === "30540887752") {
            if (fileLower.includes("1648")) score -= 20;
            if (fileLower.includes("  ") || fileLower.includes("arenales  ")) score -= 20;
        } else if (cuitClean === "30630042670") {
            if (fileLower.includes("1648")) score += 15;
            if (fileLower.includes("  ") || fileLower.includes("arenales  ")) score += 15;
        }

        if (score > bestScore && keywordMatches > 0) {
            bestScore = score;
            bestFile = file;
        }
    }

    if (bestFile) {
        return path.join(__dirname, bestFile);
    }
    
    // Explicit template fallback only for Arenales 2120 CUIT
    if (cuitClean === "30540887752") {
        return path.join(__dirname, "Liquidacion-expensas-modelo.xls");
    }
    
    return null;
}

const PORT = process.env.PORT || 5000;

// Helper to parse JSON body from incoming requests
function getJSONBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (err) {
                reject(new Error('Invalid JSON payload'));
            }
        });
    });
}

// HTTP Request Handler
const server = http.createServer(async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
    const pathname = parsedUrl.pathname;

    console.log(`[API] ${req.method} ${pathname}`);

    try {
        // Serve Dashboard HTML
        if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
            const dashboardPath = path.join(__dirname, 'dashboard.html');
            if (fs.existsSync(dashboardPath)) {
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(fs.readFileSync(dashboardPath));
            } else {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: "dashboard.html not found in workspace" }));
            }
            return;
        }

        // Consorcios list endpoint
        if (req.method === 'GET' && pathname === '/api/consorcios') {
            const list = dbManager.getConsorcios();
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(list));
            return;
        }

        // Consorcios detail endpoint
        if (req.method === 'GET' && pathname === '/api/db/consorcios/detail') {
            const cuit = parsedUrl.searchParams.get('cuit') || '';
            if (!cuit) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: "Missing CUIT" }));
                return;
            }
            const consorcio = dbManager.getConsorcio(cuit);
            if (!consorcio) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: "Consorcio not found" }));
                return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(consorcio));
            return;
        }

        // Process Local files endpoint
        if (req.method === 'GET' && pathname === '/api/process-local') {
            const periodArg = parsedUrl.searchParams.get('period') || '2026-06';
            const cuitArg = parsedUrl.searchParams.get('cuit') || '';
            const data = calculateLocalData(periodArg, cuitArg);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(data));
            return;
        }

        if (req.method === 'POST' && pathname === '/api/payroll') {
            const body = await getJSONBody(req);
            const { employees, employers, novedades, scales, period, liqNum, paymentDate } = body;

            if (!employees || !employers || !novedades || !scales || !period) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: "Missing required fields (employees, employers, novedades, scales, period)" }));
                return;
            }

            const payrollResults = calculatePayroll(employees, employers, novedades, scales, period);
            const lsdFiles = exportToAFIPLSD(payrollResults, employees, employers, period, liqNum || 1, paymentDate || '');

            // For each employee, generate their payslip HTML
            const resultsWithHtml = payrollResults.map(p => {
                return {
                    ...p,
                    payslipHtml: generatePayslipHTML(p)
                };
            });

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                period,
                results: resultsWithHtml,
                lsdFiles
            }));
            return;
        }

        if (req.method === 'POST' && pathname === '/api/expenses') {
            const body = await getJSONBody(req);
            const { consorcio, unidadesFuncionales, periodState, period, inputParams } = body;

            if (!consorcio || !unidadesFuncionales || !periodState || !period || !inputParams) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: "Missing required fields (consorcio, unidadesFuncionales, periodState, period, inputParams)" }));
                return;
            }

            const expensesResult = calculateExpenses(consorcio, unidadesFuncionales, periodState, period, inputParams);

            // Generate HTML receipts for each unit
            const resCuentaWithHtml = expensesResult.resCuenta.map(u => {
                return {
                    ...u,
                    receiptHtml: generateExpensesReceiptHTML(expensesResult, u.uf)
                };
            });

            const printAllHtml = generateAllExpensesReceiptsHTML(expensesResult);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                ...expensesResult,
                resCuenta: resCuentaWithHtml,
                printAllHtml
            }));
            return;
        }

        // Save period data endpoint
        if (req.method === 'POST' && pathname === '/api/db/period/save') {
            const body = await getJSONBody(req);
            const { cuit, period, novedades, payments, gastos, caja, isSacSeparate, newRecurringExpenses } = body;

            if (!cuit || !period) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: "Missing CUIT or Period" }));
                return;
            }

            const cuitClean = String(cuit).replace(/[^0-9]/g, '');
            const dbPeriodData = dbManager.getPeriodData(cuitClean, period);
            if (!dbPeriodData || !dbPeriodData.fileFound) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: "Period data not found or not initiated in database" }));
                return;
            }

            // Update Novedades if provided
            if (novedades) {
                dbPeriodData.novedades = novedades;
            }

            // Update Payments if provided
            if (payments) {
                dbPeriodData.resCuenta.forEach(u => {
                    if (payments[String(u.uf)] !== undefined) {
                        u.suPago = Number(payments[String(u.uf)]);
                    }
                });
            }

            // Update Expenses if provided
            if (gastos) {
                dbPeriodData.gastos = gastos;
            }

            // Update Caja if provided
            if (caja) {
                dbPeriodData.caja = {
                    ...dbPeriodData.caja,
                    ...caja
                };
            }

            if (isSacSeparate !== undefined) {
                dbPeriodData.isSacSeparate = !!isSacSeparate;
            }

            // If there are new recurring/installment expenses added from the UI, save them to the consorcio config
            if (newRecurringExpenses && Array.isArray(newRecurringExpenses)) {
                const consorcio = dbManager.getConsorcio(cuitClean);
                if (consorcio) {
                    if (!consorcio.recurringExpenses) consorcio.recurringExpenses = [];
                    newRecurringExpenses.forEach(exp => {
                        consorcio.recurringExpenses.push({
                            id: exp.id || 'rec_' + Date.now() + '_' + Math.floor(Math.random() * 100),
                            category: exp.category,
                            description: exp.description,
                            amount: Number(exp.amount),
                            type: exp.type || 'A',
                            isInstallment: !!exp.isInstallment,
                            currentInstallment: exp.isInstallment ? Number(exp.currentInstallment) : undefined,
                            totalInstallments: exp.isInstallment ? Number(exp.totalInstallments) : undefined
                        });
                    });
                    dbManager.saveConsorcio(cuitClean, consorcio);
                }
            }

            // Save to DB
            dbManager.savePeriodData(cuitClean, period, dbPeriodData);

            // Recompute and return calculations
            const updatedCalculations = calculateLocalData(period, cuitClean);
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, data: updatedCalculations }));
            return;
        }

        // Initiate period endpoint
        if (req.method === 'POST' && pathname === '/api/db/period/initiate') {
            const body = await getJSONBody(req);
            const { cuit, period, prevPeriod } = body;

            if (!cuit || !period || !prevPeriod) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: "Missing cuit, period, or prevPeriod" }));
                return;
            }

            const cuitClean = String(cuit).replace(/[^0-9]/g, '');
            try {
                dbManager.initiatePeriod(cuitClean, period, prevPeriod);
                const initiatedData = calculateLocalData(period, cuitClean);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, data: initiatedData }));
            } catch (e) {
                console.error("[API] Failed to initiate period:", e);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: e.message }));
            }
            return;
        }

        // New Consorcios CRUD Endpoint
        if (req.method === 'POST' && pathname === '/api/db/consorcios/save') {
            const body = await getJSONBody(req);
            const cuit = body.cuit || body.consorcioData?.cuit;
            const consorcioData = body.consorcioData || body;
            if (!cuit) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: "Missing CUIT" }));
                return;
            }
            dbManager.saveConsorcio(cuit, consorcioData);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
            return;
        }

        if (req.method === 'POST' && pathname === '/api/db/consorcios/delete') {
            const body = await getJSONBody(req);
            const { cuit } = body;
            if (!cuit) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: "Missing CUIT" }));
                return;
            }
            dbManager.deleteConsorcio(cuit);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
            return;
        }

        // New Employees CRUD Endpoint
        if (req.method === 'POST' && pathname === '/api/db/employees/save') {
            const body = await getJSONBody(req);
            const cuil = body.cuil || body.employeeData?.cuil;
            const employeeData = body.employeeData || body;
            if (!cuil) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: "Missing CUIL" }));
                return;
            }
            dbManager.saveEmployee(cuil, employeeData);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
            return;
        }

        if (req.method === 'POST' && pathname === '/api/db/employees/delete') {
            const body = await getJSONBody(req);
            const { cuil } = body;
            if (!cuil) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: "Missing CUIL" }));
                return;
            }
            dbManager.deleteEmployee(cuil);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
            return;
        }

        // Receipt Ingestion and Conciliation Endpoints
        if (req.method === 'POST' && pathname === '/api/db/payments/ingest-email') {
            const body = await getJSONBody(req);
            const { sender, subject, body: emailBody, attachmentName } = body;
            if (!sender || !subject) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: "Missing sender or subject" }));
                return;
            }

            const extracted = receiptParser.extractPaymentInfo(subject, emailBody || '', attachmentName || '');
            const matched = receiptParser.matchPaymentToUF(sender, subject, emailBody || '', extracted);

            const payment = {
                id: 'pay_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
                sender,
                subject,
                body: emailBody || '',
                attachmentName: attachmentName || '',
                extracted,
                matched,
                status: 'pending',
                timestamp: new Date().toISOString()
            };

            dbManager.addPendingPayment(payment);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, payment }));
            return;
        }

        if (req.method === 'GET' && pathname === '/api/db/payments/pending') {
            const cuit = parsedUrl.searchParams.get('cuit') || '';
            const db = dbManager.loadDb();
            let pending = db.pendingPayments || [];
            pending = pending.filter(p => p.status === 'pending');
            if (cuit) {
                const cuitClean = String(cuit).replace(/[^0-9]/g, '');
                pending = pending.filter(p => String(p.matched?.cuitConsorcio || '').replace(/[^0-9]/g, '') === cuitClean);
            }
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(pending));
            return;
        }

        if (req.method === 'GET' && pathname === '/api/db/employees') {
            const cuit = parsedUrl.searchParams.get('cuit') || '';
            const db = dbManager.loadDb();
            let list = db.employees || [];
            if (cuit) {
                const cuitClean = String(cuit).replace(/[^0-9]/g, '');
                list = list.filter(emp => String(emp.cuitEmployer || emp.CUIT_EMPLEADOR || emp['CUIT EMPLEADOR'] || '').replace(/[^0-9]/g, '') === cuitClean);
            }
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(list));
            return;
        }

        if (req.method === 'POST' && pathname === '/api/db/payments/approve') {
            const body = await getJSONBody(req);
            const { id, period, cuit, uf, amount } = body;
            if (!id || !period || !cuit || !uf || !amount) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: "Missing required fields (id, period, cuit, uf, amount)" }));
                return;
            }

            dbManager.resolvePendingPayment(id, 'approved');

            const cuitClean = String(cuit).replace(/[^0-9]/g, '');
            const periodData = dbManager.getPeriodData(cuitClean, period);
            if (periodData && periodData.fileFound) {
                let unit = periodData.resCuenta.find(u => String(u.uf).trim().toUpperCase() === String(uf).trim().toUpperCase());
                if (unit) {
                    unit.suPago = Math.round(((unit.suPago || 0) + Number(amount) + Number.EPSILON) * 100) / 100;
                    dbManager.savePeriodData(cuitClean, period, periodData);
                } else {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: `Unit ${uf} not found in period ${period}` }));
                    return;
                }
            } else {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: `Period ${period} not found/initiated for CUIT ${cuitClean}` }));
                return;
            }

            const updated = calculateLocalData(period, cuitClean);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, data: updated }));
            return;
        }

        if (req.method === 'POST' && pathname === '/api/db/payments/reject') {
            const body = await getJSONBody(req);
            const { id } = body;
            if (!id) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: "Missing id" }));
                return;
            }
            dbManager.resolvePendingPayment(id, 'rejected');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
            return;
        }

        // Notification Dispatch Endpoint
        if (req.method === 'POST' && pathname === '/api/db/period/send-notifications') {
            const body = await getJSONBody(req);
            const { cuit, period, uf } = body;
            if (!cuit || !period) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: "Missing CUIT or Period" }));
                return;
            }

            const cuitClean = String(cuit).replace(/[^0-9]/g, '');
            const calcData = calculateLocalData(period, cuitClean);
            const consorcio = dbManager.getConsorcio(cuitClean);
            if (!consorcio) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: "Consorcio not found" }));
                return;
            }

            const emailLogDir = path.join(__dirname, 'scratch', 'email_logs');
            const waLogDir = path.join(__dirname, 'scratch', 'whatsapp_logs');
            if (!fs.existsSync(emailLogDir)) fs.mkdirSync(emailLogDir, { recursive: true });
            if (!fs.existsSync(waLogDir)) fs.mkdirSync(waLogDir, { recursive: true });

            const targetUnits = uf 
                ? calcData.expenses.resCuenta.filter(u => String(u.uf).trim().toUpperCase() === String(uf).trim().toUpperCase())
                : calcData.expenses.resCuenta;

            const logs = [];
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

            for (const u of targetUnits) {
                const configUnit = consorcio.units?.find(cu => String(cu.uf).trim().toUpperCase() === String(u.uf).trim().toUpperCase()) || {};
                const email = configUnit.email || `propietario_uf${u.uf}@ejemplo.com`;
                const phone = configUnit.phone || `+549111234567${u.uf}`;
                
                // Write Email Log
                const emailPayload = {
                    to: email,
                    subject: `Liquidación de Expensas - ${calcData.expenses.consorcio.name} - Período ${calcData.expenses.period} - UF ${u.uf}`,
                    body: `Estimado/a ${u.nombre},\n\nLe enviamos el aviso de expensas del período ${calcData.expenses.period} correspondiente a la Unidad Funcional ${u.uf} (${u.depto}).\n\n` +
                          `Monto del Mes: $${u.totalMes.toLocaleString('es-AR', {minimumFractionDigits: 2})}\n` +
                          `Deuda Anterior: $${u.deuda.toLocaleString('es-AR', {minimumFractionDigits: 2})}\n` +
                          `Intereses: $${u.intereses.toLocaleString('es-AR', {minimumFractionDigits: 2})}\n` +
                          `Total a Pagar: $${u.totalDue.toLocaleString('es-AR', {minimumFractionDigits: 2})}\n` +
                          `Vencimiento: ${consorcio.dueDay || 10}/${period.split('-')[1]}/${period.split('-')[0]}\n\n` +
                          `Información Bancaria para Transferencia:\n` +
                          `Titular: ${consorcio.bankInfo?.titular || ''}\n` +
                          `Banco: ${consorcio.bankInfo?.bankName || ''}\n` +
                          `CBU: ${consorcio.bankInfo?.cbu || ''}\n` +
                          `Alias: ${consorcio.bankInfo?.alias || ''}\n\n` +
                          `Atentamente,\nAdministración Consorcios Kari.`,
                    attachmentSimulated: u.receiptHtml
                };

                const emailFilename = `email_uf_${u.uf}_${timestamp}.json`;
                fs.writeFileSync(path.join(emailLogDir, emailFilename), JSON.stringify(emailPayload, null, 2), 'utf8');

                // Write WhatsApp Log
                const waPayload = {
                    to: phone,
                    message: `*Administración Consorcios Kari* ✉\n` +
                             `Hola ${u.nombre}, te enviamos el aviso de expensas de ${calcData.expenses.period} para la UF ${u.uf}.\n` +
                             `• *Total a Pagar:* $${u.totalDue.toLocaleString('es-AR', {minimumFractionDigits: 2})}\n` +
                             `• *Vence:* ${consorcio.dueDay || 10}/${period.split('-')[1]}\n` +
                             `• *CBU:* ${consorcio.bankInfo?.cbu || 'No disponible'}\n` +
                             `• *Alias:* ${consorcio.bankInfo?.alias || 'No disponible'}\n\n` +
                             `Podes descargar tu comprobante de expensas acá: http://localhost:${PORT}/api/receipt/uf/${u.uf}?period=${period}`
                };

                const waFilename = `whatsapp_uf_${u.uf}_${timestamp}.json`;
                fs.writeFileSync(path.join(waLogDir, waFilename), JSON.stringify(waPayload, null, 2), 'utf8');

                logs.push({ uf: u.uf, emailSentTo: email, waSentTo: phone });
            }

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ success: true, sentCount: targetUnits.length, logs }));
            return;
        }

        // Import Google Sheets Database Sync Endpoint (n8n payload push)
        if (req.method === 'POST' && pathname === '/api/db/import-sheets') {
            const body = await getJSONBody(req);
            const { employers, employees, novedades, gastos, unidadesFuncionales } = body;

            if (!employers || !employees || !novedades || !gastos || !unidadesFuncionales) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: "Missing required fields (employers, employees, novedades, gastos, unidadesFuncionales)" }));
                return;
            }

            try {
                const stats = importSheetsData(body);
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: true, message: `Sincronización exitosa. Se actualizaron ${stats.consorciosCount} consorcios y ${stats.employeesCount} empleados.` }));
            } catch (err) {
                console.error("[Sheets Sync Error]", err);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: `Fallo al importar datos: ${err.message}` }));
            }
            return;
        }

        // Direct Google Sheets Database Sync Endpoint (triggered from UI)
        if (req.method === 'POST' && pathname === '/api/db/sync-now') {
            try {
                const spreadsheetId = "1G7ZFG0KsBIu-oBvH3OdRGNMQuBE2AbgOR6Zfu4ppGPE";
                const baseURL = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=`;
                
                console.log("[Sheets Sync] Fetching sheets from Google...");
                
                const [csvEmployers, csvEmployees, csvNovedades, csvGastos, csvUfs] = await Promise.all([
                    fetchURL(baseURL + "Empleadores"),
                    fetchURL(baseURL + "Empleados"),
                    fetchURL(baseURL + "Novedades"),
                    fetchURL(baseURL + "Gastos"),
                    fetchURL(baseURL + "UnidadesFuncionales")
                ]);
                
                console.log("[Sheets Sync] Parsing sheets CSVs...");
                const employers = parseCSV(csvEmployers);
                const employees = parseCSV(csvEmployees);
                const novedades = parseCSV(csvNovedades);
                const gastos = parseCSV(csvGastos);
                const unidadesFuncionales = parseCSV(csvUfs);

                const payload = { employers, employees, novedades, gastos, unidadesFuncionales };
                const stats = importSheetsData(payload);

                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: true, message: `Sincronización directa exitosa. Se actualizaron ${stats.consorciosCount} consorcios y ${stats.employeesCount} empleados.` }));
            } catch (err) {
                console.error("[Sheets Sync Error]", err);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: `Error de sincronización con Google Sheets: ${err.message}` }));
            }
            return;
        }

        // Status endpoint
        if (req.method === 'GET' && pathname === '/api/status') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: "ok", time: new Date().toISOString() }));
            return;
        }

        // 404 Not Found
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: "Not Found" }));

    } catch (error) {
        console.error("[API Error]", error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
    }
});

function calculateDataFromDb(cuit, period, dbPeriodData) {
    const sueldosPath = path.join(__dirname, "Liquidacion-sueldos-modelo.xls.xlsm");
    if (!fs.existsSync(sueldosPath)) {
        throw new Error("Master sueldos spreadsheet not found.");
    }
    const wbSueldos = XLSX.readFile(sueldosPath);
    const employers = XLSX.utils.sheet_to_json(wbSueldos.Sheets["Empleador"]);
    const employees = XLSX.utils.sheet_to_json(wbSueldos.Sheets["Empleados"]);

    const cuitClean = String(cuit).replace(/[^0-9]/g, '');
    const dbConsorcio = dbManager.getConsorcio(cuitClean);
    let employerRecord = employers.find(emp => String(emp.CUIT).replace(/[^0-9]/g, '') === cuitClean);
    if (!employerRecord) {
        if (dbConsorcio) {
            employerRecord = {
                "CUIT": dbConsorcio.cuit,
                "RAZON SOCIAL": dbConsorcio.name,
                "CATEGORIA EDIFICIO": dbConsorcio.category || "1° Cat.",
                "COCHERA": dbConsorcio.cochera || "NO",
                "JARDIN": dbConsorcio.jardin || "NO",
                "PILETA": dbConsorcio.pileta || "NO",
                "MOVIMIENTO DE COCHES": dbConsorcio.movimientoCoches || "NO",
                "ZONA DESFAVORABLE": dbConsorcio.zonaDesfavorable || "NO",
                "UF": dbConsorcio.units?.length || 0,
                "% VARIABLE": dbConsorcio.artRate !== undefined ? dbConsorcio.artRate : 0.03,
                "$ SEGURO VIDA FIJO": dbConsorcio.scvoFijo !== undefined ? dbConsorcio.scvoFijo : 424.62
            };
            employers.push(employerRecord);
        } else {
            throw new Error(`Employer CUIT ${cuitClean} not found in master sheet or database.`);
        }
    }

    // 1. Get database employees for this CUIT
    const db = dbManager.loadDb();
    const dbEmployees = (db.employees || []).filter(emp => 
        String(emp.cuitEmployer || emp.CUIT_EMPLEADOR || emp['CUIT EMPLEADOR'] || '').replace(/[^0-9]/g, '') === cuitClean
    );

    // 2. Map existing excel employees and merge DB updates
    const filteredEmployees = [];
    const processedCuils = new Set();

    employees.forEach(emp => {
        const empCuit = String(emp.CUIT || emp.CUIT_EMPLEADOR || emp['CUIT EMPLEADOR'] || '').replace(/[^0-9]/g, '');
        if (empCuit === cuitClean) {
            const cuilStr = String(emp.CUIL || '').replace(/[^0-9]/g, '');
            if (cuilStr) {
                processedCuils.add(cuilStr);
                const dbEmp = dbEmployees.find(de => String(de.cuil).replace(/[^0-9]/g, '') === cuilStr);
                if (dbEmp) {
                    emp['APELLIDO Y NOMBRE'] = dbEmp.employeeName || emp['APELLIDO Y NOMBRE'];
                    emp['FECHA DE INGRESO'] = dbEmp.hireDate || emp['FECHA DE INGRESO'];
                    emp.FUNCION = dbEmp.function || emp.FUNCION;
                    emp.CBU = dbEmp.cbu || emp.CBU;
                    emp['BANCO DEPOSITO'] = dbEmp.bank || emp['BANCO DEPOSITO'];
                    emp.plusJardin = dbEmp.plusJardin;
                    emp.plusPileta = dbEmp.plusPileta;
                    emp.plusCochera = dbEmp.plusCochera;
                    emp.plusMovimientoCoches = dbEmp.plusMovimientoCoches;
                }
                filteredEmployees.push(emp);
            }
        }
    });

    // 3. Add database-only employees
    dbEmployees.forEach(dbEmp => {
        const cuilStr = String(dbEmp.cuil).replace(/[^0-9]/g, '');
        if (cuilStr && !processedCuils.has(cuilStr)) {
            const funcLower = String(dbEmp.function || '').toLowerCase();
            const isMedia = funcLower.includes('media') || funcLower.includes('jornada');
            const hasVivienda = funcLower.includes('con vivienda');
            
            const newEmp = {
                CUIL: cuilStr,
                'APELLIDO Y NOMBRE': dbEmp.employeeName,
                'FECHA DE INGRESO': dbEmp.hireDate || '',
                CUIT: cuitClean,
                'CUIT EMPLEADOR': cuitClean,
                FUNCION: dbEmp.function || 'Encargado Permanente',
                'CATEGORIA EDIFICIO ': dbConsorcio ? dbConsorcio.category : '1° Cat.',
                'BANCO DEPOSITO': dbEmp.bank || '',
                CBU: dbEmp.cbu || '',
                LEGAJO: 99,
                JORNADA: isMedia ? 'Media' : 'Completa',
                Vivienda: hasVivienda ? 'SI' : 'NO',
                'Adicional remuneratorio': 0,
                Antiguedad: 0,
                Viaticos: 'NO',
                'Retiro de Residuos': 'NO',
                'Clasificacion de residuos': 'NO',
                plusJardin: dbEmp.plusJardin,
                plusPileta: dbEmp.plusPileta,
                plusCochera: dbEmp.plusCochera,
                plusMovimientoCoches: dbEmp.plusMovimientoCoches
            };
            filteredEmployees.push(newEmp);
            processedCuils.add(cuilStr);
        }
    });

    const isSacOnly = String(period).toUpperCase().includes("SAC");
    const cleanPeriod = String(period).replace("-SAC", "").replace(" SAC", "");
    const isSacPeriod = cleanPeriod.endsWith("-06") || cleanPeriod.endsWith("-12");
    const isSacSeparate = dbPeriodData.isSacSeparate || false;

    let scales;
    try {
        scales = JSON.parse(fs.readFileSync(path.join(__dirname, `scales_${cleanPeriod}.json`)));
    } catch (e) {
        scales = JSON.parse(fs.readFileSync(path.join(__dirname, "scales_2026-05.json")));
    }

    // Map dbPeriodData.novedades to format expected by calculatePayroll
    const rawNovedades = dbPeriodData.novedades || [];
    const mappedNovedades = rawNovedades.map(nov => {
        return {
            "CUIL": nov.cuil,
            "CUIT": cuitClean,
            "PERIODO": cleanPeriod,
            "DIAS TRABAJADO SUPLENTE": nov.diasTrabajados !== undefined ? Number(nov.diasTrabajados) : 30,
            "HORAS EXTRAS al 50% [HS]": Number(nov.horasExtras50 || 0),
            "HORAS EXTRAS al 100% [HS]": Number(nov.horasExtras100 || 0),
            "FERIADOS TRABAJADOS [HS]": Number(nov.feriados || 0),
            "Anticipo": Number(nov.anticipo || 0),
            "Días no trabajados": Number(nov.diasNoTrabajados || 0),
            "Licencia por enfermedad": Number(nov.diasEnfermedad || 0),
            "PLUS VACACIONES [DIAS]": Number(nov.diasVacaciones || 0),
            "Embargo": Number(nov.embargo || 0),
            "Adicional voluntario": Number(nov.adicionalVoluntario || 0)
        };
    });

    let payrollResults = [];
    if (isSacOnly) {
        payrollResults = calculatePayroll(filteredEmployees, employers, mappedNovedades, scales, period, false, false);
    } else if (isSacPeriod && isSacSeparate) {
        const normalPayroll = calculatePayroll(filteredEmployees, employers, mappedNovedades, scales, cleanPeriod, false, true);
        const sacPayroll = calculatePayroll(filteredEmployees, employers, mappedNovedades, scales, `${cleanPeriod}-SAC`, false, false);
        payrollResults = [...normalPayroll, ...sacPayroll];
    } else {
        payrollResults = calculatePayroll(filteredEmployees, employers, mappedNovedades, scales, cleanPeriod, false, false);
    }

    const lsdFiles = exportToAFIPLSD(payrollResults, filteredEmployees, employers, cleanPeriod);

    const resultsWithHtml = payrollResults.map(p => {
        return {
            ...p,
            payslipHtml: generatePayslipHTML(p)
        };
    });

    const units = dbPeriodData.resCuenta.map(u => ({
        uf: u.uf,
        depto: u.depto,
        nombre: u.nombre,
        coefA: Number(u.coefA || 0),
        coefB: Number(u.coefB || 0)
    }));

    const periodState = {};
    dbPeriodData.resCuenta.forEach(u => {
        periodState[u.uf] = {
            saldoAnterior: Number(u.saldoAnterior || 0),
            suPago: Number(u.suPago || 0),
            gastosParticulares: Number(u.gastPart || 0),
            sAsamblea: Number(u.sAsamblea || 0),
            otros: Number(u.otros || 0)
        };
    });

    const inputParams = {
        gastos: dbPeriodData.gastos || [],
        provisions: dbPeriodData.provisions || dbPeriodData.previsionesItems || [],
        currentPayroll: resultsWithHtml,
        previousPayroll: []
    };

    const expensesResultRaw = calculateExpenses(dbPeriodData.consorcio, units, periodState, cleanPeriod, inputParams);

    // Build the bank reconciliation dynamically from the new caja and payments
    const totalCobranzas = expensesResultRaw.resCuentaTotals.suPago;
    const totalPagosAyB = expensesResultRaw.totalPagosAyB;
    const totalGastosPart = expensesResultRaw.totalGastosParticulares;
    const saldoAnteriorCaja = dbPeriodData.caja ? Number(dbPeriodData.caja.saldoAnterior || 0) : 0;
    const saldoCierreCaja = Math.round((saldoAnteriorCaja + totalCobranzas - totalPagosAyB - totalGastosPart + Number.EPSILON) * 100) / 100;

    expensesResultRaw.caja = {
        saldoAnterior: saldoAnteriorCaja,
        cobranzas: totalCobranzas,
        pagosAyB: -totalPagosAyB,
        pagosPart: -totalGastosPart,
        saldoCierre: saldoCierreCaja
    };

    expensesResultRaw.bankReconciliation = [
        { label: "SALDO INICIAL", value: saldoAnteriorCaja },
        { label: "(+) COBRANZA EXPENSAS", value: totalCobranzas },
        { label: "(-) PAGOS DEL PERIODO GASTOS A Y B", value: -totalPagosAyB },
        { label: "(-) PAGOS GASTOS PARTICULARES", value: -totalGastosPart },
        { label: "SALDO AL CIERRE SEGUN CAJA", value: saldoCierreCaja }
    ];

    const resCuentaWithHtml = expensesResultRaw.resCuenta.map(u => {
        return {
            ...u,
            receiptHtml: generateExpensesReceiptHTML(expensesResultRaw, u.uf)
        };
    });

    const printAllHtml = generateAllExpensesReceiptsHTML(expensesResultRaw);

    const expensesResult = {
        ...expensesResultRaw,
        resCuenta: resCuentaWithHtml,
        printAllHtml,
        fileFound: true,
        novedades: rawNovedades,
        isSacSeparate: dbPeriodData.isSacSeparate || false
    };

    const scalesPathUsed = fs.existsSync(path.join(__dirname, `scales_${cleanPeriod}.json`)) 
        ? `scales_${cleanPeriod}.json` 
        : "scales_2026-05.json (Fallback)";
    
    return {
        payroll: {
            results: resultsWithHtml,
            lsdFiles
        },
        expenses: expensesResult,
        documentation: {
            scales,
            filesUsed: [
                { name: "Planilla de Sueldos Master", path: "Liquidacion-sueldos-modelo.xls.xlsm", type: "Excel Master" },
                { name: "Base de Datos de Consorcios y Unidades", path: "db.json", type: "JSON Database" },
                { name: `Escala Salarial SUTERH (${cleanPeriod})`, path: scalesPathUsed, type: "JSON Scales" }
            ]
        }
    };
}

// Shared local data calculation helper
function calculateLocalData(periodArg, cuitArg) {
    const isSacOnly = String(periodArg).toUpperCase().includes("SAC");
    const cleanPeriod = String(periodArg).replace("-SAC", "").replace(" SAC", "");
    const cuitClean = cuitArg ? String(cuitArg).replace(/[^0-9]/g, '') : "30540887752"; // Default Arenales 2120

    // Check if period data exists in database
    const dbPeriodData = dbManager.getPeriodData(cuitClean, cleanPeriod);
    if (dbPeriodData && dbPeriodData.fileFound) {
        return calculateDataFromDb(cuitClean, periodArg, dbPeriodData);
    }

    const sueldosPath = path.join(__dirname, "Liquidacion-sueldos-modelo.xls.xlsm");
    if (!fs.existsSync(sueldosPath)) {
        throw new Error("Local Excel files not found in workspace.");
    }

    const wbSueldos = XLSX.readFile(sueldosPath);

    // Parse Sueldos master & novedades
    const employers = XLSX.utils.sheet_to_json(wbSueldos.Sheets["Empleador"]);
    const employees = XLSX.utils.sheet_to_json(wbSueldos.Sheets["Empleados"]);
    const rawNovedades = XLSX.utils.sheet_to_json(wbSueldos.Sheets["Novedades"]);

    const dbConsorcio = dbManager.getConsorcio(cuitClean);
    let employerRecord = employers.find(emp => String(emp.CUIT).replace(/[^0-9]/g, '') === cuitClean);
    if (!employerRecord) {
        if (dbConsorcio) {
            employerRecord = {
                "CUIT": dbConsorcio.cuit,
                "RAZON SOCIAL": dbConsorcio.name,
                "CATEGORIA EDIFICIO": dbConsorcio.category || "1° Cat.",
                "COCHERA": dbConsorcio.cochera || "NO",
                "JARDIN": dbConsorcio.jardin || "NO",
                "PILETA": dbConsorcio.pileta || "NO",
                "MOVIMIENTO DE COCHES": dbConsorcio.movimientoCoches || "NO",
                "ZONA DESFAVORABLE": dbConsorcio.zonaDesfavorable || "NO",
                "UF": dbConsorcio.units?.length || 0,
                "% VARIABLE": dbConsorcio.artRate !== undefined ? dbConsorcio.artRate : 0.03,
                "$ SEGURO VIDA FIJO": dbConsorcio.scvoFijo !== undefined ? dbConsorcio.scvoFijo : 424.62
            };
            employers.push(employerRecord);
        } else {
            throw new Error(`Employer with CUIT ${cuitClean} not found in master sheet or database.`);
        }
    }

    // 1. Get database employees for this CUIT
    const db = dbManager.loadDb();
    const dbEmployees = (db.employees || []).filter(emp => 
        String(emp.cuitEmployer || emp.CUIT_EMPLEADOR || emp['CUIT EMPLEADOR'] || '').replace(/[^0-9]/g, '') === cuitClean
    );

    // 2. Map existing excel employees and merge DB updates
    const filteredEmployees = [];
    const processedCuils = new Set();

    employees.forEach(emp => {
        const empCuit = String(emp.CUIT || emp.CUIT_EMPLEADOR || emp['CUIT EMPLEADOR'] || '').replace(/[^0-9]/g, '');
        if (empCuit === cuitClean) {
            const cuilStr = String(emp.CUIL || '').replace(/[^0-9]/g, '');
            if (cuilStr) {
                processedCuils.add(cuilStr);
                const dbEmp = dbEmployees.find(de => String(de.cuil).replace(/[^0-9]/g, '') === cuilStr);
                if (dbEmp) {
                    emp['APELLIDO Y NOMBRE'] = dbEmp.employeeName || emp['APELLIDO Y NOMBRE'];
                    emp['FECHA DE INGRESO'] = dbEmp.hireDate || emp['FECHA DE INGRESO'];
                    emp.FUNCION = dbEmp.function || emp.FUNCION;
                    emp.CBU = dbEmp.cbu || emp.CBU;
                    emp['BANCO DEPOSITO'] = dbEmp.bank || emp['BANCO DEPOSITO'];
                    emp.plusJardin = dbEmp.plusJardin;
                    emp.plusPileta = dbEmp.plusPileta;
                    emp.plusCochera = dbEmp.plusCochera;
                    emp.plusMovimientoCoches = dbEmp.plusMovimientoCoches;
                }
                filteredEmployees.push(emp);
            }
        }
    });

    // 3. Add database-only employees
    dbEmployees.forEach(dbEmp => {
        const cuilStr = String(dbEmp.cuil).replace(/[^0-9]/g, '');
        if (cuilStr && !processedCuils.has(cuilStr)) {
            const funcLower = String(dbEmp.function || '').toLowerCase();
            const isMedia = funcLower.includes('media') || funcLower.includes('jornada');
            const hasVivienda = funcLower.includes('con vivienda');
            
            const newEmp = {
                CUIL: cuilStr,
                'APELLIDO Y NOMBRE': dbEmp.employeeName,
                'FECHA DE INGRESO': dbEmp.hireDate || '',
                CUIT: cuitClean,
                'CUIT EMPLEADOR': cuitClean,
                FUNCION: dbEmp.function || 'Encargado Permanente',
                'CATEGORIA EDIFICIO ': dbConsorcio ? dbConsorcio.category : '1° Cat.',
                'BANCO DEPOSITO': dbEmp.bank || '',
                CBU: dbEmp.cbu || '',
                LEGAJO: 99,
                JORNADA: isMedia ? 'Media' : 'Completa',
                Vivienda: hasVivienda ? 'SI' : 'NO',
                'Adicional remuneratorio': 0,
                Antiguedad: 0,
                Viaticos: 'NO',
                'Retiro de Residuos': 'NO',
                'Clasificacion de residuos': 'NO',
                plusJardin: dbEmp.plusJardin,
                plusPileta: dbEmp.plusPileta,
                plusCochera: dbEmp.plusCochera,
                plusMovimientoCoches: dbEmp.plusMovimientoCoches
            };
            filteredEmployees.push(newEmp);
            processedCuils.add(cuilStr);
        }
    });

    const excelDateToPeriod = (serial) => {
        if (typeof serial !== 'number') return String(serial || '');
        const excelEpoch = new Date(1899, 11, 30);
        const date = new Date(excelEpoch.getTime() + serial * 24 * 60 * 60 * 1000);
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        return `${y}-${m}`;
    };

    const novedades = rawNovedades.map(nov => {
        return {
            ...nov,
            PERIODO: excelDateToPeriod(nov.PERIODO)
        };
    });

    // Read scales (with fallback)
    let scales;
    try {
        scales = JSON.parse(fs.readFileSync(path.join(__dirname, `scales_${cleanPeriod}.json`)));
    } catch (e) {
        scales = JSON.parse(fs.readFileSync(path.join(__dirname, "scales_2026-05.json")));
    }

    const payrollResults = calculatePayroll(filteredEmployees, employers, novedades, scales, periodArg);
    const lsdFiles = exportToAFIPLSD(payrollResults, filteredEmployees, employers, cleanPeriod);

    // Map results with HTML payslips
    const resultsWithHtml = payrollResults.map(p => {
        return {
            ...p,
            payslipHtml: generatePayslipHTML(p)
        };
    });

    // Match and parse building monthly expenses file
    const expensasFilePath = findExpensesFile(cuitClean, cleanPeriod);
    let expensesResult = null;

    if (expensasFilePath) {
        const rawExpenses = calculateExpensesFromFile(expensasFilePath, cleanPeriod, payrollResults);
        const resCuentaWithHtml = rawExpenses.resCuenta.map(u => {
            return {
                ...u,
                receiptHtml: generateExpensesReceiptHTML(rawExpenses, u.uf)
            };
        });
        const printAllHtml = generateAllExpensesReceiptsHTML(rawExpenses);

        expensesResult = {
            ...rawExpenses,
            resCuenta: resCuentaWithHtml,
            printAllHtml,
            fileFound: true
        };
    } else {
        expensesResult = {
            fileFound: false,
            consorcio: {
                name: employerRecord['RAZON SOCIAL'] || employerRecord['Razon Social'] || '',
                cuit: cuitClean,
                bankInfo: {}
            },
            period: cleanPeriod,
            resCuenta: [],
            gastos: [],
            provisions: [],
            categorizedItems: {
                '1': [], '2': [], '3': [], '4': [], '5': [], '6': [], '7': [], '8': [], '9': [], '10': []
            },
            previsionesItems: [],
            totalPagosAyB: 0,
            totalGastosParticulares: 0,
            totalPrevisiones: 0,
            totalProrrateoAyB: 0,
            resCuentaTotals: {
                saldoAnterior: 0,
                suPago: 0,
                expensasA: 0,
                expensasB: 0,
                sAsamblea: 0,
                otros: 0,
                gastPart: 0,
                totalMes: 0,
                deuda: 0,
                intereses: 0,
                totalDue: 0
            },
            caja: {
                saldoAnterior: 0,
                cobranzas: 0,
                pagosAyB: 0,
                pagosPart: 0,
                saldoCierre: 0
            },
            bankReconciliation: []
        };
    }

    const scalesPathUsed = fs.existsSync(path.join(__dirname, `scales_${cleanPeriod}.json`)) 
        ? `scales_${cleanPeriod}.json` 
        : "scales_2026-05.json (Fallback)";

    const filesUsed = [
        { name: "Planilla de Sueldos Master", path: "Liquidacion-sueldos-modelo.xls.xlsm", type: "Excel Master" },
        { name: `Escala Salarial SUTERH (${cleanPeriod})`, path: scalesPathUsed, type: "JSON Scales" }
    ];

    if (expensasFilePath) {
        filesUsed.push({ name: `Planilla Expensas del Consorcio (${cleanPeriod})`, path: path.basename(expensasFilePath), type: "Excel Expensas" });
    } else {
        filesUsed.push({ name: `Planilla Expensas (No encontrada, usando datos base)`, path: "-", type: "N/A" });
    }

    return {
        payroll: {
            results: resultsWithHtml,
            lsdFiles
        },
        expenses: expensesResult,
        documentation: {
            scales,
            filesUsed
        }
    };
}

// Local CLI Execution Mode
function runLocal(periodArg, cuitArg) {
    console.log(`[Local Run] Running local calculation for CUIT: ${cuitArg || 'default'} and period: ${periodArg}...`);
    try {
        const data = calculateLocalData(periodArg, cuitArg);

        // Save AFIP LSD files
        for (const [cuit, fileContent] of Object.entries(data.payroll.lsdFiles)) {
            const outPath = path.join(__dirname, `afip_lsd_${cuit}.txt`);
            fs.writeFileSync(outPath, fileContent, { encoding: 'latin1' }); // AFIP requires ANSI
            console.log(`Saved AFIP LSD file: ${outPath}`);
        }

        // Save employee payslips HTML
        data.payroll.results.forEach(p => {
            const outPath = path.join(__dirname, `recibo_${p.employeeName.replace(/\s+/g, '_')}.html`);
            fs.writeFileSync(outPath, p.payslipHtml);
            console.log(`Saved Payslip HTML: ${outPath}`);
        });

        // Save owner receipt (UF 16 Pelayo as test, or fallback to first unit)
        let testUf = 16;
        let uRecord = data.expenses.resCuenta.find(r => r.uf === testUf);
        if (!uRecord && data.expenses.resCuenta.length > 0) {
            uRecord = data.expenses.resCuenta[0];
            testUf = uRecord.uf;
        }
        if (uRecord) {
            const outPath = path.join(__dirname, `expensas_UF_${testUf}.html`);
            fs.writeFileSync(outPath, uRecord.receiptHtml);
            console.log(`Saved Expenses Receipt HTML (UF ${testUf}): ${outPath}`);
        }

        console.log("[Local Run] Completed successfully.");
    } catch (e) {
        console.error("Local run failed:", e);
    }
}

// Entry Point Routing
const args = process.argv.slice(2);
const isLocal = args.includes('--local');
let targetPeriod = "2026-06"; // Default period
let targetCuit = "";

const periodIdx = args.indexOf('--period');
if (periodIdx !== -1 && args[periodIdx + 1]) {
    targetPeriod = args[periodIdx + 1];
}

const cuitIdx = args.indexOf('--cuit');
if (cuitIdx !== -1 && args[cuitIdx + 1]) {
    targetCuit = args[cuitIdx + 1];
}

if (isLocal) {
    runLocal(targetPeriod, targetCuit);
} else {
    server.listen(PORT, () => {
        console.log(`[Server] Antigravity Automa API running on port ${PORT}`);
        console.log(`[Endpoints] GET  / (Dashboard)`);
        console.log(`[Endpoints] GET  /api/process-local?period=YYYY-MM`);
        console.log(`[Endpoints] POST /api/payroll`);
        console.log(`[Endpoints] POST /api/expenses`);
        console.log(`[Endpoints] GET  /api/status`);
    });
}

// Google Sheets Sync Helper Functions
const https = require('https');

function fetchURL(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            if (res.statusCode < 200 || res.statusCode >= 300) {
                return reject(new Error(`HTTP Error ${res.statusCode} loading sheet`));
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

function parseNum(val, isPercentage = false) {
    if (!val || typeof val !== 'string') {
        if (typeof val === 'number') return val;
        return 0;
    }
    const isPct = val.includes('%') || isPercentage;
    const clean = val.replace(/[^0-9.-]/g, '');
    const num = Number(clean);
    if (isNaN(num)) return 0;
    return isPct ? num / 100 : num;
}

function parseCSV(csvText) {
    const lines = [];
    let row = [""];
    let inQuotes = false;

    for (let i = 0; i < csvText.length; i++) {
        const c = csvText[i];
        const next = csvText[i+1];

        if (c === '"') {
            if (inQuotes && next === '"') {
                row[row.length - 1] += '"';
                i++; // Skip next quote
            } else {
                inQuotes = !inQuotes;
            }
        } else if (c === ',' && !inQuotes) {
            row.push('');
        } else if ((c === '\r' || c === '\n') && !inQuotes) {
            if (c === '\r' && next === '\n') i++; // Skip \n
            if (row.length > 1 || row[0] !== '') {
                lines.push(row);
            }
            row = [''];
        } else {
            row[row.length - 1] += c;
        }
    }
    if (row.length > 1 || row[0] !== '') {
        lines.push(row);
    }
    
    if (lines.length === 0) return [];
    
    const headers = lines[0].map(h => h.trim());
    const data = [];
    for (let i = 1; i < lines.length; i++) {
        const values = lines[i];
        const obj = {};
        headers.forEach((h, index) => {
            let val = values[index] !== undefined ? values[index].trim() : "";
            obj[h] = val;
        });
        data.push(obj);
    }
    return data;
}

function importSheetsData(body) {
    const { employers, employees, novedades, gastos, unidadesFuncionales } = body;
    const db = dbManager.loadDb();

    // 1. Map Employers (Consorcios)
    const newConsorcios = employers.map(emp => {
        const cuitClean = String(emp["CUIT"] || "").replace(/[^0-9]/g, '');
        if (!cuitClean) return null;
        
        // Find existing consorcio to preserve fields not in sheet
        const existing = db.consorcios.find(c => String(c.cuit).replace(/[^0-9]/g, '') === cuitClean) || {};
        
        // Find units for this CUIT
        const ufsForCuit = unidadesFuncionales.filter(u => String(u["CUIT"] || "").replace(/[^0-9]/g, '') === cuitClean);
        const units = ufsForCuit.map(u => ({
            uf: Number(u["UF"] || 0),
            depto: String(u["DTO"] || ""),
            nombre: String(u["NOMBRE"] || ""),
            coefA: parseNum(u["PORCENTAJE_A"]),
            coefB: parseNum(u["PORCENTAJE_B"])
        })).sort((a, b) => a.uf - b.uf);

        return {
            cuit: cuitClean,
            name: String(emp["RAZON SOCIAL"] || "").trim().toUpperCase(),
            suterhKey: String(emp["N° CTA SUTERH"] || "").trim(),
            bankInfo: {
                bankName: String(emp["BANCO"] || "").trim().toUpperCase(),
                accountNumber: existing.bankInfo?.accountNumber || "",
                cbu: existing.bankInfo?.cbu || "",
                alias: existing.bankInfo?.alias || "",
                email: existing.bankInfo?.email || ""
            },
            interestRate: parseNum(emp["% INTERESES"] || existing.interestRate || 0.03),
            dueDay: parseNum(emp["DIA VENCIMIENTO"] || existing.dueDay || 10),
            divisorA: parseNum(emp["DIVISOR A"] || existing.divisorA || 100),
            divisorB: parseNum(emp["DIVISOR B"] || existing.divisorB || 100),
            category: String(emp["CATEGORIA EDIFICIO"] || "1° Cat.").trim(),
            cochera: String(emp["COCHERA"] || "NO").toUpperCase().trim(),
            jardin: String(emp["JARDIN"] || "NO").toUpperCase().trim(),
            pileta: String(emp["PILETA"] || "NO").toUpperCase().trim(),
            movimientoCoches: String(emp["MOVIMIENTO DE COCHES"] || "NO").toUpperCase().trim(),
            zonaDesfavorable: String(emp["ZONA DESFAVORABLE"] || "NO").toUpperCase().trim(),
            caldera: String(emp["CALDERA"] || existing.caldera || "NO").toUpperCase().trim(),
            artRate: parseNum(emp["% VARIABLE"] || 0.03),
            scvoFijo: parseNum(emp["$ SEGURO VIDA FIJO"] || 424.62),
            units: units,
            recurringExpenses: existing.recurringExpenses || []
        };
    }).filter(c => c !== null);

    db.consorcios = newConsorcios;

    // 2. Map Employees
    const newEmployees = employees.map(emp => {
        const cuilClean = String(emp["CUIL"] || "").replace(/[^0-9]/g, '');
        const cuitClean = String(emp["CUIT"] || "").replace(/[^0-9]/g, '');
        if (!cuilClean || !cuitClean) return null;
        
        const existing = db.employees.find(e => String(e.cuil).replace(/[^0-9]/g, '') === cuilClean) || {};
        
        let cat = '1';
        const catStr = String(emp['CATEGORIA EDIFICIO'] || '').trim();
        if (catStr.includes('1')) cat = '1';
        else if (catStr.includes('2')) cat = '2';
        else if (catStr.includes('3')) cat = '3';
        else if (catStr.includes('4')) cat = '4';

        return {
            cuil: cuilClean,
            employeeName: String(emp["APELLIDO Y NOMBRE"] || "").trim().toUpperCase(),
            cuitEmployer: cuitClean,
            hireDate: String(emp["FECHA DE INGRESO"] || "").trim(),
            category: cat,
            function: String(emp["FUNCION"] || "").trim(),
            bank: String(emp["BANCO DEPOSITO"] || "").trim().toUpperCase(),
            cbu: String(emp["CBU"] || "").trim(),
            plusJardin: String(emp["Retiro de Residuos"] || "NO").toUpperCase().trim() === "SI",
            plusPileta: existing.plusPileta !== undefined ? existing.plusPileta : false,
            plusCochera: existing.plusCochera !== undefined ? existing.plusCochera : false,
            plusMovimientoCoches: existing.plusMovimientoCoches !== undefined ? existing.plusMovimientoCoches : false
        };
    }).filter(e => e !== null);

    db.employees = newEmployees;

    // 3. Map Periods (group novedades, gastos, and units by period and CUIT)
    const periodsSet = new Set();
    novedades.forEach(n => { if (n["PERIODO"]) periodsSet.add(n["PERIODO"]); });
    gastos.forEach(g => { if (g["PERIODO"]) periodsSet.add(g["PERIODO"]); });

    // Clear old periods and reconstruct them from sheet data
    db.periods = {};

    periodsSet.forEach(period => {
        newConsorcios.forEach(consorcio => {
            const cuit = consorcio.cuit;
            const periodKey = `${cuit}_${period}`;
            
            // Filter novedades for this building and period
            const periodNovedades = novedades
                .filter(n => String(n["CUIT"] || "").replace(/[^0-9]/g, '') === cuit && n["PERIODO"] === period)
                .map(n => ({
                    cuil: String(n["CUIL"] || "").replace(/[^0-9]/g, ''),
                    diasTrabajados: Number(n["DIAS TRABAJADO SUPLENTE"] !== undefined && n["DIAS TRABAJADO SUPLENTE"] !== "" ? n["DIAS TRABAJADO SUPLENTE"] : 30),
                    horasTotales: Number(n["HORAS TOTALES"] || 0),
                    horasJornada: Number(n["Horas JORNADA [HS]"] || 0),
                    horasExtras50: Number(n["HORAS EXTRAS al 50% [HS]"] || 0),
                    horasExtras100: Number(n["HORAS EXTRAS al 100% [HS]"] || 0),
                    feriados: Number(n["FERIADOS TRABAJADOS [HS]"] || 0),
                    vacacionesDias: Number(n["PLUS VACACIONES [DIAS]"] || 0),
                    adicionalVoluntario: parseNum(n["Adicional voluntario"]),
                    embargo: parseNum(n["Embargo"]),
                    diasNoTrabajados: Number(n["Días no trabajados"] || 0),
                    licenciaEnfermedad: Number(n["Licencia por enfermedad"] || 0),
                    suplencia100: Number(n["Suplencia al 100% [hs]"] || 0),
                    anticipo: parseNum(n["Anticipo"])
                }));

            // Filter gastos for this building and period
            const periodGastos = gastos
                .filter(g => String(g["CUIT"] || "").replace(/[^0-9]/g, '') === cuit && g["PERIODO"] === period)
                .map(g => {
                    const type = String(g["GRUPO_GASTO"] || "A").trim().replace("GASTO ", "").toUpperCase();
                    return {
                        category: String(g["GRUPO_GASTO"] || "10").trim().includes("PARTICULAR") ? "PARTICULAR" : "10",
                        description: String(g["CONCEPTO"] || "").trim(),
                        amount: parseNum(g["IMPORTE"]),
                        type: type === 'PARTICULAR' ? 'Particular' : type,
                        uf: g["UF_PARTICULAR"] ? Number(g["UF_PARTICULAR"]) : null,
                        comprobante: String(g["COMPROBANTE"] || "").trim()
                    };
                });

            // Construct resCuenta from units with their payments/saldoAnterior
            const ufsForCuit = unidadesFuncionales.filter(u => String(u["CUIT"] || "").replace(/[^0-9]/g, '') === cuit);
            
            const resCuenta = consorcio.units.map(unit => {
                const sheetUf = ufsForCuit.find(su => Number(su["UF"]) === unit.uf) || {};
                const saldoAnterior = parseNum(sheetUf["SALDO_ANTERIOR"]);
                const suPago = parseNum(sheetUf["SU_PAGO"]);
                
                return {
                    uf: unit.uf,
                    depto: unit.depto,
                    nombre: unit.nombre,
                    coefA: unit.coefA,
                    coefB: unit.coefB,
                    saldoAnterior: saldoAnterior,
                    suPago: suPago,
                    expensasA: 0,
                    expensasB: 0,
                    sAsamblea: 0,
                    otros: 0,
                    gastPart: 0,
                    totalMes: 0,
                    deuda: saldoAnterior,
                    intereses: 0,
                    totalDue: saldoAnterior
                };
            });

            // Map payments map
            const paymentsMap = {};
            resCuenta.forEach(r => {
                paymentsMap[String(r.uf)] = r.suPago;
            });

            db.periods[periodKey] = {
                fileFound: true,
                consorcio: consorcio,
                period: period,
                resCuenta: resCuenta,
                gastos: periodGastos,
                provisions: [],
                novedades: periodNovedades,
                payments: paymentsMap,
                categorizedItems: {
                    '1': [], '2': [], '3': [], '4': [], '5': [], '6': [], '7': [], '8': [], '9': [], '10': []
                },
                previsionesItems: [],
                totalPagosAyB: 0,
                totalGastosParticulares: 0,
                totalPrevisiones: 0,
                totalProrrateoAyB: 0,
                resCuentaTotals: {
                    saldoAnterior: resCuenta.reduce((sum, r) => sum + r.saldoAnterior, 0),
                    suPago: resCuenta.reduce((sum, r) => sum + r.suPago, 0),
                    expensasA: 0,
                    expensasB: 0,
                    sAsamblea: 0,
                    otros: 0,
                    gastPart: 0,
                    totalMes: 0,
                    deuda: resCuenta.reduce((sum, r) => sum + r.deuda, 0),
                    intereses: 0,
                    totalDue: resCuenta.reduce((sum, r) => sum + r.totalDue, 0)
                },
                caja: {
                    saldoAnterior: 0,
                    cobranzas: resCuenta.reduce((sum, r) => sum + Math.abs(r.suPago), 0),
                    pagosAyB: 0,
                    pagosPart: 0,
                    saldoCierre: 0
                },
                bankReconciliation: []
            };
        });
    });

    dbManager.saveDb(db);
    return { consorciosCount: newConsorcios.length, employeesCount: newEmployees.length };
}

