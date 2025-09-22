"use client"

import { useState } from "react"
import { ChevronDown, ChevronRight, Network, Code, CheckCircle, XCircle } from "lucide-react"
import { Button } from "./ui/button"
import type { ResponseOutputItem } from "openai/resources/responses/responses"

interface MCPCallDisplayProps {
  mcpCall: ResponseOutputItem.McpCall
}

export function MCPCallDisplay({ mcpCall }: MCPCallDisplayProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  const getStatusIcon = () => {
    if (mcpCall.error) {
      return <XCircle className="w-4 h-4" />
    }
    return <CheckCircle className="w-4 h-4" />
  }

  let parsedArgs: unknown
  if (mcpCall.arguments) {
    try {
      parsedArgs = JSON.parse(mcpCall.arguments)
    } catch {
      parsedArgs = mcpCall.arguments
    }
  }

  let parsedOutput: unknown
  if (mcpCall.output) {
    try {
      parsedOutput = JSON.parse(mcpCall.output)
    } catch {
      parsedOutput = mcpCall.output
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
        <Network className="w-4 h-4" />
        <span>{mcpCall.name || "Unknown MCP Call"}</span>
        <span className="text-xs opacity-75">({mcpCall.server_label || "Unknown Server"})</span>
        {getStatusIcon()}
      </Button>

      {isExpanded && (
        <div className="mt-3 pl-6 text-sm space-y-3">
          <div className="text-xs opacity-75">
            Server: {mcpCall.server_label || "Unknown Server"}
          </div>

          {mcpCall.arguments && (
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

          {mcpCall.output && (
            <div>
              <div className="font-semibold mb-1">Output:</div>
              <pre className="bg-muted p-2 rounded text-xs overflow-x-auto">
                {JSON.stringify(parsedOutput, null, 2)}
              </pre>
            </div>
          )}

          {mcpCall.error && (
            <div>
              <div className="font-semibold mb-1">Error:</div>
              <div className="bg-muted p-2 rounded text-xs">
                {mcpCall.error}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
