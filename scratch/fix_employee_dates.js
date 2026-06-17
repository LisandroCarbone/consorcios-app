const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const DB_PATH = path.join(__dirname, '..', 'db.json');
const SUELDOS_PATH = path.join(__dirname, '..', 'Liquidacion-sueldos-modelo.xls.xlsm');

if (!fs.existsSync(DB_PATH) || !fs.existsSync(SUELDOS_PATH)) {
    console.error("Files not found!");
    process.exit(1);
}

const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
const wb = XLSX.readFile(SUELDOS_PATH);
const excelEmployees = XLSX.utils.sheet_to_json(wb.Sheets['Empleados']);

const excelSerialToDateString = (serial) => {
    if (typeof serial !== 'number' || isNaN(serial)) return String(serial || '');
    const excelEpoch = new Date(1899, 11, 30);
    const date = new Date(excelEpoch.getTime() + serial * 24 * 60 * 60 * 1000);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
};

let count = 0;
db.employees.forEach(emp => {
    const cuilClean = String(emp.cuil).replace(/[^0-9]/g, '');
    const excelEmp = excelEmployees.find(e => String(e.CUIL).replace(/[^0-9]/g, '') === cuilClean);
    if (excelEmp) {
        const hireDate = excelSerialToDateString(excelEmp['FECHA DE INGRESO']);
        emp.hireDate = hireDate;
        emp['FECHA DE INGRESO'] = hireDate;
        
        // Also fix basic function/bank/cbu details
        emp.bank = String(excelEmp['BANCO DEPOSITO'] || emp.bank || '').trim();
        emp.cbu = String(excelEmp['CBU'] || emp.cbu || '').trim();
        
        // Try to parse category number (e.g. from '3° Cat.' or keep original)
        let cat = '1';
        const catStr = String(excelEmp['CATEGORIA EDIFICIO '] || '').trim();
        if (catStr.includes('1')) cat = '1';
        else if (catStr.includes('2')) cat = '2';
        else if (catStr.includes('3')) cat = '3';
        else if (catStr.includes('4')) cat = '4';
        emp.category = cat;
        
        count++;
    }
});

fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
console.log(`Updated ${count} employees in db.json with correct hire dates and metadata.`);
