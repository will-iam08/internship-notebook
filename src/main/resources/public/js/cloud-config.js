export function readCloudConfig() {
  const config = globalThis.window?.__SUPABASE__;
  return {
    url: typeof config?.url === "string" ? config.url.trim() : "",
    anonKey: typeof config?.anonKey === "string" ? config.anonKey.trim() : ""
  };
}
