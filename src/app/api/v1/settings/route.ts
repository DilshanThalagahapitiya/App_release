import { api } from "@/lib/http";
import { settingsSchema } from "@/lib/schemas";
import { forbidden } from "@/lib/errors";
import { getSettings, updateSettings } from "@/lib/settings";
import { emailConfigured } from "@/lib/email";
import { audit } from "@/lib/audit";
export const GET = api(async (c) => {
  const u = c.user();
  const s = await getSettings(c.env);
  const owner = u.isPlatformOwner;
  return { ...(owner ? s : { maxAttachmentBytes: s.maxAttachmentBytes, allowedAttachmentTypes: s.allowedAttachmentTypes, defaultLinkExpiryDays: s.defaultLinkExpiryDays }),
    emailConfigured: emailConfigured(c.env), turnstileConfigured: !!c.env.TURNSTILE_SECRET_KEY, canEdit: owner };
});
export const PUT = api(async (c) => {
  const u = c.user();
  if (!u.isPlatformOwner) throw forbidden("Only the Platform Owner can change platform settings.");
  const patch = await c.body(settingsSchema);
  const s = await updateSettings(c.env, patch, u.userId);
  await audit(c.env, { actorUserId: u.userId, action: "settings.updated", resourceType: "platform_settings", metadata: { fields: Object.keys(patch) }, req: c.req });
  return s;
});
