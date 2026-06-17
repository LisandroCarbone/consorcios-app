const fs = require('fs');
const db = JSON.parse(fs.readFileSync('db.json', 'utf8'));
console.log("Consorcios count:", db.consorcios.length);
console.log("Employees count:", db.employees.length);
console.log("Periods keys:", Object.keys(db.periods));
