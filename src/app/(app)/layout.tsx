import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Nav from "@/components/Nav";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("users")
    .select("name")
    .eq("id", user.id)
    .single();

  return (
    <div className="flex min-h-screen">
      <Nav name={profile?.name ?? user.email ?? "Team"} />
      <main className="flex-1 min-w-0 pt-16 pb-20 md:pt-0 md:pb-0">
        <div className="max-w-5xl mx-auto px-4 md:px-8 py-6">{children}</div>
      </main>
    </div>
  );
}
