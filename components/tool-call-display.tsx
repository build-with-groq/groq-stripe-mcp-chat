"use client"

import { useState } from "react"
import { ChevronDown, ChevronRight, Code, CheckCircle, XCircle, Wrench } from "lucide-react"
import { Button } from "./ui/button"
import type { ResponseFunctionToolCall } from "openai/resources/responses/responses"

interface ToolCallDisplayProps {
  toolCall: ResponseFunctionToolCall & { output?: string | null; error?: string | null }
}

export function ToolCallDisplay({ toolCall }: ToolCallDisplayProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  const getStatusIcon = () => {
    if (toolCall.error) {
      return <XCircle className="w-4 h-4" />
    }
    return <CheckCircle className="w-4 h-4" />
  }

  let parsedArgs: unknown
  if (toolCall.arguments) {
    try {
      parsedArgs = JSON.parse(toolCall.arguments)
    } catch {
      parsedArgs = toolCall.arguments
    }
  }

  let parsedOutput: unknown
  if (toolCall.output) {
    try {
      parsedOutput = JSON.parse(toolCall.output)
    } catch {
      parsedOutput = toolCall.output
    }
  }

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
        <Wrench className="w-4 h-4" />
        <span>{toolCall.name || "Unknown Tool"}</span>
        {getStatusIcon()}
      </Button>

      {isExpanded && (
        <div className="mt-3 pl-6 text-sm space-y-3">
          {toolCall.arguments && (
            <div>
              <div className="font-semibold mb-1 flex items-center gap-1">
                <Code className="w-3 h-3" />
                Arguments:
              </div>
              <pre className="bg-muted p-2 rounded text-xs overflow-x-auto">
                {JSON.stringify(parsedArgs, null, 2)}
              </pre>
            </div>
          )}

          {toolCall.output && (
            <div>
              <div className="font-semibold mb-1">Output:</div>
              <pre className="bg-muted p-2 rounded text-xs overflow-x-auto">
                {JSON.stringify(parsedOutput, null, 2)}
              </pre>
            </div>
          )}

          {toolCall.error && (
            <div>
              <div className="font-semibold mb-1">Error:</div>
              <div className="bg-muted p-2 rounded text-xs">
                {toolCall.error}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
