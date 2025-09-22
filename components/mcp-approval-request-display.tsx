"use client"

import { useState } from "react"
import { Button } from "./ui/button"
import { AlertTriangle, Check, X, CheckCircle, XCircle } from "lucide-react"
import type { ResponseOutputItem } from "openai/resources/responses/responses"

interface MCPApprovalRequestDisplayProps {
  approvalRequest: ResponseOutputItem.McpApprovalRequest
  onDecision: (approve: boolean) => void
  disabled?: boolean
  approvalStatus?: boolean // true = approved, false = denied, undefined = pending
}

export function MCPApprovalRequestDisplay({ 
  approvalRequest, 
  onDecision, 
  disabled = false,
  approvalStatus
}: MCPApprovalRequestDisplayProps) {
  const [decision, setDecision] = useState<'approved' | 'denied' | null>(null)

  const handleApprove = () => {
    setDecision('approved')
    onDecision(true)
  }

  const handleDeny = () => {
    setDecision('denied')
    onDecision(false)
  }

  const getStatusDisplay = () => {
    // Use approvalStatus from props if available, otherwise fall back to local decision state
    const status = approvalStatus !== undefined 
      ? (approvalStatus ? 'approved' : 'denied')
      : decision

    if (status === 'approved') {
      return (
        <div className="flex items-center gap-2">
          <CheckCircle className="w-4 h-4" />
          <span className="font-semibold">Approved</span>
        </div>
      )
    }
    
    if (status === 'denied') {
      return (
        <div className="flex items-center gap-2">
          <XCircle className="w-4 h-4" />
          <span className="font-semibold">Denied</span>
        </div>
      )
    }

    return (
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-4 h-4" />
        <span className="font-semibold">MCP approval requested</span>
      </div>
    )
  }

  const getBorderColor = () => {
    // Use approvalStatus from props if available, otherwise fall back to local decision state
    const status = approvalStatus !== undefined 
      ? (approvalStatus ? 'approved' : 'denied')
      : decision

    if (status === 'approved') return "border-green-500"
    if (status === 'denied') return "border-red-500"
    return "border"
  }

  return (
    <div className={`bg-card text-card-foreground rounded-lg p-4 text-sm ${getBorderColor()}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          {getStatusDisplay()}
          
          <div className="mt-2">
            <div className="font-medium mb-1">
              Server: {approvalRequest.server_label || "Unknown Server"}
            </div>
            <div className="font-medium mb-1">
              Tool: {approvalRequest.name || "Unknown Tool"}
            </div>
            
            {approvalRequest.arguments && (
              <div className="mt-2">
                <div className="font-medium mb-1">Arguments:</div>
                <pre className="bg-muted p-2 rounded text-xs overflow-x-auto whitespace-pre-wrap">
                  {JSON.stringify(JSON.parse(approvalRequest.arguments || '{}'), null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>

        {approvalStatus === undefined && !decision && !disabled && (
          <div className="flex gap-2">
            <Button
              onClick={handleApprove}
              size="sm"
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              <Check className="w-3 h-3 mr-1" />
              Approve
            </Button>
            <Button
              onClick={handleDeny}
              size="sm"
              variant="destructive"
            >
              <X className="w-3 h-3 mr-1" />
              Deny
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
