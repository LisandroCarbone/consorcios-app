const fs = require('fs');
const content = fs.readFileSync('pdf_generator.js', 'utf8');
const lines = content.split('\n');
lines.forEach((line, idx) => {
    if (line.includes('consorcio') || line.includes('bankInfo')) {
        console.log(`pdf_generator.js:${idx + 1}: ${line.trim()}`);
    }
});
