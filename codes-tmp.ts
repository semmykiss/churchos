import { db } from "./src/server/db";
const rows = await db.eventRegistration.findMany({ select: { qrToken: true, status: true, quantity: true, checkedInSeats: true, event: { select: { name: true } } }, take: 20, orderBy: { createdAt: "desc" } });
console.log(rows.map(r => `${r.qrToken} ${r.status} ${r.checkedInSeats}/${r.quantity} — ${r.event.name}`).join("\n"));
process.exit(0);
