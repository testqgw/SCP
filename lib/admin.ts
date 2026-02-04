import { auth, currentUser } from "@clerk/nextjs/server";
import { prisma as db } from "@/lib/prisma";
import { redirect } from "next/navigation";

const ADMIN_EMAILS = [
  "masterq@ultops.com",
  "quincygw@gmail.com",
  process.env.ADMIN_EMAIL
].filter(Boolean) as string[];

export async function getAdminAccess() {
  const user = await currentUser();

  if (!user) {
    return redirect("/sign-in");
  }

  const email = user.emailAddresses[0]?.emailAddress;

  // Check if email is in admin list
  if (email && ADMIN_EMAILS.includes(email)) {
    return { id: user.id, email, role: "ADMIN" };
  }

  // Also check database role
  const dbUser = await db.user.findUnique({
    where: { email: email }
  });

  if (dbUser?.role === "ADMIN") {
    return dbUser;
  }

  return redirect("/dashboard");
}
