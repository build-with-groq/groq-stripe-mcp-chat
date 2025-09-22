"use client"

import { useMemo, useState } from "react"
import { Brain, ChevronDown, ChevronRight } from "lucide-react"
import { Button } from "./ui/button"
import type { ResponseReasoningItem } from "openai/resources/responses/responses"

interface ReasoningDisplayProps {
  reasoning: ResponseReasoningItem
}

export function ReasoningDisplay({ reasoning }: ReasoningDisplayProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  const text = useMemo(() => {
    const summary = reasoning.summary?.map(part => {
      if (typeof part === "string") return part
      if ("text" in part) return part.text
      return JSON.stringify(part, null, 2)
    })

    return (summary?.length ? summary : undefined)?.join("\n\n") ?? "No reasoning details provided."
  }, [reasoning])

  console.log("text", text);
  if (text.length === 0) return null;

  return (
    <div className="bg-card text-card-foreground border-groq-orange/20 border rounded-lg p-4">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 p-0 h-auto font-normal"
      >
        {isExpanded ? (
          <ChevronDown className="w-4 h-4" />
        ) : (
          <ChevronRight className="w-4 h-4" />
        )}
        <Brain className="w-4 h-4" />
        <span>Reasoning</span>
      </Button>

      {isExpanded && (
        <div className="mt-3 pl-6 text-sm whitespace-pre-wrap leading-relaxed">
          {text}
        </div>
      )}
    </div>
  )
}
