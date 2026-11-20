"use client";
import { useParams } from "next/navigation";
import { FeedbackDetail } from "@/components/feedback-detail";
export default function Page() { const { feedbackId } = useParams<{ feedbackId: string }>(); return <FeedbackDetail id={feedbackId} back="/portal/feedback" />; }
