import { Command } from "commander";
import { featureCreateCommand } from "./feature-create";
import { featureGetCommand } from "./feature-get";
import { featureListCommand } from "./feature-list";
import { featureUpdateCommand } from "./feature-update";

export const featureCommand = new Command("feature")
  .description("Feature management commands for Fusebase apps");

featureCommand.addCommand(featureCreateCommand);
featureCommand.addCommand(featureGetCommand);
featureCommand.addCommand(featureListCommand);
featureCommand.addCommand(featureUpdateCommand);
