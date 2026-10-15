import "./overview-backdrop.css";

/** Hollow, frosted ornament based on the supplied reference, behind the overview UI. */
export default function OverviewBackdrop() {
  return <div className="overview-backdrop" aria-hidden="true">
    <svg viewBox="180 40 300 760" fill="none" className="overview-prism">
      <g className="overview-prism-halo" stroke="white" strokeWidth="14" opacity=".42">
        <path d="M250 331 435 127 435 458 250 715Z" />
      </g>
      <g stroke="white" strokeLinejoin="miter">
        <path d="M218 310 445 61 445 468 218 782Z" strokeWidth="2" opacity=".2" />
        <path d="M226 318 437 87 437 462 226 756Z" strokeWidth="2" opacity=".33" />
        <path d="M250 331 435 127 435 458 250 715Z" strokeWidth="3.4" opacity=".86" />
        <path d="M256 338 428 149 428 457 256 694Z" strokeWidth="2.4" opacity=".6" />
      </g>
    </svg>
  </div>;
}
