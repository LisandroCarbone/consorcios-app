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

async function runNewBuildingTest() {
    console.log("=== STARTING NEW BUILDING ONBOARDING TEST ===");

    const cuit = "30999999999";
    const cuil = "20999999999";
    const period = "2026-06";
    const prevPeriod = "2026-05";

    // 1. Save new consorcio
    console.log("\n1. Saving new consorcio Arenales 9999...");
    const consorcioRes = await request('POST', '/api/db/consorcios/save', {
        cuit: cuit,
        consorcioData: {
            name: "ARENALES 9999",
            suterhKey: "9999",
            interestRate: 0.04,
            dueDay: 15,
            bankInfo: {
                bankName: "GALICIA",
                titular: "CONSORCIO ARENALES 9999",
                accountNumber: "CC 999-99999-9",
                cbu: "0070000000000000999999",
                alias: "ARENALES.NUEVO"
            },
            category: "2° Cat.",
            cochera: "SI",
            jardin: "SI",
            pileta: "SI",
            movimientoCoches: "SI",
            zonaDesfavorable: "SI",
            artRate: 0.025,
            scvoFijo: 424.62,
            units: [
                { uf: "1", depto: "1A", nombre: "Propietario 1A", coefA: 40.0, coefB: 0, email: "prop1a@example.com", phone: "+5491100000001" },
                { uf: "2", depto: "1B", nombre: "Propietario 1B", coefA: 60.0, coefB: 0, email: "prop1b@example.com", phone: "+5491100000002" }
            ]
        }
    });
    console.log("Save consorcio status:", consorcioRes.success ? "SUCCESS" : "FAILED");

    // 2. Save new employee
    console.log("\n2. Registering new employee for CUIT 30999999999...");
    const employeeRes = await request('POST', '/api/db/employees/save', {
        cuil: cuil,
        employeeData: {
            employeeName: "JUAN ENCARGADO",
            cuitEmployer: cuit,
            hireDate: "2020-01-15",
            category: "2",
            function: "Encargado Permanente sin vivienda",
            bank: "GALICIA",
            cbu: "0070000000000000001111"
        }
    });
    console.log("Save employee status:", employeeRes.success ? "SUCCESS" : "FAILED");

    // 3. Initiate period
    console.log(`\n3. Initiating period ${period} for CUIT ${cuit} from ${prevPeriod}...`);
    const initRes = await request('POST', '/api/db/period/initiate', { cuit, period, prevPeriod });
    console.log("Initiation status:", initRes.success ? "SUCCESS" : "FAILED");

    // 4. Run calculation
    console.log(`\n4. Processing calculations for CUIT ${cuit} and period ${period}...`);
    const calcRes = await request('GET', `/api/process-local?period=${period}&cuit=${cuit}`);
    
    if (calcRes.payroll && calcRes.payroll.results.length > 0) {
        console.log("SUCCESS: Processed payroll and expenses!");
        const empResult = calcRes.payroll.results[0];
        console.log(`\nPayroll details for ${empResult.employeeName}:`, {
            baseSalary: empResult.totalRemunerativo,
            netSalary: empResult.netSalary,
            seniorityYears: empResult.seniority,
            conceptsCount: empResult.concepts?.length
        });
        
        console.log("\nActive building pluses added to salary:");
        empResult.concepts.forEach(c => {
            if (c.type === "C" && c.code !== "1000" && c.code !== "1750") {
                console.log(` - ${c.name}: $${c.amount}`);
            }
        });

        console.log("\nEmployer contributions details:", {
            totalContributions: empResult.totalContributions,
            totalLaborCost: empResult.totalLaborCost
        });
        
        console.log("\nExpenses results:", {
            totalUnits: calcRes.expenses.resCuenta.length,
            totalProrrateo: calcRes.expenses.totalProrrateoAyB,
            cajaCierre: calcRes.expenses.caja.saldoCierre
        });
    } else {
        console.log("FAILED to process or empty results:", calcRes);
    }

    console.log("\n=== NEW BUILDING ONBOARDING TEST COMPLETE ===");
}

runNewBuildingTest().catch(console.error);
