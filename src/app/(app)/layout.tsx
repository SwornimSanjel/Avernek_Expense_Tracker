import Nav from "@/components/Nav";
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
  const profile = await one<{ name: string }>(
    `select name from public.users where id = $1`,
    [session.sub]
  );

  return (
    <div className="flex min-h-screen">
      <Nav name={profile?.name ?? session.name ?? session.email} />
      <main className="flex-1 min-w-0 pt-16 pb-20 md:pt-0 md:pb-0">
        <div className="max-w-5xl mx-auto px-4 md:px-8 py-6">{children}</div>
      </main>
    </div>
  );
}
