const fs = require('fs');

const db = JSON.parse(fs.readFileSync('db.json', 'utf8'));
console.log("Initial periods in DB:");
Object.keys(db.periods).forEach(k => console.log(" - " + k));

let deletedCount = 0;
Object.keys(db.periods).forEach(key => {
    if (key.endsWith('_2026-04') || key.endsWith('_2026-06') || key.endsWith('_2026-04-SAC') || key.endsWith('_2026-06-SAC')) {
        delete db.periods[key];
        deletedCount++;
    }
});

fs.writeFileSync('db.json', JSON.stringify(db, null, 2), 'utf8');
console.log(`\nDeleted ${deletedCount} period records. Remaining periods in DB:`);
Object.keys(db.periods).forEach(k => console.log(" - " + k));
