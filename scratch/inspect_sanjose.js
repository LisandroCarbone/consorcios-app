const XLSX = require('xlsx');
const wb = XLSX.readFile('SAN JOSE 0526.xls');
const sheet = wb.Sheets['RES CUENTA'];
const data = XLSX.utils.sheet_to_json(sheet);
console.log("Total rows in RES CUENTA:", data.length);
data.forEach((row, i) => {
    console.log(`Row ${i}:`, row);
});
