import { useId, useLayoutEffect, useRef, useState } from "react";
import "./archive-data-flow.css";

/** Decorative data-link animation behind the archive interface. */
export default function ArchiveDataFlow() {
  const svgRef = useRef<SVGSVGElement>(null);
  const [boundaryY, setBoundaryY] = useState(150);
  const id = useId().replace(/:/g, "");
  const packetId = `${id}-packet`;
  const blurId = `${id}-glass-blur`;
  const upperClipId = `${id}-above-line`;
  const lowerClipId = `${id}-below-line`;

  useLayoutEffect(() => {
    const svg = svgRef.current;
    const scene = svg?.closest(".main-column")?.querySelector(".archive-scene");
    if (!svg || !scene) return;
    let active = true;
    const measure = () => {
      const matrix = svg.getScreenCTM();
      if (!active || !matrix) return;
      // Convert the actual archive border into this SVG's coordinates.
      const point = new DOMPoint(0, scene.getBoundingClientRect().top).matrixTransform(matrix.inverse());
      setBoundaryY(Math.max(10, Math.min(650, point.y)));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(svg);
    observer.observe(scene);
    window.addEventListener("resize", measure);
    void document.fonts.ready.then(measure);
    measure();
    return () => { active = false; observer.disconnect(); window.removeEventListener("resize", measure); };
  }, []);

  const sourceY = Math.max(15, boundaryY - 48);

  return (
    <figure className="archive-data-flow" aria-hidden="true">
      <svg ref={svgRef} viewBox="0 0 1400 900" preserveAspectRatio="none">
        <defs>
          <filter id={blurId} x="-250%" y="-250%" width="600%" height="600%" colorInterpolationFilters="sRGB">
            <feGaussianBlur stdDeviation="12" />
          </filter>
          <clipPath id={upperClipId} clipPathUnits="userSpaceOnUse">
            <rect x="-200" y="-200" width="1800" height={boundaryY + 200} />
          </clipPath>
          <clipPath id={lowerClipId} clipPathUnits="userSpaceOnUse">
            <rect x="-200" y={boundaryY} width="1800" height={1100 - boundaryY} />
          </clipPath>
          <g id={packetId} className="archive-packet" transform={`translate(840 ${sourceY})`}>
            <animateTransform attributeName="transform" type="translate" dur="5s" repeatCount="indefinite"
              values={`840 ${sourceY};840 ${sourceY};840 745;840 755;840 740;840 745;840 745`}
              keyTimes="0;0.025;0.26;0.305;0.35;0.4;1"
              calcMode="spline"
              keySplines="0 0 1 1;0.28 0.08 0.2 1;0.12 0.8 0.3 1;0.55 0 0.75 0.2;0.2 0.7 0.35 1;0 0 1 1" />
            <animate attributeName="opacity" dur="5s" repeatCount="indefinite" values="1;1;1;1;0.25;0;0" keyTimes="0;0.025;0.245;0.305;0.35;0.4;1" />
            <g>
              <path d="M0 -14 L14 0 L0 14 L-14 0 Z" fill="none" stroke="#ffffff" strokeWidth="1.5" />
              <animateTransform attributeName="transform" type="scale" dur="5s" repeatCount="indefinite"
                values="1 1;1 1;1 1;1.28 .68;.84 1.16;1 1;1 1"
                keyTimes="0;0.245;0.26;0.305;0.35;0.4;1" />
            </g>
          </g>
        </defs>

        <g className="archive-local-glyph" transform="translate(840 745) scale(.5) translate(0 15)">
          <path className="local-chevron local-chevron-back" d="M-62 -105 L0 -43 L62 -105" />
          <path className="local-chevron local-chevron-front" d="M-62 -77 L0 -15 L62 -77" />
          <path className="local-base" d="M-75 19 H75 M-75 39 H75" />
          <ellipse className="local-impact" cx="0" cy="-15" rx="24" ry="8" />
        </g>

        <g className="packet-upper-layer" clipPath={`url(#${upperClipId})`} opacity=".7">
          <use href={`#${packetId}`} fill="none" stroke="#ffffff" filter={`url(#${blurId})`} />
        </g>
        <g className="packet-lower-layer" clipPath={`url(#${lowerClipId})`}>
          <use href={`#${packetId}`} fill="none" stroke="#ffffff" className="packet-primary" />
        </g>
      </svg>
    </figure>
  );
}
