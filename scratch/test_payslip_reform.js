const http = require('http');
const fs = require('fs');
const path = require('path');

function fetchPayroll() {
    console.log("Fetching payroll from API for CUIT 30604528166 and period 2026-06...");
    const url = 'http://localhost:5000/api/process-local?period=2026-06&cuit=30604528166';
    
    http.get(url, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
            try {
                const data = JSON.parse(body);
                if (data.payroll && data.payroll.results && data.payroll.results.length > 0) {
                    const firstEmp = data.payroll.results[0];
                    console.log(`Successfully fetched payroll for employee: ${firstEmp.employeeName}`);
                    
                    const outputPath = path.join(__dirname, 'test_payslip.html');
                    fs.writeFileSync(outputPath, firstEmp.payslipHtml, 'utf8');
                    console.log(`Payslip HTML saved to: ${outputPath}`);
                } else {
                    console.error("No payroll results found in response:", data);
                }
            } catch (e) {
                console.error("Failed to parse JSON response:", e);
                console.log("Raw response:", body);
            }
        });
    }).on('error', (err) => {
        console.error("HTTP request error:", err);
    });
}

fetchPayroll();
