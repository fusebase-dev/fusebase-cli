import { Command } from "commander";
import { appCreateCommand } from "./app-create";
import { appGetCommand } from "./app-get";
import { appListCommand } from "./app-list";
import { appPortalEmbedsCommand } from "./app-portal-embeds";
import { appUpdateCommand } from "./app-update";

export const appCommand = new Command("app")
  .description("App management commands for the current Fusebase product");

appCommand.addCommand(appCreateCommand);
appCommand.addCommand(appGetCommand);
appCommand.addCommand(appListCommand);
appCommand.addCommand(appPortalEmbedsCommand);
appCommand.addCommand(appUpdateCommand);
