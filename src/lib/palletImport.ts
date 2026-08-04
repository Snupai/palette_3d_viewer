import type { PalletData } from "~/lib/palletTypes";
import { parseRobText } from "~/lib/robParser";

export type PalletImportFile = {
  name: string;
  text: () => Promise<string>;
};

export type ParsedPalletFile = {
  name: string;
  rawText: string;
  data: PalletData;
};

export type PalletImportDiagnostic = {
  fileName: string;
  line: number | null;
  reason: string;
};

export type PalletImportResult = {
  parsed: ParsedPalletFile[];
  diagnostics: PalletImportDiagnostic[];
};

function errorMessage(cause: unknown): string {
  return cause instanceof Error && cause.message.trim()
    ? cause.message.trim()
    : "Unknown error";
}

export function parserDiagnostic(
  fileName: string,
  cause: unknown,
): PalletImportDiagnostic {
  const message = errorMessage(cause);
  const match = /^\.rob line (\d+):\s*(.*)$/i.exec(message);
  return {
    fileName,
    line: match ? Number.parseInt(match[1]!, 10) : null,
    reason: match?.[2] ?? message,
  };
}

export async function parsePalletFiles(
  files: readonly PalletImportFile[],
): Promise<PalletImportResult> {
  const parsed: ParsedPalletFile[] = [];
  const diagnostics: PalletImportDiagnostic[] = [];

  for (const file of files) {
    let rawText: string;
    try {
      rawText = await file.text();
    } catch (cause) {
      diagnostics.push({
        fileName: file.name,
        line: null,
        reason: `Unable to read file: ${errorMessage(cause)}`,
      });
      continue;
    }

    try {
      parsed.push({
        name: file.name,
        rawText,
        data: parseRobText(rawText),
      });
    } catch (cause) {
      diagnostics.push(parserDiagnostic(file.name, cause));
    }
  }

  return { parsed, diagnostics };
}

export function formatImportDiagnostics(
  diagnostics: readonly PalletImportDiagnostic[],
): string | null {
  if (diagnostics.length === 0) return null;
  const grouped = new Map<string, PalletImportDiagnostic[]>();
  diagnostics.forEach((diagnostic) => {
    const entries = grouped.get(diagnostic.fileName) ?? [];
    entries.push(diagnostic);
    grouped.set(diagnostic.fileName, entries);
  });

  const lines = ["Some files could not be imported:"];
  grouped.forEach((entries, fileName) => {
    lines.push(`• ${fileName}`);
    entries.forEach((entry) => {
      lines.push(
        `  ${entry.line === null ? "" : `Line ${entry.line}: `}${entry.reason}`,
      );
    });
  });
  return lines.join("\n");
}
