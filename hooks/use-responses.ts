import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
    ResponseErrorEvent,
    ResponseInputItem,
    ResponseStreamEvent,
} from "openai/resources/responses/responses";

import {
    ResponseSession,
    type ResponseSessionMessage,
} from "@/lib/responses";

const DEFAULT_ENDPOINT = "/api/chat";

const createUserMessage = (text: string): ResponseInputItem => ({
    type: "message",
    role: "user",
    content: text,
});

type UseResponsesSnapshot = ReturnType<ResponseSession["getSnapshot"]>;

export interface UseResponsesResult {
    messages: ReadonlyArray<ResponseInputItem>;
    status: UseResponsesSnapshot["status"];
    error: UseResponsesSnapshot["error"];
    sendMessage: (text: string) => Promise<void>;
    sendMcpApprovalResponse: (approvalRequestId: string, approve: boolean) => Promise<void>;
    cancel: () => void;
}

export interface UseResponsesOptions {
    /** Optional override for the server endpoint streaming OpenAI events. */
    endpoint?: string;
}

const transformMessage = (message: ResponseSessionMessage): ResponseInputItem | undefined => {
    if (message.kind === "input" || message.kind === "output") {
        if (message.item.type === "reasoning") {
            const hasContent = message.item.content?.some((m) => m.text !== "");
            if (!hasContent) {
                return;
            }
            return {
                type: "message",
                role: "assistant",
                content: `<reasoning>${message.item.content?.map((m) => m.text).join(" ")}</reasoning>`,
            }
        }

        if (message.item.type === "message" && message.item.role === "assistant") {
            return {
                type: "message",
                role: "assistant",
                content: (message.item.content as any).map((m: any) => m.text).join(" "),
            }
        }

        return message.item;
    }

    // Fallback for unknown message types
    return {
        type: "message",
        role: "user",
        content: "",
    };
}

export const useResponses = (options?: UseResponsesOptions): UseResponsesResult => {
    const endpoint = options?.endpoint ?? DEFAULT_ENDPOINT;

    const sessionRef = useRef<ResponseSession>();
    if (!sessionRef.current) {
        sessionRef.current = new ResponseSession();
    }

    const [{ messages, status, error }, setSnapshot] = useState<UseResponsesSnapshot>(
        sessionRef.current.getSnapshot(),
    );
    const transformedMessages = useMemo(() => messages.map(transformMessage).filter(message => message !== undefined), [messages]);

    const abortRef = useRef<AbortController | null>(null);
    const streamingRef = useRef(false);

    useEffect(() => {
        const session = sessionRef.current!;
        const unsubscribe = session.on("change", (snapshot) => {
            setSnapshot(snapshot);
        });
        return unsubscribe;
    }, []);

    const cancel = useCallback(() => {
        const controller = abortRef.current;
        if (controller) {
            controller.abort();
            abortRef.current = null;
            streamingRef.current = false;
        }
    }, []);

    const sendMessage = useCallback(
        async (text: string, skipEmptyCheck = false) => {
            if (!text.trim() && !skipEmptyCheck) return;

            const session = sessionRef.current!;

            if (streamingRef.current) {
                cancel();
            }

            if (text.trim()) {
                const userMessage = createUserMessage(text.trim());
                session.addInput(userMessage);
            }

            const controller = new AbortController();
            abortRef.current = controller;
            streamingRef.current = true;

            try {
                const payloadInputs = session
                    .getMessages()
                    .map(transformMessage);

                const response = await fetch(endpoint, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ messages: payloadInputs }),
                    signal: controller.signal,
                });

                if (!response.ok || !response.body) {
                    throw new Error(`Streaming request failed: ${response.status} ${response.statusText}`);
                }

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = "";

                while (true) {
                    const { value, done } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });

                    let newlineIndex: number;
                    while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
                        const line = buffer.slice(0, newlineIndex).trim();
                        buffer = buffer.slice(newlineIndex + 1);
                        if (!line) continue;
                        if (line.startsWith(":")) continue; // comment line in SSE

                        let data = line;
                        if (data.startsWith("data:")) {
                            data = data.slice(5).trim();
                        }

                        if (!data || data === "[DONE]") {
                            continue;
                        }

                        try {
                            const parsed = JSON.parse(data) as ResponseStreamEvent;
                            session.handleEvent(parsed);
                        } catch (parseError) {
                            console.warn("Failed to parse stream event", parseError, { data });
                        }
                    }
                }

                buffer += decoder.decode(new Uint8Array(), { stream: false });

                if (buffer.trim() && buffer.trim() !== "[DONE]") {
                    try {
                        const parsed = JSON.parse(buffer.trim()) as ResponseStreamEvent;
                        session.handleEvent(parsed);
                    } catch (parseError) {
                        console.warn("Failed to parse trailing stream event", parseError, { buffer });
                    }
                }
            } catch (error_) {
                if ((error_ as Error).name === "AbortError") {
                    return;
                }

                const failure: ResponseErrorEvent = {
                    type: "error",
                    message: error_ instanceof Error ? error_.message : "Streaming request failed",
                    sequence_number: 0,
                    code: "stream_error",
                    param: null,
                };
                sessionRef.current!.handleEvent(failure);
            } finally {
                streamingRef.current = false;
                if (abortRef.current === controller) {
                    abortRef.current = null;
                }
            }
        },
        [cancel, endpoint],
    );

    const sendMcpApprovalResponse = useCallback(
        async (approvalRequestId: string, approve: boolean) => {
            const session = sessionRef.current!;
            session.addApprovalResponse(approvalRequestId, approve);

            // Check if all pending approvals have been handled after this response
            const updatedMessages = session.getMessages();
            const approvalRequests = updatedMessages.filter(
                (msg): msg is ResponseSessionMessage =>
                    msg.kind === "output" && msg.item.type === "mcp_approval_request"
            ) as Array<{ item: { id: string } }>;

            const approvalResponses = updatedMessages.filter(
                (msg): msg is ResponseSessionMessage =>
                    msg.kind === "input" && msg.item.type === "mcp_approval_response"
            ) as Array<{ item: ResponseInputItem.McpApprovalResponse }>;

            const respondedIds = new Set(approvalResponses.map(resp => resp.item.approval_request_id));
            const remainingPendingIds = approvalRequests
                .map(req => req.item.id)
                .filter(id => !respondedIds.has(id));

            // If no pending approvals remain and we're not currently streaming, auto-send
            if (remainingPendingIds.length === 0 && !streamingRef.current && approvalResponses.length > 0) {
                // Send without user input - just the updated messages with approval responses
                void sendMessage("", true);
            }
        },
        [sendMessage],
    );


    return {
        messages: transformedMessages,
        status,
        error,
        sendMessage,
        sendMcpApprovalResponse,
        cancel,
    };
};
