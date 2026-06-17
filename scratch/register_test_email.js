const fs = require('fs');

const db = JSON.parse(fs.readFileSync('db.json', 'utf8'));
const c = db.consorcios.find(x => String(x.cuit).replace(/[^0-9]/g, '') === '30580260906');
if (c) {
    const u = c.units.find(x => x.uf === 'LOC 1');
    if (u) {
        u.email = 'vecino_uruguay@example.com';
        fs.writeFileSync('db.json', JSON.stringify(db, null, 2), 'utf8');
        console.log("Successfully registered email 'vecino_uruguay@example.com' to Uruguay 1025 UF LOC 1.");
    } else {
        console.log("UF LOC 1 not found!");
    }
} else {
    console.log("Uruguay 1025 not found!");
}
