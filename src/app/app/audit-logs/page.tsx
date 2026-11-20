"use client";
import { PageHeader } from "@/components/ui";
import { AuditTable } from "@/components/audit-table";
export default function Page() { return (<><PageHeader title="Activity & audit logs" description="Privileged actions, authentication events and distribution activity. IP addresses are stored only as salted hashes." /><AuditTable /></>); }
