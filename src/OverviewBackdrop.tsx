import "./overview-backdrop.css";

/** Hollow, frosted ornament based on the supplied reference, behind the overview UI. */
export default function OverviewBackdrop() {
  return <div className="overview-backdrop" aria-hidden="true">
    <svg viewBox="180 80 320 700" fill="none" className="overview-prism">
      <g className="overview-prism-halo" stroke="white" strokeWidth="14" opacity=".42">
        <path d="M214 205 422 145 422 665 214 725Z" />
      </g>
      <g stroke="white" strokeLinejoin="miter">
        <path d="M242 183 450 123 450 643 242 703Z" strokeWidth="2.2" opacity=".3" />
        <path d="M214 205 242 183M422 145 450 123M422 665 450 643M214 725 242 703" strokeWidth="2" opacity=".4" />
        <path d="M214 205 422 145 422 665 214 725Z" strokeWidth="3.8" opacity=".86" />
        <path d="M228 218 408 166 408 651 228 703Z" strokeWidth="2.4" opacity=".65" />
        <path d="M236 230 400 183 400 643 236 690Z" strokeWidth="1.8" opacity=".32" />
      </g>
    </svg>
  </div>;
}
