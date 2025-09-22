"use client"

import { useState } from "react"
import { ChevronDown, ChevronRight, List, Wrench } from "lucide-react"
import { Button } from "./ui/button"
import type { ResponseOutputItem } from "openai/resources/responses/responses"

interface MCPListToolsDisplayProps {
  item: ResponseOutputItem.McpListTools
}

export function MCPListToolsDisplay({ item }: MCPListToolsDisplayProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  const tools = item.tools ?? []

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
        <List className="w-4 h-4" />
        <span>Available Tools</span>
        <span className="text-xs opacity-75">({item.server_label || "Unknown server"})</span>
        <span className="text-xs px-2 py-1 rounded">{tools.length} tools</span>
      </Button>

      {isExpanded && (
        <div className="mt-3 pl-6 text-sm space-y-3">
          {tools.map((tool, index) => {
            const name = typeof tool.name === "string" ? tool.name : undefined
            const description = typeof tool.description === "string" ? tool.description : undefined
            const schema = tool.input_schema ?? undefined

            return (
              <div key={name ?? index} className="bg-muted/50 border rounded p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Wrench className="w-3 h-3" />
                  <span className="font-semibold">{name ?? "Unnamed tool"}</span>
                </div>
                {description && <div className="text-xs opacity-75">{description}</div>}
                {schema && (
                  <div>
                    <div className="text-xs font-semibold mb-1">Input schema</div>
                    <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">
                      {JSON.stringify(schema, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )
          })}
          {tools.length === 0 && <div className="text-xs opacity-70">No tools returned.</div>}
        </div>
      )}
    </div>
  )}
