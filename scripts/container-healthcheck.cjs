const port = process.env.PORT || "3000";
fetch(`http://127.0.0.1:${port}/`, {
  signal: AbortSignal.timeout(4000),
}).then(
  response => process.exit(response.ok ? 0 : 1),
  () => process.exit(1),
);
