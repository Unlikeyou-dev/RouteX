export default function Logo({ size = 34, withText = true, textClass = 'text-lg' }) {
  return (
    <span className="inline-flex items-center gap-2.5 select-none">
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="#4f46e5" />
        <path
          d="M10 10 L22 22 M22 10 L10 22"
          stroke="white"
          strokeWidth="2.6"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="10" cy="10" r="1.7" fill="white" />
        <circle cx="22" cy="22" r="1.7" fill="white" />
      </svg>
      {withText && (
        <span className={`font-bold tracking-tight text-ink ${textClass}`}>
          Route<span className="text-brand-600">X</span>
        </span>
      )}
    </span>
  )
}
