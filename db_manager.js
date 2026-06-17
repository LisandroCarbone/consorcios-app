const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'db.json');

function loadDb() {
    if (!fs.existsSync(DB_PATH)) {
        return {
            consorcios: [],
            employees: [],
            periods: {},
            pendingPayments: []
        };
    }
    try {
        const raw = fs.readFileSync(DB_PATH, 'utf8');
        const db = JSON.parse(raw);
        if (!db.pendingPayments) db.pendingPayments = [];
        return db;
    } catch (e) {
        console.error("[DB Manager] Failed to parse db.json, returning empty structure", e);
        return {
            consorcios: [],
            employees: [],
            periods: {},
            pendingPayments: []
        };
    }
}

function saveDb(data) {
    try {
        fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (e) {
        console.error("[DB Manager] Failed to write db.json", e);
        return false;
    }
}

function getConsorcios() {
    const db = loadDb();
    return db.consorcios.map(c => ({
        cuit: c.cuit,
        name: c.name,
        suterhKey: c.suterhKey
    }));
}

function getConsorcio(cuit) {
    const db = loadDb();
    const cuitClean = String(cuit).replace(/[^0-9]/g, '');
    return db.consorcios.find(c => String(c.cuit).replace(/[^0-9]/g, '') === cuitClean) || null;
}

function getEmployees(cuit) {
    const db = loadDb();
    const cuitClean = String(cuit).replace(/[^0-9]/g, '');
    return db.employees.filter(emp => String(emp.cuitEmployer || emp.CUIT_EMPLEADOR || emp['CUIT EMPLEADOR'] || '').replace(/[^0-9]/g, '') === cuitClean);
}

function getPeriodData(cuit, period) {
    const db = loadDb();
    const cuitClean = String(cuit).replace(/[^0-9]/g, '');
    const key = `${cuitClean}_${period}`;
    
    if (db.periods[key]) {
        return {
            ...db.periods[key],
            fileFound: true
        };
    }
    
    // Return empty placeholder structure
    return {
        fileFound: false,
        consorcio: getConsorcio(cuitClean) || { name: '', cuit: cuitClean, bankInfo: {} },
        period: period,
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

function savePeriodData(cuit, period, periodData) {
    const db = loadDb();
    const cuitClean = String(cuit).replace(/[^0-9]/g, '');
    const key = `${cuitClean}_${period}`;
    
    db.periods[key] = {
        ...periodData,
        fileFound: true
    };
    
    return saveDb(db);
}

function initiatePeriod(cuit, period, prevPeriod) {
    const db = loadDb();
    const cuitClean = String(cuit).replace(/[^0-9]/g, '');
    const key = `${cuitClean}_${period}`;
    const prevKey = `${cuitClean}_${prevPeriod}`;
    
    const consorcio = db.consorcios.find(c => String(c.cuit).replace(/[^0-9]/g, '') === cuitClean);
    if (!consorcio) {
        throw new Error(`Consorcio CUIT ${cuitClean} not found in database.`);
    }
    
    const prevData = db.periods[prevKey];
    
    // Rollover units resCuenta list
    const resCuenta = [];
    let sumSaldoAnterior = 0;
    
    consorcio.units.forEach(u => {
        let saldoAnterior = 0;
        
        if (prevData && prevData.resCuenta) {
            const prevUnit = prevData.resCuenta.find(pu => String(pu.uf).trim().toUpperCase() === String(u.uf).trim().toUpperCase());
            if (prevUnit) {
                // Carry forward outstanding totalDue from previous month
                saldoAnterior = Math.round((prevUnit.totalDue + Number.EPSILON) * 100) / 100;
            }
        }
        
        sumSaldoAnterior += saldoAnterior;
        
        resCuenta.push({
            uf: u.uf,
            depto: u.depto,
            nombre: u.nombre,
            coefA: u.coefA,
            coefB: u.coefB,
            saldoAnterior: saldoAnterior,
            suPago: 0,
            expensasA: 0,
            expensasB: 0,
            sAsamblea: 0,
            otros: 0,
            gastPart: 0,
            totalMes: 0,
            deuda: saldoAnterior,
            intereses: 0,
            totalDue: saldoAnterior
        });
    });
    
    let prevCierre = 0;
    if (prevData && prevData.caja) {
        prevCierre = prevData.caja.saldoCierre || 0;
    }
    
    // Find active employees to pre-populate default novedades
    const activeEmployees = db.employees.filter(emp => 
        String(emp.cuitEmployer || emp.CUIT_EMPLEADOR || emp['CUIT EMPLEADOR'] || '').replace(/[^0-9]/g, '') === cuitClean
    );
    const defaultNovedades = activeEmployees.map(emp => ({
        cuil: emp.cuil,
        diasTrabajados: 30,
        horasExtras50: 0,
        horasExtras100: 0,
        feriados: 0,
        anticipo: 0
    }));
    
    // Process recurring expenses
    const periodGastos = [];
    const recurringExpenses = consorcio.recurringExpenses || [];
    recurringExpenses.forEach(exp => {
        if (exp.isInstallment) {
            const current = Number(exp.currentInstallment || 1);
            const total = Number(exp.totalInstallments || 1);
            if (current <= total) {
                periodGastos.push({
                    category: String(exp.category || '10'),
                    description: `${exp.description} (Cuota ${current} de ${total})`,
                    amount: Number(exp.amount || 0),
                    type: exp.type || 'A'
                });
                exp.currentInstallment = current + 1; // Increment for next month
            }
        } else {
            periodGastos.push({
                category: String(exp.category || '10'),
                description: exp.description,
                amount: Number(exp.amount || 0),
                type: exp.type || 'A'
            });
        }
    });

    // Create new blank period record
    db.periods[key] = {
        fileFound: true,
        consorcio: consorcio,
        period: period,
        resCuenta: resCuenta,
        gastos: periodGastos,
        provisions: [],
        novedades: defaultNovedades,
        categorizedItems: {
            '1': [], '2': [], '3': [], '4': [], '5': [], '6': [], '7': [], '8': [], '9': [], '10': []
        },
        previsionesItems: [],
        totalPagosAyB: 0,
        totalGastosParticulares: 0,
        totalPrevisiones: 0,
        totalProrrateoAyB: 0,
        resCuentaTotals: {
            saldoAnterior: Math.round((sumSaldoAnterior + Number.EPSILON) * 100) / 100,
            suPago: 0,
            expensasA: 0,
            expensasB: 0,
            sAsamblea: 0,
            otros: 0,
            gastPart: 0,
            totalMes: 0,
            deuda: Math.round((sumSaldoAnterior + Number.EPSILON) * 100) / 100,
            intereses: 0,
            totalDue: Math.round((sumSaldoAnterior + Number.EPSILON) * 100) / 100
        },
        caja: {
            saldoAnterior: prevCierre,
            cobranzas: 0,
            pagosAyB: 0,
            pagosPart: 0,
            saldoCierre: prevCierre
        },
        bankReconciliation: [
            { label: "SALDO INICIAL", value: prevCierre },
            { label: "(+) COBRANZA EXPENSAS", value: 0 },
            { label: "(-) PAGOS DEL PERIODO GASTOS A Y B", value: 0 },
            { label: "(-) PAGOS GASTOS PARTICULARES", value: 0 },
            { label: "SALDO AL CIERRE SEGUN CAJA", value: prevCierre }
        ]
    };
    
    saveDb(db);
    return db.periods[key];
}

function saveConsorcio(cuit, consorcioData) {
    const db = loadDb();
    const cuitClean = String(cuit).replace(/[^0-9]/g, '');
    let existingIdx = db.consorcios.findIndex(c => String(c.cuit).replace(/[^0-9]/g, '') === cuitClean);
    
    const formattedConsorcio = {
        cuit: cuitClean,
        name: consorcioData.name,
        suterhKey: consorcioData.suterhKey,
        bankInfo: consorcioData.bankInfo || {},
        interestRate: Number(consorcioData.interestRate !== undefined ? consorcioData.interestRate : 0.03),
        dueDay: Number(consorcioData.dueDay !== undefined ? consorcioData.dueDay : 10),
        divisorA: Number(consorcioData.divisorA !== undefined ? consorcioData.divisorA : 100),
        divisorB: Number(consorcioData.divisorB !== undefined ? consorcioData.divisorB : 100),
        category: consorcioData.category || "1° Cat.",
        cochera: consorcioData.cochera || "NO",
        jardin: consorcioData.jardin || "NO",
        pileta: consorcioData.pileta || "NO",
        movimientoCoches: consorcioData.movimientoCoches || "NO",
        zonaDesfavorable: consorcioData.zonaDesfavorable || "NO",
        caldera: consorcioData.caldera || "NO",
        artRate: Number(consorcioData.artRate !== undefined ? consorcioData.artRate : 0.03),
        scvoFijo: Number(consorcioData.scvoFijo !== undefined ? consorcioData.scvoFijo : 424.62),
        units: consorcioData.units || [],
        recurringExpenses: consorcioData.recurringExpenses || []
    };

    if (existingIdx !== -1) {
        db.consorcios[existingIdx] = formattedConsorcio;
    } else {
        db.consorcios.push(formattedConsorcio);
    }

    // Propagate updated name, depto, and coefficients to all existing periods for this CUIT
    if (db.periods) {
        Object.keys(db.periods).forEach(periodKey => {
            if (periodKey.startsWith(cuitClean + "_")) {
                const periodData = db.periods[periodKey];
                if (periodData && periodData.resCuenta) {
                    periodData.resCuenta.forEach(r => {
                        const matchedUnit = formattedConsorcio.units.find(u => Number(u.uf) === Number(r.uf));
                        if (matchedUnit) {
                            r.nombre = matchedUnit.nombre;
                            r.depto = matchedUnit.depto;
                            r.coefA = matchedUnit.coefA;
                            r.coefB = matchedUnit.coefB;
                        }
                    });
                }
            }
        });
    }

    return saveDb(db);
}

function deleteConsorcio(cuit) {
    const db = loadDb();
    const cuitClean = String(cuit).replace(/[^0-9]/g, '');
    db.consorcios = db.consorcios.filter(c => String(c.cuit).replace(/[^0-9]/g, '') !== cuitClean);
    return saveDb(db);
}

function saveEmployee(cuil, employeeData) {
    const db = loadDb();
    const cuilClean = String(cuil).replace(/[^0-9]/g, '');
    let existingIdx = db.employees.findIndex(e => String(e.cuil).replace(/[^0-9]/g, '') === cuilClean);
    
    const formattedEmployee = {
        cuil: cuilClean,
        employeeName: employeeData.employeeName,
        cuitEmployer: String(employeeData.cuitEmployer || '').replace(/[^0-9]/g, ''),
        hireDate: employeeData.hireDate,
        category: employeeData.category || '1',
        function: employeeData.function || 'Encargado Permanente',
        bank: employeeData.bank || '',
        cbu: employeeData.cbu || '',
        plusJardin: !!employeeData.plusJardin,
        plusPileta: !!employeeData.plusPileta,
        plusCochera: !!employeeData.plusCochera,
        plusMovimientoCoches: !!employeeData.plusMovimientoCoches
    };
    if (existingIdx !== -1) {
        db.employees[existingIdx] = {
            ...db.employees[existingIdx],
            ...formattedEmployee
        };
    } else {
        db.employees.push(formattedEmployee);
    }
    return saveDb(db);
}

function deleteEmployee(cuil) {
    const db = loadDb();
    const cuilClean = String(cuil).replace(/[^0-9]/g, '');
    db.employees = db.employees.filter(e => String(e.cuil).replace(/[^0-9]/g, '') !== cuilClean);
    return saveDb(db);
}

function getPendingPayments(cuit) {
    const db = loadDb();
    const cuitClean = String(cuit).replace(/[^0-9]/g, '');
    return (db.pendingPayments || []).filter(p => String(p.matched?.cuitConsorcio || '').replace(/[^0-9]/g, '') === cuitClean);
}

function addPendingPayment(payment) {
    const db = loadDb();
    if (!db.pendingPayments) db.pendingPayments = [];
    db.pendingPayments.push(payment);
    saveDb(db);
    return payment;
}

function resolvePendingPayment(id, status) {
    const db = loadDb();
    if (!db.pendingPayments) db.pendingPayments = [];
    const payment = db.pendingPayments.find(p => String(p.id) === String(id));
    if (payment) {
        payment.status = status;
        saveDb(db);
        return true;
    }
    return false;
}

module.exports = {
    loadDb,
    saveDb,
    getConsorcios,
    getConsorcio,
    getEmployees,
    getPeriodData,
    savePeriodData,
    initiatePeriod,
    saveConsorcio,
    deleteConsorcio,
    saveEmployee,
    deleteEmployee,
    getPendingPayments,
    addPendingPayment,
    resolvePendingPayment
};
