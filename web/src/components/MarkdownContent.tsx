import ReactMarkdown from 'react-markdown'

/**
 * markdown 渲染（§10.7）：content 以排版后的形态展示，
 * 禁止把 #、** 等原始标记符号直接显示在页面上。
 */
export function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="text-sm leading-relaxed text-foreground/90">
      <ReactMarkdown
        components={{
          h1: ({ children }) => (
            <h1 className="mt-3 mb-1 text-[15px] font-semibold">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="mt-3 mb-1 text-[15px] font-semibold">{children}</h2>
          ),
          h3: ({ children }) => <h3 className="mt-2 mb-1 text-sm font-semibold">{children}</h3>,
          p: ({ children }) => <p className="my-1.5">{children}</p>,
          ul: ({ children }) => <ul className="my-1.5 list-disc pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="my-1.5 list-decimal pl-5">{children}</ol>,
          li: ({ children }) => <li className="my-0.5">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-border pl-3 text-muted-foreground">
              {children}
            </blockquote>
          ),
          code: ({ children }) => (
            <code className="rounded bg-muted px-1 py-0.5 text-[13px]">{children}</code>
          ),
          hr: () => <hr className="my-3 border-border" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
