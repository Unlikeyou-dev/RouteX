export default function Logo({ size = 34, withText = true, textClass = 'text-lg' }) {
  return (
    <span className="inline-flex items-center gap-2.5 select-none">
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
        <defs>
          <linearGradient id="rx-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#6366f1" />
            <stop offset="1" stopColor="#8b5cf6" />
          </linearGradient>
        </defs>
        <rect width="32" height="32" rx="8" fill="url(#rx-g)" />
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
        <span className={`font-bold tracking-tight ${textClass}`}>
          Route<span className="bg-gradient-to-r from-brand-400 to-glow bg-clip-text text-transparent">X</span>
        </span>
      )}
    </span>
  )
}
