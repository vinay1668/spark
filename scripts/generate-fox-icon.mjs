import { writeFile, mkdir } from "node:fs/promises";
import { foxFace } from "../apps/web-react/src/fox-art.js";

const target = new URL("../apps/web-react/src/assets/", import.meta.url);
await mkdir(target, { recursive: true });
// A static icon is dependable in browser tabs; the header handles animation.
const paths = foxFace.map(({ d, fill }) => `  <path fill="${fill}" d="${d}"/>`).join("\n");
await writeFile(new URL("spark-fox-icon.svg", target),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 34 34" shape-rendering="crispEdges">\n${paths}\n</svg>\n`);
