const http = require('http');
const fs = require('fs');
const path = require('path');

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

async function runNotificationsTest() {
    console.log("=== STARTING NOTIFICATIONS SYSTEM TEST ===");

    const cuit = "30580260906"; // Uruguay 1025
    const period = "2026-06";

    // 1. Clear previous logs
    const emailLogDir = path.join(__dirname, '..', 'scratch', 'email_logs');
    const waLogDir = path.join(__dirname, '..', 'scratch', 'whatsapp_logs');
    
    if (fs.existsSync(emailLogDir)) {
        fs.readdirSync(emailLogDir).forEach(file => fs.unlinkSync(path.join(emailLogDir, file)));
    }
    if (fs.existsSync(waLogDir)) {
        fs.readdirSync(waLogDir).forEach(file => fs.unlinkSync(path.join(waLogDir, file)));
    }

    console.log("\n1. Triggering building-wide notifications...");
    const res = await request('POST', '/api/db/period/send-notifications', { cuit, period });
    console.log("Send Status:", res.success ? "SUCCESS" : "FAILED");
    console.log("Notified units count:", res.sentCount);

    // 2. Verify files created
    console.log("\n2. Verifying log files in scratch directory...");
    const emailFiles = fs.existsSync(emailLogDir) ? fs.readdirSync(emailLogDir) : [];
    const waFiles = fs.existsSync(waLogDir) ? fs.readdirSync(waLogDir) : [];
    
    console.log("Generated Email Log Files:", emailFiles.length);
    console.log("Generated WhatsApp Log Files:", waFiles.length);
    
    if (emailFiles.length > 0) {
        const sampleEmail = JSON.parse(fs.readFileSync(path.join(emailLogDir, emailFiles[0]), 'utf8'));
        console.log("\nSample Email Log Content:", {
            to: sampleEmail.to,
            subject: sampleEmail.subject,
            bodySnippet: sampleEmail.body.substring(0, 150) + "..."
        });
    }
    
    if (waFiles.length > 0) {
        const sampleWa = JSON.parse(fs.readFileSync(path.join(waLogDir, waFiles[0]), 'utf8'));
        console.log("\nSample WhatsApp Log Content:", {
            to: sampleWa.to,
            messageSnippet: sampleWa.message.substring(0, 150) + "..."
        });
    }

    console.log("\n=== NOTIFICATIONS SYSTEM TEST COMPLETE ===");
}

runNotificationsTest().catch(console.error);
