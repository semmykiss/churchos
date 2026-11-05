// Verify owners of remaining giving records + portal login sanity
import { db } from "../src/server/db";

const pledgeOwners = await db.pledge.findMany({ select: { person: { select: { firstName: true, lastName: true } } } });
console.log("remaining pledge owners:", pledgeOwners.map((p) => `${p.person.firstName} ${p.person.lastName}`));

const donationOwners = await db.donation.groupBy({ by: ["personId"], _count: { _all: true } });
const persons = await db.person.findMany({ select: { id: true, firstName: true, lastName: true } });
const nameOf = (id: string | null) => persons.find((p) => p.id === id)?.firstName ?? (id ? "UNKNOWN!" : "(anonymous/no person)");
for (const d of donationOwners) console.log(`donations person=${nameOf(d.personId)}: ${d._count._all}`);

await db.$disconnect();
