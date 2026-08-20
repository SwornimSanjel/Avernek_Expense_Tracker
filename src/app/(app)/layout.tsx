import Nav from "@/components/Nav";
import MotionPage from "@/components/MotionPage";
import { requireSession } from "@/lib/auth/server";
import { one } from "@/lib/db";

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
      <main className="app-main flex-1 min-w-0 pt-16 md:pt-0">
        <MotionPage>{children}</MotionPage>
      </main>
    </div>
  );
}
