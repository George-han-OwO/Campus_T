import "./overview-backdrop.css";

/** Hollow, frosted ornament based on the supplied reference, behind the overview UI. */
export default function OverviewBackdrop() {
  return <div className="overview-backdrop" aria-hidden="true">
    <svg viewBox="145 90 435 775" fill="none" className="overview-prism">
      <g className="overview-prism-halo" stroke="white" strokeWidth="14" opacity=".42">
        <path d="M211 304 517 193 517 581 211 765Z" />
      </g>
      <g stroke="white" strokeLinejoin="miter">
        <path d="M175 263 552 125 552 601 175 831Z" strokeWidth="1.8" opacity=".18" />
        <path d="M192 282 535 157 535 589 192 799Z" strokeWidth="2" opacity=".35" />
        <path d="M211 304 517 193 517 581 211 765Z" strokeWidth="3" opacity=".86" />
        <path d="M225 319 503 218 503 568 225 738Z" strokeWidth="2.2" opacity=".65" />
      </g>
    </svg>
  </div>;
}
