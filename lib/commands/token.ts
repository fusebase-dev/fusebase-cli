import { Command } from "commander";
import { tokenCreateCommand } from "./token-create";

export const tokenCommand = new Command("token").description(
  "Manage product development tokens",
);

tokenCommand.addCommand(tokenCreateCommand);
