// The plugin version, injected by esbuild (build.mjs `define`) from server/package.json.
// `npm run check-version` (also run by `prebuild` and CI) keeps package.json equal to
// .claude-plugin/plugin.json, so every user-agent and serverInfo string agrees with
// the manifest. Falls back to "dev" when the source runs unbundled.
declare const __NYQUEST_VERSION__: string | undefined;

export const VERSION: string = typeof __NYQUEST_VERSION__ === "string" ? __NYQUEST_VERSION__ : "dev";
