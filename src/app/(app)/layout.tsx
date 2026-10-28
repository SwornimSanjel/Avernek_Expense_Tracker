import Nav from "@/components/Nav";
import AssistantLauncher from "@/components/assistant/AssistantLauncher";
import { isAiEnabled } from "@/lib/ai/config";
import MotionPage from "@/components/MotionPage";
import { requireSession } from "@/lib/auth/server";
import { one } from "@/lib/db";

/*
 * There is deliberately no loading.tsx in this folder. With one, Next.js 15
 * answers a change of filters on the same page (?period=year, ?status=paused,
 * ?client=…) by showing the cached page's skeleton and patching the real page
 * in afterwards — and on a streamed page that patch never landed, so filters
 * sat on "Updating…" forever. Without it every navigation fetches the whole
 * page in one request. The sidebar shows a spinner on the item being opened.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();

  // The cookie carries a name, but it is a snapshot from sign-in time; read the
  // current one so a rename in Settings shows up without signing out.
  const profile = await one<{ name: string; is_admin: boolean }>(
    `select name, is_admin from public.users where id = $1`,
    [session.sub]
  );

  return (
    <div className="app-shell flex min-h-screen">
      <Nav name={profile?.name ?? session.name ?? session.email} isAdmin={profile?.is_admin ?? session.isAdmin} />
      <main className="app-main flex-1 min-w-0 pt-14 md:pt-0">
        <MotionPage>{children}</MotionPage>
      </main>
      {/* Only with OPENROUTER_API_KEY set; without it the app is unchanged. */}
      {isAiEnabled() && <AssistantLauncher firstName={(profile?.name ?? session.name ?? "there").split(" ")[0]} />}
    </div>
  );
}
