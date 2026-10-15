import { z } from "zod";
import { daysBetween, durationLabel, formatDate } from "../dates";
import { clean, firstIssue, isoDate } from "./common";
import type { ReadTool } from "./types";

/** Nepal's clock, whatever time zone the server runs in. */
export const NEPAL_TIME_ZONE = "Asia/Kathmandu";

/** Today's date (YYYY-MM-DD), weekday and time in Nepal. */
export function nepalNow(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: NEPAL_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "long",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value])
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: parts.weekday,
    time: `${parts.hour}:${parts.minute} ${parts.dayPeriod}`,
  };
}

const schema = z.object({
  date: isoDate.optional().describe("A date to count the days to or from, if the user asked (e.g. 'how many days until 1 November')"),
});

export const getDateTime: ReadTool = {
  name: "get_date_time",
  label: "Date and time",
  kind: "read",
  permission: "member",
  description:
    "Today's date, the day of the week and the current time in Nepal, and optionally how many days until or since a date. Use for 'what is today's date', 'what day is it', 'what time is it', 'how many days until …'.",
  schema,
  async run(raw) {
    const parsed = schema.safeParse(clean(raw));
    if (!parsed.success) return { status: "error", summary: firstIssue(parsed.error) };
    const now = nepalNow();
    const items = [
      { label: "Today", value: `${now.weekday}, ${formatDate(now.date)}` },
      { label: "Time in Nepal", value: now.time },
    ];
    let extra = "";
    if (parsed.data.date && parsed.data.date !== now.date) {
      const days = daysBetween(now.date, parsed.data.date);
      const phrase = days === 0 ? "that is today" : days > 0 ? `${durationLabel(days)} from today` : `${durationLabel(-days)} ago`;
      items.push({ label: formatDate(parsed.data.date), value: phrase });
      extra = ` ${formatDate(parsed.data.date)}: ${phrase}.`;
    }
    return {
      status: "ok",
      summary: `Today is ${now.weekday}, ${formatDate(now.date)}, and it is ${now.time} in Nepal.${extra}`,
      cards: [{ type: "facts", title: "Date and time", items }],
      data: { ...now, time_zone: NEPAL_TIME_ZONE },
    };
  },
};
