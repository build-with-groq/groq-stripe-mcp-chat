"use client"

import type React from "react"
import { Fragment, useCallback, useEffect, useRef, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { MessageBubble } from "@/components/ui/message-bubble"
import { TypingIndicator } from "@/components/ui/typing-indicator"
import { WelcomeScreen } from "@/components/ui/welcome-screen"
import { AssistantMessage } from "@/components/ui/assistant-message"
import { ReasoningDisplay } from "@/components/reasoning-display"
import { ToolCallDisplay } from "@/components/tool-call-display"
import { MCPCallDisplay } from "@/components/mcp-call-display"
import { MCPListToolsDisplay } from "@/components/mcp-list-tools-display"
import { AlertTriangle, Send, Github } from "lucide-react"
import Image from "next/image"
import {
  type ResponseInputItem,
  type ResponseOutputItem,
  type ResponseOutputMessage,
  type ResponseOutputText,
  type ResponseOutputRefusal,
  type ResponseReasoningItem,
} from "openai/resources/responses/responses"
import { useResponses } from "@/hooks/use-responses"
import { MCPApprovalRequestDisplay } from "./mcp-approval-request-display"

const isOutputText = (part: ResponseOutputMessage["content"][number]): part is ResponseOutputText =>
  part.type === "output_text"

const isRefusal = (part: ResponseOutputMessage["content"][number]): part is ResponseOutputRefusal =>
  part.type === "refusal"

const renderInputContent = (input: ResponseInputItem): string => {
  if (input.type === "message") {
    if (typeof input.content === "string") return input.content

    const parts = Array.isArray(input.content) ? input.content : []
    return parts
      .map(part => (part.type === "input_text" ? part.text : ""))
      .filter(Boolean)
      .join("\n")
  }

  if ("text" in input && typeof (input as { text?: string }).text === "string") {
    return (input as { text: string }).text
  }

  return ""
}

const isReasoningMarkup = (value: string): boolean => {
  const trimmed = value.trim()
  return trimmed.startsWith("<reasoning>") && trimmed.endsWith("</reasoning>")
}

export const extractReasoningText = (value: string): string => {
  const trimmed = value.trim()
  return trimmed.replace(/^<reasoning>/, "").replace(/<\/reasoning>$/, "")
}

const renderAssistantText = (output: ResponseOutputMessage): string => {
  if (typeof output.content === "string") return output.content

  const textParts = output.content.filter(isOutputText).map(part => part.text)
  if (textParts.length) return textParts.join("")

  const refusal = output.content.find(isRefusal)
  if (refusal) {
    return `The assistant declined: ${refusal.refusal}`
  }

  return ""
}

const getMessageKey = (message: ResponseInputItem | ResponseOutputItem, index: number): string => {
  const id = (message as { id?: string }).id

  if (message.type === "message") {
    const role = (message as { role?: string }).role ?? "message"
    return `message-${role}-${id ?? index}`
  }

  return `${message.type}-${id ?? index}`
}

interface RenderOutputOptions {
  onMcpApprovalDecision?: (
    approvalRequest: ResponseOutputItem.McpApprovalRequest,
    approve: boolean,
  ) => Promise<void> | void
  disableApprovalActions?: boolean
  approvalResponses?: Map<string, boolean>
}

// Helper function to determine if a message is from the assistant
const isAssistantMessage = (message: ResponseInputItem | ResponseOutputItem): boolean => {
  if (message.type === "message") {
    return (message as any).role === "assistant"
  }
  // All output types are from the assistant
  return message.type === "reasoning" ||
    message.type === "function_call" ||
    message.type === "mcp_call" ||
    message.type === "mcp_list_tools" ||
    message.type === "mcp_approval_request" ||
    (message as any).type // catch any other output types
}

const renderOutputComponent = (message: ResponseOutputItem, options: RenderOutputOptions = {}) => {
  const output = message
  const { onMcpApprovalDecision, disableApprovalActions, approvalResponses } = options

  switch (output.type) {
    case "message": {
      const content = renderAssistantText(output)
      if (!content) return null
      const isStreaming = output.status === "in_progress"
      return (
        <MessageBubble
          key={`assistant-${message.id}`}
          role="assistant"
          content={content}
          isStreaming={isStreaming}
        />
      )
    }
    case "reasoning":
      return <ReasoningDisplay key={`reasoning-${output.id}`} reasoning={output} />
    case "function_call":
      return <ToolCallDisplay key={`tool-${output.id ?? message.id}`} toolCall={output} />
    case "mcp_call":
      return <MCPCallDisplay key={`mcp-${output.id}`} mcpCall={output} />
    case "mcp_list_tools":
      return <MCPListToolsDisplay key={`mcp-tools-${output.id}`} item={output} />
    case "mcp_approval_request":
      const approvalStatus = approvalResponses?.get(output.id)

      if (!onMcpApprovalDecision) {
        return (
          <div
            key={`mcp-approval-${output.id}`}
            className="bg-card text-card-foreground border rounded-lg p-4 text-sm flex items-start gap-2"
          >
            <AlertTriangle className="w-4 h-4 mt-1" />
            <div>
              <div className="font-semibold mb-1">MCP approval requested</div>
              <pre className="text-xs whitespace-pre-wrap">
                {JSON.stringify(output, null, 2)}
              </pre>
            </div>
          </div>
        )
      }

      return (
        <MCPApprovalRequestDisplay
          key={`mcp-approval-${output.id}`}
          approvalRequest={output}
          onDecision={(approve: boolean) => onMcpApprovalDecision(output, approve)}
          disabled={disableApprovalActions}
          approvalStatus={approvalStatus}
        />
      )
    default:
      return (
        <div
          key={`raw-${message.id}`}
          className="bg-card text-card-foreground border rounded-lg p-4 text-xs overflow-x-auto"
        >
          <pre className="whitespace-pre-wrap">
            {JSON.stringify(output, null, 2)}
          </pre>
        </div>
      )
  }
}

export default function ChatInterface() {
  const { messages, sendMessage, sendMcpApprovalResponse, status, error } = useResponses()
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Track approval responses to show approved status
  const approvalResponses = useMemo(() => {
    const responses = new Map<string, boolean>()
    messages.forEach(message => {
      if (message.type === "mcp_approval_response") {
        const approvalResponse = message as ResponseInputItem.McpApprovalResponse
        responses.set(approvalResponse.approval_request_id, approvalResponse.approve)
      }
    })
    return responses
  }, [messages])

  const isStreaming = status === "in_progress"

  const handleMcpApprovalDecision = useCallback(
    async (approvalRequest: ResponseOutputItem.McpApprovalRequest, approve: boolean) => {
      await sendMcpApprovalResponse(approvalRequest.id, approve)
    },
    [sendMcpApprovalResponse],
  )

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const input = (formData.get("message") as string | null) ?? ""
    if (!input.trim()) return

    void sendMessage(input)
    event.currentTarget.reset()
    inputRef.current?.focus()
  }

  return (
    <div className="flex flex-col h-screen max-w-4xl mx-auto">
      {/* Header with GitHub link */}
      <a
        href="https://github.com/build-with-groq/groq-stripe-mcp-chat"
        target="_blank"
        rel="noopener noreferrer"
        className="p-2 rounded-lg absolute top-4 right-4 hover:bg-muted/50 transition-colors text-muted-foreground hover:text-foreground"
        aria-label="View source on GitHub"
      >
        <Github className="w-5 h-5" />
      </a>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && <WelcomeScreen />}

        {messages.map((message, index) => {
          const key = getMessageKey(message, index)

          // Determine if this message should show the assistant icon
          const isCurrentAssistant = isAssistantMessage(message)
          const isPreviousAssistant = index > 0 ? isAssistantMessage(messages[index - 1]) : false
          const showIcon = !isCurrentAssistant || !isPreviousAssistant

          if (message.type === "message") {
            const text = renderInputContent(message)
            if (text) {
              if (
                message.role === "assistant" &&
                typeof (message as { content?: unknown }).content === "string" &&
                isReasoningMarkup(text)
              ) {
                const reasoningSummary = extractReasoningText(text).trim()
                if (reasoningSummary) {
                  const reasoningItem: ResponseReasoningItem = {
                    id: (message as { id?: string }).id ?? `inline-reasoning-${index}`,
                    type: "reasoning",
                    summary: [
                      {
                        type: "summary_text",
                        text: reasoningSummary,
                      },
                    ],
                    status: "completed",
                  }

                  return (
                    <AssistantMessage key={key} showIcon={showIcon}>
                      <ReasoningDisplay reasoning={reasoningItem} />
                    </AssistantMessage>
                  )
                }
              }

              const role = message.role === "user" ? "user" : "assistant"
              const isStreamingMessage =
                role === "assistant" && (message as Partial<ResponseOutputMessage>).status === "in_progress"

              return (
                <MessageBubble
                  key={key}
                  role={role}
                  content={text}
                  isStreaming={isStreamingMessage}
                  showIcon={role === "assistant" ? showIcon : true}
                />
              )
            }
          }

          if (message.type === "mcp_approval_response") {
            // Don't display approval response messages to the user
            return null
          }

          return (
            <AssistantMessage key={key} showIcon={showIcon}>
              {renderOutputComponent(message as ResponseOutputItem, {
                onMcpApprovalDecision: handleMcpApprovalDecision,
                disableApprovalActions: isStreaming,
                approvalResponses,
              })}
            </AssistantMessage>
          )
        })}

        {isStreaming && (
          <AssistantMessage showIcon={messages.length === 0 || !isAssistantMessage(messages[messages.length - 1])}>
            <TypingIndicator />
          </AssistantMessage>
        )}

        {error && (
          <div className="border border-red-200 bg-red-50 text-red-700 rounded-lg p-4 text-sm flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-1" />
            <div>
              <div className="font-semibold">Streaming error</div>
              <div>{error.message}</div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="border-t border-border bg-card/50 backdrop-blur-sm p-4">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <Input
            ref={inputRef}
            name="message"
            placeholder="Ask about Stripe APIs, payments, or anything else..."
            disabled={isStreaming}
            className="flex-1 bg-input border-border focus:ring-2 focus:ring-groq-orange/50"
            autoFocus
          />
          <Button
            type="submit"
            disabled={isStreaming}
            className="bg-groq-orange hover:bg-groq-orange/90 text-white"
          >
            <Send className="w-4 h-4" />
            <span className="sr-only">Send message</span>
          </Button>
        </form>
      </div>
    </div>
  )
}
