const http = require('http');

function request(method, path, body = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 5000,
            path: path,
            method: method,
            headers: {
                'Content-Type': 'application/json'
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    resolve({ statusCode: res.statusCode, body: data });
                }
            });
        });

        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function runTest() {
    console.log("=== STARTING END-TO-END VERIFICATION ===");

    const cuit = "30580260906"; // Uruguay 1025
    const period = "2026-06";
    const prevPeriod = "2026-05";

    // 1. Initiate period
    console.log(`\n1. Initiating period ${period} for CUIT ${cuit} from ${prevPeriod}...`);
    const initRes = await request('POST', '/api/db/period/initiate', { cuit, period, prevPeriod });
    console.log("Initiation status:", initRes.success ? "SUCCESS" : "FAILED", initRes.error || "");

    // 2. Fetch current data
    console.log(`\n2. Fetching initial data for ${period}...`);
    const data1 = await request('GET', `/api/process-local?period=${period}&cuit=${cuit}`);
    console.log("Initial resCuenta units:", data1.expenses.resCuenta.length);
    console.log("Initial net salaries count:", data1.payroll.results.length);
    console.log("Initial total expenses:", data1.expenses.totalPagosAyB);
    console.log("Caja Cierre:", data1.expenses.caja.saldoCierre);

    // Let's inspect outstanding debts rolled over from May
    const carriedOver = data1.expenses.resCuenta.map(u => ({ uf: u.uf, depto: u.depto, nombre: u.nombre, saldoAnterior: u.saldoAnterior }));
    console.log("Rolled over debts (saldoAnterior) for first 3 units:", carriedOver.slice(0, 3));

    // 3. Save novedades
    console.log("\n3. Saving employee novedades...");
    const employeesList = data1.payroll.results;
    if (employeesList.length > 0) {
        const emp = employeesList[0];
        const novedades = [
            {
                cuil: emp.cuil,
                diasTrabajados: 30,
                horasExtras50: 10,
                horasExtras100: 5,
                feriados: 2,
                anticipo: 20000
            }
        ];
        const saveNovRes = await request('POST', '/api/db/period/save', { cuit, period, novedades });
        console.log("Save novedades status:", saveNovRes.success ? "SUCCESS" : "FAILED");
        if (saveNovRes.success) {
            const updatedEmp = saveNovRes.data.payroll.results.find(e => e.cuil === emp.cuil);
            console.log(`Updated Net Salary for ${emp.employeeName}:`, updatedEmp.netSalary);
        }
    }

    // 4. Save gastos (Elevator repair $15,000, Cleaning supplies $8,000)
    console.log("\n4. Adding building expenses...");
    const gastos = [
        { category: "3", description: "Mantenimiento Ascensores", amount: 15000, type: "A" },
        { category: "7", description: "Compra de Lavandina y Detergente", amount: 8000, type: "A" }
    ];
    const saveGastosRes = await request('POST', '/api/db/period/save', { cuit, period, gastos });
    console.log("Save gastos status:", saveGastosRes.success ? "SUCCESS" : "FAILED");
    if (saveGastosRes.success) {
        console.log("Updated total expensas A:", saveGastosRes.data.expenses.totalProrrateoAyB);
        console.log("Updated Caja Cierre:", saveGastosRes.data.expenses.caja.saldoCierre);
    }

    // 5. Save resident payments (Su Pago)
    console.log("\n5. Saving owner payments (Su Pago)...");
    const payments = {};
    if (data1.expenses.resCuenta.length > 0) {
        // Let first unit pay $10,000
        const firstUf = data1.expenses.resCuenta[0].uf;
        payments[firstUf] = 10000;
        const savePayRes = await request('POST', '/api/db/period/save', { cuit, period, payments });
        console.log("Save payments status:", savePayRes.success ? "SUCCESS" : "FAILED");
        if (savePayRes.success) {
            const updatedUnit = savePayRes.data.expenses.resCuenta.find(u => u.uf === firstUf);
            console.log(`Unit UF ${firstUf} details:`, {
                saldoAnterior: updatedUnit.saldoAnterior,
                suPago: updatedUnit.suPago,
                deuda: updatedUnit.deuda,
                intereses: updatedUnit.intereses,
                totalDue: updatedUnit.totalDue
            });
            console.log("Updated Caja Cobranzas:", savePayRes.data.expenses.caja.cobranzas);
            console.log("Updated Caja Cierre:", savePayRes.data.expenses.caja.saldoCierre);
        }
    }

    // 6. Test manual document generation and HTML preview formatting
    console.log("\n6. Checking HTML print preview generation...");
    const finalData = await request('GET', `/api/process-local?period=${period}&cuit=${cuit}`);
    const receiptHtmlSample = finalData.expenses.resCuenta[0].receiptHtml;
    console.log("Receipt HTML preview snippet:", receiptHtmlSample ? receiptHtmlSample.substring(0, 150) + "..." : "NONE");
    console.log("Print All HTML preview snippet:", finalData.expenses.printAllHtml ? finalData.expenses.printAllHtml.substring(0, 150) + "..." : "NONE");

    console.log("\n=== E2E VERIFICATION COMPLETED ===");
}

runTest().catch(console.error);
