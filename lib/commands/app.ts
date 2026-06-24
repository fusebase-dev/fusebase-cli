import { Command } from "commander";
import { appCreateCommand } from "./app-create";
import { appGetCommand } from "./app-get";
import { appListCommand } from "./app-list";
import { appPortalEmbedsCommand } from "./app-portal-embeds";
import { appUpdateCommand } from "./app-update";
import { hasFlag } from "../config.ts";

export const appCommand = new Command("app")
  .description("App management commands for the current Fusebase product");

appCommand.addCommand(appCreateCommand);
appCommand.addCommand(appGetCommand);
appCommand.addCommand(appListCommand);
if (hasFlag("app-portal-embeds-list")) {
  appCommand.addCommand(appPortalEmbedsCommand);
}
appCommand.addCommand(appUpdateCommand);
