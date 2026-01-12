import { Command } from "commander";
import { secretCreateCommand } from "./secret-create";

export const secretCommand = new Command("secret")
  .description("Manage secrets for app features");

secretCommand.addCommand(secretCreateCommand);
