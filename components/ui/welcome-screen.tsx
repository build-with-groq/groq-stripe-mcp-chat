import Image from "next/image"

export function WelcomeScreen() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center space-y-6 p-8">
      <div className="flex items-center justify-center space-x-4">
        <div className="flex items-center justify-center w-20 h-20 rounded-full bg-groq-orange">
          <Image src="/groq-logo.png" alt="Groq" width={40} height={40} className="rounded-full" />
        </div>
        <div className="flex items-center justify-center w-20 h-20 rounded-full bg-[#635bff] -ml-8 border border-gray-200">
          <Image src="/stripe-logo.jpeg" alt="Stripe" width={40} height={40} className="rounded-full" />
        </div>
      </div>
      <div className="space-y-3">
        <h1 className="text-3xl font-bold text-foreground">Groq x Stripe Chat</h1>
        <p className="text-muted-foreground max-w-2xl text-balance leading-relaxed">
          Natural language chat interface that allows you to interact with Stripe's Model Context Protocol (MCP) server
          through conversational commands and queries.
        </p>
      </div>
      <div className="text-sm text-muted-foreground/80">Start typing to begin your conversation</div>
    </div>
  )
}
