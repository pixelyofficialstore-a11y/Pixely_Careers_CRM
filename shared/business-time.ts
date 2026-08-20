export const BUSINESS_TIME_ZONE = "Asia/Karachi";

type DateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function getDateTimeParts(date: Date, timeZone: string): DateTimeParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = getDateTimeParts(date, timeZone);
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  ) - date.getTime();
}

function getStartOfLocalPeriod(
  date: Date,
  timeZone: string,
  dayOfMonth: number,
): Date {
  const parts = getDateTimeParts(date, timeZone);
  const localMidnightAsUtc = new Date(
    Date.UTC(parts.year, parts.month - 1, dayOfMonth),
  );

  return new Date(
    localMidnightAsUtc.getTime() -
      getTimeZoneOffsetMs(localMidnightAsUtc, timeZone),
  );
}

export function getStartOfBusinessDay(date = new Date()): Date {
  return getStartOfLocalPeriod(date, BUSINESS_TIME_ZONE, getDateTimeParts(date, BUSINESS_TIME_ZONE).day);
}

export function getStartOfBusinessMonth(date = new Date()): Date {
  return getStartOfLocalPeriod(date, BUSINESS_TIME_ZONE, 1);
}

export function getMillisecondsUntilNextBusinessDay(date = new Date()): number {
  const parts = getDateTimeParts(date, BUSINESS_TIME_ZONE);
  const nextLocalMidnightAsUtc = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day + 1),
  );
  const nextMidnight = new Date(
    nextLocalMidnightAsUtc.getTime() -
      getTimeZoneOffsetMs(nextLocalMidnightAsUtc, BUSINESS_TIME_ZONE),
  );

  return Math.max(0, nextMidnight.getTime() - date.getTime());
}