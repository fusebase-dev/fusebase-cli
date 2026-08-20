import { Command } from "commander";
import chalk from "chalk";
import { fetchOrgs } from "../api.ts";
import { getConfig } from "../config.ts";

export const orgsListCommand = new Command("list")
  .description("List organizations you belong to")
  .option("--json", "Print the organizations as JSON")
  .action(async (options: { json?: boolean }) => {
    const config = getConfig();

    if (!config.apiKey) {
      console.error("Error: Not authenticated. Run 'fusebase auth' or 'fusebase auth --api-key=<apiKey>' first.");
      process.exit(1);
    }

    let organizations;
    try {
      ({ organizations } = await fetchOrgs(config.apiKey));
    } catch (error) {
      console.error(`Error: Failed to fetch organizations. ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }

    if (options.json) {
      console.log(JSON.stringify(organizations, null, 2));
      return;
    }

    if (organizations.length === 0) {
      console.log("No organizations found.");
      return;
    }

    console.log("\nOrganizations:\n");
    for (const org of organizations) {
      console.log(`  ${org.title} ${chalk.dim(`(${org.id})`)}`);
    }
    console.log(`\nTotal: ${organizations.length} organization(s)`);
  });

export const orgsCommand = new Command("orgs").description("Organization commands");

orgsCommand.addCommand(orgsListCommand);
