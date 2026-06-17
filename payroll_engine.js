const fs = require('fs');
const path = require('path');

// Helper to sanitize object keys by trimming them
function sanitizeKeys(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    return Object.keys(obj).reduce((acc, key) => {
        const cleanKey = key.trim();
        let val = obj[key];
        if (typeof val === 'string') {
            val = val.trim();
        }
        acc[cleanKey] = val;
        return acc;
    }, {});
}

// Helper to parse dates and calculate seniority in years based on month completed logic
function calculateSeniorityYears(hireDateStr, periodStr) {
    if (!hireDateStr) return 0;
    
    // Period is AAAA-MM (e.g., 2026-06)
    const [pYear, pMonth] = periodStr.split('-').map(Number);
    
    // Hire date can be AAAA-MM-DD or Excel serial number
    let hYear, hMonth;
    if (typeof hireDateStr === 'number' || !isNaN(hireDateStr)) {
        const excelEpoch = new Date(1899, 11, 30);
        const hireDate = new Date(excelEpoch.getTime() + hireDateStr * 24 * 60 * 60 * 1000);
        hYear = hireDate.getFullYear();
        hMonth = hireDate.getMonth();
    } else {
        const hireDate = new Date(hireDateStr);
        hYear = hireDate.getFullYear();
        hMonth = hireDate.getMonth();
    }
    
    // Set both dates to day 1 of the month to count the month of hire fully
    const start = new Date(hYear, hMonth, 1);
    const end = new Date(pYear, pMonth - 1, 1);
    
    let years = end.getFullYear() - start.getFullYear();
    const m = end.getMonth() - start.getMonth();
    if (m < 0) {
        years--;
    }
    return Math.max(0, years);
}

function parseHireDate(hireDateStr) {
    if (!hireDateStr) return null;
    if (typeof hireDateStr === 'number' || (typeof hireDateStr === 'string' && hireDateStr.trim() !== '' && !isNaN(hireDateStr))) {
        const serial = Number(hireDateStr);
        const excelEpoch = new Date(1899, 11, 30);
        return new Date(excelEpoch.getTime() + serial * 24 * 60 * 60 * 1000);
    }
    if (typeof hireDateStr === 'string') {
        const parts = hireDateStr.split(/[-/]/);
        if (parts.length === 3) {
            const y = parseInt(parts[0], 10);
            const m = parseInt(parts[1], 10);
            const d = parseInt(parts[2], 10);
            if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
                return new Date(y, m - 1, d);
            }
        }
    }
    const d = new Date(hireDateStr);
    if (isNaN(d.getTime())) return null;
    return d;
}

function getSacProportion(hireDateStr, periodStr) {
    if (!hireDateStr) return 1.0;
    const hireDate = parseHireDate(hireDateStr);
    if (!hireDate || isNaN(hireDate.getTime())) return 1.0;

    const parts = String(periodStr).split('-');
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    if (isNaN(year) || isNaN(month)) return 1.0;

    const isFirstSemester = month <= 6;
    let semStart, semEnd;
    if (isFirstSemester) {
        semStart = new Date(year, 0, 1);  // Jan 1
        semEnd = new Date(year, 5, 30);   // Jun 30
    } else {
        semStart = new Date(year, 6, 1);  // Jul 1
        semEnd = new Date(year, 11, 31); // Dec 31
    }

    semStart.setHours(0, 0, 0, 0);
    semEnd.setHours(0, 0, 0, 0);
    hireDate.setHours(0, 0, 0, 0);

    if (hireDate <= semStart) {
        return 1.0;
    }
    if (hireDate > semEnd) {
        return 0.0;
    }

    const diffTime = semEnd.getTime() - hireDate.getTime();
    const activeDays = Math.round(diffTime / (1000 * 60 * 60 * 24)) + 1;

    const totalTime = semEnd.getTime() - semStart.getTime();
    const totalDays = Math.round(totalTime / (1000 * 60 * 60 * 24)) + 1;

    return activeDays / totalDays;
}

// Format period from AAAA-MM to "MM AAAA" or "MM/AAAA"
function formatPeriodText(periodStr) {
    const months = [
        "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
        "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
    ];
    const clean = String(periodStr).replace("-SAC", "").replace(" SAC", "");
    const [year, month] = clean.split('-');
    return `${months[parseInt(month) - 1]} ${year}` + (String(periodStr).includes("SAC") ? " (SAC)" : "");
}

function getHighestGrossOfSemester(cuit, cuil, targetPeriod, currentGross, scales, employees, employers) {
    if (!cuit || !cuil) return currentGross;
    try {
        const dbManager = require('./db_manager');
        const [year, monthStr] = targetPeriod.split('-');
        const month = Number(monthStr);
        if (isNaN(month)) return currentGross;
        
        const isFirstSemester = month <= 6;
        const startMonth = isFirstSemester ? 1 : 7;
        const endMonth = isFirstSemester ? 6 : 12;
        
        let maxGross = 0;
        
        for (let m = startMonth; m <= endMonth; m++) {
            const periodKey = `${year}-${String(m).padStart(2, '0')}`;
            
            const periodData = dbManager.getPeriodData(cuit, periodKey);
            if (!periodData || !periodData.fileFound || !periodData.novedades) {
                continue;
            }
            
            const rawNovedades = periodData.novedades || [];
            const mappedNovedades = rawNovedades.map(nov => ({
                "CUIL": nov.cuil,
                "CUIT": cuit,
                "PERIODO": periodKey,
                "DIAS TRABAJADO SUPLENTE": nov.diasTrabajados !== undefined ? Number(nov.diasTrabajados) : 30,
                "HORAS EXTRAS al 50% [HS]": Number(nov.horasExtras50 || 0),
                "HORAS EXTRAS al 100% [HS]": Number(nov.horasExtras100 || 0),
                "FERIADOS TRABAJADOS [HS]": Number(nov.feriados || 0),
                "Anticipo": Number(nov.anticipo || 0),
                "Días no trabajados": Number(nov.diasNoTrabajados || 0),
                "Licencia por enfermedad": Number(nov.diasEnfermedad || 0),
                "PLUS VACACIONES [DIAS]": Number(nov.diasVacaciones || 0),
                "Embargo": Number(nov.embargo || 0),
                "Adicional voluntario": Number(nov.adicionalVoluntario || 0)
            }));
            
            const results = calculatePayroll(employees, employers, mappedNovedades, scales, periodKey, true);
            const empResult = results.find(r => String(r.cuil).replace(/[^0-9]/g, '') === String(cuil).replace(/[^0-9]/g, ''));
            if (empResult && empResult.totalRemunerativo > maxGross) {
                maxGross = empResult.totalRemunerativo;
            }
        }
        
        return maxGross > 0 ? maxGross : currentGross;
    } catch (e) {
        console.error("[SAC Calc] Failed to calculate highest gross", e);
        return currentGross;
    }
}

function calculatePayroll(employeesRaw, employersRaw, novedadesRaw, scales, targetPeriod, bypassSac = false, isSacSeparate = false) {
    const isSacOnly = String(targetPeriod).toUpperCase().includes("SAC");
    const cleanPeriod = String(targetPeriod).replace("-SAC", "").replace(" SAC", "");
    const results = [];

    // Sanitize input arrays
    const employees = employeesRaw.map(sanitizeKeys);
    const employers = employersRaw.map(sanitizeKeys);
    const novedades = novedadesRaw.map(sanitizeKeys);
    
    // Filter novedades for the target period
    const periodNovedades = novedades.filter(n => n.PERIODO === cleanPeriod);
    
    for (const emp of employees) {
        const cuilStr = String(emp.CUIL || '').trim();
        if (!cuilStr) continue;
        
        let nov = periodNovedades.find(n => String(n.CUIL || '').trim() === cuilStr);
        if (!nov) {
            const CUIT = emp.CUIT || emp.CUIT_EMPLEADOR || emp['CUIT EMPLEADOR'];
            if (!CUIT) continue;
            nov = {
                CUIL: emp.CUIL,
                APELLIDO_Y_NOMBRE: emp['APELLIDO Y NOMBRE'] || `${emp.APELLIDO || ''} ${emp.NOMBRE || ''}`.trim(),
                CUIT: CUIT,
                PERIODO: targetPeriod
            };
        }
        
        const boss = employers.find(b => String(b.CUIT || '').trim() === String(nov.CUIT || '').trim());
        
        if (!boss) {
            console.warn(`Warning: Missing employer record for CUIT ${nov.CUIT}`);
            continue;
        }

        // Check if employee was hired after the target period
        const hireDateStr = emp["FECHA DE INGRESO"];
        let hYear, hMonth;
        if (typeof hireDateStr === 'number' || !isNaN(hireDateStr)) {
            const excelEpoch = new Date(1899, 11, 30);
            const hireDate = new Date(excelEpoch.getTime() + hireDateStr * 24 * 60 * 60 * 1000);
            hYear = hireDate.getFullYear();
            hMonth = hireDate.getMonth();
        } else {
            const hireDate = new Date(hireDateStr);
            hYear = hireDate.getFullYear();
            hMonth = hireDate.getMonth();
        }
        const [pYear, pMonth] = targetPeriod.split('-').map(Number);
        const hireStart = new Date(hYear, hMonth, 1);
        const periodStart = new Date(pYear, pMonth - 1, 1);
        if (hireStart > periodStart) {
            // Employee not hired yet in this period
            continue;
        }

        // 1. Get Base Salary from Scale
        const functionName = emp.FUNCION;
        let lookupFunction = functionName;
        if (lookupFunction === "Suplente eventual") {
            lookupFunction = "Suplente con horario por dia";
        }
        const category = boss["CATEGORIA EDIFICIO"] || emp["CATEGORIA EDIFICIO"] || "1° Cat.";
        
        // Find match in scales
        const scaleMatch = scales.baseSalaries[lookupFunction];
        let scaleBasic = 0;
        if (scaleMatch) {
            scaleBasic = scaleMatch[category] || scaleMatch["1° Cat."] || 0;
        } else {
            console.warn(`Warning: Scale not found for function "${functionName}"`);
        }

        // Seniority
        const seniorityYears = calculateSeniorityYears(emp["FECHA DE INGRESO"], targetPeriod);
        
        // Pluses rates from scale
        const normalizeFuzzyKey = (key) => {
            if (!key) return '';
            return key
                .toLowerCase()
                .replace(/&#8211;/g, '-')
                .replace(/&ndash;/g, '-')
                .replace(/–/g, '-')
                .replace(/—/g, '-')
                .replace(/\s+/g, ' ')
                .trim();
        };

        const normalizedAdditionals = {};
        if (scales && scales.additionals) {
            for (const [k, v] of Object.entries(scales.additionals)) {
                normalizedAdditionals[normalizeFuzzyKey(k)] = v;
            }
        }
        
        const getAddVal = (key) => {
            const val = normalizedAdditionals[normalizeFuzzyKey(key)];
            if (typeof val === 'number') return val;
            if (typeof val === 'string') {
                const clean = val.replace(/[^0-9.]/g, '');
                return clean ? Number(clean) : 0;
            }
            return 0;
        };

        const trashRate = getAddVal("Retiro de residuos por unidad destinada a vivienda u oficina");
        const trashClassBase = getAddVal("Clasificación de residuos Resol. 2013 243 SSRT-GCABA");
        const housingValue = getAddVal("Valor vivienda");
        const seniorityRate1 = getAddVal("Plus por antigüedad conf. Resoluc. 106/09 – inc. D, e, h, n y p del art. 7 y 8 por año ( 1%)");
        const seniorityRate2 = getAddVal("Plus por antigüedad – por año ART. 11 ( 2%)");
        const garageCleanRate = getAddVal("Plus limpieza de cocheras");
        const carMoveRate = getAddVal("Plus moviemiento de coches – hasta 20 unidades");
        const gardenRate = getAddVal("Plus Jardin");
        const poolRate = getAddVal("Plus limpieza de piletas y mantenimiento del agua");
        const viaticosRate = getAddVal("Adicional Viaticos");
        const scaleAdicionalRemuneratorio = getAddVal("Adicional Remuneratorio Mensual");

        // Is Suplente?
        const isSuplente = String(emp.FUNCION).toLowerCase().includes("suplente") || String(emp.JORNADA).toLowerCase().includes("suplente");

        // Hourly rate divisor logic
        let hourlyDivisor = 200;
        if (String(emp.FUNCION).toLowerCase().includes("media jornada") || String(emp.JORNADA).toLowerCase().includes("media")) {
            hourlyDivisor = 100;
        } else if (String(emp.FUNCION).toLowerCase().includes("vigilancia nocturna")) {
            hourlyDivisor = 175;
        }

        // --- CALCULATE REMUNERATIVE CONCEPTS ---
        const concepts = [];
        let totalRemunerativo = 0;
        let housingVal = 0;

        if (!isSacOnly) {

        // A. Sueldo Básico / Suplencia
        let basicSalaryValue = 0;
        if (isSuplente) {
            const diasTrabajados = nov["DIAS TRABAJADO SUPLENTE"] || 0;
            const horasJornada = nov["Horas JORNADA [HS]"] || 8;
            // Hourly rate is (Sueldo Basico from Scale / 8) * Horas Jornada
            const hourlyRate = (scaleBasic / 8) * horasJornada;
            basicSalaryValue = hourlyRate * diasTrabajados;
            
            concepts.push({
                code: "1000",
                name: "Suplencia",
                unidad: diasTrabajados,
                valorUnitario: Math.round(hourlyRate * 100) / 100,
                amount: Math.round(basicSalaryValue * 100) / 100,
                type: "C" // Credit/Haber
            });
        } else {
            basicSalaryValue = scaleBasic;
            concepts.push({
                code: "1000",
                name: "Sueldo Básico",
                unidad: "",
                valorUnitario: "",
                amount: basicSalaryValue,
                type: "C"
            });
        }
        totalRemunerativo += basicSalaryValue;

        // B. Suplencia al 100% (only for suplentes hours)
        const suplenciaHours100 = nov["Suplencia al 100% [hs]"] || 0;
        if (isSuplente && suplenciaHours100 > 0) {
            const hourlyRate100 = (scaleBasic / 8) * 2;
            const suplenciaValue100 = hourlyRate100 * suplenciaHours100;
            concepts.push({
                code: "1050",
                name: "Suplencia al 100%",
                unidad: suplenciaHours100,
                valorUnitario: Math.round(hourlyRate100 * 100) / 100,
                amount: Math.round(suplenciaValue100 * 100) / 100,
                type: "C"
            });
            totalRemunerativo += suplenciaValue100;
        }

        // C. Retiro de Residuos
        let trashValue = 0;
        if (emp["Retiro de Residuos"] === "SI") {
            const uf = boss.UF || 0;
            trashValue = uf * trashRate;
            concepts.push({
                code: "1100",
                name: "Retiro de residuos por unidad destinada a vivienda u oficina",
                unidad: uf,
                valorUnitario: trashRate,
                amount: trashValue,
                type: "C"
            });
            totalRemunerativo += trashValue;
        }

        // D. Clasificación de Residuos
        let trashClassValue = 0;
        if (emp["Retiro de Residuos"] === "SI") {
            const uf = boss.UF || 0;
            if (uf <= 25) {
                trashClassValue = trashClassBase;
            } else {
                trashClassValue = trashClassBase + (trashClassBase / 75) * (uf - 25);
            }
            // Round to 2 decimals
            trashClassValue = Math.round(trashClassValue * 100) / 100;
            concepts.push({
                code: "1150",
                name: "Clasificación de residuos Resol. 2013 243 SSRT-GCABA",
                unidad: "",
                valorUnitario: "",
                amount: trashClassValue,
                type: "C"
            });
            totalRemunerativo += trashClassValue;
        }

        // E. Valor Vivienda
        housingVal = 0;
        if (emp.Vivienda === "SI") {
            housingVal = housingValue;
            concepts.push({
                code: "1200",
                name: "Valor vivienda",
                unidad: "",
                valorUnitario: "",
                amount: housingVal,
                type: "C"
            });
            totalRemunerativo += housingVal;
        }

        // F. Plus Antigüedad (1% and 2%)
        let antiquity1 = 0;
        if (seniorityRate1 > 0 && emp["Plus por antigüedad conf. Resoluc. 106/09 – inc. D, e, h, n y p del art. 7 y 8 por año ( 1%)"] === "SI") {
            antiquity1 = seniorityYears * seniorityRate1;
            concepts.push({
                code: "1250",
                name: "Plus por antigüedad conf. Resoluc. 106/09 (1%)",
                unidad: seniorityYears,
                valorUnitario: seniorityRate1,
                amount: antiquity1,
                type: "C"
            });
            totalRemunerativo += antiquity1;
        }

        let antiquity2 = 0;
        if (!isSuplente && seniorityYears > 0) {
            antiquity2 = seniorityYears * seniorityRate2;
            concepts.push({
                code: "1300",
                name: "Plus por antigüedad – por año ART. 11 ( 2%)",
                unidad: seniorityYears,
                valorUnitario: seniorityRate2,
                amount: antiquity2,
                type: "C"
            });
            totalRemunerativo += antiquity2;
        }

        // G. Pluses de Edificio (Cochera, Movimiento Coches, Jardin, Pileta)
        const funcion2 = String(emp.Funcion2 || emp.FUNCION).toUpperCase();
        
        const hasCocheraPlus = emp.plusCochera !== undefined ? !!emp.plusCochera : funcion2.includes("ENCARGADO");
        const hasCarMovePlus = emp.plusMovimientoCoches !== undefined ? !!emp.plusMovimientoCoches : String(emp.FUNCION).includes("Encargado");
        const hasJardinPlus = emp.plusJardin !== undefined ? !!emp.plusJardin : funcion2.includes("ENCARGADO");
        const hasPiletaPlus = emp.plusPileta !== undefined ? !!emp.plusPileta : String(emp.FUNCION).includes("Encargado");

        let garageCleanVal = 0;
        if (hasCocheraPlus && boss.COCHERA === "SI") {
            garageCleanVal = garageCleanRate;
            concepts.push({
                code: "1350",
                name: "Plus limpieza de cocheras",
                unidad: "",
                valorUnitario: "",
                amount: garageCleanVal,
                type: "C"
            });
            totalRemunerativo += garageCleanVal;
        }

        let carMoveVal = 0;
        if (hasCarMovePlus && boss["MOVIMIENTO DE COCHES"] === "SI") {
            carMoveVal = carMoveRate;
            concepts.push({
                code: "1400",
                name: "Plus moviemiento de coches – hasta 20 unidades",
                unidad: "",
                valorUnitario: "",
                amount: carMoveVal,
                type: "C"
            });
            totalRemunerativo += carMoveVal;
        }

        let gardenVal = 0;
        if (hasJardinPlus && boss.JARDIN === "SI") {
            gardenVal = gardenRate;
            concepts.push({
                code: "1450",
                name: "Plus Jardin",
                unidad: "",
                valorUnitario: "",
                amount: gardenVal,
                type: "C"
            });
            totalRemunerativo += gardenVal;
        }

        let poolVal = 0;
        if (hasPiletaPlus && boss.PILETA === "SI") {
            poolVal = poolRate;
            concepts.push({
                code: "1500",
                name: "Plus limpieza de piletas y mantenimiento del agua",
                unidad: "",
                valorUnitario: "",
                amount: poolVal,
                type: "C"
            });
            totalRemunerativo += poolVal;
        }

        // H. Plus Zona Desfavorable (50%)
        let zoneVal = 0;
        if (boss["ZONA DESFAVORABLE"] === "SI") {
            zoneVal = Math.round((basicSalaryValue * 0.5) * 100) / 100;
            concepts.push({
                code: "1550",
                name: "Plus Zona Desfavorable",
                unidad: "",
                valorUnitario: "",
                amount: zoneVal,
                type: "C"
            });
            totalRemunerativo += zoneVal;
        }

        // I. Titulo
        let titleVal = 0;
        if (emp.TITULO === "SI" || emp["Titulo de Encargado Integral de Edificio"] === "SI") {
            titleVal = Math.round((basicSalaryValue * 0.1) * 100) / 100;
            concepts.push({
                code: "1600",
                name: "Titulo de Encargado Integral de Edificio",
                unidad: "",
                valorUnitario: "",
                amount: titleVal,
                type: "C"
            });
            totalRemunerativo += titleVal;
        }

        // J. Adicional Voluntario
        const extraVoluntario = nov["Adicional voluntario"] || emp["Adicional voluntario"] || 0;
        if (extraVoluntario > 0) {
            concepts.push({
                code: "1650",
                name: "Adicional voluntario",
                unidad: "",
                valorUnitario: "",
                amount: extraVoluntario,
                type: "C"
            });
            totalRemunerativo += extraVoluntario;
        }

        // --- DEFINE OVERTIME BASE ---
        // Overtime base is the sum of basic + building pluses + antiquity + voluntary. It excludes Viáticos and ARM.
        const sumBaseRemun = basicSalaryValue + trashValue + trashClassValue + housingVal + antiquity1 + antiquity2 + garageCleanVal + carMoveVal + gardenVal + poolVal + extraVoluntario;

        // K. Adicional Viáticos (Added after overtime base is calculated!)
        let viaticosVal = 0;
        if (emp.Viaticos === "SI") {
            viaticosVal = viaticosRate;
            concepts.push({
                code: "1700",
                name: "Adicional Viaticos",
                unidad: "",
                valorUnitario: "",
                amount: viaticosVal,
                type: "C"
            });
            totalRemunerativo += viaticosVal;
        }

        // L. Adicional Remuneratorio Mensual (CCT ARM)
        let cctAdicional = 0;
        const masterAdicionalRemuneratorio = emp["Adicional remuneratorio"] || scaleAdicionalRemuneratorio || 100000;
        if (isSuplente) {
            const totalHours = (nov["HORAS TOTALES"] || 0) + suplenciaHours100;
            cctAdicional = Math.round((masterAdicionalRemuneratorio * totalHours) * 100) / 100;
            concepts.push({
                code: "1750",
                name: "Adicional Remuneratorio Mensual",
                unidad: totalHours,
                valorUnitario: masterAdicionalRemuneratorio,
                amount: cctAdicional,
                type: "C"
            });
        } else {
            cctAdicional = masterAdicionalRemuneratorio;
            concepts.push({
                code: "1750",
                name: "Adicional Remuneratorio Mensual",
                unidad: "",
                valorUnitario: "",
                amount: cctAdicional,
                type: "C"
            });
        }
        totalRemunerativo += cctAdicional;

        // M. Horas Extras al 50%
        const hours50 = nov["HORAS EXTRAS al 50% [HS]"] || 0;
        let extras50Val = 0;
        if (hours50 > 0) {
            let hourlyRate;
            if (hourlyDivisor === 100) {
                // Media Jornada basic / 100 + pluses / 200 (excluding viáticos & ARM)
                const plusesTotal = sumBaseRemun - basicSalaryValue;
                hourlyRate = (basicSalaryValue / 100 + plusesTotal / 200) * 1.5;
            } else {
                hourlyRate = (sumBaseRemun / hourlyDivisor) * 1.5;
            }
            hourlyRate = Math.round(hourlyRate * 100000) / 100000; // 5 decimal precision
            extras50Val = Math.round((hourlyRate * hours50) * 100) / 100;
            concepts.push({
                code: "1800",
                name: "Horas extras al 50%",
                unidad: hours50,
                valorUnitario: Math.round(hourlyRate * 100) / 100,
                amount: extras50Val,
                type: "C"
            });
            totalRemunerativo += extras50Val;
        }

        // N. Horas Extras al 100%
        const hours100 = nov["HORAS EXTRAS al 100% [HS]"] || 0;
        let extras100Val = 0;
        if (hours100 > 0) {
            let hourlyRate;
            if (hourlyDivisor === 100) {
                const plusesTotal = sumBaseRemun - basicSalaryValue;
                hourlyRate = (basicSalaryValue / 100 + plusesTotal / 200) * 2.0;
            } else {
                hourlyRate = (sumBaseRemun / hourlyDivisor) * 2.0;
            }
            hourlyRate = Math.round(hourlyRate * 100000) / 100000;
            extras100Val = Math.round((hourlyRate * hours100) * 100) / 100;
            concepts.push({
                code: "1850",
                name: "Horas extras al 100%",
                unidad: hours100,
                valorUnitario: Math.round(hourlyRate * 100) / 100,
                amount: extras100Val,
                type: "C"
            });
            totalRemunerativo += extras100Val;
        }

        // O. Feriados Trabajados
        const feriadosHs = nov["FERIADOS TRABAJADOS [HS]"] || 0;
        let feriadosVal = 0;
        if (feriadosHs > 0) {
            let hourlyRate;
            if (isSuplente) {
                hourlyRate = (scaleBasic / 8) * 2;
            } else if (hourlyDivisor === 100 || String(emp.FUNCION).includes("No Permanente")) {
                const plusesTotal = sumBaseRemun - basicSalaryValue;
                hourlyRate = (basicSalaryValue / 100 + plusesTotal / 200) * 2.0;
            } else {
                hourlyRate = (sumBaseRemun / hourlyDivisor) * 2.0;
            }
            hourlyRate = Math.round(hourlyRate * 100000) / 100000;
            feriadosVal = Math.round((hourlyRate * feriadosHs) * 100) / 100;
            concepts.push({
                code: "1900",
                name: "Feriados trabajados hs",
                unidad: feriadosHs,
                valorUnitario: Math.round(hourlyRate * 100) / 100,
                amount: feriadosVal,
                type: "C"
            });
            totalRemunerativo += feriadosVal;
        }

        // P. Días No Trabajados (Absences - Subtracted)
        const diasNoTrabajados = nov["Días no trabajados"] || 0;
        if (diasNoTrabajados > 0) {
            const dailyRate = Math.round((sumBaseRemun / 30) * 100) / 100;
            const absencesVal = Math.round((dailyRate * diasNoTrabajados) * 100) / 100;
            
            concepts.push({
                code: "2000",
                name: "Días no trabajados",
                unidad: diasNoTrabajados,
                valorUnitario: dailyRate,
                amount: -absencesVal,
                type: "D"
            });
            totalRemunerativo -= absencesVal;
        }

        // Q. Licencia por Enfermedad (Paid)
        const diasEnfermedad = nov["Licencia por enfermedad"] || 0;
        if (diasEnfermedad > 0) {
            const dailyRate = Math.round((sumBaseRemun / 30) * 100) / 100;
            const sickLeaveVal = Math.round((dailyRate * diasEnfermedad) * 100) / 100;
            
            concepts.push({
                code: "2050",
                name: "Licencia por enfermedad",
                unidad: diasEnfermedad,
                valorUnitario: dailyRate,
                amount: sickLeaveVal,
                type: "C"
            });
            totalRemunerativo += sickLeaveVal;
        }

        // R. Plus Vacacional
        const diasVacaciones = nov["PLUS VACACIONES [DIAS]"] || 0;
        if (diasVacaciones > 0) {
            const baseSum = sumBaseRemun; // Exclude viaticosVal as per Excel log
            const avgOvertime = 0; // Fallback
            const vacUnitRate = (baseSum + avgOvertime) / 25 - (baseSum / 30);
            const vacPlusVal = Math.round((vacUnitRate * diasVacaciones) * 100) / 100;
            concepts.push({
                code: "2100",
                name: "Plus vacacional",
                unidad: diasVacaciones,
                valorUnitario: Math.round(vacUnitRate * 100) / 100,
                amount: vacPlusVal,
                type: "C"
            });
            totalRemunerativo += vacPlusVal;
        }
        }

        // S. SAC & Bonificaciones (Only for special periods)
        let isSacPeriod = cleanPeriod.endsWith("-06") || cleanPeriod.endsWith("-12") || cleanPeriod === "SAC 1°" || cleanPeriod === "SAC 2°" || isSacOnly;

        if (isSacPeriod && !bypassSac && (!isSacSeparate || isSacOnly)) {
            const highestGross = getHighestGrossOfSemester(nov.CUIT || boss.CUIT || '', emp.CUIL, cleanPeriod, totalRemunerativo, scales, employeesRaw, employersRaw);
            const hireDateStr = emp["FECHA DE INGRESO"] || emp.hireDate;
            const sacProportion = getSacProportion(hireDateStr, cleanPeriod);
            const sacVal = Math.round((highestGross / 2 * sacProportion) * 100) / 100;
            
            // Calculate active days in the semester if proportional
            let unidadText = "";
            if (sacProportion < 1.0) {
                const parts = String(cleanPeriod).split('-');
                const month = parseInt(parts[1], 10);
                const year = parseInt(parts[0], 10);
                const isFirstSem = month <= 6;
                const totalDays = isFirstSem ? 181 : 184; // 2026 is non-leap year (Feb has 28 days)
                const activeDays = Math.round(sacProportion * totalDays);
                unidadText = `${activeDays} d.`;
            }

            concepts.push({
                code: "2200",
                name: "Sueldo anual complementario",
                unidad: unidadText,
                valorUnitario: "",
                amount: sacVal,
                type: "C"
            });
            totalRemunerativo += sacVal;

            if (cleanPeriod.endsWith("-12") || targetPeriod === "SAC 2°") {
                const bonusVal = Math.round((scaleBasic * 0.2) * 100) / 100;
                concepts.push({
                    code: "2250",
                    name: "Bonificación",
                    unidad: "",
                    valorUnitario: "",
                    amount: bonusVal,
                    type: "C"
                });
                totalRemunerativo += bonusVal;
            }
        }

        totalRemunerativo = Math.round(totalRemunerativo * 100) / 100;

        // --- CALCULATE DEDUCTIONS (DESCUENTOS) ---
        let totalDescuentos = 0;

        // A. Jubilación (11%)
        const jubVal = Math.round((totalRemunerativo * 0.11) * 100) / 100;
        concepts.push({
            code: "5000",
            name: "Jubilación",
            unidad: "11%",
            valorUnitario: 0.11,
            amount: jubVal,
            type: "D"
        });
        totalDescuentos += jubVal;

        // B. Ley 19032 (3%)
        const leyVal = Math.round((totalRemunerativo * 0.03) * 100) / 100;
        concepts.push({
            code: "5050",
            name: "Ley 19032",
            unidad: "3%",
            valorUnitario: 0.03,
            amount: leyVal,
            type: "D"
        });
        totalDescuentos += leyVal;

        // C. Obra Social (3%)
        const osVal = Math.round((totalRemunerativo * 0.03) * 100) / 100;
        concepts.push({
            code: "5100",
            name: "Obra Social",
            unidad: "3%",
            valorUnitario: 0.03,
            amount: osVal,
            type: "D"
        });
        totalDescuentos += osVal;

        // D. Diferencia Obra Social Ley 26475
        let diffOsVal = 0;
        if (emp.JORNADA === "Media" && !isSuplente) {
            let fullTimeBasic = 0;
            const ftScaleMatch = scales.baseSalaries["Encargado Permanente sin vivienda"];
            if (ftScaleMatch) {
                fullTimeBasic = ftScaleMatch[category] || ftScaleMatch["1° Cat."] || 0;
            }
            const minOsContribution = fullTimeBasic * 0.03;
            const currentOsContrib = totalRemunerativo * 0.03;
            
            diffOsVal = Math.max(0, minOsContribution - currentOsContrib);
            diffOsVal = Math.round(diffOsVal * 100) / 100;
            
            if (diffOsVal > 0) {
                concepts.push({
                    code: "5150",
                    name: "Diferencia Obra Social Ley 26475",
                    unidad: "",
                    valorUnitario: "",
                    amount: diffOsVal,
                    type: "D"
                });
                totalDescuentos += diffOsVal;
            }
        }

        // E. SUTERH (2%) - Only if NOT Suplente Eventual
        let suterhVal = 0;
        if (emp.FUNCION !== "Suplente eventual") {
            suterhVal = Math.round((totalRemunerativo * 0.02) * 100) / 100;
            concepts.push({
                code: "5200",
                name: "SUTERH",
                unidad: "2%",
                valorUnitario: 0.02,
                amount: suterhVal,
                type: "D"
            });
            totalDescuentos += suterhVal;
        }

        // F. Caja Prot. Flia (1%)
        const cajaVal = Math.round((totalRemunerativo * 0.01) * 100) / 100;
        concepts.push({
            code: "5250",
            name: "Caja Prot. Flia.",
            unidad: "1%",
            valorUnitario: 0.01,
            amount: cajaVal,
            type: "D"
        });
        totalDescuentos += cajaVal;

        // G. FATERYH (1%) - Only if NOT Suplente Eventual
        let fateryhVal = 0;
        if (emp.FUNCION !== "Suplente eventual") {
            fateryhVal = Math.round((totalRemunerativo * 0.01) * 100) / 100;
            concepts.push({
                code: "5300",
                name: "FATERYH",
                unidad: "1%",
                valorUnitario: 0.01,
                amount: fateryhVal,
                type: "D"
            });
            totalDescuentos += fateryhVal;
        }

        // H. Seguro Vitalicio (0.75%)
        const seguroVal = Math.round((totalRemunerativo * 0.0075) * 10000) / 10000;
        const seguroValRounded = Math.round(seguroVal * 100) / 100;
        concepts.push({
            code: "5350",
            name: "Seguro vitalicio - Art. 27 bis CCT 589/10",
            unidad: "0.75%",
            valorUnitario: 0.0075,
            amount: seguroValRounded,
            type: "D"
        });
        totalDescuentos += seguroValRounded;

        // I. Desc. Vivienda (if housingVal applies)
        let descViviendaVal = 0;
        if (emp.Vivienda === "SI") {
            descViviendaVal = housingVal;
            concepts.push({
                code: "5400",
                name: "Desc. vivienda",
                unidad: "",
                valorUnitario: "",
                amount: descViviendaVal,
                type: "D"
            });
            totalDescuentos += descViviendaVal;
        }

        // J. Embargo
        const embargoVal = nov.Embargo || 0;
        if (embargoVal > 0) {
            concepts.push({
                code: "5450",
                name: "Embargo",
                unidad: "",
                valorUnitario: "",
                amount: embargoVal,
                type: "D"
            });
            totalDescuentos += embargoVal;
        }

        // K. Anticipo
        const anticipoVal = nov.Anticipo || 0;
        if (anticipoVal > 0) {
            concepts.push({
                code: "5500",
                name: "Anticipo",
                unidad: "",
                valorUnitario: "",
                amount: anticipoVal,
                type: "D"
            });
            totalDescuentos += anticipoVal;
        }

        // --- CALCULATE NO-REMUNERATIVE ITEMS & ROUNDING ---
        let totalNoRemunerativo = 0;
        
        // Redondeo
        const netBeforeRounding = totalRemunerativo - totalDescuentos;
        const netRounded = Math.ceil(netBeforeRounding);
        const roundingVal = Math.round((netRounded - netBeforeRounding) * 100) / 100;
        
        if (roundingVal !== 0) {
            concepts.push({
                code: "9000",
                name: "Redondeo",
                unidad: "",
                valorUnitario: "",
                amount: roundingVal,
                type: "NR"
            });
            totalNoRemunerativo += roundingVal;
        }

        const netSalary = netRounded;
        totalDescuentos = Math.round(totalDescuentos * 100) / 100;
        totalNoRemunerativo = Math.round(totalNoRemunerativo * 100) / 100;

        // --- CALCULATE EMPLOYER CONTRIBUTIONS ---
        const contributions = [];
        
        // 1. Seguridad Social (18.72%)
        const ssContrib = Math.round((totalRemunerativo * 0.1872) * 100) / 100;
        contributions.push({ name: "Seguridad Social (SIPA/INSSJP/FNE/Asig)", rate: 0.1872, amount: ssContrib });

        // 2. Obra Social Empleador (5.1%)
        const osContrib = Math.round((totalRemunerativo * 0.051) * 100) / 100;
        contributions.push({ name: "Obra Social Empleador", rate: 0.051, amount: osContrib });

        // 3. LRT - ART (Riesgos del Trabajo)
        const artRate = boss["% VARIABLE"] || 0;
        const artContrib = Math.round((totalRemunerativo * artRate) * 100) / 100;
        contributions.push({ name: "LRT - ART (Riesgos del Trabajo)", rate: artRate, amount: artContrib });

        // 4. SCVO
        const scvoContrib = boss["$ SEGURO VIDA FIJO"] || 424.62;
        contributions.push({ name: "SCVO (Seguro Colectivo de Vida Obligatorio)", rate: 0, amount: scvoContrib });

        // 5. SUTERH (1.5%)
        const suterhContrib = Math.round((totalRemunerativo * 0.015) * 100) / 100;
        contributions.push({ name: "SUTERH (Contribución)", rate: 0.015, amount: suterhContrib });

        // 6. SERACARH (0.5%)
        const seracarhContrib = Math.round((totalRemunerativo * 0.005) * 100) / 100;
        contributions.push({ name: "SERACARH (Contribución)", rate: 0.005, amount: seracarhContrib });

        // 7. FATERYH (4.75%)
        const fateryhContrib = Math.round((totalRemunerativo * 0.0475) * 100) / 100;
        contributions.push({ name: "FATERYH (Contribución)", rate: 0.0475, amount: fateryhContrib });

        const totalContributions = contributions.reduce((sum, c) => sum + c.amount, 0);
        const roundedTotalContributions = Math.round(totalContributions * 100) / 100;
        const totalLaborCost = Math.round((totalRemunerativo + roundedTotalContributions) * 100) / 100;

        results.push({
            consorcioName: boss["RAZON SOCIAL"],
            cuit: boss.CUIT,
            cuil: emp.CUIL,
            employeeName: emp["APELLIDO Y NOMBRE"],
            period: targetPeriod,
            periodText: formatPeriodText(targetPeriod),
            legajo: emp.LEGAJO,
            category: category,
            function: emp.FUNCION,
            hireDate: emp["FECHA DE INGRESO"],
            seniority: seniorityYears,
            cbu: emp.CBU,
            bank: emp.BANCODEPOSITO || emp["BANCO DEPOSITO"],
            
            // Totals
            totalRemunerativo,
            totalNoRemunerativo,
            totalGross: totalRemunerativo + totalNoRemunerativo,
            totalDescuentos,
            netSalary,
            totalContributions: roundedTotalContributions,
            totalLaborCost,
            
            // Detailed lists
            concepts,
            contributions
        });
    }

    return results;
}

module.exports = { calculatePayroll, calculateSeniorityYears };
