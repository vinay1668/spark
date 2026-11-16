import { useEffect } from "react";

export function useLegacyVoxelScene(routeKey) {
  useEffect(() => {
    const canvas = document.querySelector(".stage canvas");
    if (!canvas) return undefined;
    let cancelled = false;
    let cleanup;
    const startScene = async () => {
    const [THREE, { default: legacyAppSource }] = await Promise.all([
      import("three"),
      import("../../web/public/app.js?raw"),
    ]);
    if (cancelled || !canvas.isConnected) return;
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
    cleanup = mount(THREE);
    };
    startScene().catch((error) => {
      if (!cancelled) console.warn("Spark illustration could not start", error);
    });
    return () => {
      cancelled = true;
      if (typeof cleanup === "function") cleanup();
    };
  }, [routeKey]);
}
