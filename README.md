# Pallet 3D Viewer

Import, inspect, and edit `.rob` pallet plans in the browser.

## Features

- Interactive Three.js 3D view with package selection
- Layer rail for controlling the visible stack cutoff
- 2D edit mode for package grips and interlayers
- Local pallet library persisted in IndexedDB
- Raw `.rob` text retained for round-trip editing and downloads

## Requirements

This project uses [Bun](https://bun.sh/) as its package manager. The pinned
version is `bun@1.3.14`, as declared by the `packageManager` field in
`package.json`.

## Development

```sh
bun install
bun run dev
```

Open `http://localhost:3000` and import a `.rob` file.

Available verification commands:

```sh
bun run test:run
bun run typecheck
bun run lint
bun run format:check
bun run build
```

## Supported `.rob` invariants

- Blank lines are positionally significant and are preserved while parsing.
- Package coordinates are integers.
- Supported package rotations are `0`, `90`, `180`, and `270` degrees.
- Each `Zwischenlage` contributes 3 mm to the stack height.
- Imported raw text is retained so plans can be parsed again and round-tripped
  without discarding source formatting.

## Stack

Next.js 15 App Router, React 19, Three.js, Tailwind CSS 4, TypeScript, and
Vitest.

## License

[MIT](LICENSE)
