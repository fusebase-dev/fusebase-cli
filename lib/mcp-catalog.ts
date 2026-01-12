import type { McpServerCatalogEntry } from "../ide-configs/mcp-servers";

/**
 * **Flag gate (primary).** If `entry.flag` is set, the entry is ignored unless that
 * flag is enabled in ~/.fusebase/config.json (`fusebase config set-flag`).
 * When this returns `false`, the server is not treated as required or optional anywhere.
 *
 * **`required` only applies after a successful flag check:** if `entry.flag` is
 * absent or empty, the entry is active; then `required` vs optional logic applies.
 */
export function isMcpCatalogEntryActive(
  entry: McpServerCatalogEntry,
  hasFlag: (flag: string) => boolean,
): boolean {
  const f = entry.flag?.trim();
  if (!f) return true;
  return hasFlag(f);
}
