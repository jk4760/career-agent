/**
 * NextCareer Logo「折线 N」（§10.8）：字母 N 的最后一笔延伸为增长箭头，
 * 箭头终点节点 = AI 落点。N 深藏青，增长线亮蓝。随用随缩放。
 */
export function LogoMark({
  size = 20,
  variant = 'light',
  className,
}: {
  size?: number
  /** light = 浅色底（默认）；dark = 深色底（N 与节点换白/浅蓝） */
  variant?: 'light' | 'dark'
  className?: string
}) {
  const n = variant === 'light' ? '#0F172A' : '#FFFFFF'
  const blue = variant === 'light' ? '#2563EB' : '#3B82F6'
  const nodeRing = variant === 'light' ? '#FFFFFF' : '#0F172A'
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 72 72"
      fill="none"
      className={className}
      role="img"
      aria-label="NextCareer"
    >
      <path
        d="M14 56 L14 18 L40 56 L40 18"
        stroke={n}
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M40 44 L58 20" stroke={blue} strokeWidth="7" strokeLinecap="round" />
      <path
        d="M60 32 L60 16 L46 18"
        stroke={blue}
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="58" cy="20" r="5" fill={blue} stroke={nodeRing} strokeWidth="2.5" />
    </svg>
  )
}
