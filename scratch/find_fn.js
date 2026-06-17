const fs = require('fs');
const content = fs.readFileSync('expenses_engine.js', 'utf8');
const lines = content.split('\n');
lines.forEach((line, idx) => {
    if (line.includes('function calculateExpenses')) {
        console.log(`Line ${idx + 1}: ${line}`);
    }
});
