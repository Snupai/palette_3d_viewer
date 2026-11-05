import { createInterface } from "node:readline";

/**
 * Hidden prompt: readline with its echo muted. Lines are pulled from one
 * async iterator, so piped input (`printf 'pw\npw\n' | …`) is buffered and
 * not lost between the password and its confirmation.
 */
export function createHiddenPrompt() {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: process.stdin.isTTY === true,
  });
  // Suppress readline's echo of typed characters (private but stable API).
  (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput =
    () => undefined;
  rl.on("SIGINT", () => {
    process.stdout.write("\n");
    rl.close();
    process.exit(130);
  });
  const lines = rl[Symbol.asyncIterator]();
  return {
    prompt: async (label: string) => {
      process.stdout.write(label);
      const next = await lines.next();
      process.stdout.write("\n");
      if (next.done) throw new Error("no password given (end of input)");
      return next.value;
    },
    close: () => rl.close(),
  };
}
