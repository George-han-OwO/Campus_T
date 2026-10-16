/** Shared overview/archive motif, behind the app UI and clear of all controls. */
export default function ArchiveBackdrop() {
  return (
    <svg className="archive-backdrop" viewBox="0 0 1082 1875" fill="none" aria-hidden="true">
      <defs>
        <clipPath id="archive-backdrop-clip" clipPathUnits="userSpaceOnUse">
          <path d="M1082 144.659V201.122L936.595 55.7168L55 937.312L936.595 1818.91L1082 1673.5V1730.02L937.341 1874.68L0 937.342L937.341 0L1082 144.659Z" />
        </clipPath>
        <filter id="archive-frost-blur" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="50" />
        </filter>
        <mask id="archive-backdrop-sweep" maskUnits="userSpaceOnUse" x="0" y="0" width="1082" height="1875">
          <path d="M1082 172.9 L936.97 27.86 L27.5 937.33 L936.97 1846.8 L1082 1701.76" pathLength="1000" stroke="white" strokeWidth="64" strokeLinecap="butt" strokeLinejoin="miter" strokeDasharray="140 1000" strokeDashoffset="140" filter="url(#archive-frost-blur)">
            <animate attributeName="stroke-dashoffset" from="140" to="-1000" dur="4s" calcMode="linear" repeatCount="indefinite" />
          </path>
        </mask>
      </defs>
      <path d="M1082 144.659V201.122L936.595 55.7168L55 937.312L936.595 1818.91L1082 1673.5V1730.02L937.341 1874.68L0 937.342L937.341 0L1082 144.659Z" fill="#D9D9D9" opacity=".34" />
      <g clipPath="url(#archive-backdrop-clip)">
        <rect width="1082" height="1875" fill="white" opacity=".9" mask="url(#archive-backdrop-sweep)" />
        <path d="M1082 172.9 L936.97 27.86 L27.5 937.33 L936.97 1846.8 L1082 1701.76" pathLength="1000" stroke="white" strokeWidth="24" strokeLinecap="butt" strokeLinejoin="miter" strokeDasharray="140 1000" strokeDashoffset="140" opacity=".72">
          <animate attributeName="stroke-dashoffset" from="140" to="-1000" dur="4s" calcMode="linear" repeatCount="indefinite" />
        </path>
      </g>
    </svg>
  );
}
