const dbManager = require('../db_manager');
const receiptParser = require('../receipt_parser');

const db = dbManager.loadDb();
console.log("Checking database consorcios count:", db.consorcios.length);
const uruguay = db.consorcios.find(c => c.cuit === '30580260906');
console.log("Uruguay 1025 units with email count:", uruguay.units.filter(u => u.email).length);
console.log("Uruguay 1025 units with email details:", uruguay.units.filter(u => u.email).map(u => ({ uf: u.uf, email: u.email })));

const emailSender = "vecino_uruguay@example.com";
const cleanSender = emailSender.trim().toLowerCase().replace(/[^a-z0-9@.]/g, '');
console.log("cleanSender:", cleanSender);

for (const c of db.consorcios) {
    const senderMatch = (c.units || []).find(u => {
        const uEmail = u.email ? u.email.trim().toLowerCase() : '';
        const uPhone = u.phone ? u.phone.trim().toLowerCase().replace(/[^a-z0-9@.]/g, '') : '';
        const emailMatches = uEmail === cleanSender;
        if (emailMatches) {
            console.log(`Matched! Consorcio CUIT: ${c.cuit}, UF: ${u.uf}, Email: ${uEmail}`);
        }
        return emailMatches;
    });
}

const res = receiptParser.matchPaymentToUF(emailSender, "Transferencia Expensas UF LOC 1 - Junio", "body text", { amount: 150000 });
console.log("Result of matchPaymentToUF:", res);
