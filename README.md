# Groq x Stripe MCP Chat

**A natural language chat interface that allows you to interact with Stripe's Model Context Protocol (MCP) server through conversational commands and queries.**

## Live Demo

**[View the live application](https://groq-stripe-mcp-chat.vercel.groqcloud.net)**

## Overview

This application demonstrates real-time AI chat capabilities using Groq API integrated with Stripe's Model Context Protocol (MCP) server. Built as a complete, end-to-end template that you can fork, customize, and deploy.

**Key Features:**
- Natural language interface for Stripe operations
- Real-time streaming responses with Server-Sent Events (SSE)
- MCP (Model Context Protocol) integration for secure API interactions
- Modern React/Next.js interface with shadcn/ui components
- Sub-second response times, efficient concurrent request handling, and production-grade performance powered by Groq

## Architecture

**Tech Stack:**
- **Frontend:** Next.js 15, React 18, TypeScript, Tailwind CSS
- **UI Components:** shadcn/ui with Radix UI primitives
- **Backend:** Next.js API routes with streaming SSE support
- **AI Infrastructure:** Groq API with OpenAI's GPT-OSS-120B model (`openai/gpt-oss-120b`)
- **Integration:** [Stripe MCP server](https://docs.stripe.com/mcp#remote) for payment operations

## Quick Start

### Prerequisites
- Node.js 18+ and npm
- Groq API key ([Create a free GroqCloud account and generate an API key here](https://console.groq.com/keys))
- [Stripe Secret Key](https://docs.stripe.com/keys#create-restricted-api-secret-key) for MCP server integration

### Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/build-with-groq/groq-stripe-mcp-chat
   cd groq-stripe-mcp-chat
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   Create a `.env.local` file in the root directory:
   ```env
   GROQ_API_KEY=your_groq_api_key_here
   STRIPE_SECRET_KEY=your_stripe_secret_key_here
   ```

4. **Run the development server**
   ```bash
   npm run dev
   ```

5. **Open your browser**
   Navigate to `http://localhost:3000` to start chatting with the Stripe MCP interface.

## Customization

This template is designed to be a foundation for you to get started with. Key areas for customization:
- **Model Selection:** Update Groq model configuration in `app/api/chat/route.ts:33`
- **UI/Styling:** Customize themes and components in `components/ui/` directory
- **MCP Server:** Configure different MCP servers in the tools configuration at `app/api/chat/route.ts:35-45`

## Next Steps

### For Developers
- **Create your free GroqCloud account:** Access official API docs, the playground for experimentation, and more resources via [Groq Console](https://console.groq.com).
- **Build and customize:** Fork this repo and start customizing to build out your own application.
- **Get support:** Connect with other developers building on Groq, chat with our team, and submit feature requests on our [Groq Developer Forum](https://community.groq.com).

### For Founders and Business Leaders
- **See enterprise capabilities:** This template showcases production-ready AI that can handle realtime business workloads. See other applications here.
- **Discuss Your needs:** [Contact our team](https://groq.com/enterprise-access/) to explore how Groq can accelerate your AI initiatives.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Credits

Created by [Ben Ankiel](https://www.linkedin.com/in/ben-ankiel/).
