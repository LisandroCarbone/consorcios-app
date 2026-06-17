const db = require('../db_manager');
const rawDb = db.loadDb();
console.log('Employees count:', rawDb.employees.length);
if (rawDb.employees.length > 0) {
    console.log('Sample Employee:', JSON.stringify(rawDb.employees[0], null, 2));
} else {
    console.log('No employees found in db.json.');
}
