# Pallet 3D Viewer

Visualize `.rob` pallet layouts in a fast, interactive 3D scene powered by Three.js.

### Features
- Import `.rob` files and render layered pallet layouts
- Save multiple pallets locally and switch between them
- 3D navigation with orbit controls, grid, axes, and pallet base
- OpenGraph/Twitter embeds with dynamic OG image

### Getting Started
- **Install**: `bun install` or `pnpm install` or `npm install`
- **Dev**: `bun run dev` (or `pnpm dev` / `npm run dev`)
- **Build**: `bun run build` (or `pnpm build` / `npm run build`)

Open `http://localhost:3000` and use the “Import .rob file” button.

### Tech Stack
- **Next.js 15** app router
- **Three.js** for rendering
- **TypeScript**
- **Tailwind CSS**

### OpenGraph
- Site metadata and a dynamic OG image are configured. Update the icon at `public/favicon.ico`.

### License
MIT
