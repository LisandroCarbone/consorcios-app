const { calculatePayroll } = require('../payroll_engine');
const fs = require('fs');
const path = require('path');

// Mock data
const mockEmployees = [
    {
        CUIL: "20111111111",
        "APELLIDO Y NOMBRE": "FULL SEMESTER EMPLOYEE",
        "FECHA DE INGRESO": "2024-01-01", // Hired prior to semester
        CUIT: "30519077635",
        "CUIT EMPLEADOR": "30519077635",
        FUNCION: "Encargado Permanente con vivienda",
        "CATEGORIA EDIFICIO ": "1° Cat.",
        "BANCO DEPOSITO": "GALICIA",
        CBU: "0070000000000000000001",
        JORNADA: "Completa",
        Vivienda: "SI",
        Antiguedad: 2
    },
    {
        CUIL: "20222222222",
        "APELLIDO Y NOMBRE": "MID SEMESTER EMPLOYEE",
        "FECHA DE INGRESO": "2026-05-01", // Hired May 1st (61 active days in Jan-Jun semester)
        CUIT: "30519077635",
        "CUIT EMPLEADOR": "30519077635",
        FUNCION: "Encargado Permanente con vivienda",
        "CATEGORIA EDIFICIO ": "1° Cat.",
        "BANCO DEPOSITO": "GALICIA",
        CBU: "0070000000000000000002",
        JORNADA: "Completa",
        Vivienda: "SI",
        Antiguedad: 0
    }
];

const mockEmployers = [
    {
        CUIT: "30519077635",
        "RAZON SOCIAL": "TEST CONDOMINIUM",
        "CATEGORIA EDIFICIO": "1° Cat.",
        "COCHERA": "NO",
        "JARDIN": "NO",
        "PILETA": "NO",
        "MOVIMIENTO DE COCHES": "NO",
        "ZONA DESFAVORABLE": "NO",
        "UF": 10,
        "% VARIABLE": 0.03,
        "$ SEGURO VIDA FIJO": 424.62
    }
];

const mockNovedades = [
    {
        CUIL: "20111111111",
        CUIT: "30519077635",
        PERIODO: "2026-06",
        "DIAS TRABAJADO SUPLENTE": 30
    },
    {
        CUIL: "20222222222",
        CUIT: "30519077635",
        PERIODO: "2026-06",
        "DIAS TRABAJADO SUPLENTE": 30
    }
];

// Load scales
const scalesPath = path.join(__dirname, '..', 'scales_2026-05.json');
const scales = JSON.parse(fs.readFileSync(scalesPath, 'utf8'));

// Run payroll calculation
console.log("Running June 2026 payroll simulation with SAC...");
const results = calculatePayroll(mockEmployees, mockEmployers, mockNovedades, scales, "2026-06");

console.log(`Results count: ${results.length}\n`);

results.forEach(res => {
    const sacConcept = res.concepts.find(c => c.code === "2200");
    console.log(`Employee: ${res.employeeName}`);
    console.log(` - Hire Date: ${res.hireDate || mockEmployees.find(e => e.CUIL === res.cuil)["FECHA DE INGRESO"]}`);
    console.log(` - Total Remunerativo: $${res.totalRemunerativo}`);
    if (sacConcept) {
        console.log(` - SAC (Aguinaldo) Concept Amount: $${sacConcept.amount}`);
        console.log(` - SAC (Aguinaldo) Concept Unit: "${sacConcept.unidad}"`);
    } else {
        console.log(` - No SAC concept found!`);
    }
    console.log("");
});
