import { useEffect } from "react";
import * as THREE from "three";
import legacyAppSource from "../../web/public/app.js?raw";

export function useLegacyVoxelScene(routeKey) {
  useEffect(() => {
    if (!document.querySelector(".stage canvas")) return undefined;
    const start = legacyAppSource.indexOf(
      'const root = document.querySelector(".world");',
    );
    const end = legacyAppSource.indexOf("// ── theme (dark / light) ──");
    if (start < 0 || end < 0)
      throw new Error("Legacy voxel scene boundaries were not found");
    let source = legacyAppSource.slice(start, end);
    source = source.replace(
      "function draw(now) {",
      "let destroyed = false; function draw(now) { if (destroyed) return;",
    );
    source +=
      "\nreturn () => { destroyed = true; clearInterval(ticker); renderer.dispose(); window.removeEventListener('spark-themechange', applySceneTheme); };";
    const mount = new Function("THREE", source);
    const cleanup = mount(THREE);
    return typeof cleanup === "function" ? cleanup : undefined;
  }, [routeKey]);
}
