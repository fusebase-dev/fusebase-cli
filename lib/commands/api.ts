import { Command } from "commander";
import {
  resolveOpenApiFile,
  validateOpenApiFile,
} from "../openapi";

const validateCommand = new Command("validate")
  .description("Validate the feature OpenAPI contract (Phase 1 MVP)")
  .option("-f, --file <path>", "Path to the OpenAPI spec file")
  .action(async (options: { file?: string }) => {
    const filePath = await resolveOpenApiFile(process.cwd(), options.file);

    if (!filePath) {
      console.error(
        "Error: OpenAPI spec not found. Expected openapi.json, openapi.yaml, or openapi.yml in the current directory.",
      );
      process.exit(1);
    }

    try {
      const result = await validateOpenApiFile(filePath);
      if (result.issues.length > 0) {
        console.error(`OpenAPI validation failed for ${result.filePath}`);
        for (const issue of result.issues) {
          console.error(`- ${issue.path}: ${issue.message}`);
        }
        process.exit(1);
      }

      console.log(`OpenAPI validation passed: ${result.filePath}`);
      console.log(`  title:      ${result.title}`);
      console.log(`  version:    ${result.version}`);
      console.log(`  operations: ${result.operationCount}`);
      if (result.operationIds.length > 0) {
        console.log(`  operationIds: ${result.operationIds.join(", ")}`);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown validation error";
      console.error(`Error: ${message}`);
      process.exit(1);
    }
  });

export const apiCommand = new Command("api")
  .description("App API contract utilities")
  .addCommand(validateCommand);
