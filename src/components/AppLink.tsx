import Link from "next/link";
import type { ComponentProps } from "react";

/**
 * Every in-app link. Prefetching is off on purpose.
 *
 * Each page here is rendered per request, so a prefetched link carries the
 * page's outline but not its data. Next.js 15 then fetches the data after the
 * click and patches it in with a separate update, which it applies to whatever
 * page is on screen by then: clicking Expenses → Other income → Expenses
 * quickly left the address and the sidebar on Expenses while Other income
 * showed. Without the prefetch, a click fetches the whole page in one request,
 * and a newer click cancels an older one, so the page always matches the
 * address. See also the note in (app)/layout.tsx.
 */
export default function AppLink(props: ComponentProps<typeof Link>) {
  return <Link prefetch={false} {...props} />;
}
