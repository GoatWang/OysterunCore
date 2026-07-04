const WEEKDAY_INDEX = Object.freeze({
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
});

function normalizeRequiredString(value, fieldName) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
  return value.trim();
}

function normalizeOptionalString(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return String(value).trim() || null;
  return value.trim() || null;
}

function assertValidDate(date, fieldName) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new Error(`${fieldName} must be a valid date/time`);
  }
}

export function getHostSystemTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function normalizeHostTimezone(value = null) {
  const timezone = normalizeOptionalString(value) || getHostSystemTimezone();
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
  } catch (err) {
    throw new Error(`Unsupported Host timezone ${timezone}: ${err.message}`);
  }
  return timezone;
}

function getZonedParts(date, timezone) {
  assertValidDate(date, "date");
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value])
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function getTimezoneOffsetMs(timezone, date) {
  const parts = getZonedParts(date, timezone);
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return localAsUtc - date.getTime();
}

function zonedLocalToUtcIso(timezone, parts) {
  let utcMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second || 0
  );
  for (let i = 0; i < 4; i += 1) {
    const offsetMs = getTimezoneOffsetMs(timezone, new Date(utcMs));
    const nextUtcMs =
      Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day,
        parts.hour,
        parts.minute,
        parts.second || 0
      ) - offsetMs;
    if (nextUtcMs === utcMs) break;
    utcMs = nextUtcMs;
  }
  return new Date(utcMs).toISOString();
}

function parseTimeOfDay(value) {
  const normalized = normalizeRequiredString(value, "schedule time");
  const match = normalized.match(/^([01]?[0-9]|2[0-3]):([0-5][0-9])$/);
  if (!match) {
    throw new Error("schedule time must use HH:mm");
  }
  return {
    token: `${match[1].padStart(2, "0")}:${match[2]}`,
    hour: Number(match[1]),
    minute: Number(match[2]),
  };
}

function parseIsoOrLocalDateTime(value, timezone) {
  const normalized = normalizeRequiredString(value, "schedule date/time");
  if (/[zZ]|[+-][0-9]{2}:[0-9]{2}$/.test(normalized)) {
    const date = new Date(normalized);
    assertValidDate(date, "schedule date/time");
    return date.toISOString();
  }
  const match = normalized.match(
    /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2})(?::([0-9]{2}))?$/
  );
  if (!match) {
    throw new Error("schedule date/time must be ISO or local YYYY-MM-DDTHH:mm");
  }
  return zonedLocalToUtcIso(timezone, {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] || 0),
  });
}

function addLocalDays(parts, days) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  date.setUTCDate(date.getUTCDate() + days);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function localWeekdayIndex(parts) {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

function normalizeWeekday(value) {
  if (Number.isInteger(value) && value >= 0 && value <= 6) return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (/^[0-6]$/.test(normalized)) return Number(normalized);
    if (Object.prototype.hasOwnProperty.call(WEEKDAY_INDEX, normalized)) {
      return WEEKDAY_INDEX[normalized];
    }
  }
  throw new Error(`Unsupported weekday: ${value}`);
}

function normalizeWeekdays(value) {
  const raw = Array.isArray(value) ? value : [value];
  const weekdays = [...new Set(raw.map(normalizeWeekday))].sort(
    (a, b) => a - b
  );
  if (weekdays.length === 0) {
    throw new Error("weekly schedules require at least one weekday");
  }
  return weekdays;
}

function normalizeDayOfMonth(value) {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
      ? Number(value.trim())
      : NaN;
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 31) {
    return numeric;
  }
  throw new Error(`Unsupported day of month: ${value}`);
}

function getDaysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function normalizeScheduleRule(input, { timezone = null } = {}) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("schedule rule must be an object");
  }
  const normalizedTimezone = normalizeHostTimezone(input.timezone || timezone);
  const rawType = normalizeRequiredString(
    input.type || input.frequency,
    "schedule rule type"
  ).toLowerCase();
  const type = rawType === "every_tuesday" ? "weekly" : rawType;
  if (type === "daily") {
    const time = parseTimeOfDay(
      input.time || input.local_time || input.time_of_day
    );
    return {
      type: "daily",
      time: time.token,
      timezone: normalizedTimezone,
      missed_run_policy: "skip_without_catch_up",
    };
  }
  if (type === "weekly") {
    const time = parseTimeOfDay(
      input.time || input.local_time || input.time_of_day
    );
    const weekdaySource =
      rawType === "every_tuesday"
        ? "tuesday"
        : input.weekdays ||
          input.selected_weekdays ||
          input.weekday ||
          input.day;
    return {
      type: "weekly",
      weekdays: normalizeWeekdays(weekdaySource),
      time: time.token,
      timezone: normalizedTimezone,
      missed_run_policy: "skip_without_catch_up",
    };
  }
  if (type === "monthly") {
    const time = parseTimeOfDay(
      input.time || input.local_time || input.time_of_day
    );
    return {
      type: "monthly",
      day_of_month: normalizeDayOfMonth(
        input.day_of_month ?? input.month_day ?? input.day ?? 1
      ),
      time: time.token,
      timezone: normalizedTimezone,
      missed_run_policy: "skip_without_catch_up",
    };
  }
  if (type === "once") {
    const at = parseIsoOrLocalDateTime(
      input.at || input.run_at || input.datetime || input.local_datetime,
      normalizedTimezone
    );
    return {
      type: "once",
      at,
      timezone: normalizedTimezone,
      missed_run_policy: "skip_without_catch_up",
    };
  }
  throw new Error(`Unsupported schedule rule type: ${rawType}`);
}

export function computeNextScheduleRunAt(
  rule,
  { after = new Date(), timezone = null } = {}
) {
  const normalizedRule = normalizeScheduleRule(rule, { timezone });
  const afterDate = after instanceof Date ? after : new Date(after);
  assertValidDate(afterDate, "after");
  const afterMs = afterDate.getTime();
  if (normalizedRule.type === "once") {
    return Date.parse(normalizedRule.at) > afterMs ? normalizedRule.at : null;
  }
  const time = parseTimeOfDay(normalizedRule.time);
  const afterLocal = getZonedParts(afterDate, normalizedRule.timezone);
  if (normalizedRule.type === "monthly") {
    for (let offset = 0; offset <= 24; offset += 1) {
      const monthIndex = afterLocal.month - 1 + offset;
      const year = afterLocal.year + Math.floor(monthIndex / 12);
      const month = (monthIndex % 12) + 1;
      const day = Math.min(
        normalizedRule.day_of_month,
        getDaysInMonth(year, month)
      );
      const candidate = zonedLocalToUtcIso(normalizedRule.timezone, {
        year,
        month,
        day,
        hour: time.hour,
        minute: time.minute,
        second: 0,
      });
      if (Date.parse(candidate) > afterMs) return candidate;
    }
    throw new Error("Unable to compute next monthly schedule occurrence");
  }
  const targetWeekdays =
    normalizedRule.type === "weekly" ? normalizedRule.weekdays : null;
  const searchDays = normalizedRule.type === "weekly" ? 14 : 2;
  for (let offset = 0; offset <= searchDays; offset += 1) {
    const localDate = addLocalDays(afterLocal, offset);
    if (
      targetWeekdays &&
      !targetWeekdays.includes(localWeekdayIndex(localDate))
    ) {
      continue;
    }
    const candidate = zonedLocalToUtcIso(normalizedRule.timezone, {
      ...localDate,
      hour: time.hour,
      minute: time.minute,
      second: 0,
    });
    if (Date.parse(candidate) > afterMs) return candidate;
  }
  throw new Error("Unable to compute next schedule occurrence");
}

export function serializeScheduleRuleForSummary(rule) {
  const normalizedRule = normalizeScheduleRule(rule);
  return {
    ...normalizedRule,
    host_timezone_source: "Intl.DateTimeFormat().resolvedOptions().timeZone",
    catch_up_burst: false,
  };
}
