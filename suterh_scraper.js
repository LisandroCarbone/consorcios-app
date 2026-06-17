const https = require('https');
const fs = require('fs');
const path = require('path');

// Helper to fetch html via https
function fetchHtml(url) {
    return new Promise((resolve, reject) => {
        https.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        }, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                // Handle redirect
                fetchHtml(res.headers.location).then(resolve).catch(reject);
                return;
            }
            if (res.statusCode !== 200) {
                reject(new Error(`Failed to load page: status code ${res.statusCode}`));
                return;
            }
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => resolve(data));
        }).on('error', (err) => reject(err));
    });
}

// Convert month name in Spanish to English index or similar, or just map standard Spanish months
const MONTHS_ES = {
    'enero': '01', 'febrero': '02', 'marzo': '03', 'abril': '04', 'mayo': '05', 'junio': '06',
    'julio': '07', 'agosto': '08', 'septiembre': '09', 'octubre': '10', 'noviembre': '11', 'diciembre': '12'
};

// Map period (e.g. "2026-05") to SUTERH URL format: "planilla-salarial-mayo-2026"
function getUrlForPeriod(periodStr) {
    const [year, month] = periodStr.split('-');
    const monthName = Object.keys(MONTHS_ES).find(key => MONTHS_ES[key] === month);
    if (!monthName) {
        throw new Error(`Periodo inválido: ${periodStr}. Debe ser AAAA-MM.`);
    }
    return `https://suterh.org.ar/planilla-salarial-${monthName}-${year}/`;
}

// Parse HTML tables into arrays of rows and cells
function parseTables(html) {
    const tables = [];
    const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
    let tableMatch;

    while ((tableMatch = tableRegex.exec(html)) !== null) {
        const tableContent = tableMatch[1];
        const rows = [];
        const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
        let trMatch;

        while ((trMatch = trRegex.exec(tableContent)) !== null) {
            const rowContent = trMatch[1];
            const cells = [];
            // Match td or th
            const tdRegex = /<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi;
            let tdMatch;

            while ((tdMatch = tdRegex.exec(rowContent)) !== null) {
                // Strip HTML tags and clean whitespace
                let cellText = tdMatch[1]
                    .replace(/<[^>]+>/g, ' ')
                    .replace(/&nbsp;/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();
                cells.push(cellText);
            }
            if (cells.length > 0) {
                rows.push(cells);
            }
        }
        if (rows.length > 0) {
            tables.push(rows);
        }
    }
    return tables;
}

// Clean and convert string to number
function cleanNumber(str) {
    if (!str) return 0;
    // Remove dots (thousands separators) and replace comma with dot (decimal separator)
    let clean = str.replace(/\./g, '').replace(/,/g, '.').trim();
    // Remove any non-numeric chars except digits and dot
    clean = clean.replace(/[^\d.]/g, '');
    const num = parseFloat(clean);
    return isNaN(num) ? 0 : num;
}

// Extract base salaries table
function processBaseSalaries(table) {
    const scales = {};
    if (!table || table.length < 2) return scales;
    
    // Find headers (usually 1° Cat, 2° Cat, etc.)
    const headers = table[0].map(h => h.toLowerCase());
    const cat1Idx = headers.findIndex(h => h.includes('1'));
    const cat2Idx = headers.findIndex(h => h.includes('2'));
    const cat3Idx = headers.findIndex(h => h.includes('3'));
    const cat4Idx = headers.findIndex(h => h.includes('4'));

    for (let i = 1; i < table.length; i++) {
        const row = table[i];
        if (row.length < 2) continue;
        const functionName = row[0];
        
        scales[functionName] = {
            '1° Cat.': cat1Idx !== -1 && row[cat1Idx] ? cleanNumber(row[cat1Idx]) : 0,
            '2° Cat.': cat2Idx !== -1 && row[cat2Idx] ? cleanNumber(row[cat2Idx]) : 0,
            '3° Cat.': cat3Idx !== -1 && row[cat3Idx] ? cleanNumber(row[cat3Idx]) : 0,
            '4° Cat.': cat4Idx !== -1 && row[cat4Idx] ? cleanNumber(row[cat4Idx]) : 0
        };
    }
    return scales;
}

// Extract additional concepts table
function processAdditionals(table) {
    const additionals = {};
    if (!table) return additionals;

    for (const row of table) {
        if (row.length < 2) continue;
        const concept = row[0];
        const valueStr = row[1];
        
        // Handle special values like percentage
        if (valueStr.includes('%')) {
            additionals[concept] = valueStr.trim();
        } else {
            additionals[concept] = cleanNumber(valueStr);
        }
    }
    return additionals;
}

async function scrapeSuterh(periodStr) {
    try {
        const url = getUrlForPeriod(periodStr);
        console.log(`Scraping SUTERH scales for period ${periodStr} from: ${url}`);
        const html = await fetchHtml(url);
        const tables = parseTables(html);
        
        if (tables.length < 2) {
            throw new Error("No se encontraron las tablas salariales esperadas en la página.");
        }

        const baseSalaries = processBaseSalaries(tables[0]);
        const additionals = processAdditionals(tables[1]);

        // SUTERH sometimes has the Adicional Remuneratorio Mensual in the page text itself rather than the table.
        // Let's search for "Adicional Remuneratorio Mensual" in the text
        let adicionalRemuneratorio = 100000; // default/fallback
        const textMatch = html.match(/Adicional Remuneratorio Mensual[^$]*\$\s*([\d.]+)/i);
        if (textMatch && textMatch[1]) {
            adicionalRemuneratorio = cleanNumber(textMatch[1]);
        }
        additionals["Adicional Remuneratorio Mensual"] = adicionalRemuneratorio;

        return {
            period: periodStr,
            url: url,
            scrapedAt: new Date().toISOString(),
            baseSalaries,
            additionals
        };
    } catch (err) {
        console.error(`Error scraping SUTERH: ${err.message}`);
        throw err;
    }
}

// If run directly
if (require.main === module) {
    const args = process.argv.slice(2);
    const period = args[0] || '2026-05'; // default to Mayo 2026 which we verified exists
    
    scrapeSuterh(period)
        .then(result => {
            const outputPath = path.join(__dirname, `scales_${period}.json`);
            fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
            console.log(`Successfully scraped SUTERH scales and wrote to ${outputPath}`);
            console.log(`Base Salaries Count: ${Object.keys(result.baseSalaries).length}`);
            console.log(`Additional Concepts Count: ${Object.keys(result.additionals).length}`);
        })
        .catch(err => {
            console.error("Scraping failed:", err);
            process.exit(1);
        });
}

module.exports = { scrapeSuterh };
