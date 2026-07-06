import { Command } from "commander";
import { secretCreateCommand } from "./secret-create";
import { secretDeleteCommand } from "./secret-delete";

export const secretCommand = new Command("secret")
  .description("Manage declared secret keys for product apps (values set in UI)");

secretCommand.addCommand(secretCreateCommand);
secretCommand.addCommand(secretDeleteCommand);
