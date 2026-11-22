import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const rows = [
  { name: "Northwind", plan: "Team" },
  { name: "Initech", plan: "Pro" },
];

/** A screen that already uses the design system. `uninvent check` stays silent here. */
export function CustomersPage() {
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 p-8">
      <PageHeader
        title="Customers"
        description="Accounts built with the system, not around it."
        actions={<Button>Invite</Button>}
      />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Plan</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.name}>
              <TableCell>{row.name}</TableCell>
              <TableCell>{row.plan}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </main>
  );
}
