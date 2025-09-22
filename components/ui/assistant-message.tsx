import Image from "next/image"

interface AssistantMessageProps {
  children: React.ReactNode
  showIcon?: boolean
}

export function AssistantMessage({ children, showIcon = true }: AssistantMessageProps) {
  return (
    <div className="flex gap-3 justify-start">
      {showIcon ? (
        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-groq-orange shrink-0">
          <Image src="/groq-logo.png" alt="Groq" width={20} height={20} className="rounded-full" />
        </div>
      ) : (
        <div className="w-8 h-8 shrink-0" />
      )}
      <div className="max-w-[80%]">
        {children}
      </div>
    </div>
  )
}
