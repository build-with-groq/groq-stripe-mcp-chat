import { Card } from "@/components/ui/card"

export function TypingIndicator() {
  return (
    <Card className="bg-card text-card-foreground p-4 border-groq-orange/20">
      <div className="flex items-center gap-2">
        <div className="flex space-x-1">
          <div className="w-2 h-2 bg-groq-orange rounded-full animate-bounce [animation-delay:-0.3s]"></div>
          <div className="w-2 h-2 bg-groq-orange rounded-full animate-bounce [animation-delay:-0.15s]"></div>
          <div className="w-2 h-2 bg-groq-orange rounded-full animate-bounce"></div>
        </div>
        <span className="text-sm text-muted-foreground">Thinking...</span>
      </div>
    </Card>
  )
}
