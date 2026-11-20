"use client";
import { useParams } from "next/navigation";
import { FeedbackTable } from "@/components/feedback-table";
export default function ProjectFeedback() { const { projectId } = useParams<{ projectId: string }>(); return <FeedbackTable projectId={projectId} base="/app/feedback" />; }
