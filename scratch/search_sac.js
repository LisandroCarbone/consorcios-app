const fs = require('fs');
const content = fs.readFileSync('payroll_engine.js', 'utf8');
const lines = content.split('\n');
lines.forEach((line, idx) => {
    if (line.toLowerCase().includes('sac') || line.toLowerCase().includes('aguinaldo')) {
        console.log(`payroll_engine.js:${idx + 1}: ${line.trim()}`);
    }
});
