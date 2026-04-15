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

export function createTrackerId(date: Date): string {
  return formatDateToken(date, "YYYY-MM-DDTHH:mm:ss");
}

export function createTaskId(date: Date = new Date()): string {
  return `task-${formatDateToken(date, "YYYYMMDDHHmmss")}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export function createCaptureId(date: Date = new Date()): string {
  return `capture-${formatDateToken(date, "YYYYMMDDHHmmss")}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export function trackerAnchor(id: string): string {
  return `nexus-${id.replace(/[^0-9A-Za-z]/g, "").toLowerCase()}`;
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
