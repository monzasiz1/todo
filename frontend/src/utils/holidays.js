import { addDays, format } from 'date-fns';

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

export function getGermanNationalHolidaysInRange(start, end) {
  if (!start || !end) return [];

  const startDate = new Date(`${String(start).slice(0, 10)}T00:00:00`);
  const endDate = new Date(`${String(end).slice(0, 10)}T00:00:00`);

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate < startDate) {
    return [];
  }

  const startYear = startDate.getFullYear();
  const endYear = endDate.getFullYear();
  const holidays = [];

  for (let year = startYear; year <= endYear; year += 1) {
    getGermanNationalHolidays(year).forEach((holiday) => {
      if (holiday.date >= format(startDate, 'yyyy-MM-dd') && holiday.date <= format(endDate, 'yyyy-MM-dd')) {
        holidays.push(holiday);
      }
    });
  }

  return holidays;
}