"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import {
  type FormEvent,
  useState,
  useRef,
  useEffect,
  useMemo,
} from "react";
import { motion } from "framer-motion";
import {
  Send,
  Loader2,
  CheckCircle2,
  ExternalLink,
  ArrowLeft,
  AlertCircle,
  Wallet,
  ArrowRightLeft,
  ArrowUpRight,
  Copy,
  Check,
  Droplets,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DoodleMascot, MascotIcon } from "@/components/doodle-mascot";
import { useApp } from "@/providers/app-provider";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { UIMessage } from "ai";

// ---------------------------------------------------------------------------
// ChatView — main exported component
// ---------------------------------------------------------------------------

export function ChatView() {
  const {
    persona,
    activeConversationId,
    setActiveConversationId,
    addConversation,
    updateConversationTitle,
    initialChatMessage,
    setInitialChatMessage,
    setChatActive,
    email,
    userAddress,
    session,
  } = useApp();

  // -----------------------------------------------------------------------
  // Chat transport — sends session + persona + wallet info to server
  // -----------------------------------------------------------------------

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: {
          persona,
          userAddress,
          walletAddress: userAddress,
          session,
        },
      }),
    [persona, userAddress, session],
  );

  const { messages, sendMessage, status, setMessages } = useChat({
    transport,
  });

  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const conversationIdRef = useRef<string | null>(activeConversationId);
  const loadedConversationIdRef = useRef<string | null>(null);
  const hasSentInitialRef = useRef(false);

  const isLoading = status === "streaming" || status === "submitted";

  // -----------------------------------------------------------------------
  // Auto-send initial message from home search bar
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (initialChatMessage && !hasSentInitialRef.current) {
      hasSentInitialRef.current = true;
      sendMessage({ text: initialChatMessage });
      setInitialChatMessage(null);
    }
  }, [initialChatMessage, sendMessage, setInitialChatMessage]);

  useEffect(() => {
    hasSentInitialRef.current = false;
  }, [activeConversationId]);

  // -----------------------------------------------------------------------
  // Keep conversationIdRef in sync
  // -----------------------------------------------------------------------

  useEffect(() => {
    conversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  // -----------------------------------------------------------------------
  // Load existing messages when switching to a conversation
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (!activeConversationId) {
      if (loadedConversationIdRef.current !== null) {
        setMessages([]);
        loadedConversationIdRef.current = null;
      }
      return;
    }
    if (loadedConversationIdRef.current === activeConversationId) return;
    loadedConversationIdRef.current = activeConversationId;

    fetch(`/api/conversations/${activeConversationId}/messages`)
      .then((res) => res.json())
      .then((data) => {
        if (data.messages?.length > 0) {
          const uiMessages: UIMessage[] = data.messages.map(
            (m: { id: string; role: string; content: string; createdAt: string }) => ({
              id: m.id,
              role: m.role as "user" | "assistant",
              parts: [{ type: "text" as const, text: m.content }],
              createdAt: new Date(m.createdAt),
            }),
          );
          setMessages(uiMessages);
        } else {
          setMessages([]);
        }
      })
      .catch(console.error);
  }, [activeConversationId, setMessages]);

  // -----------------------------------------------------------------------
  // Auto-scroll on new messages
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // -----------------------------------------------------------------------
  // Persist messages to DB when AI finishes responding
  // -----------------------------------------------------------------------

  const lastPersistedCountRef = useRef(0);

  useEffect(() => {
    if (status !== "ready") return;
    if (messages.length === 0) return;
    if (messages.length <= lastPersistedCountRef.current) return;

    const newMessages = messages.slice(lastPersistedCountRef.current);
    lastPersistedCountRef.current = messages.length;

    (async () => {
      let convoId = conversationIdRef.current;

      // Create conversation if needed
      if (!convoId && email) {
        try {
          const res = await fetch("/api/conversations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userAddress: email }),
          });
          const data = await res.json();
          convoId = data.conversation.id;
          conversationIdRef.current = convoId;
          setActiveConversationId(convoId!);
          addConversation({
            id: convoId!,
            title: "New Chat",
            updatedAt: new Date().toISOString(),
          });
        } catch (err) {
          console.error("Failed to create conversation:", err);
          return;
        }
      }

      if (!convoId) return;

      for (const msg of newMessages) {
        const content = msg.parts
          .filter((p): p is { type: "text"; text: string } => p.type === "text")
          .map((p) => p.text)
          .join("");

        if (!content.trim()) continue;

        try {
          await fetch(`/api/conversations/${convoId}/messages`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ role: msg.role, content }),
          });

          // Set conversation title from first user message
          if (msg.role === "user" && messages.indexOf(msg) === 0) {
            const title = content.length > 50 ? content.slice(0, 47) + "..." : content;
            updateConversationTitle(convoId, title);
          }
        } catch (err) {
          console.error("Failed to persist message:", err);
        }
      }
    })();
  }, [status, messages, email, setActiveConversationId, addConversation, updateConversationTitle]);

  useEffect(() => {
    lastPersistedCountRef.current = 0;
  }, [activeConversationId]);

  // -----------------------------------------------------------------------
  // Event handlers
  // -----------------------------------------------------------------------

  function handleBackToHome() {
    setChatActive(false);
    setInitialChatMessage(null);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    sendMessage({ text: input });
    setInput("");
  }

  // User avatar initials
  const avatarInitials = email ? email.slice(0, 2).toUpperCase() : "U";

  // Deduplicate messages by id (keep last occurrence)
  const deduped = useMemo(() => {
    const seen = new Map<string, number>();
    messages.forEach((m, i) => seen.set(m.id, i));
    return messages.filter((m, i) => seen.get(m.id) === i);
  }, [messages]);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div className="flex h-full flex-col">
      {/* Back to Home */}
      <div className="px-8 pt-4 pb-1">
        <button
          onClick={handleBackToHome}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors font-medium"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Home
        </button>
      </div>

      {/* Messages Area */}
      <ScrollArea className="flex-1 px-8 py-6" ref={scrollRef}>
        <div className="mx-auto max-w-2xl space-y-5">
          {/* Empty state */}
          {messages.length === 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="py-12 text-center"
            >
              <div className="flex justify-center mb-5">
                <DoodleMascot size={88} mood="happy" />
              </div>
              <h3 className="text-xl font-bold text-[#1F2937] mb-1">
                Hey there! I&apos;m your yield buddy
              </h3>
              <p className="text-sm text-muted-foreground max-w-sm mx-auto leading-relaxed">
                Ask me about yield farming on X Layer and I&apos;ll help you
                deposit into the best pools.
              </p>
            </motion.div>
          )}

          {/* Message list */}
          {deduped.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              avatarInitials={avatarInitials}
            />
          ))}

          {/* Thinking indicator */}
          {isLoading && messages.length > 0 && <ThinkingIndicator />}
        </div>
      </ScrollArea>

      {/* Input Area */}
      <div className="px-8 pb-6 pt-2">
        <form onSubmit={handleSubmit} className="mx-auto max-w-2xl">
          <div className="card-playful flex items-center gap-2 px-5 py-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Tell me about your yield goals..."
              disabled={isLoading}
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 outline-none py-2 disabled:opacity-50"
            />
            <Button
              type="submit"
              size="icon"
              disabled={isLoading || !input.trim()}
              className="shrink-0"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MessageBubble — renders a single message (user or assistant)
// ---------------------------------------------------------------------------

function MessageBubble({
  message,
  avatarInitials,
}: {
  message: UIMessage;
  avatarInitials: string;
}) {
  if (!message.parts || !Array.isArray(message.parts)) return null;

  // Check if the message has any visible content
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hasVisible = message.role === "user" || message.parts.some((p: any) => {
    if (!p?.type) return false;
    if (p.type === "text" && p.text) return true;
    // Tool parts (either "tool-xxx" or "dynamic-tool")
    const tType = p.type === "dynamic-tool" ? `tool-${p.toolName}` : p.type;
    if (typeof tType === "string" && tType.startsWith("tool-") && p.state) return true;
    return false;
  });

  if (!hasVisible) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={cn(
        "flex gap-3",
        message.role === "user" ? "justify-end" : "justify-start",
      )}
    >
      {message.role === "assistant" && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl bg-pastel-mint">
          <MascotIcon size={20} />
        </div>
      )}
      <div
        className={cn(
          "max-w-[75%] rounded-3xl px-5 py-3 text-sm leading-relaxed",
          message.role === "user"
            ? "bg-primary text-white rounded-br-lg"
            : "bg-white border border-border/60 text-[#1F2937] rounded-bl-lg shadow-[0_1px_3px_rgba(0,0,0,0.04)]",
        )}
      >
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        {message.parts.map((part: any, i: number) => (
          <MessagePart
            key={`${message.id}-${i}`}
            part={part}
            role={message.role}
          />
        ))}
      </div>
      {message.role === "user" && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl bg-pastel-blue">
          <span className="text-xs font-bold text-[#3730A3]">{avatarInitials}</span>
        </div>
      )}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// MessagePart — renders a single part within a message
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function MessagePart({ part, role }: { part: any; role: string }) {
  if (!part?.type) return null;

  // --- Text ---
  if (part.type === "text") {
    if (!part.text) return null;
    if (role === "assistant") {
      return (
        <div className="chat-markdown">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{part.text}</ReactMarkdown>
        </div>
      );
    }
    return <p className="whitespace-pre-wrap">{part.text}</p>;
  }

  // --- Step start (invisible boundary) ---
  if (part.type === "step-start") return null;

  // --- Tool parts ---
  // Normalize dynamic-tool → tool-{name}
  const toolType =
    part.type === "dynamic-tool" ? `tool-${part.toolName}` : part.type;

  if (typeof toolType !== "string" || !toolType.startsWith("tool-")) return null;

  // Loading states
  if (part.state === "input-streaming" || part.state === "input-available") {
    return <ToolLoading toolType={toolType} />;
  }

  // Error from tool output
  if (part.state === "output-available" && part.output?.error) {
    return <ToolError message={part.output.message || "Something went wrong."} />;
  }

  // Output cards for each tool
  if (part.state === "output-available" && part.output) {
    switch (toolType) {
      case "tool-get_balances":
        return <BalancesCard output={part.output} />;
      case "tool-swap_token":
        return <SwapCard output={part.output} />;
      case "tool-add_liquidity":
        return <LiquidityCard output={part.output} action="add" />;
      case "tool-remove_liquidity":
        return <LiquidityCard output={part.output} action="remove" />;
      case "tool-withdraw_to_address":
        return <TransferCard output={part.output} />;
      default:
        return null;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Tool loading indicator
// ---------------------------------------------------------------------------

function ToolLoading({ toolType }: { toolType: string }) {
  const labels: Record<string, string> = {
    "tool-get_balances": "Checking balances...",
    "tool-swap_token": "Executing swap...",
    "tool-add_liquidity": "Adding liquidity...",
    "tool-remove_liquidity": "Removing liquidity...",
    "tool-withdraw_to_address": "Sending transfer...",
  };
  return (
    <div className="my-2 flex items-center gap-2 text-xs text-muted-foreground">
      <Loader2 className="h-3 w-3 animate-spin" />
      {labels[toolType] ?? "Working..."}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tool error card
// ---------------------------------------------------------------------------

function ToolError({ message }: { message: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="my-2 w-full"
    >
      <div className="flex items-center gap-2.5 rounded-2xl bg-red-50 px-4 py-3">
        <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
        <p className="text-xs text-destructive">{message}</p>
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Balances card
// ---------------------------------------------------------------------------

function BalancesCard({
  output,
}: {
  output: {
    balances: { symbol: string; balance: string; usdValue: string }[];
    lpPositions?: { tokenId: string; liquidity: string }[];
  };
}) {
  const { balances, lpPositions } = output;

  if (!balances || balances.length === 0) {
    return (
      <div className="my-2 text-xs text-muted-foreground">
        No token balances found.
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="my-2 w-full"
    >
      <div className="rounded-2xl bg-[#F1F5F9] px-4 py-3">
        <div className="flex items-center gap-2 text-xs font-medium text-[#1F2937] mb-2">
          <Wallet className="h-3.5 w-3.5 text-primary" />
          Your Balances
        </div>
        <div className="space-y-1.5">
          {balances.map((b, idx) => (
            <div key={idx} className="flex items-center justify-between text-xs">
              <span className="font-medium text-[#1F2937]">{b.symbol}</span>
              <div className="text-right">
                <span className="text-[#1F2937]">
                  {parseFloat(b.balance).toFixed(4)}
                </span>
                {parseFloat(b.usdValue) > 0 && (
                  <span className="text-muted-foreground ml-1.5">
                    (${parseFloat(b.usdValue).toFixed(2)})
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        {lpPositions && lpPositions.length > 0 && (
          <div className="mt-3 pt-2 border-t border-border/40">
            <div className="flex items-center gap-2 text-xs font-medium text-[#1F2937] mb-1">
              <Droplets className="h-3.5 w-3.5 text-primary" />
              LP Positions
            </div>
            {lpPositions.map((lp) => (
              <div key={lp.tokenId} className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">#{lp.tokenId}</span>
                <span className="font-mono text-[#1F2937]">
                  {BigInt(lp.liquidity) > 0n ? "Active" : "Empty"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Swap card
// ---------------------------------------------------------------------------

function SwapCard({
  output,
}: {
  output: {
    fromToken: string;
    toToken: string;
    amountIn: string;
    expectedOut: string;
    txHash: string;
    explorerUrl: string;
  };
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="my-2 w-full"
    >
      <div className="rounded-2xl bg-[#F1F5F9] px-4 py-3">
        <div className="flex items-center gap-2 text-xs font-medium text-[#1F2937] mb-2">
          <ArrowRightLeft className="h-3.5 w-3.5 text-primary" />
          Swap Complete
        </div>
        <p className="text-sm font-medium text-[#1F2937]">
          {output.amountIn} {output.fromToken} → {output.expectedOut} {output.toToken}
        </p>
        <TxHashLink txHash={output.txHash} explorerUrl={output.explorerUrl} />
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Liquidity card (add or remove)
// ---------------------------------------------------------------------------

function LiquidityCard({
  output,
  action,
}: {
  output: {
    pool?: string;
    amountUSDT?: string;
    amountWOKB?: string;
    tokenId?: string;
    percentRemoved?: number;
    txHash?: string;
    collectTxHash?: string;
    explorerUrl: string;
  };
  action: "add" | "remove";
}) {
  const isAdd = action === "add";
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="my-2 w-full"
    >
      <div className="rounded-2xl bg-[#F1F5F9] px-4 py-3">
        <div className="flex items-center gap-2 text-xs font-medium text-[#1F2937] mb-2">
          <Droplets className="h-3.5 w-3.5 text-primary" />
          {isAdd ? "Liquidity Added" : "Liquidity Removed"}
        </div>
        {isAdd ? (
          <p className="text-sm font-medium text-[#1F2937]">
            {output.amountUSDT} USDT + {output.amountWOKB} WOKB → {output.pool ?? "USDT/WOKB"} pool
          </p>
        ) : (
          <p className="text-sm font-medium text-[#1F2937]">
            Position #{output.tokenId} — {output.percentRemoved ?? 100}% removed
          </p>
        )}
        <TxHashLink
          txHash={output.txHash || output.collectTxHash || ""}
          explorerUrl={output.explorerUrl}
        />
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Transfer (withdraw) card
// ---------------------------------------------------------------------------

function TransferCard({
  output,
}: {
  output: {
    token: string;
    amount: string;
    toAddress: string;
    txHash: string;
    explorerUrl: string;
  };
}) {
  const short = `${output.toAddress.slice(0, 8)}...${output.toAddress.slice(-6)}`;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="my-2 w-full"
    >
      <div className="rounded-2xl bg-[#F1F5F9] px-4 py-3">
        <div className="flex items-center gap-2 text-xs font-medium text-[#1F2937] mb-2">
          <ArrowUpRight className="h-3.5 w-3.5 text-primary" />
          Transfer Sent
        </div>
        <p className="text-sm font-medium text-[#1F2937]">
          {output.amount} {output.token} → <span className="font-mono">{short}</span>
        </p>
        <TxHashLink txHash={output.txHash} explorerUrl={output.explorerUrl} />
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Tx hash link (reusable)
// ---------------------------------------------------------------------------

function TxHashLink({ txHash, explorerUrl }: { txHash: string; explorerUrl: string }) {
  const [copied, setCopied] = useState(false);

  if (!txHash) return null;

  function copyHash() {
    navigator.clipboard.writeText(txHash);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex items-center gap-2 mt-2">
      <span className="text-[10px] font-mono text-muted-foreground">
        {txHash.slice(0, 12)}...{txHash.slice(-8)}
      </span>
      <button
        onClick={copyHash}
        className="text-muted-foreground hover:text-foreground transition-colors"
      >
        {copied ? (
          <Check className="h-3 w-3 text-[#059669]" />
        ) : (
          <Copy className="h-3 w-3" />
        )}
      </button>
      <a
        href={explorerUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1 text-[10px] text-primary hover:underline"
      >
        <ExternalLink className="h-3 w-3" />
        Explorer
      </a>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Thinking indicator
// ---------------------------------------------------------------------------

function ThinkingIndicator() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex items-center gap-3"
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl bg-pastel-mint">
        <MascotIcon size={20} />
      </div>
      <div className="flex items-center gap-2 rounded-3xl rounded-bl-lg border border-border/60 bg-white px-5 py-3 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <div className="flex gap-1.5">
          <span className="h-2 w-2 animate-bounce rounded-full bg-primary/40 [animation-delay:0ms]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-primary/40 [animation-delay:150ms]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-primary/40 [animation-delay:300ms]" />
        </div>
      </div>
    </motion.div>
  );
}
