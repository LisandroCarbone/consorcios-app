const fs = require('fs');
const path = require('path');
const { parseExpensesWorkbook } = require('../expenses_engine');

const DB_PATH = path.join(__dirname, '..', 'db.json');
const EXCEL_PATH = path.join(__dirname, '..', 'SAN JOSE 0526.xls');

if (!fs.existsSync(DB_PATH) || !fs.existsSync(EXCEL_PATH)) {
    console.error("Required files not found!");
    process.exit(1);
}

const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
const sjConsorcio = db.consorcios.find(c => String(c.cuit).replace(/[^0-9]/g, '') === '30536354154');

if (!sjConsorcio) {
    console.error("San Jose 369 consorcio not found in db.json!");
    process.exit(1);
}

const excelData = parseExpensesWorkbook(EXCEL_PATH);
const excelUnits = excelData.units;

console.log(`Units count in Excel: ${excelUnits.length}`);
console.log(`Units count in DB currently: ${sjConsorcio.units.length}`);

let restoredCount = 0;
excelUnits.forEach(exU => {
    const exists = sjConsorcio.units.some(dbU => String(dbU.uf).trim().toUpperCase() === String(exU.uf).trim().toUpperCase());
    if (!exists) {
        console.log(`Restoring missing unit: ${exU.uf} | ${exU.nombre}`);
        sjConsorcio.units.push(exU);
        restoredCount++;
    }
});

if (restoredCount > 0) {
    // Sort units if needed (e.g. by index or name)
    // Save database
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
    console.log(`Successfully restored ${restoredCount} missing units to db.json.`);
} else {
    console.log("No units were missing from db.json. All units are already present on disk!");
}
