// Test stub: the real module needs the Workers runtime. Tests inject env via __setTestEnv instead.
export async function getCloudflareContext(): Promise<never> {
  throw new Error("getCloudflareContext should not be called in tests; use __setTestEnv");
}
export function initOpenNextCloudflareForDev() {}
