export function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

export function formatDateToken(date: Date, format: string): string {
  const map: Record<string, string> = {
    YYYY: date.getFullYear().toString(),
    MM: pad(date.getMonth() + 1),
    DD: pad(date.getDate()),
    HH: pad(date.getHours()),
    mm: pad(date.getMinutes()),
    ss: pad(date.getSeconds())
  };

  return Object.entries(map).reduce((output, [token, tokenValue]) => {
    return output.split(token).join(tokenValue);
  }, format);
}

export function getDateStamp(date: Date): string {
  return formatDateToken(date, "YYYY-MM-DD");
}

export function getTimeStamp(date: Date): string {
  return formatDateToken(date, "HH:mm");
}

export function getDateTimeStamp(date: Date): string {
  return formatDateToken(date, "YYYY-MM-DD HH:mm");
}

function createCompactId(prefix: string, date: Date = new Date()): string {
  const timeToken = date.getTime().toString(36);
  const randomToken = Math.random().toString(36).slice(2, 4);
  return `${prefix}-${timeToken}${randomToken}`;
}

export function createTrackerId(date: Date): string {
  return formatDateToken(date, "YYYY-MM-DDTHH:mm:ss");
}

export function createTaskId(date: Date = new Date()): string {
  return createCompactId("t", date);
}

export function createCaptureId(date: Date = new Date()): string {
  return createCompactId("c", date);
}

export function trackerAnchor(id: string): string {
  return `p-${id.replace(/[^0-9]/g, "").slice(4, 14)}`;
}

export function formatTimelineLabel(id: string): string {
  const [datePart, timePart = "00:00:00"] = id.split("T");
  const [, month, day] = datePart.split("-");
  const [hour, minute] = timePart.split(":");
  return `${Number(month)}-${Number(day)} ${hour}:${minute}`;
}

export function parseDateStamp(value: string): Date {
  return new Date(`${value}T00:00:00`);
}

export function getDaysSince(value: string, now: Date = new Date()): number {
  const start = parseDateStamp(value).getTime();
  const today = parseDateStamp(getDateStamp(now)).getTime();
  const diff = today - start;
  return Math.max(0, Math.floor(diff / 86_400_000));
}
