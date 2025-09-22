/**
 * Runtime-agnostic helpers for working with the OpenAI Responses streaming API.
 *
 * The ResponseSession collects streaming events, keeps a single ordered
 * message array (inputs + outputs), and exposes a minimal event surface so the
 * rest of the app can subscribe without depending on Node-only primitives.
 */

import type {
    Response,
    ResponseErrorEvent,
    ResponseFunctionToolCall,
    ResponseInputItem,
    ResponseOutputItem,
    ResponseOutputMessage,
    ResponseOutputRefusal,
    ResponseOutputText,
    ResponseReasoningItem,
    ResponseStatus,
    ResponseStreamEvent,
    ResponseCustomToolCall,
    ResponseCodeInterpreterToolCall,
} from "openai/resources/responses/responses";

/** Small helper to narrow a specific event type from the union. */
type EventOfType<TType extends ResponseStreamEvent["type"]> = Extract<ResponseStreamEvent, { type: TType }>;

/** JSON clone keeps the module runtime agnostic (Node, browsers, workers). */
function clone<T>(value: T): T {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}


export interface ResponseSessionInputMessage {
    kind: "input";
    item: ResponseInputItem;
}

export interface ResponseSessionOutputMessage {
    kind: "output";
    item: ResponseOutputItem;
    outputIndex: number;
    events: ResponseStreamEvent[];
    augmentations?: OutputAugmentations;
}

export type ResponseSessionMessage = ResponseSessionInputMessage | ResponseSessionOutputMessage;

export interface OutputAugmentations {
    partialImages?: EventOfType<"response.image_generation_call.partial_image">[];
    customToolInput?: string;
    reasoningText?: EventOfType<"response.reasoning_text.delta">[];
    reasoningSummaryText?: EventOfType<"response.reasoning_summary_text.delta">[];
}

export interface SessionAugmentations {
    audio?: {
        chunks: EventOfType<"response.audio.delta">[];
        transcript: EventOfType<"response.audio.transcript.delta">[];
    };
}

export interface ResponseSessionSnapshot {
    messages: ReadonlyArray<ResponseSessionMessage>;
    status: ResponseStatus | "idle";
    response?: Response;
    error?: ResponseErrorEvent;
    sessionAugmentations?: SessionAugmentations;
}

type ResponseSessionEvents = {
    change: ResponseSessionSnapshot;
    event: ResponseStreamEvent;
    status: ResponseStatus | "idle";
    error: ResponseErrorEvent;
    end: Response | undefined;
    [event: string]: unknown;
}

type Listener<T> = (payload: T) => void;

class TinyEmitter<Events extends Record<string, unknown>> {
    private readonly listeners = new Map<keyof Events, Set<Listener<any>>>();

    on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
        const bucket = this.listeners.get(event) ?? new Set<Listener<Events[K]>>();
        bucket.add(listener);
        this.listeners.set(event, bucket as Set<Listener<any>>);
        return () => this.off(event, listener);
    }

    off<K extends keyof Events>(event: K, listener: Listener<Events[K]>): void {
        const bucket = this.listeners.get(event);
        if (!bucket) return;
        bucket.delete(listener);
        if (bucket.size === 0) {
            this.listeners.delete(event);
        }
    }

    emit<K extends keyof Events>(event: K, payload: Events[K]): void {
        const bucket = this.listeners.get(event);
        if (!bucket) return;
        bucket.forEach((listener) => {
            listener(payload);
        });
    }
}

export interface ResponseSessionOptions {
    /** Optional inputs to seed the transcript before streaming starts. */
    inputs?: ReadonlyArray<ResponseInputItem>;
    /** Optional persisted snapshot to resume from. */
    response?: Response;
}

export class ResponseSession {
    private readonly emitter = new TinyEmitter<ResponseSessionEvents>();
    private readonly messages: ResponseSessionMessage[] = [];
    private readonly idToIndex = new Map<string, number>();
    private readonly outputIndexToMessageIndex = new Map<number, number>();

    private responseSnapshot?: Response;
    private status: ResponseStatus | "idle" = "idle";
    private lastError?: ResponseErrorEvent;
    private sessionAugmentations?: SessionAugmentations;
    private ended = false;
    private endEmitted = false;
    private currentResponseId?: string;

    public constructor(options: ResponseSessionOptions = {}) {
        if (options.inputs) {
            options.inputs.forEach((input) => {
                this.addInput(input);
            });
        }
        if (options.response) {
            this.responseSnapshot = clone(options.response);
            this.status = options.response.status ?? "idle";
            this.syncOutputsFromSnapshot();
        }
    }

    public on<K extends keyof ResponseSessionEvents>(event: K, listener: Listener<ResponseSessionEvents[K]>): () => void {
        return this.emitter.on(event, listener);
    }

    public addInput(input: ResponseInputItem): ResponseSessionInputMessage {
        const entry: ResponseSessionInputMessage = { kind: "input", item: clone(input) };
        const index = this.messages.length;
        this.messages.push(entry);
        this.registerItemId(input, index);
        this.emitChange();
        return entry;
    }

    public addApprovalResponse(approvalRequestId: string, approve: boolean): ResponseSessionInputMessage {
        const approvalResponse: ResponseInputItem.McpApprovalResponse = {
            type: "mcp_approval_response",
            approve,
            approval_request_id: approvalRequestId,
        };
        return this.addInput(approvalResponse);
    }

    public handleEvent(event: ResponseStreamEvent): void {
        this.emitter.emit("event", event);
        this.mutateSnapshot(event);
        this.applyToMessages(event);

        if (event.type === "error") {
            this.lastError = event;
            this.ended = true;
            this.emitError(event);
        }

        if (event.type === "response.queued") {
            this.status = "queued";
        }

        this.emitChange();
    }

    public async consume(stream: AsyncIterable<ResponseStreamEvent>): Promise<Response | undefined> {
        for await (const event of stream) {
            this.handleEvent(event);
        }
        return this.responseSnapshot;
    }

    public getMessages(): ReadonlyArray<ResponseSessionMessage> {
        return this.messages;
    }

    public getStatus(): ResponseStatus | "idle" {
        return this.status;
    }

    public getResponse(): Response | undefined {
        return this.responseSnapshot;
    }

    public getError(): ResponseErrorEvent | undefined {
        return this.lastError;
    }

    public getSnapshot(): ResponseSessionSnapshot {
        return {
            messages: [...this.messages],
            status: this.status,
            response: this.responseSnapshot,
            error: this.lastError,
            sessionAugmentations: this.sessionAugmentations,
        };
    }

    private emitChange(): void {
        this.emitter.emit("change", this.getSnapshot());
        this.emitter.emit("status", this.status);
        if (this.ended && !this.endEmitted) {
            this.endEmitted = true;
            this.emitter.emit("end", this.responseSnapshot);
        }
    }

    private emitError(error: ResponseErrorEvent): void {
        this.emitter.emit("error", error);
    }

    private resetCurrentResponseOutputs(): void {
        const indices = Array.from(this.outputIndexToMessageIndex.values());
        this.outputIndexToMessageIndex.clear();

        indices.forEach((index) => {
            const entry = this.messages[index];
            if (entry?.kind !== "output") return;
            const outputId = (entry.item as { id?: string }).id;
            if (typeof outputId === "string") {
                this.idToIndex.delete(outputId);
            }
        });
    }

    private mutateSnapshot(event: ResponseStreamEvent): void {
        switch (event.type) {
            case "response.created":
            case "response.in_progress":
            case "response.completed":
            case "response.failed":
            case "response.incomplete": {
                const nextResponseId = event.response?.id;
                if (
                    event.type === "response.created" ||
                    (nextResponseId && nextResponseId !== this.currentResponseId)
                ) {
                    this.resetCurrentResponseOutputs();
                }
                this.currentResponseId = nextResponseId ?? this.currentResponseId;
                this.responseSnapshot = clone(event.response);
                this.status = event.response.status ?? "idle";
                this.ended = event.type !== "response.created" && event.type !== "response.in_progress";
                this.syncOutputsFromSnapshot();
                return;
            }
            case "response.output_item.added":
            case "response.output_item.done": {
                this.setSnapshotOutput(event.output_index, event.item);
                return;
            }
            case "response.content_part.added":
            case "response.content_part.done": {
                const message = this.ensureSnapshotOutputItem(event.output_index, "message", event.item_id) as
                    | ResponseOutputMessage
                    | undefined;
                if (!message) return;
                this.ensureOutputItemPresence(event.output_index, "message", event.item_id);
                const part = event.part;
                if (part.type === "output_text" || part.type === "refusal") {
                    message.content[event.content_index] = clone(part);
                }
                return;
            }
            case "response.output_text.delta": {
                const message = this.ensureSnapshotOutputItem(event.output_index, "message", event.item_id) as
                    | ResponseOutputMessage
                    | undefined;
                if (!message) return;
                this.ensureOutputItemPresence(event.output_index, "message", event.item_id);
                const content = this.ensureSnapshotText(message, event.content_index);
                content.text += event.delta;
                return;
            }
            case "response.output_text.done": {
                const message = this.ensureSnapshotOutputItem(event.output_index, "message", event.item_id) as
                    | ResponseOutputMessage
                    | undefined;
                if (!message) return;
                this.ensureOutputItemPresence(event.output_index, "message", event.item_id);
                const content = this.ensureSnapshotText(message, event.content_index);
                content.text = event.text;
                return;
            }
            case "response.output_text.annotation.added": {
                const message = this.ensureSnapshotOutputItem(event.output_index, "message", event.item_id) as
                    | ResponseOutputMessage
                    | undefined;
                if (!message) return;
                this.ensureOutputItemPresence(event.output_index, "message", event.item_id);
                const content = this.ensureSnapshotText(message, event.content_index);
                const annotations = content.annotations ?? [];
                const annotationEvent = event as EventOfType<"response.output_text.annotation.added">;
                const annotation = clone(annotationEvent.annotation) as ResponseOutputText["annotations"][number];
                annotations[annotationEvent.annotation_index] = annotation;
                content.annotations = annotations;
                return;
            }
            case "response.refusal.delta": {
                const message = this.ensureSnapshotOutputItem(event.output_index, "message", event.item_id) as
                    | ResponseOutputMessage
                    | undefined;
                if (!message) return;
                this.ensureOutputItemPresence(event.output_index, "message", event.item_id);
                const refusal = this.ensureSnapshotRefusal(message, event.content_index);
                refusal.refusal += event.delta;
                return;
            }
            case "response.refusal.done": {
                const message = this.ensureSnapshotOutputItem(event.output_index, "message", event.item_id) as
                    | ResponseOutputMessage
                    | undefined;
                if (!message) return;
                this.ensureOutputItemPresence(event.output_index, "message", event.item_id);
                const refusal = this.ensureSnapshotRefusal(message, event.content_index);
                const refusalEvent = event as EventOfType<"response.refusal.done">;
                refusal.refusal = refusalEvent.refusal;
                return;
            }
            case "response.function_call_arguments.delta": {
                const fn = this.ensureSnapshotOutputItem(event.output_index, "function_call", event.item_id);
                if (fn?.type === "function_call") {
                    this.ensureOutputItemPresence(event.output_index, "function_call", event.item_id);
                    fn.arguments += event.delta;
                }
                return;
            }
            case "response.function_call_arguments.done": {
                const fn = this.ensureSnapshotOutputItem(event.output_index, "function_call", event.item_id);
                if (fn?.type === "function_call") {
                    this.ensureOutputItemPresence(event.output_index, "function_call", event.item_id);
                    fn.arguments = event.arguments;
                }
                return;
            }
            case "response.custom_tool_call_input.delta": {
                const tool = this.ensureSnapshotOutputItem(event.output_index, "custom_tool_call", event.item_id);
                if (tool?.type === "custom_tool_call") {
                    this.ensureOutputItemPresence(event.output_index, "custom_tool_call", event.item_id);
                    tool.input += event.delta;
                }
                return;
            }
            case "response.custom_tool_call_input.done": {
                const tool = this.ensureSnapshotOutputItem(event.output_index, "custom_tool_call", event.item_id);
                if (tool?.type === "custom_tool_call") {
                    this.ensureOutputItemPresence(event.output_index, "custom_tool_call", event.item_id);
                    tool.input = event.input;
                }
                return;
            }
            case "response.mcp_call_arguments.delta": {
                const call = this.ensureSnapshotOutputItem(event.output_index, "mcp_call", event.item_id);
                if (call?.type === "mcp_call") {
                    this.ensureOutputItemPresence(event.output_index, "mcp_call", event.item_id);
                    call.arguments += event.delta;
                }
                return;
            }
            case "response.mcp_call_arguments.done": {
                const call = this.ensureSnapshotOutputItem(event.output_index, "mcp_call", event.item_id);
                if (call?.type === "mcp_call") {
                    this.ensureOutputItemPresence(event.output_index, "mcp_call", event.item_id);
                    call.arguments = event.arguments;
                }
                return;
            }
            case "response.code_interpreter_call_code.delta": {
                const code = this.ensureSnapshotOutputItem(event.output_index, "code_interpreter_call", event.item_id);
                if (code?.type === "code_interpreter_call") {
                    this.ensureOutputItemPresence(event.output_index, "code_interpreter_call", event.item_id);
                    code.code += event.delta;
                }
                return;
            }
            case "response.code_interpreter_call_code.done": {
                const code = this.ensureSnapshotOutputItem(event.output_index, "code_interpreter_call", event.item_id);
                if (code?.type === "code_interpreter_call") {
                    this.ensureOutputItemPresence(event.output_index, "code_interpreter_call", event.item_id);
                    code.code = event.code;
                }
                return;
            }
            case "response.code_interpreter_call.in_progress":
            case "response.code_interpreter_call.interpreting":
            case "response.code_interpreter_call.completed": {
                const code = this.ensureSnapshotOutputItem(event.output_index, "code_interpreter_call", event.item_id);
                if (code?.type === "code_interpreter_call") {
                    this.ensureOutputItemPresence(event.output_index, "code_interpreter_call", event.item_id);
                    code.status =
                        event.type === "response.code_interpreter_call.completed"
                            ? "completed"
                            : event.type === "response.code_interpreter_call.interpreting"
                              ? "interpreting"
                              : "in_progress";
                }
                return;
            }
            case "response.image_generation_call.in_progress":
            case "response.image_generation_call.generating":
            case "response.image_generation_call.completed": {
                const image = this.ensureSnapshotOutputItem(event.output_index, "image_generation_call", event.item_id) as
                    | ResponseOutputItem.ImageGenerationCall
                    | undefined;
                if (image?.type === "image_generation_call") {
                    this.ensureOutputItemPresence(event.output_index, "image_generation_call", event.item_id);
                    image.status =
                        event.type === "response.image_generation_call.completed"
                            ? "completed"
                            : event.type === "response.image_generation_call.generating"
                              ? "generating"
                              : "in_progress";
                }
                return;
            }
            case "response.reasoning_summary_part.added":
            case "response.reasoning_summary_part.done": {
                const reasoning = this.ensureSnapshotOutputItem(event.output_index, "reasoning", event.item_id) as
                    | ResponseReasoningItem
                    | undefined;
                if (reasoning?.type === "reasoning") {
                    this.ensureOutputItemPresence(event.output_index, "reasoning", event.item_id);
                    reasoning.summary[event.summary_index] = clone(event.part);
                }
                return;
            }
            case "response.reasoning_summary_text.delta": {
                const reasoning = this.ensureSnapshotOutputItem(event.output_index, "reasoning", event.item_id) as
                    | ResponseReasoningItem
                    | undefined;
                if (reasoning?.type === "reasoning") {
                    this.ensureOutputItemPresence(event.output_index, "reasoning", event.item_id);
                    const summary = reasoning.summary[event.summary_index];
                    if (summary && "text" in summary) {
                        summary.text += event.delta;
                    }
                }
                return;
            }
            case "response.reasoning_summary_text.done": {
                const reasoning = this.ensureSnapshotOutputItem(event.output_index, "reasoning", event.item_id) as
                    | ResponseReasoningItem
                    | undefined;
                if (reasoning?.type === "reasoning") {
                    this.ensureOutputItemPresence(event.output_index, "reasoning", event.item_id);
                    const summary = reasoning.summary[event.summary_index];
                    if (summary && "text" in summary) {
                        summary.text = event.text;
                    }
                }
                return;
            }
            case "response.reasoning_text.delta": {
                const reasoning = this.ensureSnapshotOutputItem(event.output_index, "reasoning", event.item_id) as
                    | ResponseReasoningItem
                    | undefined;
                if (reasoning?.type === "reasoning") {
                    this.ensureOutputItemPresence(event.output_index, "reasoning", event.item_id);
                    const summary = reasoning.summary[event.content_index];
                    if (summary && "text" in summary) {
                        summary.text += event.delta;
                    }
                }
                return;
            }
            case "response.reasoning_text.done": {
                const reasoning = this.ensureSnapshotOutputItem(event.output_index, "reasoning", event.item_id) as
                    | ResponseReasoningItem
                    | undefined;
                if (reasoning?.type === "reasoning") {
                    this.ensureOutputItemPresence(event.output_index, "reasoning", event.item_id);
                    const summary = reasoning.summary[event.content_index];
                    if (summary && "text" in summary) {
                        summary.text = event.text;
                    }
                }
                return;
            }
            default:
                return;
        }
    }

    private applyToMessages(event: ResponseStreamEvent): void {
        switch (event.type) {
            case "response.output_item.added": {
                const entry = this.ensureOutputEntry(event.item, event.output_index);
                entry.events.push(event);
                break;
            }
            case "response.output_item.done": {
                const entry = this.ensureOutputEntry(event.item, event.output_index);
                entry.item = clone(event.item);
                entry.events.push(event);
                break;
            }
            case "response.content_part.added":
            case "response.content_part.done": {
                let entry = this.findOutputEntry(event.item_id, event.output_index);
                if (!entry) {
                    entry = this.ensureOutputItemPresence(event.output_index, "message", event.item_id);
                }
                if (entry && entry.item.type === "message") {
                    const part = event.part;
                    if (part.type === "output_text" || part.type === "refusal") {
                        const cloned = clone(part) as ResponseOutputMessage["content"][number];
                        this.ensureMessageContentSlot(entry.item, event.content_index, cloned.type);
                        entry.item.content[event.content_index] = cloned;
                        entry.events.push(event);
                    }
                }
                break;
            }
            case "response.output_text.delta": {
                let entry = this.findOutputEntry(event.item_id, event.output_index);
                if (!entry) {
                    entry = this.ensureOutputItemPresence(event.output_index, "message", event.item_id);
                }
                if (entry && entry.item.type === "message") {
                    const text = this.ensureMessageText(entry.item, event.content_index);
                    text.text += event.delta;
                    entry.events.push(event);
                }
                break;
            }
            case "response.output_text.done": {
                let entry = this.findOutputEntry(event.item_id, event.output_index);
                if (!entry) {
                    entry = this.ensureOutputItemPresence(event.output_index, "message", event.item_id);
                }
                if (entry && entry.item.type === "message") {
                    const text = this.ensureMessageText(entry.item, event.content_index);
                    text.text = event.text;
                    entry.events.push(event);
                }
                break;
            }
            case "response.output_text.annotation.added": {
                const annotationEvent = event as EventOfType<"response.output_text.annotation.added">;
                let entry = this.findOutputEntry(annotationEvent.item_id, annotationEvent.output_index);
                if (!entry) {
                    entry = this.ensureOutputItemPresence(annotationEvent.output_index, "message", annotationEvent.item_id);
                }
                if (entry && entry.item.type === "message") {
                    const text = this.ensureMessageText(entry.item, annotationEvent.content_index);
                    const annotations = text.annotations ?? [];
                    const annotation = clone(annotationEvent.annotation) as ResponseOutputText["annotations"][number];
                    annotations[annotationEvent.annotation_index] = annotation;
                    text.annotations = annotations;
                    entry.events.push(annotationEvent);
                }
                break;
            }
            case "response.refusal.delta": {
                let entry = this.findOutputEntry(event.item_id, event.output_index);
                if (!entry) {
                    entry = this.ensureOutputItemPresence(event.output_index, "message", event.item_id);
                }
                if (entry && entry.item.type === "message") {
                    const refusal = this.ensureMessageRefusal(entry.item, event.content_index);
                    refusal.refusal += event.delta;
                    entry.events.push(event);
                }
                break;
            }
            case "response.refusal.done": {
                let entry = this.findOutputEntry(event.item_id, event.output_index);
                if (!entry) {
                    entry = this.ensureOutputItemPresence(event.output_index, "message", event.item_id);
                }
                if (entry && entry.item.type === "message") {
                    const refusalEvent = event as EventOfType<"response.refusal.done">;
                    const refusal = this.ensureMessageRefusal(entry.item, refusalEvent.content_index);
                    refusal.refusal = refusalEvent.refusal;
                    entry.events.push(refusalEvent);
                }
                break;
            }
            case "response.function_call_arguments.delta": {
                let entry = this.findOutputEntry(event.item_id, event.output_index);
                if (!entry) {
                    entry = this.ensureOutputItemPresence(event.output_index, "function_call", event.item_id);
                }
                if (entry && entry.item.type === "function_call") {
                    entry.item.arguments += event.delta;
                    entry.events.push(event);
                }
                break;
            }
            case "response.function_call_arguments.done": {
                let entry = this.findOutputEntry(event.item_id, event.output_index);
                if (!entry) {
                    entry = this.ensureOutputItemPresence(event.output_index, "function_call", event.item_id);
                }
                if (entry && entry.item.type === "function_call") {
                    entry.item.arguments = event.arguments;
                    entry.events.push(event);
                }
                break;
            }
            case "response.custom_tool_call_input.delta": {
                let entry = this.findOutputEntry(event.item_id, event.output_index);
                if (!entry) {
                    entry = this.ensureOutputItemPresence(event.output_index, "custom_tool_call", event.item_id);
                }
                if (entry && entry.item.type === "custom_tool_call") {
                    const augmentations = this.ensureAugmentations(entry);
                    augmentations.customToolInput = (augmentations.customToolInput ?? "") + event.delta;
                    entry.events.push(event);
                }
                break;
            }
            case "response.custom_tool_call_input.done": {
                let entry = this.findOutputEntry(event.item_id, event.output_index);
                if (!entry) {
                    entry = this.ensureOutputItemPresence(event.output_index, "custom_tool_call", event.item_id);
                }
                if (entry && entry.item.type === "custom_tool_call") {
                    const doneEvent = event as EventOfType<"response.custom_tool_call_input.done">;
                    const augmentations = this.ensureAugmentations(entry);
                    augmentations.customToolInput = doneEvent.input;
                    entry.events.push(doneEvent);
                }
                break;
            }
            case "response.mcp_call_arguments.delta": {
                let entry = this.findOutputEntry(event.item_id, event.output_index);
                if (!entry) {
                    entry = this.ensureOutputItemPresence(event.output_index, "mcp_call", event.item_id);
                }
                if (entry && entry.item.type === "mcp_call") {
                    entry.item.arguments += event.delta;
                    entry.events.push(event);
                }
                break;
            }
            case "response.mcp_call_arguments.done": {
                let entry = this.findOutputEntry(event.item_id, event.output_index);
                if (!entry) {
                    entry = this.ensureOutputItemPresence(event.output_index, "mcp_call", event.item_id);
                }
                if (entry && entry.item.type === "mcp_call") {
                    entry.item.arguments = event.arguments;
                    entry.events.push(event);
                }
                break;
            }
            case "response.mcp_call.in_progress":
            case "response.mcp_call.completed":
            case "response.mcp_call.failed":
            case "response.mcp_list_tools.in_progress":
            case "response.mcp_list_tools.completed":
            case "response.mcp_list_tools.failed": {
                const ensuredType = event.type.startsWith("response.mcp_list_tools") ? "mcp_list_tools" : "mcp_call";
                this.ensureOutputItemPresence(event.output_index, ensuredType as ResponseOutputItem["type"], (event as { item_id?: string }).item_id);
                this.recordOutputEvent(event.output_index, (event as { item_id?: string }).item_id, event);
                break;
            }
            case "response.reasoning_summary_part.added":
            case "response.reasoning_summary_part.done": {
                let entry = this.findOutputEntry(event.item_id, event.output_index);
                if (!entry) {
                    entry = this.ensureOutputItemPresence(event.output_index, "reasoning", event.item_id);
                }
                if (entry && entry.item.type === "reasoning") {
                    entry.item.summary[event.summary_index] = clone(event.part);
                    entry.events.push(event);
                }
                break;
            }
            case "response.reasoning_summary_text.done": {
                let entry = this.findOutputEntry(event.item_id, event.output_index);
                if (!entry) {
                    entry = this.ensureOutputItemPresence(event.output_index, "reasoning", event.item_id);
                }
                if (entry && entry.item.type === "reasoning") {
                    const summary = entry.item.summary[event.summary_index];
                    if (summary && "text" in summary) {
                        summary.text = event.text;
                    }
                    entry.events.push(event);
                }
                break;
            }
            case "response.reasoning_text.done": {
                let entry = this.findOutputEntry(event.item_id, event.output_index);
                if (!entry) {
                    entry = this.ensureOutputItemPresence(event.output_index, "reasoning", event.item_id);
                }
                if (entry && entry.item.type === "reasoning") {
                    const summary = entry.item.summary[event.content_index];
                    if (summary && "text" in summary) {
                        summary.text = event.text;
                    }
                    entry.events.push(event);
                }
                break;
            }
            case "response.code_interpreter_call_code.delta": {
                let entry = this.findOutputEntry(undefined, event.output_index);
                if (!entry) {
                    entry = this.ensureOutputItemPresence(event.output_index, "code_interpreter_call", event.item_id);
                }
                if (entry && entry.item.type === "code_interpreter_call") {
                    entry.item.code += event.delta;
                    entry.events.push(event);
                }
                break;
            }
            case "response.code_interpreter_call_code.done": {
                let entry = this.findOutputEntry(undefined, event.output_index);
                if (!entry) {
                    entry = this.ensureOutputItemPresence(event.output_index, "code_interpreter_call", event.item_id);
                }
                if (entry && entry.item.type === "code_interpreter_call") {
                    entry.item.code = event.code;
                    entry.events.push(event);
                }
                break;
            }
            case "response.code_interpreter_call.in_progress":
            case "response.code_interpreter_call.interpreting":
            case "response.code_interpreter_call.completed": {
                let entry = this.findOutputEntry(undefined, event.output_index);
                if (!entry) {
                    entry = this.ensureOutputItemPresence(event.output_index, "code_interpreter_call", event.item_id);
                }
                if (entry && entry.item.type === "code_interpreter_call") {
                    entry.item.status =
                        event.type === "response.code_interpreter_call.completed"
                            ? "completed"
                            : event.type === "response.code_interpreter_call.interpreting"
                              ? "interpreting"
                              : "in_progress";
                    entry.events.push(event);
                }
                break;
            }
            case "response.image_generation_call.in_progress":
            case "response.image_generation_call.generating":
            case "response.image_generation_call.completed": {
                let entry = this.findOutputEntry(event.item_id, event.output_index);
                if (!entry) {
                    entry = this.ensureOutputItemPresence(event.output_index, "image_generation_call", event.item_id);
                }
                if (entry && entry.item.type === "image_generation_call") {
                    entry.item.status =
                        event.type === "response.image_generation_call.completed"
                            ? "completed"
                            : event.type === "response.image_generation_call.generating"
                              ? "generating"
                              : "in_progress";
                    entry.events.push(event);
                }
                break;
            }
            case "response.image_generation_call.partial_image": {
                const entry = this.recordOutputEvent(event.output_index, event.item_id, event);
                if (entry) {
                    const aug = this.ensureAugmentations(entry);
                    aug.partialImages = aug.partialImages ?? [];
                    aug.partialImages.push(event);
                }
                break;
            }
            case "response.reasoning_text.delta": {
                const entry = this.findOutputEntry(event.item_id, event.output_index);
                if (entry && entry.item.type === "reasoning") {
                    const summary = entry.item.summary[event.content_index];
                    if (summary && "text" in summary) {
                        summary.text += event.delta;
                    }
                    const aug = this.ensureAugmentations(entry);
                    aug.reasoningText = aug.reasoningText ?? [];
                    aug.reasoningText.push(event);
                    entry.events.push(event);
                }
                break;
            }
            case "response.reasoning_summary_text.delta": {
                const entry = this.findOutputEntry(event.item_id, event.output_index);
                if (entry && entry.item.type === "reasoning") {
                    const summary = entry.item.summary[event.summary_index];
                    if (summary && "text" in summary) {
                        summary.text += event.delta;
                    }
                    const aug = this.ensureAugmentations(entry);
                    aug.reasoningSummaryText = aug.reasoningSummaryText ?? [];
                    aug.reasoningSummaryText.push(event);
                    entry.events.push(event);
                }
                break;
            }
            case "response.audio.delta": {
                this.appendAudioChunk(event);
                break;
            }
            case "response.audio.transcript.delta": {
                this.appendAudioTranscript(event);
                break;
            }
            case "response.audio.done":
            case "response.audio.transcript.done":
            case "response.queued":
            case "response.created":
            case "response.in_progress":
            case "response.completed":
            case "response.failed":
            case "response.incomplete":
            case "error":
                break;
            default: {
                const outputIndex = (event as { output_index?: number }).output_index;
                if (typeof outputIndex === "number") {
                    const itemId = (event as { item_id?: string }).item_id;
                    this.recordOutputEvent(outputIndex, typeof itemId === "string" ? itemId : undefined, event);
                }
                break;
            }
        }
    }

    private appendAudioChunk(event: EventOfType<"response.audio.delta">): void {
        const audio = this.ensureSessionAudio();
        audio?.chunks.push(event);
    }

    private appendAudioTranscript(event: EventOfType<"response.audio.transcript.delta">): void {
        const audio = this.ensureSessionAudio();
        audio?.transcript.push(event);
    }

    private makeId(prefix: string): string {
        return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }

    private createPlaceholderOutput(type: ResponseOutputItem["type"], itemId?: string): ResponseOutputItem {
        const id = itemId ?? this.makeId(type);
        switch (type) {
            case "message": {
                const placeholder: ResponseOutputMessage = {
                    id,
                    type: "message",
                    role: "assistant",
                    status: "in_progress",
                    content: [],
                };
                return placeholder;
            }
            case "reasoning": {
                const placeholder: ResponseReasoningItem = {
                    id,
                    type: "reasoning",
                    summary: [],
                    status: "in_progress",
                };
                return placeholder;
            }
            case "function_call": {
                const placeholder: ResponseFunctionToolCall = {
                    id,
                    type: "function_call",
                    call_id: id,
                    name: "",
                    arguments: "",
                    status: "in_progress",
                };
                return placeholder;
            }
            case "custom_tool_call": {
                const placeholder: ResponseCustomToolCall = {
                    id,
                    type: "custom_tool_call",
                    call_id: id,
                    name: "",
                    input: "",
                };
                return placeholder;
            }
            case "mcp_call": {
                const placeholder: ResponseOutputItem.McpCall = {
                    id,
                    type: "mcp_call",
                    name: "",
                    server_label: "",
                    arguments: "",
                };
                return placeholder;
            }
            case "mcp_list_tools": {
                const placeholder: ResponseOutputItem.McpListTools = {
                    id,
                    type: "mcp_list_tools",
                    server_label: "",
                    tools: [],
                };
                return placeholder;
            }
            case "code_interpreter_call": {
                const placeholder: ResponseCodeInterpreterToolCall = {
                    id,
                    type: "code_interpreter_call",
                    code: "",
                    outputs: [],
                    container_id: "",
                    status: "in_progress",
                };
                return placeholder;
            }
            case "image_generation_call": {
                const placeholder: ResponseOutputItem.ImageGenerationCall = {
                    id,
                    type: "image_generation_call",
                    status: "in_progress",
                    result: null,
                };
                return placeholder;
            }
            default:
                return { type } as ResponseOutputItem;
        }
    }

    private ensureSnapshotOutputItem(
        outputIndex: number,
        type: ResponseOutputItem["type"],
        itemId?: string,
    ): ResponseOutputItem | undefined {
        if (!this.responseSnapshot) return undefined;

        let item = this.responseSnapshot.output[outputIndex];
        if (!item || item.type !== type) {
            item = this.createPlaceholderOutput(type, itemId);
            this.setSnapshotOutput(outputIndex, item);
        } else if (itemId && "id" in item && typeof item.id === "string" && item.id !== itemId) {
            item.id = itemId;
        }

        this.registerItemId(item as { id?: string }, outputIndex);
        return item;
    }

    private ensureOutputItemPresence(
        outputIndex: number,
        type: ResponseOutputItem["type"],
        itemId?: string,
    ): ResponseSessionOutputMessage | undefined {
        const snapshotItem = this.ensureSnapshotOutputItem(outputIndex, type, itemId);
        if (!snapshotItem) return undefined;
        return this.ensureOutputEntry(snapshotItem, outputIndex);
    }

    private ensureOutputEntry(item: ResponseOutputItem, outputIndex: number): ResponseSessionOutputMessage {
        const existingIndex = this.outputIndexToMessageIndex.get(outputIndex);
        if (existingIndex != null) {
            const existing = this.messages[existingIndex];
            if (existing?.kind === "output") {
                existing.item = clone(item);
                existing.outputIndex = outputIndex;
                this.registerItemId(item, existingIndex);
                return existing;
            }
        }
        const entry: ResponseSessionOutputMessage = {
            kind: "output",
            item: clone(item),
            outputIndex,
            events: [],
        };
        
        // Find the correct insertion point to maintain outputIndex order
        const insertionIndex = this.findInsertionPoint(outputIndex);
        this.messages.splice(insertionIndex, 0, entry);
        
        // Update all mappings that come after the insertion point
        this.updateMappingsAfterInsertion(insertionIndex, outputIndex);
        
        this.registerItemId(item, insertionIndex);
        return entry;
    }

    private findOutputEntry(itemId: string | undefined, outputIndex: number | undefined): ResponseSessionOutputMessage | undefined {
        if (itemId) {
            const idx = this.idToIndex.get(itemId);
            if (idx != null) {
                const entry = this.messages[idx];
                if (entry?.kind === "output") {
                    return entry;
                }
            }
        }
        if (outputIndex != null) {
            const idx = this.outputIndexToMessageIndex.get(outputIndex);
            if (idx != null) {
                const entry = this.messages[idx];
                if (entry?.kind === "output") {
                    return entry;
                }
            }
        }
        return undefined;
    }

    private ensureMessageContentSlot(message: ResponseOutputMessage, index: number, type: "output_text" | "refusal"): void {
        while (message.content.length <= index) {
            message.content.push({ type: "output_text", text: "", annotations: [] });
        }
        const current = message.content[index];
        if (!current || current.type !== type) {
            if (type === "output_text") {
                message.content[index] = { type: "output_text", text: "", annotations: [] };
            } else {
                message.content[index] = { type: "refusal", refusal: "" } as ResponseOutputRefusal;
            }
        }
    }

    private ensureMessageText(message: ResponseOutputMessage, index: number): ResponseOutputText {
        this.ensureMessageContentSlot(message, index, "output_text");
        const content = message.content[index];
        const text = content as ResponseOutputText;
        text.annotations = text.annotations ?? [];
        return text;
    }

    private ensureMessageRefusal(message: ResponseOutputMessage, index: number): ResponseOutputRefusal {
        this.ensureMessageContentSlot(message, index, "refusal");
        return message.content[index] as ResponseOutputRefusal;
    }

    private ensureSessionAudio(): SessionAugmentations["audio"] {
        if (!this.sessionAugmentations) {
            this.sessionAugmentations = {};
        }
        if (!this.sessionAugmentations.audio) {
            this.sessionAugmentations.audio = { chunks: [], transcript: [] };
        }
        return this.sessionAugmentations.audio;
    }

    private ensureAugmentations(entry: ResponseSessionOutputMessage): OutputAugmentations {
        if (!entry.augmentations) {
            entry.augmentations = {};
        }
        return entry.augmentations;
    }

    private setSnapshotOutput(outputIndex: number, item: ResponseOutputItem): void {
        if (!this.responseSnapshot) return;
        const copy = clone(item);
        this.responseSnapshot.output[outputIndex] = copy;
    }

    private getSnapshotOutput(outputIndex: number | undefined, itemId?: string): ResponseOutputItem | undefined {
        if (!this.responseSnapshot || outputIndex == null) return undefined;
        const byIndex = this.responseSnapshot.output[outputIndex];
        if (itemId && byIndex && "id" in byIndex && byIndex.id && byIndex.id !== itemId) {
            return this.responseSnapshot.output.find((candidate) => (candidate as { id?: string }).id === itemId);
        }
        return byIndex;
    }

    private getSnapshotMessage(outputIndex: number | undefined, itemId?: string): ResponseOutputMessage | undefined {
        const item = this.getSnapshotOutput(outputIndex, itemId);
        return item?.type === "message" ? item : undefined;
    }

    private ensureSnapshotText(message: ResponseOutputMessage, contentIndex: number): ResponseOutputText {
        while (message.content.length <= contentIndex) {
            message.content.push({ type: "output_text", text: "", annotations: [] });
        }
        const current = message.content[contentIndex];
        if (current && current.type === "output_text") {
            current.annotations = current.annotations ?? [];
            return current;
        }
        const created: ResponseOutputText = { type: "output_text", text: "", annotations: [] };
        message.content[contentIndex] = created;
        return created;
    }

    private ensureSnapshotRefusal(message: ResponseOutputMessage, contentIndex: number): ResponseOutputRefusal {
        while (message.content.length <= contentIndex) {
            message.content.push({ type: "refusal", refusal: "" });
        }
        const current = message.content[contentIndex];
        if (current && current.type === "refusal") {
            return current;
        }
        const created: ResponseOutputRefusal = { type: "refusal", refusal: "" };
        message.content[contentIndex] = created;
        return created;
    }

    private recordOutputEvent(outputIndex: number | undefined, itemId: string | undefined, event: ResponseStreamEvent): ResponseSessionOutputMessage | undefined {
        if (itemId) {
            const byId = this.idToIndex.get(itemId);
            if (byId != null) {
                const entry = this.messages[byId];
                if (entry?.kind === "output") {
                    entry.events.push(event);
                    return entry;
                }
            }
        }
        if (outputIndex == null) return undefined;
        const entry = this.ensureOutputEntryFromSnapshot(outputIndex);
        if (entry) {
            entry.events.push(event);
            if (itemId) {
                this.registerItemId(entry.item, this.outputIndexToMessageIndex.get(outputIndex) ?? this.messages.indexOf(entry));
            }
        }
        return entry;
    }

    private ensureOutputEntryFromSnapshot(outputIndex: number): ResponseSessionOutputMessage | undefined {
        const snapshotItem = this.responseSnapshot?.output[outputIndex];
        if (!snapshotItem) return undefined;
        const existingIndex = this.outputIndexToMessageIndex.get(outputIndex);
        if (existingIndex != null) {
            const existingEntry = this.messages[existingIndex];
            if (existingEntry?.kind === "output") {
                existingEntry.item = snapshotItem;
                this.registerItemId(snapshotItem, existingIndex);
                return existingEntry;
            }
        }
        const entry: ResponseSessionOutputMessage = {
            kind: "output",
            item: snapshotItem,
            outputIndex,
            events: [],
        };
        
        // Find the correct insertion point to maintain outputIndex order
        const insertionIndex = this.findInsertionPoint(outputIndex);
        this.messages.splice(insertionIndex, 0, entry);
        
        // Update all mappings that come after the insertion point
        this.updateMappingsAfterInsertion(insertionIndex, outputIndex);
        
        this.registerItemId(snapshotItem, insertionIndex);
        return entry;
    }

    private findInsertionPoint(outputIndex: number): number {
        // Find the correct position to insert this outputIndex to maintain order
        // We want to insert after all input messages and before any output with higher outputIndex
        
        let insertionIndex = 0;
        
        // Skip all input messages - they should always come first
        while (insertionIndex < this.messages.length && this.messages[insertionIndex].kind === "input") {
            insertionIndex++;
        }
        
        // Find the position among output messages based on outputIndex
        while (insertionIndex < this.messages.length) {
            const message = this.messages[insertionIndex];
            if (message.kind === "output" && message.outputIndex > outputIndex) {
                break;
            }
            insertionIndex++;
        }
        
        return insertionIndex;
    }

    private updateMappingsAfterInsertion(insertionIndex: number, newOutputIndex: number): void {
        // Update outputIndexToMessageIndex mapping for the new entry
        this.outputIndexToMessageIndex.set(newOutputIndex, insertionIndex);
        
        // Update all mappings for entries that were shifted down
        for (let i = insertionIndex + 1; i < this.messages.length; i++) {
            const message = this.messages[i];
            if (message.kind === "output") {
                this.outputIndexToMessageIndex.set(message.outputIndex, i);
            }
            
            // Update idToIndex mapping for shifted entries
            const id = (message.item as { id?: string }).id;
            if (typeof id === "string" && id.length > 0) {
                this.idToIndex.set(id, i);
            }
        }
    }

    private registerItemId(item: unknown, index: number): void {
        if (!item || typeof item !== "object") return;
        const id = (item as { id?: unknown }).id;
        if (typeof id === "string" && id.length > 0) {
            this.idToIndex.set(id, index);
        }
    }

    private syncOutputsFromSnapshot(): void {
        if (!this.responseSnapshot) return;
        this.responseSnapshot.output.forEach((_, index) => {
            this.ensureOutputEntryFromSnapshot(index);
        });
    }
}
