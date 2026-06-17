const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'payroll_engine.js');
const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n');
lines.forEach((line, idx) => {
    if (line.includes('antigüedad') || line.includes('antiguedad') || line.includes('1300') || line.includes('seniority')) {
        console.log(`${idx + 1}: ${line.trim()}`);
    }
});
