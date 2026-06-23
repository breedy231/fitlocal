import { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import { sql } from 'drizzle-orm';
import { db } from '../db.js';
import { assembleContext } from '../lib/assistant/context.js';
import {
  ASSISTANT_TOOLS,
  MUTATING_TOOLS,
  executeAssistantTool,
  summarizeToolCall,
} from '../lib/assistant/tools.js';

const MODEL = process.env.ASSISTANT_MODEL || 'claude-haiku-4-5';
const MAX_TOOL_ROUNDS = 5;
const HISTORY_LIMIT = 20; // prior messages sent to the model
const SYSTEM_INSTRUCTIONS = `You are the FitLocal assistant — a personal trainer and nutrition coach with full access to the user's gym data, and tools to act on it.

Cardio target: 45–60 min per gym session.
Workout rotation: Push → Pull → Legs.

Use tools to log data or look up history beyond what's shown in the context below. Be concise — the user is often on their phone between sets, and talks in pounds and miles (not kg/meters).

Write in plain text — no Markdown formatting (no **bold**, headers, or bullet syntax), since responses render as plain text. Use short lines and simple dashes for lists.`;

interface ChatBody {
  message: string;
  conversationId?: string;
}

// Persist a message and bump the conversation's updated_at in one transaction so
// "most recent conversation" ordering stays correct (nothing else maintains it).
function saveMessage(conversationId: string, role: 'user' | 'assistant', content: string) {
  db.run(sql`INSERT INTO assistant_messages (conversation_id, role, content) VALUES (${conversationId}, ${role}, ${content})`);
  db.run(sql`UPDATE assistant_conversations SET updated_at = datetime('now') WHERE id = ${conversationId}`);
}

export async function assistantRoutes(app: FastifyInstance) {
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

  // History for the UI on mount: last 50 messages of the most recent conversation.
  app.get('/assistant/history', async () => {
    const conv = db.get<{ id: string }>(
      sql`SELECT id FROM assistant_conversations ORDER BY updated_at DESC LIMIT 1`
    );
    if (!conv) return { conversationId: null, messages: [] };
    const rows = db.all<{ role: string; content: string; created_at: string }>(sql`
      SELECT role, content, created_at FROM assistant_messages
      WHERE conversation_id = ${conv.id} ORDER BY id DESC LIMIT 50
    `);
    return { conversationId: conv.id, messages: rows.reverse() };
  });

  app.post<{ Body: ChatBody }>('/assistant/chat', async (req, reply) => {
    const { message } = req.body || {};
    if (!message || typeof message !== 'string' || !message.trim()) {
      return reply.code(400).send({ error: 'message is required' });
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      return reply.code(500).send({ error: 'ANTHROPIC_API_KEY is not configured' });
    }

    // Resolve / create conversation.
    let conversationId = req.body.conversationId;
    if (conversationId) {
      const exists = db.get<{ id: string }>(
        sql`SELECT id FROM assistant_conversations WHERE id = ${conversationId}`
      );
      if (!exists) conversationId = undefined;
    }
    if (!conversationId) {
      conversationId = randomUUID();
      db.run(sql`INSERT INTO assistant_conversations (id) VALUES (${conversationId})`);
    }

    // Persist the user's message before doing any work.
    saveMessage(conversationId, 'user', message.trim());

    // Load prior history (capped) — exclude the row we just inserted, then re-add it
    // as the final user turn so ordering is explicit.
    const prior = db.all<{ role: string; content: string }>(sql`
      SELECT role, content FROM assistant_messages
      WHERE conversation_id = ${conversationId} ORDER BY id DESC LIMIT ${HISTORY_LIMIT}
    `).reverse();
    const messages: Anthropic.MessageParam[] = prior.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    }));

    // System prompt: stable instructions + per-request context. Cache both —
    // identical across turns within a session (prefix-cached, not re-paid).
    const context = assembleContext();
    const system: Anthropic.TextBlockParam[] = [
      { type: 'text', text: SYSTEM_INSTRUCTIONS, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: `User's gym data:\n\n${context}`, cache_control: { type: 'ephemeral' } },
    ];

    // SSE setup — take over the socket.
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const send = (event: Record<string, unknown>) => {
      raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    let assistantText = '';
    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const stream = client.messages.stream({
          model: MODEL,
          max_tokens: 2048,
          system,
          tools: ASSISTANT_TOOLS,
          messages,
        });

        stream.on('text', (delta) => {
          assistantText += delta;
          send({ type: 'delta', text: delta });
        });

        const final = await stream.finalMessage();
        messages.push({ role: 'assistant', content: final.content });

        if (final.stop_reason !== 'tool_use') break;

        // Execute every tool call this round, feed results back.
        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const block of final.content) {
          if (block.type !== 'tool_use') continue;
          const input = (block.input || {}) as Record<string, unknown>;
          const result = executeAssistantTool(block.name, input);
          if (MUTATING_TOOLS.has(block.name)) {
            send({ type: 'tool', name: block.name, summary: summarizeToolCall(block.name, input) });
          }
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
        }
        messages.push({ role: 'user', content: toolResults });
      }
    } catch (err) {
      req.log.error({ err }, 'assistant chat failed');
      send({ type: 'error', message: err instanceof Error ? err.message : 'assistant error' });
    }

    // Persist the full assistant reply server-side regardless of client state —
    // on refresh the client reloads it from the DB even if the stream dropped.
    if (assistantText.trim()) saveMessage(conversationId, 'assistant', assistantText.trim());

    send({ type: 'done', conversationId });
    raw.end();
  });
}
