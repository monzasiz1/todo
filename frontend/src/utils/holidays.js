import { addDays, format } from 'date-fns';

export const FEDERAL_STATES = [
  { code: '', label: 'Nur bundesweit' },
  { code: 'BW', label: 'Baden-Wuerttemberg' },
  { code: 'BY', label: 'Bayern' },
  { code: 'BE', label: 'Berlin' },
  { code: 'BB', label: 'Brandenburg' },
  { code: 'HB', label: 'Bremen' },
  { code: 'HH', label: 'Hamburg' },
  { code: 'HE', label: 'Hessen' },
  { code: 'MV', label: 'Mecklenburg-Vorpommern' },
  { code: 'NI', label: 'Niedersachsen' },
  { code: 'NW', label: 'Nordrhein-Westfalen' },
  { code: 'RP', label: 'Rheinland-Pfalz' },
  { code: 'SL', label: 'Saarland' },
  { code: 'SN', label: 'Sachsen' },
  { code: 'ST', label: 'Sachsen-Anhalt' },
  { code: 'SH', label: 'Schleswig-Holstein' },
  { code: 'TH', label: 'Thueringen' },
];

function getEasterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function createHoliday(date, name) {
  return {
    date: format(date, 'yyyy-MM-dd'),
    name,
  };
}

function getRepentanceAndPrayerDay(year) {
  const date = new Date(year, 10, 22);
  while (date.getDay() !== 3) {
    date.setDate(date.getDate() - 1);
  }
  return date;
}

export function getGermanNationalHolidays(year) {
  const easterSunday = getEasterSunday(year);

  return [
    createHoliday(new Date(year, 0, 1), 'Neujahr'),
    createHoliday(addDays(easterSunday, -2), 'Karfreitag'),
    createHoliday(addDays(easterSunday, 1), 'Ostermontag'),
    createHoliday(new Date(year, 4, 1), 'Tag der Arbeit'),
    createHoliday(addDays(easterSunday, 39), 'Christi Himmelfahrt'),
    createHoliday(addDays(easterSunday, 50), 'Pfingstmontag'),
    createHoliday(new Date(year, 9, 3), 'Tag der Deutschen Einheit'),
    createHoliday(new Date(year, 11, 25), '1. Weihnachtstag'),
    createHoliday(new Date(year, 11, 26), '2. Weihnachtstag'),
  ];
}

export function getGermanStateHolidays(year, stateCode = '') {
  if (!stateCode) return [];

  const easterSunday = getEasterSunday(year);
  const code = String(stateCode || '').toUpperCase();
  const holidays = [];

  if (['BW', 'BY', 'ST'].includes(code)) {
    holidays.push(createHoliday(new Date(year, 0, 6), 'Heilige Drei Koenige'));
  }

  if (['BW', 'BY', 'HE', 'NW', 'RP', 'SL'].includes(code)) {
    holidays.push(createHoliday(addDays(easterSunday, 60), 'Fronleichnam'));
  }

  if (['SL', 'BY'].includes(code)) {
    holidays.push(createHoliday(new Date(year, 7, 15), 'Mariae Himmelfahrt'));
  }

  if (['TH'].includes(code)) {
    holidays.push(createHoliday(new Date(year, 8, 20), 'Weltkindertag'));
  }

  if (['BB', 'MV', 'SN', 'ST', 'TH', 'HB', 'HH', 'NI', 'SH'].includes(code)) {
    holidays.push(createHoliday(new Date(year, 9, 31), 'Reformationstag'));
  }

  if (['BW', 'BY', 'NW', 'RP', 'SL'].includes(code)) {
    holidays.push(createHoliday(new Date(year, 10, 1), 'Allerheiligen'));
  }

  if (['SN'].includes(code)) {
    holidays.push(createHoliday(getRepentanceAndPrayerDay(year), 'Buss- und Bettag'));
  }

  if (['BE', 'MV'].includes(code)) {
    holidays.push(createHoliday(new Date(year, 2, 8), 'Internationaler Frauentag'));
  }

  return holidays;
}

export function getGermanHolidays(year, stateCode = '') {
  const merged = [...getGermanNationalHolidays(year), ...getGermanStateHolidays(year, stateCode)];
  const seen = new Set();

  return merged.filter((holiday) => {
    const key = `${holiday.date}:${holiday.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function getGermanHolidaysInRange(start, end, stateCode = '') {
  if (!start || !end) return [];

  const startDate = new Date(`${String(start).slice(0, 10)}T00:00:00`);
  const endDate = new Date(`${String(end).slice(0, 10)}T00:00:00`);

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate < startDate) {
    return [];
  }

  const startYear = startDate.getFullYear();
  const endYear = endDate.getFullYear();
  const holidays = [];
  const startKey = format(startDate, 'yyyy-MM-dd');
  const endKey = format(endDate, 'yyyy-MM-dd');

  for (let year = startYear; year <= endYear; year += 1) {
    getGermanHolidays(year, stateCode).forEach((holiday) => {
      if (holiday.date >= startKey && holiday.date <= endKey) {
        holidays.push(holiday);
      }
    });
  }

  return holidays;
}