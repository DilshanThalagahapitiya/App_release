"use client";
import { PageHeader } from "@/components/ui";
import { FeedbackTable } from "@/components/feedback-table";
export default function Page() { return (<><PageHeader title="QA feedback" description="Issues reported by testers and customers across your projects." /><FeedbackTable base="/app/feedback" /></>); }
