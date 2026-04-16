import os from "os";
import { Command } from "commander";
import { sendCommandLog } from "./api";
import { getConfig, hasFlag, loadFuseConfig } from "./config";
import { VERSION } from "./version";

function getFullCommandName(cmd: Command): string {
  const names: string[] = [];
  let current: Command | null = cmd;
  while (current) {
    const name = current.name();
    if (name === "fusebase") break;
    names.unshift(name);
    current = current.parent;
  }
  return names.join(" ");
}

const MAX_COMMAND_ARGS_LENGTH = 4096;

function getCommandArgs(commandName: string): string | undefined {
  const allArgs = process.argv.slice(2);
  const commandParts = commandName.split(" ");

  let startIdx = 0;
  for (const part of commandParts) {
    if (allArgs[startIdx] === part) startIdx++;
  }

  const args = allArgs.slice(startIdx).join(" ");
  if (!args) return undefined;
  return args.substring(0, MAX_COMMAND_ARGS_LENGTH);
}

function instrumentCommand(cmd: Command): void {
  for (const sub of cmd.commands) {
    instrumentCommand(sub);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const originalAction = (cmd as any)._actionHandler;
  if (typeof originalAction !== "function") return;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (cmd as any)._actionHandler = async (...args: any[]) => {
    const startTime = Date.now();
    let success = true;
    let errorMessage: string | undefined;
    let errorStackTrace: string | undefined;

    try {
      await originalAction.call(cmd, ...args);
    } catch (err) {
      success = false;
      if (err instanceof Error) {
        errorMessage = err.message;
        errorStackTrace = err.stack;
      } else {
        errorMessage = String(err);
      }
      throw err;
    } finally {
      try {
        if (hasFlag("analytics")) {
          const duration = Date.now() - startTime;
          const commandName = getFullCommandName(cmd);
          const config = getConfig();
          const fuseConfig = loadFuseConfig();

          if (config.apiKey) {
            sendCommandLog(config.apiKey, {
              command: commandName,
              commandArgs: getCommandArgs(commandName),
              cliVersion: VERSION,
              os: os.platform(),
              osVersion: os.release(),
              appId: fuseConfig?.appId,
              orgId: fuseConfig?.orgId || "",
              duration,
              success,
              errorMessage,
              errorStackTrace,
            }).catch(() => {});
          }
        }
      } catch {
        // Prevent logging errors from masking the original command error
      }
    }
  };
}

/**
 * Recursively instrument all registered commands to send command logs
 * as fire-and-forget POST requests when the analytics flag is enabled.
 */
export function instrumentAllCommands(program: Command): void {
  instrumentCommand(program);
}
