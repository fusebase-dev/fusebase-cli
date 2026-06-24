import { Command } from "commander";
import { fetchApp, fetchProductAppPortalEmbeds } from "../api.ts";
import { getConfig, loadFuseConfig } from "../config.ts";

export async function runAppPortalEmbeds(appIdArg: string): Promise<void> {
  const config = getConfig();
  const fuseConfig = loadFuseConfig();

  if (!config.apiKey) {
    console.error("Error: Not authenticated. Run 'fusebase auth' or 'fusebase auth --api-key=<apiKey>' first.");
    process.exit(1);
  }

  if (!fuseConfig) {
    console.error("Error: No fusebase.json found. Run 'fusebase init' first.");
    process.exit(1);
  }

  const { orgId, productId } = fuseConfig;

  if (!orgId || !productId) {
    console.error("Error: fusebase.json is missing orgId or productId.");
    process.exit(1);
  }

  try {
    await fetchApp(config.apiKey, orgId, productId, appIdArg);
    const response = await fetchProductAppPortalEmbeds(
      config.apiKey,
      orgId,
      productId,
      appIdArg,
    );

    if (response.portalEmbeds.length === 0) {
      console.log("No portal embeds found for this app.");
      return;
    }

    console.log("\nPortal embeds:\n");

    for (const embed of response.portalEmbeds) {
      console.log(`Portal: ${embed.portal.name}`);
      if (embed.page.title) {
        console.log(`Page: ${embed.page.title}`);
      }
      console.log(`URL: ${embed.url}\n`);
    }

    console.log(`Total: ${response.portalEmbeds.length} portal page(s)`);
  } catch (error) {
    console.error(`Error: Failed to fetch app portal embeds. ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

export const appPortalEmbedsCommand = new Command("portal-embeds")
  .description("List portal pages where an app is embedded")
  .argument("<appId>", "App ID to list portal embeds for")
  .action(runAppPortalEmbeds);
