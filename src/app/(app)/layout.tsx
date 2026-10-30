import Nav from "@/components/Nav";
import AssistantLauncher from "@/components/assistant/AssistantLauncher";
import { isAiEnabled } from "@/lib/ai/config";
import MotionPage from "@/components/MotionPage";
import { requireSession } from "@/lib/auth/server";
import { hasEverything } from "@/lib/access";

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
  // Name, admin flag and access are read from the database on every request,
  // so a rename or an access change shows up without signing out.
  const session = await requireSession();

  return (
    <div className="app-shell flex min-h-screen">
      <Nav name={session.name || session.email} isAdmin={session.isAdmin} access={session.access} />
      <main className="app-main flex-1 min-w-0 pt-14 md:pt-0">
        <MotionPage>{children}</MotionPage>
      </main>
      {/* Only with OPENROUTER_API_KEY set, and only for people who may see
          everything: the assistant can read every table. */}
      {isAiEnabled() && hasEverything(session.access) && <AssistantLauncher firstName={(session.name || "there").split(" ")[0]} />}
    </div>
  );
}
