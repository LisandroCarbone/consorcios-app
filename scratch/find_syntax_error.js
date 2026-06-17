const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'pdf_generator.js');
const content = fs.readFileSync(filePath, 'utf8');

let braces = 0;
const lines = content.split('\n');
lines.forEach((line, idx) => {
    for (let char of line) {
        if (char === '{') braces++;
        if (char === '}') {
            braces--;
            if (braces < 0) {
                console.log(`ERROR: Extra closing brace at line ${idx + 1}: ${line.trim()}`);
                braces = 0; // reset
            }
        }
    }
});
console.log(`Final braces balance: ${braces}`);
