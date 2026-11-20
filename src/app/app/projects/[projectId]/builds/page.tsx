"use client";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui";
import { BuildsTable } from "@/components/builds-table";

export default function ProjectBuilds() {
  const { projectId } = useParams<{ projectId: string }>();
  return (<div className="space-y-4"><div className="flex justify-end"><a href={`/app/projects/${projectId}/builds/upload`}><Button variant="primary">Upload build</Button></a></div><BuildsTable projectId={projectId} /></div>);
}
