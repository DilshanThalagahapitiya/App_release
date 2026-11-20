import type { Eligibility } from "./report-schema";

export interface ProjectRow {
  id: string; organisation_id: string; name: string; slug: string; description: string | null;
  app_display_name: string | null; expected_bundle_identifier: string | null; platform: string;
  icon_r2_key: string | null; default_qa_instructions: string | null; default_install_instructions: string | null;
  access_policy: "named_users_only" | "allow_protected_links"; feedback_enabled: number;
  status: "active" | "paused" | "archived"; created_by: string | null; created_at: string; updated_at: string;
}

export interface BuildRow {
  id: string; organisation_id: string; project_id: string; uploaded_by: string | null; original_filename: string;
  r2_object_key: string; file_size_bytes: number; sha256: string; app_name: string | null; bundle_identifier: string | null;
  version: string | null; build_number: string | null; minimum_os_version: string | null;
  supported_device_families_json: string | null; architectures_json: string | null;
  release_title: string | null; release_notes: string | null; internal_notes: string | null;
  declared_version: string | null; declared_build_number: string | null; distribution_method: string;
  external_install_url: string | null; validation_status: "pending" | "running" | "completed" | "failed";
  eligibility_status: Eligibility; processing_status: string; allow_download_when_ineligible: number;
  publish_status: "unpublished" | "published" | "archived"; uploaded_at: string; validated_at: string | null;
  published_at: string | null; archived_at: string | null; deleted_at: string | null; created_at: string; updated_at: string;
}

export interface LinkRow {
  id: string; organisation_id: string; project_id: string; build_id: string; created_by: string | null; token_hash: string;
  title: string; access_scope: "named_users" | "project_members" | "protected_link"; password_hash: string | null;
  expires_at: string | null; max_downloads: number | null; download_count: number; allow_download: number;
  allow_feedback: number; customer_release_notes: string | null; installation_guidance: string | null;
  status: "draft" | "active" | "revoked"; created_at: string; revoked_at: string | null;
}

export interface FeedbackRow {
  id: string; organisation_id: string; project_id: string; build_id: string | null; reporter_user_id: string | null;
  assigned_to_user_id: string | null; category: string; title: string; description: string; severity: string; status: string;
  device_model: string | null; ios_version: string | null; reproduction_steps: string | null; expected_result: string | null;
  actual_result: string | null; contact_preference: string; created_at: string; updated_at: string; resolved_at: string | null;
}
