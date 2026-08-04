export function rotateRobPlanBy180(rawText: string): string {
  const newline = rawText.includes("\r\n") ? "\r\n" : "\n";
  const lines = rawText.split(/\r?\n/);
  const coordinatePattern = /^(\s*-?\d+(?:\s+-?\d+){4}\s+)(-?\d+)(.*)$/;

  return lines
    .map((line) => {
      if (!coordinatePattern.test(line)) return line;
      return line.replace(
        coordinatePattern,
        (_full, prefix: string, rotationRaw: string, suffix: string) => {
          const rotation = Number.parseInt(rotationRaw, 10);
          if (!Number.isFinite(rotation)) return line;
          return `${prefix}${(((rotation + 180) % 360) + 360) % 360}${suffix}`;
        },
      );
    })
    .join(newline);
}
