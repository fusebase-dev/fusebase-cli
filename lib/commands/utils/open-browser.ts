import open from "open";
import { logger } from "../../logger";

export function openBrowser(url: string) {
  logger.info('Opening browser with url: %s', url);
  open(url);
}
