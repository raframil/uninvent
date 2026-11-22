import { Button } from "@/components/ui/button";

const rows = [
  { name: "Northwind", plan: "Team" },
  { name: "Initech", plan: "Pro" },
];

export function CustomersPage() {
  return (
    <main>
      <header>
        <h1>Customers</h1>
        <Button>Invite</Button>
      </header>
      <ul>
        {rows.map((row) => (
          <li key={row.name}>
            {row.name} · {row.plan}
          </li>
        ))}
      </ul>
    </main>
  );
}
