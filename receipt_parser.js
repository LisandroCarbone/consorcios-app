const dbManager = require('./db_manager');

function extractPaymentInfo(subject, body, attachmentName) {
    const textToSearch = `${subject}\n${body}\n${attachmentName}`.toUpperCase();

    // 1. Extract Amount
    let amount = 0;
    const fileAmountMatch = attachmentName ? attachmentName.match(/_(\d+)(?:\.\d+)?\./) || attachmentName.match(/(\d+)k?\./i) : null;
    
    const amountRegexes = [
        /\$\s*([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{2})?)/,
        /IMPORTE\s*:?\s*([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{2})?)/,
        /TOTAL\s*:?\s*([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{2})?)/,
        /MONTO\s*:?\s*([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{2})?)/
    ];

    let amountFound = false;
    for (const regex of amountRegexes) {
        const match = textToSearch.match(regex);
        if (match && match[1]) {
            const cleanStr = match[1].replace(/\./g, '').replace(',', '.');
            const val = parseFloat(cleanStr);
            if (!isNaN(val) && val > 0) {
                amount = val;
                amountFound = true;
                break;
            }
        }
    }

    if (!amountFound && fileAmountMatch) {
        const val = parseFloat(fileAmountMatch[1]);
        if (!isNaN(val)) amount = val;
    }

    // 2. Extract Date
    let date = new Date().toISOString().substring(0, 10);
    const dateRegexes = [
        /(\d{2})[\/-](\d{2})[\/-](\d{4})/,
        /(\d{4})[\/-](\d{2})[\/-](\d{2})/
    ];

    for (const regex of dateRegexes) {
        const match = textToSearch.match(regex);
        if (match) {
            if (match[3].length === 4) {
                date = `${match[3]}-${match[2]}-${match[1]}`;
            } else {
                date = `${match[1]}-${match[2]}-${match[3]}`;
            }
            break;
        }
    }

    // 3. Extract CUIT/CUIL
    let cuit = '';
    const cuitMatch = textToSearch.match(/([23]\d-?\d{8}-?\d)/);
    if (cuitMatch) {
        cuit = cuitMatch[1].replace(/-/g, '');
    }

    // 4. Extract target CBU/Alias
    let targetCbu = '';
    const cbuMatch = textToSearch.match(/(\d{22})/);
    if (cbuMatch) {
        targetCbu = cbuMatch[1];
    }

    let senderName = '';
    const nameMatch = textToSearch.match(/ORIGEN\s*:?\s*([A-Z\s]{4,30})(?:\n|\r|$)/) || 
                      textToSearch.match(/ORDENANTE\s*:?\s*([A-Z\s]{4,30})(?:\n|\r|$)/) ||
                      textToSearch.match(/DESDE\s*:?\s*([A-Z\s]{4,30})(?:\n|\r|$)/);
    if (nameMatch) {
        senderName = nameMatch[1].trim();
    }

    return {
        amount,
        date,
        cuit,
        senderName,
        targetCbu
    };
}

function matchPaymentToUF(emailSender, subject, body, extracted) {
    const db = dbManager.loadDb();
    const textToSearch = `${subject}\n${body}`.toUpperCase();

    // 1. First search for a registered sender (email or phone) across ALL consorcios
    if (emailSender && emailSender.trim()) {
        const cleanSender = emailSender.trim().toLowerCase();
        const isEmail = cleanSender.includes('@');
        for (const c of db.consorcios) {
            const senderMatch = (c.units || []).find(u => {
                if (isEmail) {
                    const uEmail = u.email ? u.email.trim().toLowerCase() : '';
                    return uEmail === cleanSender;
                } else {
                    const cleanPhone = cleanSender.replace(/[^0-9]/g, '');
                    const uPhone = u.phone ? u.phone.trim().toLowerCase().replace(/[^0-9]/g, '') : '';
                    return cleanPhone && uPhone && uPhone.endsWith(cleanPhone);
                }
            });
            if (senderMatch) {
                return {
                    cuitConsorcio: c.cuit,
                    uf: senderMatch.uf,
                    confidence: 'high',
                    reason: `Coincidencia por remitente registrado (${emailSender}).`
                };
            }
        }
    }

    let matchedConsorcio = null;
    let matchedUf = null;
    let confidence = 'none';
    let reason = '';

    if (extracted.targetCbu) {
        matchedConsorcio = db.consorcios.find(c => c.bankInfo && c.bankInfo.cbu === extracted.targetCbu);
    }
    
    if (!matchedConsorcio) {
        db.consorcios.forEach(c => {
            if (c.bankInfo && c.bankInfo.alias && textToSearch.includes(c.bankInfo.alias.toUpperCase())) {
                matchedConsorcio = c;
            }
        });
    }

    if (!matchedConsorcio) {
        db.consorcios.forEach(c => {
            const nameWords = c.name.toUpperCase().split(/\s+/).filter(w => w.length > 3 && w !== "CONSORCIO" && w !== "PROPIETARIOS");
            for (const word of nameWords) {
                if (textToSearch.includes(word)) {
                    matchedConsorcio = c;
                    break;
                }
            }
        });
    }

    if (!matchedConsorcio && db.consorcios.length > 0) {
        matchedConsorcio = db.consorcios[0];
    }

    if (!matchedConsorcio) {
        return { matchedConsorcio: null, matchedUf: null, confidence: 'none', reason: 'No se encontró consorcio en la base de datos.' };
    }

    const units = matchedConsorcio.units || [];

    for (const u of units) {
        const ufStr = String(u.uf).toUpperCase().trim();
        const deptoStr = String(u.depto).toUpperCase().trim();
        
        if (textToSearch.includes(`UF ${ufStr}`) || textToSearch.includes(`UF-${ufStr}`) || textToSearch.includes(`UF${ufStr}`)) {
            return {
                cuitConsorcio: matchedConsorcio.cuit,
                uf: u.uf,
                confidence: 'high',
                reason: `UF ${u.uf} especificada en el cuerpo/asunto.`
            };
        }
        if (deptoStr && (textToSearch.includes(`DPTO ${deptoStr}`) || textToSearch.includes(`DEPTO ${deptoStr}`) || textToSearch.includes(`DEPARTAMENTO ${deptoStr}`))) {
            return {
                cuitConsorcio: matchedConsorcio.cuit,
                uf: u.uf,
                confidence: 'high',
                reason: `Departamento ${u.depto} especificado en el cuerpo/asunto.`
            };
        }
        if (ufStr.length > 1 && textToSearch.includes(ufStr)) {
            return {
                cuitConsorcio: matchedConsorcio.cuit,
                uf: u.uf,
                confidence: 'medium',
                reason: `Coincidencia parcial del código de unidad (${u.uf}) en el texto.`
            };
        }
    }

    if (extracted.senderName) {
        const cleanExtractedName = extracted.senderName.toUpperCase().replace(/[^A-Z]/g, '');
        for (const u of units) {
            if (u.nombre) {
                const cleanOwnerName = u.nombre.toUpperCase().replace(/[^A-Z]/g, '');
                if (cleanExtractedName.includes(cleanOwnerName) || cleanOwnerName.includes(cleanExtractedName)) {
                    return {
                        cuitConsorcio: matchedConsorcio.cuit,
                        uf: u.uf,
                        confidence: 'medium',
                        reason: `Coincidencia del titular de la transferencia (${extracted.senderName}) con el propietario registrado (${u.nombre}).`
                    };
                }
            }
        }
    }

    if (units.length > 0) {
        return {
            cuitConsorcio: matchedConsorcio.cuit,
            uf: units[0].uf,
            confidence: 'low',
            reason: `No se pudo determinar la unidad con precisión. Se pre-asigna la primera UF por defecto.`
        };
    }

    return {
        cuitConsorcio: matchedConsorcio.cuit,
        uf: null,
        confidence: 'low',
        reason: 'Consorcio identificado pero no tiene unidades funcionales.'
    };
}

module.exports = {
    extractPaymentInfo,
    matchPaymentToUF
};
