import { Card } from "@/components/ui/card"
import { User } from "lucide-react"
import Image from "next/image"
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';

interface MessageBubbleProps {
  role: "user" | "assistant"
  content: string
  isStreaming?: boolean
  showIcon?: boolean
}

export function MessageBubble({ role, content, isStreaming = false, showIcon = true }: MessageBubbleProps) {
  return (
    <div className={`flex gap-3 ${role === "user" ? "justify-end" : "justify-start"}`}>
      {role === "assistant" && showIcon && (
        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-groq-orange shrink-0">
          <Image src="/groq-logo.png" alt="Groq" width={20} height={20} className="rounded-full" />
        </div>
      )}
      {role === "assistant" && !showIcon && (
        <div className="w-8 h-8 shrink-0" />
      )}

      <Card
        className={`max-w-[80%] p-4 ${role === "user" ? "bg-groq-orange text-white" : "bg-card text-card-foreground border-groq-orange/20"
          }`}
      >
        <div className="prose prose-sm max-w-none list-disc break-words">
          <div className={`whitespace-pre-wrap leading-relaxed m-0 flex flex-col gap-2 ${role === "user" ? "text-white!" : ""}`}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
              {content}
            </ReactMarkdown>
            {isStreaming && <span className="animate-pulse">▋</span>}
          </div>
        </div>
      </Card>

      {role === "user" && (
        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-black/10 shrink-0">
          <User className="w-4 h-4" />
        </div>
      )}
    </div>
  )
}
