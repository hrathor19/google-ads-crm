/**
 * The KollegeApply mark, matching Counselling CRM so the two apps read as one
 * product. Inline rather than an <img> so it inherits size cleanly and needs
 * no extra request; the full-detail version lives in public/favicon.svg for
 * the browser tab.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 30 26"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M18 0L7 13L18 26H24L13 13L24 0H18Z" fill="#E85A42" />
      <path d="M9 0L0 13L9 26H15L6 13L15 0H9Z" fill="#E85A42" opacity="0.55" />
    </svg>
  );
}
