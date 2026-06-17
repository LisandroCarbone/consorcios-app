const fs = require('fs');

const db = JSON.parse(fs.readFileSync('db.json', 'utf8'));

// Remove test consorcio
db.consorcios = db.consorcios.filter(c => c.cuit !== '30999999999');

// Remove test employee
db.employees = db.employees.filter(e => e.cuil !== '20999999999' && e.CUIL !== '20999999999');

// Remove test periods
delete db.periods['30999999999_2026-06'];
delete db.periods['30580260906_2026-06'];

// Clear pending payments queue
db.pendingPayments = [];

fs.writeFileSync('db.json', JSON.stringify(db, null, 2), 'utf8');
console.log("Successfully cleaned up test data from db.json.");
