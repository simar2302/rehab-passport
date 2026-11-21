import { BUILTIN_EXERCISES } from "./exercises";
import { doseIn } from "./i18n";
import type { Data, Exercise, LogEntry, Passport, PassportItem } from "./types";

export function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// Local calendar date as YYYY-MM-DD (not UTC, so "today" matches the wall clock).
export function dateKey(d: Date = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function parseKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key: string, n: number): string {
  const d = parseKey(key);
  d.setDate(d.getDate() + n);
  return dateKey(d);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((parseKey(b).getTime() - parseKey(a).getTime()) / 86400000);
}

// The year is shown only when it is not the current one: "Nov 20", "Jan 3, 2027".
export function fmtDate(key: string): string {
  const d = parseKey(key);
  const year = d.getFullYear() === new Date().getFullYear() ? undefined : "numeric";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year });
}

export function fmtDay(key: string): string {
  return parseKey(key).toLocaleDateString(undefined, { weekday: "short", day: "numeric" });
}

export function allExercises(data: Data): Exercise[] {
  return [...BUILTIN_EXERCISES, ...data.exercises];
}

export function findExercise(data: Data, id: string): Exercise | undefined {
  return allExercises(data).find((e) => e.id === id);
}

export function doseText(item: Pick<PassportItem, "sets" | "reps" | "perDay" | "hold">): string {
  return doseIn(item, "en");
}

export function activePassport(data: Data, patientId: string): Passport | undefined {
  return data.passports.find((p) => p.patientId === patientId && p.status === "active");
}

// Days a passport version has been in use, from its start up to today (or its end).
export function passportDays(p: Passport, today = dateKey()): string[] {
  const last = p.endDate && p.endDate < today ? addDays(p.endDate, -1) : today;
  const n = daysBetween(p.startDate, last);
  const days: string[] = [];
  for (let i = 0; i <= n; i++) days.push(addDays(p.startDate, i));
  return days;
}

export type Adherence = { done: number; expected: number; pct: number | null };

export function adherence(p: Passport, logs: LogEntry[], days?: string[]): Adherence {
  const range = days ?? passportDays(p);
  const set = new Set(range);
  const done = logs.filter((l) => l.passportId === p.id && set.has(l.date)).length;
  const expected = range.length * p.items.length;
  return { done, expected, pct: expected ? Math.round((done / expected) * 100) : null };
}

export function isDone(logs: LogEntry[], passportId: string, itemId: string, date: string): boolean {
  return logs.some((l) => l.passportId === passportId && l.itemId === itemId && l.date === date);
}

/** Secret for a patient's phone link (unguessable, URL-safe). */
export function newToken(): string {
  return uid().replace(/-/g, "");
}

// Deterministic ids: a tick or pain score for the same day from the phone and
// from the clinic land on the same row instead of duplicating.
export const logId = (passportId: string, itemId: string, date: string) => `${passportId}:${itemId}:${date}`;
export const painId = (passportId: string, date: string) => `${passportId}:${date}`;

/** Date of the last review of this passport version up to today, if any. */
export function lastReviewDate(reviews: { passportId: string; date: string }[], p: Passport, today = dateKey()): string | undefined {
  return reviews
    .filter((r) => r.passportId === p.id && r.date <= today)
    .map((r) => r.date)
    .sort()
    .at(-1);
}

/** Next follow-up date: the therapist's appointment, else 14 days after the last visit. */
export function nextReviewDate(data: Pick<Data, "reviews">, p: Passport): string {
  if (p.nextVisit) return p.nextVisit.slice(0, 10);
  return addDays(lastReviewDate(data.reviews, p) ?? p.startDate, 14);
}

/** Default appointment: two weeks from `from` at 10:00. */
export function defaultVisit(from = dateKey()): string {
  return `${addDays(from, 14)}T10:00`;
}

/**
 * The current visit period: from the last visit (review, or the day this
 * passport version started) to the next appointment. Progress, the tick grid
 * and the patient's phone are all organised around this window.
 */
export function visitPeriod(data: Pick<Data, "reviews">, p: Passport, today = dateKey()) {
  const start = lastReviewDate(data.reviews, p, today) ?? p.startDate;
  const visit = nextReviewDate(data, p);
  const end = visit > start ? visit : addDays(start, 14);
  const n = Math.min(daysBetween(start, end), 41);
  const days = Array.from({ length: n + 1 }, (_, i) => addDays(start, i));
  const elapsed = days.filter((d) => d <= today && (!p.endDate || d < p.endDate));
  return { start, end, visit, days, elapsed, daysLeft: Math.max(0, daysBetween(today, visit)), overdue: visit < today };
}

export function fmtTime(nextVisit?: string): string {
  return nextVisit && nextVisit.length > 10 ? nextVisit.slice(11, 16) : "";
}

/** Highest pain score reported in the last `days` days for this passport. */
export function recentMaxPain(pain: { passportId: string; date: string; score: number }[], p: Passport, days = 3, today = dateKey()): number | null {
  const from = addDays(today, -(days - 1));
  const scores = pain.filter((x) => x.passportId === p.id && x.date >= from && x.date <= today).map((x) => x.score);
  return scores.length ? Math.max(...scores) : null;
}

export function youtubeEmbed(url: string): string | null {
  try {
    const u = new URL(url);
    let id: string | null = null;
    if (u.hostname.includes("youtu.be")) id = u.pathname.slice(1);
    else if (u.hostname.includes("youtube.com")) {
      id = u.searchParams.get("v");
      if (!id && u.pathname.startsWith("/shorts/")) id = u.pathname.split("/")[2];
      if (!id && u.pathname.startsWith("/embed/")) id = u.pathname.split("/")[2];
    }
    return id ? `https://www.youtube-nocookie.com/embed/${id}` : null;
  } catch {
    return null;
  }
}
