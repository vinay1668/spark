import "./brand.css";

const blocks = [
  { x: 40, y: 42, level: 3 },
  { x: 28, y: 48, level: 2 },
  { x: 52, y: 48, level: 2 },
  { x: 40, y: 54, level: 1 },
  { x: 40, y: 30, level: 3 },
  { x: 40, y: 18, level: 3 },
];

/** Decorative, finite build sequence. Reduced motion shows the finished model. */
export function BlockBuild({ stage = 3 }) {
  const visible = blocks.filter((block) => block.level <= stage);
  return (
    <svg className="block-build" viewBox="0 0 80 80" aria-hidden="true" focusable="false">
      <path className="build-ground" d="M8 58 40 42 72 58 40 74Z" />
      {visible.map(({ x, y }, index) => (
        <g key={`${x}-${y}`} transform={`translate(${x} ${y})`}>
          <g className={`build-block${index === visible.length - 1 ? " build-block-cap" : ""}`} style={{ "--block-delay": `${index * 120}ms` }}>
            <path className="block-left" d="M-12 0 0 6V20L-12 14Z" />
            <path className="block-right" d="M0 6 12 0V14L0 20Z" />
            <path className="block-top" d="M0-6 12 0 0 6-12 0Z" />
            <path className="block-glint" d="M-9 0 0-4 9 0 0 4Z" />
          </g>
        </g>
      ))}
      {stage === 3 && <path className="build-spark" d="M64 14h3v4h4v3h-4v4h-3v-4h-4v-3h4z" />}
    </svg>
  );
}
