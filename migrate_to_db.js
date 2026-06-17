const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const { parseExpensesWorkbook, calculateExpensesFromFile } = require('./expenses_engine');

const SUELDOS_PATH = path.join(__dirname, "Liquidacion-sueldos-modelo.xls.xlsm");
const DB_PATH = path.join(__dirname, 'db.json');

const CUIT_MAPPING = {
    "30519077635": { name: "Santiago del Estero", keywords: ["sgo", "santiago", "estero", "sant"] },
    "30532673484": { name: "Lima 461", keywords: ["lima"] },
    "30536354154": { name: "San Jose 369", keywords: ["san jose", "jose"] },
    "30537480544": { name: "Belgrano 1266", keywords: ["belgrano"] },
    "30538590009": { name: "Rodriguez Peña", keywords: ["rodriguez", "pena", "peña", "rod"] },
    "30540887752": { name: "Arenales 2120", keywords: ["arenales"] },
    "30559333022": { name: "Palos 285", keywords: ["palos"] },
    "30580260906": { name: "Uruguay 1025", keywords: ["uruguay"] },
    "30604528166": { name: "Alte Brown 720", keywords: ["brown"] },
    "30630042670": { name: "Arenales 1648", keywords: ["arenales", "1648"] },
    "30661488618": { name: "Montes de Oca", keywords: ["montes", "oca", "m oca"] },
    "30707887628": { name: "Hipolito Yrigoyen", keywords: ["yrigoyen", "hipolito"] },
    "30711283338": { name: "Salta 555", keywords: ["salta"] },
    "30711553165": { name: "Azcuenaga 1570", keywords: ["azcuenaga"] },
    "30711776903": { name: "Sanchez de Bustamante", keywords: ["bustamante", "bustamente"] }
};

function findExpensesFileForPeriod(cuit, periodStr) {
    const cuitClean = String(cuit).replace(/[^0-9]/g, '');
    const [year, month] = periodStr.split('-');
    const periodShort = `${month}${year.substring(2)}`;
    const periodLong = `${month}${year}`;

    const dirFiles = fs.readdirSync(__dirname);
    const mapping = CUIT_MAPPING[cuitClean];
    if (!mapping) return null;

    let bestFile = null;
    let bestScore = 0;

    for (const file of dirFiles) {
        const fileLower = file.toLowerCase();
        if (!fileLower.endsWith('.xls') && !fileLower.endsWith('.xlsx')) continue;
        if (fileLower.startsWith('liquidacion-') || fileLower.startsWith('~$')) continue;

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
    
    if (cuitClean === "30540887752") {
        return path.join(__dirname, "Liquidacion-expensas-modelo.xls");
    }
    
    return null;
}

function runMigration() {
    console.log("=== STARTING EXCEL TO JSON DATABASE MIGRATION ===");
    
    if (!fs.existsSync(SUELDOS_PATH)) {
        console.error(`❌ Master file ${SUELDOS_PATH} not found.`);
        process.exit(1);
    }

    const wbSueldos = XLSX.readFile(SUELDOS_PATH);
    
    // 1. Parse Employers
    const rawEmployers = XLSX.utils.sheet_to_json(wbSueldos.Sheets["Empleador"]);
    console.log(`Parsed ${rawEmployers.length} employers.`);

    // 2. Parse Employees
    const rawEmployees = XLSX.utils.sheet_to_json(wbSueldos.Sheets["Empleados"]);
    console.log(`Parsed ${rawEmployees.length} employees.`);

    // 3. Parse Novedades
    const rawNovedades = XLSX.utils.sheet_to_json(wbSueldos.Sheets["Novedades"]);
    
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
    console.log(`Parsed ${novedades.length} payroll variable logs.`);

    const db = {
        consorcios: [],
        employees: [],
        periods: {}
    };

    // Populate Employees
    const excelSerialToDateString = (serial) => {
        if (typeof serial !== 'number' || isNaN(serial)) return String(serial || '');
        const excelEpoch = new Date(1899, 11, 30);
        const date = new Date(excelEpoch.getTime() + serial * 24 * 60 * 60 * 1000);
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    };

    rawEmployees.forEach(emp => {
        const hireDateVal = emp['FECHA DE INGRESO'] || emp['FECHA INGRESO'] || emp.hireDate || '';
        const hireDateStr = (typeof hireDateVal === 'number') ? excelSerialToDateString(hireDateVal) : String(hireDateVal).trim();
        
        let cat = '1';
        const catStr = String(emp['CATEGORIA EDIFICIO '] || emp.CATEGORIA || '').trim();
        if (catStr.includes('1')) cat = '1';
        else if (catStr.includes('2')) cat = '2';
        else if (catStr.includes('3')) cat = '3';
        else if (catStr.includes('4')) cat = '4';

        db.employees.push({
            cuil: String(emp.CUIL || '').trim(),
            employeeName: String(emp['APELLIDO Y NOMBRE'] || emp.NOMBRE || '').trim(),
            cuitEmployer: String(emp.CUIT || emp.CUIT_EMPLEADOR || emp['CUIT EMPLEADOR'] || '').replace(/[^0-9]/g, ''),
            hireDate: hireDateStr,
            category: cat,
            function: String(emp.FUNCION || emp.PUESTO || '').trim(),
            bank: String(emp['BANCO DEPOSITO'] || emp.BANCO || '').trim(),
            cbu: String(emp.CBU || '').trim()
        });
    });

    // Populate Consorcios and Period Data (May 2026)
    rawEmployers.forEach(emp => {
        const cuit = String(emp.CUIT).replace(/[^0-9]/g, '');
        const name = emp['RAZON SOCIAL'] || emp['Razon Social'];
        console.log(`Migrating CUIT ${cuit} | ${name}...`);

        const expFilePath = findExpensesFileForPeriod(cuit, "2026-05");
        let parsedExpenses = null;
        let units = [];
        
        if (expFilePath) {
            console.log(`  Found May 2026 sheet: ${path.basename(expFilePath)}`);
            try {
                parsedExpenses = calculateExpensesFromFile(expFilePath, "2026-05");
                const workbookData = parseExpensesWorkbook(expFilePath);
                units = workbookData.units;
                
                // Add consorcio details
                db.consorcios.push({
                    cuit: cuit,
                    name: parsedExpenses.consorcio.name,
                    suterhKey: parsedExpenses.consorcio.suterhKey,
                    bankInfo: parsedExpenses.consorcio.bankInfo,
                    interestRate: parsedExpenses.consorcio.interestRate,
                    dueDay: parsedExpenses.consorcio.dueDay,
                    divisorA: parsedExpenses.consorcio.divisorA || 100,
                    divisorB: parsedExpenses.consorcio.divisorB || 100,
                    units: units
                });

                // Populate May 2026 period details
                const periodKey = `${cuit}_2026-05`;
                
                // Filter novedades for this building and period
                const buildingNovedades = novedades
                    .filter(nov => String(nov.CUIT || nov.CUIT_EMPLEADOR || '').replace(/[^0-9]/g, '') === cuit && nov.PERIODO === '2026-05')
                    .map(nov => ({
                        cuil: String(nov.CUIL || '').trim(),
                        diasTrabajados: nov.DIAS || 30,
                        horasExtras50: nov['HS. 50%'] || 0,
                        horasExtras100: nov['HS. 100%'] || 0,
                        feriados: nov.FERIADOS || 0,
                        anticipo: nov.ANTICIPO || 0
                    }));

                // Map payments into a key-value object of UF -> suPago
                const paymentsMap = {};
                parsedExpenses.resCuenta.forEach(u => {
                    paymentsMap[String(u.uf)] = u.suPago;
                });

                db.periods[periodKey] = {
                    fileFound: true,
                    consorcio: db.consorcios[db.consorcios.length - 1],
                    period: "2026-05",
                    resCuenta: parsedExpenses.resCuenta,
                    gastos: parsedExpenses.gastos,
                    provisions: parsedExpenses.provisions,
                    categorizedItems: parsedExpenses.categorizedItems,
                    previsionesItems: parsedExpenses.previsionesItems,
                    totalPagosAyB: parsedExpenses.totalPagosAyB,
                    totalGastosParticulares: parsedExpenses.totalGastosParticulares,
                    totalPrevisiones: parsedExpenses.totalPrevisiones,
                    totalProrrateoAyB: parsedExpenses.totalProrrateoAyB,
                    resCuentaTotals: parsedExpenses.resCuentaTotals,
                    caja: parsedExpenses.caja,
                    bankReconciliation: parsedExpenses.bankReconciliation,
                    novedades: buildingNovedades,
                    payments: paymentsMap
                };
            } catch (err) {
                console.error(`  ❌ Error parsing spreadsheet: ${err.message}`);
            }
        } else {
            console.log(`  ⚠️ May 2026 sheet not found. Creating default entries.`);
            db.consorcios.push({
                cuit: cuit,
                name: name,
                suterhKey: emp.SUTERH_KEY || '',
                bankInfo: {
                    bankName: '',
                    accountNumber: '',
                    cbu: '',
                    alias: '',
                    email: ''
                },
                interestRate: 0.03,
                dueDay: 10,
                divisorA: 100,
                divisorB: 100,
                units: []
            });
        }
    });

    // Save database
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
    console.log(`\n✅ MIGRATION COMPLETED SUCCESSFULY! Database written to ${DB_PATH}`);
}

runMigration();
