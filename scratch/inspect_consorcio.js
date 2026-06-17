const fs = require('fs');
const db = JSON.parse(fs.readFileSync('db.json', 'utf8'));
const c = db.consorcios.find(x => String(x.cuit).replace(/[^0-9]/g, '') === '30580260906');
console.log(JSON.stringify(c, null, 2));
