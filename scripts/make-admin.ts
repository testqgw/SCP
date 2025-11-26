const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();

async function main() {
    // Replace this with your email
    const email = "quincygw@gmail.com";

    console.log(`Checking for user with email: ${email}...`);

    const user = await db.user.findUnique({
        where: { email: email },
    });

    if (!user) {
        console.error("User not found! Make sure you have signed up first.");
        return;
    }

    await db.user.update({
        where: { email: email },
        data: { role: "ADMIN" }
    });
    console.log("👑 User promoted to ADMIN");
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await db.$disconnect();
    });
