import { auth, currentUser } from "@clerk/nextjs/server";
import { prisma as db } from "@/lib/prisma";
import { redirect } from "next/navigation";

export async function getAdminAccess() {
  const user = await currentUser();

  if (!user) {
    return redirect("/sign-in");
  }

  const email = user.emailAddresses[0].emailAddress;

  const dbUser = await db.user.findUnique({
    where: { email: email }
  });

  if (!dbUser || dbUser.role !== "ADMIN") {
    return redirect("/dashboard");
  }

  return dbUser;
}
