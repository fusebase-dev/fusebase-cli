import { Command } from "commander";
import { secretCreateCommand } from "./secret-create";

export const secretCommand = new Command("secret")
  .description("Manage secrets for product apps");

secretCommand.addCommand(secretCreateCommand);
