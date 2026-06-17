const http = require('http');

function request(method, path, body = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 5000,
            path: path,
            method: method,
            headers: {
                'Content-Type': 'application/json'
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    resolve({ statusCode: res.statusCode, body: data });
                }
            });
        });

        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function runIngestionTest() {
    console.log("=== STARTING EMAIL INGESTION & MATCHING TEST ===");

    const cuit = "30580260906"; // Uruguay 1025
    const period = "2026-06";

    // 1. Ingest simulated payment email
    console.log("\n1. Simulating incoming email payment...");
    const emailPayload = {
        sender: "vecino_uruguay@example.com",
        subject: "Transferencia Expensas UF LOC 1 - Junio",
        body: "Hola Kari, te adjunto el comprobante de transferencia por un monto de $150.320,50 para la expensa de este mes. Gracias!",
        attachmentName: "comprobante_galicia_150320.pdf"
    };
    
    const ingestRes = await request('POST', '/api/db/payments/ingest-email', emailPayload);
    console.log("Ingestion Status:", ingestRes.success ? "SUCCESS" : "FAILED");
    console.log("Ingested Payment details:", {
        id: ingestRes.payment?.id,
        extractedAmount: ingestRes.payment?.extracted?.amount,
        extractedDate: ingestRes.payment?.extracted?.date,
        matchedCuit: ingestRes.payment?.matched?.cuitConsorcio,
        matchedUf: ingestRes.payment?.matched?.uf,
        confidence: ingestRes.payment?.matched?.confidence,
        reason: ingestRes.payment?.matched?.reason
    });

    // 2. Fetch pending payments queue
    console.log("\n2. Fetching pending payments queue for CUIT...");
    const pendingList = await request('GET', `/api/db/payments/pending?cuit=${cuit}`);
    console.log("Pending payments count:", pendingList.length);
    const targetPayment = pendingList.find(p => p.id === ingestRes.payment?.id);
    console.log("Found our payment in queue:", targetPayment ? "YES" : "NO");

    // 3. Approve the payment
    if (targetPayment) {
        console.log(`\n3. Approving pending payment ID ${targetPayment.id}...`);
        const approveRes = await request('POST', '/api/db/payments/approve', {
            id: targetPayment.id,
            period: period,
            cuit: cuit,
            uf: targetPayment.matched.uf,
            amount: targetPayment.extracted.amount
        });
        console.log("Approval Status:", approveRes.success ? "SUCCESS" : "FAILED");

        // 4. Verify payment applied to unit
        if (approveRes.success) {
            console.log("\n4. Verifying payment applied to unit LOC 1...");
            const unit = approveRes.data.expenses.resCuenta.find(u => u.uf === targetPayment.matched.uf);
            console.log(`Unit UF ${targetPayment.matched.uf} payment details:`, {
                nombre: unit.nombre,
                suPago: unit.suPago,
                deuda: unit.deuda,
                totalDue: unit.totalDue
            });
            console.log("New Caja Cobranzas:", approveRes.data.expenses.caja.cobranzas);
            console.log("New Caja Cierre:", approveRes.data.expenses.caja.saldoCierre);
        }
    }

    console.log("\n=== INGESTION & MATCHING TEST COMPLETE ===");
}

runIngestionTest().catch(console.error);
