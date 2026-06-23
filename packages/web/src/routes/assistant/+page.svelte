<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { getApiBase, getAuthHeaders } from '$lib/api';

  interface ToolChip { name: string; summary: string; }
  interface Msg { role: 'user' | 'assistant'; content: string; tools?: ToolChip[]; }

  const DRAFT_KEY = 'fitlocal_assistant_draft';

  let messages = $state<Msg[]>([]);
  let input = $state('');
  let conversationId = $state<string | null>(null);
  let streaming = $state(false);
  let loadingHistory = $state(true);
  let scroller: HTMLDivElement | null = null;

  async function scrollToBottom() {
    await tick();
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }

  onMount(async () => {
    input = localStorage.getItem(DRAFT_KEY) ?? '';
    try {
      const res = await fetch(`${getApiBase()}/assistant/history`, { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        conversationId = data.conversationId;
        messages = (data.messages ?? []).map((m: { role: string; content: string }) => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content,
        }));
      }
    } catch { /* offline — start fresh */ }
    loadingHistory = false;
    scrollToBottom();
  });

  // iOS PWA swipe-kill does not fire beforeunload — persist the draft on hide.
  function persistDraft() {
    if (input.trim()) localStorage.setItem(DRAFT_KEY, input);
    else localStorage.removeItem(DRAFT_KEY);
  }
  function onVisibility() {
    if (document.visibilityState === 'hidden') persistDraft();
  }
  onMount(() => {
    document.addEventListener('visibilitychange', onVisibility);
  });
  onDestroy(() => {
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
  });

  function newConversation() {
    if (streaming) return;
    messages = [];
    conversationId = null;
    input = '';
    localStorage.removeItem(DRAFT_KEY);
  }

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;
    input = '';
    localStorage.removeItem(DRAFT_KEY);
    messages = [...messages, { role: 'user', content: text }];
    const assistantIdx = messages.length;
    messages = [...messages, { role: 'assistant', content: '', tools: [] }];
    streaming = true;
    scrollToBottom();

    try {
      const res = await fetch(`${getApiBase()}/assistant/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ message: text, conversationId }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const chunks = buf.split('\n\n');
        buf = chunks.pop() ?? ''; // keep incomplete trailing chunk
        for (const chunk of chunks) {
          const line = chunk.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          const evt = JSON.parse(line.slice(6));
          const cur = messages[assistantIdx];
          if (evt.type === 'delta') {
            cur.content += evt.text;
            messages = messages;
          } else if (evt.type === 'tool') {
            cur.tools = [...(cur.tools ?? []), { name: evt.name, summary: evt.summary }];
            messages = messages;
          } else if (evt.type === 'done') {
            conversationId = evt.conversationId;
          } else if (evt.type === 'error') {
            cur.content += `\n\n⚠️ ${evt.message}`;
            messages = messages;
          }
          scrollToBottom();
        }
      }
    } catch (err) {
      messages[assistantIdx].content += `\n\n⚠️ ${err instanceof Error ? err.message : 'Connection lost'}`;
      messages = messages;
    } finally {
      streaming = false;
      scrollToBottom();
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }
</script>

<div class="flex flex-col h-screen" style="background-color: #0f0f0f;">
  <!-- Header -->
  <header class="flex items-center justify-between pl-4 pr-14 md:pr-4 py-3 border-b border-neutral-800 shrink-0">
    <h1 class="text-lg font-bold text-green-400">Coach</h1>
    <button
      onclick={newConversation}
      disabled={streaming}
      class="text-sm text-neutral-400 hover:text-neutral-200 disabled:opacity-40 min-h-[44px] px-3 rounded-lg hover:bg-neutral-800 transition-colors"
    >
      New chat
    </button>
  </header>

  <!-- Messages -->
  <div bind:this={scroller} class="flex-1 overflow-y-auto px-4 py-4 space-y-4 md:pb-4 pb-[calc(80px+env(safe-area-inset-bottom))]">
    {#if loadingHistory}
      <p class="text-neutral-600 text-sm text-center mt-8">Loading…</p>
    {:else if messages.length === 0}
      <div class="text-neutral-500 text-sm text-center mt-12 space-y-2">
        <p>Ask about your training, log your weight, or look up a lift.</p>
        <p class="text-neutral-600">"What's my next workout?" · "I weighed 181" · "What did I bench last month?"</p>
      </div>
    {/if}

    {#each messages as msg}
      <div class="flex {msg.role === 'user' ? 'justify-end' : 'justify-start'}">
        <div
          class="max-w-[85%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap break-words {msg.role === 'user'
            ? 'bg-green-600 text-white'
            : 'bg-neutral-800 text-neutral-100'}"
        >
          {#if msg.tools && msg.tools.length > 0}
            <div class="flex flex-wrap gap-1.5 mb-2">
              {#each msg.tools as tool}
                <span class="inline-flex items-center gap-1 text-xs bg-green-500/15 text-green-300 rounded-full px-2 py-0.5">
                  ✓ {tool.summary}
                </span>
              {/each}
            </div>
          {/if}
          {#if msg.content}
            {msg.content}
          {:else if streaming}
            <span class="text-neutral-500">…</span>
          {/if}
        </div>
      </div>
    {/each}
  </div>

  <!-- Input pinned above the safe area -->
  <div
    class="border-t border-neutral-800 px-3 py-2 shrink-0"
    style="background-color: #1a1a1a; padding-bottom: calc(0.5rem + env(safe-area-inset-bottom));"
  >
    <div class="flex items-end gap-2">
      <textarea
        bind:value={input}
        onkeydown={onKeydown}
        rows="1"
        placeholder="Message your coach…"
        class="flex-1 resize-none rounded-2xl bg-neutral-900 text-neutral-100 placeholder-neutral-600 px-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-green-500 max-h-32"
      ></textarea>
      <button
        onclick={send}
        disabled={streaming || !input.trim()}
        class="shrink-0 min-h-[44px] min-w-[44px] rounded-full bg-green-600 text-white flex items-center justify-center disabled:opacity-40 transition-opacity"
        aria-label="Send"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19V5m0 0l-7 7m7-7l7 7" />
        </svg>
      </button>
    </div>
  </div>
</div>
