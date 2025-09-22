import OpenAI from "openai"

const client = new OpenAI({
  apiKey: process.env.GROQ_API_KEY ?? "",
  baseURL: process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1",
  defaultHeaders: process.env.CLIENT_ORIGIN ? {
    "Origin": process.env.CLIENT_ORIGIN
  } : {}
})

export async function POST(req: Request) {
  const { messages }: {
    messages: OpenAI.Responses.ResponseInput
  } = await req.json()

  // Set up SSE headers
  const headers = new Headers({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
  })

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()

      try {
        const stream = await client.responses.create({
          model: 'moonshotai/kimi-k2-instruct-0905',
          input: messages,
          tools: [
            {
              type: "mcp",
              server_label: "stripe",
              server_url: "https://mcp.stripe.com",
              headers: {
                "Authorization": `Bearer ${process.env.STRIPE_SECRET_KEY}`
              },
              require_approval: "never"
            }
          ],
          stream: true
        })

        for await (const event of stream) {
          const eventData = `data: ${JSON.stringify(event)}\n\n`
          controller.enqueue(encoder.encode(eventData))
        }
      } catch (error) {
        console.error("Stream error:", error)
        const errorEvent = {
          type: "error",
          message: "Stream error occurred",
          code: "stream_error",
          param: "stream_error",
          sequence_number: 0,
        } satisfies OpenAI.Responses.ResponseErrorEvent
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorEvent)}\n\n`))
      } finally {
        controller.close()
      }
    },
    cancel() {
      if (stream) {
        console.debug("upstream aborted by client")
        stream?.cancel()
      }
    }
  })

  return new Response(stream, { headers })
}
