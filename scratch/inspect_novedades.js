const db = require('../db_manager');
const rawDb = db.loadDb();
console.log('Period Keys:', Object.keys(rawDb.periods));
for (const [key, val] of Object.entries(rawDb.periods)) {
    if (val.novedades && val.novedades.length > 0) {
        console.log(`Found novedades in key: ${key}`);
        console.log(JSON.stringify(val.novedades[0], null, 2));
        break;
    }
}
