"use client";
import { PageHeader, Button } from "@/components/ui";
import { FeedbackTable } from "@/components/feedback-table";
export default function MyFeedback() { return (<><PageHeader title="QA feedback" description="Issues you've reported and their status." actions={<a href="/portal/feedback/new"><Button variant="primary">Report an issue</Button></a>} /><FeedbackTable base="/portal/feedback" showReporter={false} /></>); }
