import { foxFace } from "./fox-art.js";
import "./brand.css";

export function SparkPetMark() {
  return (
    <span className="fox-brand" aria-hidden="true">
      <svg viewBox="-3 -3 38 38" focusable="false" shapeRendering="crispEdges">
        <g className="fox-face">
          {foxFace.filter((path) => !path.part).map(({ d, fill }) => <path key={d} d={d} fill={fill} />)}
          <g className="fox-eyes">
            {foxFace.filter((path) => path.part === "eyes").map(({ d, fill }) => <path key={d} d={d} fill={fill} />)}
          </g>
        </g>
      </svg>
      <span className="fox-brand-spark" />
    </span>
  );
}
