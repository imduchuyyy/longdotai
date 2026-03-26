"use client";

import { useEffect, useRef, useState } from "react";
import {
  Send,
  Loader2,
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
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import Image from "next/image";
import { useApp } from "@/providers/app-provider";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ==========================================================================
// Helpers for SDK v6 UIMessage
// ==========================================================================

/** Extract concatenated text from a UIMessage's parts array */
function getMessageText(message: any): string {
  if (message.parts && Array.isArray(message.parts)) {
    return message.parts
      .filter((p: any) => p.type === "text")
      .map((p: any) => p.text || "")
      .join("");
  }
  if (typeof message.content === "string") return message.content;
  return "";
}

/** Extract tool invocation parts from a UIMessage */
function getToolParts(message: any): any[] {
  if (!message.parts || !Array.isArray(message.parts)) return [];
  return message.parts.filter(
    (p: any) =>
      p.type === "dynamic-tool" ||
      (typeof p.type === "string" && p.type.startsWith("tool-")),
  );
}

/** Get tool name from a part (without "tool-" prefix) */
function getToolNameRaw(part: any): string {
  if (part.type === "dynamic-tool") return part.toolName || "unknown";
  if (typeof part.type === "string" && part.type.startsWith("tool-")) {
    return part.type.slice(5);
  }
  return "unknown";
}

/** Get full tool key (with "tool-" prefix) for matching */
function getToolKey(part: any): string {
  const raw = getToolNameRaw(part);
  return `tool-${raw}`;
}

/** Check if a tool part has completed output */
function hasToolOutput(part: any): boolean {
  return part.state === "output-available";
}

/** Check if a tool part has an error */
function hasToolError(part: any): boolean {
  return (
    part.state === "output-error" ||
    (part.state === "output-available" && part.output?.error === true)
  );
}

/** Get error message from a tool part */
function getToolErrorMessage(part: any): string {
  if (part.state === "output-error") return part.errorText || "Something went wrong.";
  if (part.output?.error) return part.output.message || "Something went wrong.";
  return "Something went wrong.";
}

/** Format a numeric string nicely */
function formatNum(val: string): string {
  const n = parseFloat(val);
  if (isNaN(n)) return val;
  if (n === 0) return "0";
  if (n < 0.0001) return "<0.0001";
  if (n < 1) return n.toFixed(6);
  if (n < 1000) return n.toFixed(4);
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** Shorten an address */
function shortAddr(addr: string): string {
  if (!addr || addr.length <= 14) return addr || "";
  return `${addr.slice(0, 8)}...${addr.slice(-6)}`;
}

// ==========================================================================
// Tool loading labels
// ==========================================================================

const TOOL_LABELS: Record<string, string> = {
  get_balances: "Checking balances...",
  get_positions: "Finding your LP positions...",
  swap_token: "Executing swap...",
  add_liquidity: "Adding liquidity...",
  remove_liquidity: "Removing liquidity...",
  withdraw_to_address: "Sending transfer...",
};

// ==========================================================================
// ChatView — main exported component
// ==========================================================================

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

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const initialSentRef = useRef(false);
  const conversationIdRef = useRef<string | null>(activeConversationId);
  const loadedConversationRef = useRef<string | null>(null);
  const isLoadingFromDb = useRef(false);
  const lastPersistedCount = useRef(0);
  const skipNextPersistReset = useRef(false);

  // --- Stable transport ---
  // Use a ref to always read latest context values without recreating transport
  const ctxRef = useRef({ persona, userAddress, session });
  useEffect(() => {
    ctxRef.current = { persona, userAddress, session };
  }, [persona, userAddress, session]);

  const [transport] = useState(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: () => ({
          persona: ctxRef.current.persona,
          userAddress: ctxRef.current.userAddress,
          walletAddress: ctxRef.current.userAddress,
          session: ctxRef.current.session,
        }),
      }),
  );

  // --- useChat ---
  const { messages, sendMessage, status, setMessages } = useChat({
    transport,
  });

  const [input, setInput] = useState("");
  const isLoading = status === "submitted" || status === "streaming";

  // --- Keep conversationIdRef in sync ---
  useEffect(() => {
    conversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  // --- Scroll to bottom ---
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  // --- Load messages when switching to existing conversation ---
  useEffect(() => {
    if (!activeConversationId) {
      if (loadedConversationRef.current !== null) {
        setMessages([]);
        loadedConversationRef.current = null;
      }
      return;
    }
    if (loadedConversationRef.current === activeConversationId) return;
    loadedConversationRef.current = activeConversationId;

    isLoadingFromDb.current = true;
    fetch(`/api/conversations/${activeConversationId}/messages`)
      .then((r) => r.json())
      .then((data) => {
        const msgs = (data.messages ?? []).map(
          (m: { id: string; role: string; content: string }) => ({
            id: m.id,
            role: m.role,
            parts: [{ type: "text" as const, text: m.content }],
          }),
        );
        setMessages(msgs);
      })
      .catch(console.error)
      .finally(() => {
        setTimeout(() => {
          isLoadingFromDb.current = false;
        }, 300);
      });
  }, [activeConversationId, setMessages]);

  // --- Auto-send initial message from home search bar ---
  useEffect(() => {
    if (initialChatMessage && !initialSentRef.current) {
      initialSentRef.current = true;
      const timer = setTimeout(() => {
        sendMessage({ text: initialChatMessage });
        setInitialChatMessage(null);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [initialChatMessage, sendMessage, setInitialChatMessage]);

  useEffect(() => {
    initialSentRef.current = false;
  }, [activeConversationId]);

  // --- Persist messages to DB when AI finishes responding ---
  // Reset persisted count when switching conversations, unless we just
  // created a new conversation for the current chat (skip flag).
  useEffect(() => {
    if (skipNextPersistReset.current) {
      skipNextPersistReset.current = false;
      return;
    }
    lastPersistedCount.current = 0;
  }, [activeConversationId]);

  useEffect(() => {
    if (status !== "ready") return;
    if (messages.length === 0) return;
    if (messages.length <= lastPersistedCount.current) return;
    if (isLoadingFromDb.current) return;

    const newMsgs = messages.slice(lastPersistedCount.current);
    lastPersistedCount.current = messages.length;

    (async () => {
      let convoId = conversationIdRef.current;

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
          // Mark as already loaded so the load-from-DB effect won't
          // race against us and wipe the in-memory messages.
          loadedConversationRef.current = convoId!;
          // Skip the next lastPersistedCount reset since this isn't
          // a real conversation switch — we just assigned an ID.
          skipNextPersistReset.current = true;
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

      for (const msg of newMsgs) {
        const content = getMessageText(msg);
        if (!content.trim()) continue;

        try {
          await fetch(`/api/conversations/${convoId}/messages`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ role: msg.role, content }),
          });

          if (
            msg.role === "user" &&
            newMsgs.indexOf(msg) === 0 &&
            messages.indexOf(msg) === 0
          ) {
            const title =
              content.length > 50 ? content.slice(0, 47) + "..." : content;
            updateConversationTitle(convoId, title);
          }
        } catch (err) {
          console.error("Failed to persist message:", err);
        }
      }
    })();
  }, [
    status,
    messages,
    email,
    setActiveConversationId,
    addConversation,
    updateConversationTitle,
  ]);

  // --- Handlers ---
  function handleBack() {
    setChatActive(false);
    setInitialChatMessage(null);
  }

  function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault?.();
    if (!input?.trim() || isLoading) return;
    sendMessage({ text: input });
    setInput("");
  }

  const avatarInitials = email ? email.slice(0, 2).toUpperCase() : "U";
  const messageList = messages || [];

  // =======================================================================
  // Render
  // =======================================================================

  return (
    <div className="flex h-full flex-col">
      {/* Back button */}
      <div className="px-8 pt-4 pb-1">
        <button
          onClick={handleBack}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors font-medium"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Home
        </button>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto max-w-2xl space-y-5">
          {/* Empty state */}
          {messageList.length === 0 && (
            <div className="py-12 text-center animate-in fade-in slide-in-from-bottom-2 duration-500">
              <div className="flex justify-center mb-5">
                <Image src="/Lacditt.gif" alt="Mascot" width={88} height={88} unoptimized className="drop-shadow-md rounded-2xl" />
              </div>
              <h3 className="text-xl font-bold text-[#1F2937] mb-1">
                Hey there! I&apos;m your yield buddy
              </h3>
              <p className="text-sm text-muted-foreground max-w-sm mx-auto leading-relaxed">
                Ask me about yield farming on X Layer and I&apos;ll help you
                deposit into the best pools.
              </p>
            </div>
          )}

          {/* Messages */}
          {messageList.map((m: any) => {
            const text = getMessageText(m);
            const toolParts = getToolParts(m);

            // Skip assistant messages with no visible content
            if (m.role === "assistant" && !text.trim() && toolParts.length === 0)
              return null;

            return (
              <div
                key={m.id}
                className={cn(
                  "flex gap-3 animate-in fade-in duration-300",
                  m.role === "user" ? "justify-end" : "justify-start",
                )}
              >
                {/* Assistant avatar */}
                {m.role === "assistant" && (
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl bg-pastel-mint overflow-hidden">
                    <Image src="/avatar-chat.png" alt="AI" width={20} height={20} className="rounded-full" />
                  </div>
                )}

                {/* Message bubble */}
                <div
                  className={cn(
                    "max-w-[75%] rounded-3xl px-5 py-3 text-sm leading-relaxed",
                    m.role === "user"
                      ? "bg-primary text-white rounded-br-lg"
                      : "bg-white border border-border/60 text-[#1F2937] rounded-bl-lg shadow-[0_1px_3px_rgba(0,0,0,0.04)]",
                  )}
                >
                  {/* Text content */}
                  {text && m.role === "user" && (
                    <span className="whitespace-pre-wrap">{text}</span>
                  )}
                  {text && m.role !== "user" && (
                    <div className="chat-markdown">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {text}
                      </ReactMarkdown>
                    </div>
                  )}

                  {/* Tool parts */}
                  {toolParts.map((part: any) => {
                    const toolName = getToolNameRaw(part);
                    const toolKey = getToolKey(part);
                    const done = hasToolOutput(part);
                    const errored = hasToolError(part);

                    // Error state
                    if (errored) {
                      return (
                        <div
                          key={part.toolCallId}
                          className="mt-3 w-full"
                        >
                          <div className="flex items-center gap-2.5 rounded-2xl bg-red-50 px-4 py-3">
                            <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
                            <p className="text-xs text-destructive">
                              {getToolErrorMessage(part)}
                            </p>
                          </div>
                        </div>
                      );
                    }

                    // Loading state
                    if (!done) {
                      return (
                        <div
                          key={part.toolCallId}
                          className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"
                        >
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          <span>
                            {TOOL_LABELS[toolName] ?? "Working..."}
                          </span>
                        </div>
                      );
                    }

                    // Output cards
                    const output = part.output;
                    if (!output) return null;

                    switch (toolKey) {
                      case "tool-get_balances":
                        return (
                          <BalancesCard
                            key={part.toolCallId}
                            output={output}
                          />
                        );
                      case "tool-get_positions":
                        return (
                          <PositionsCard
                            key={part.toolCallId}
                            output={output}
                          />
                        );
                      case "tool-swap_token":
                        return (
                          <SwapCard
                            key={part.toolCallId}
                            output={output}
                          />
                        );
                      case "tool-add_liquidity":
                        return (
                          <LiquidityCard
                            key={part.toolCallId}
                            output={output}
                            action="add"
                          />
                        );
                      case "tool-remove_liquidity":
                        return (
                          <LiquidityCard
                            key={part.toolCallId}
                            output={output}
                            action="remove"
                          />
                        );
                      case "tool-withdraw_to_address":
                        return (
                          <TransferCard
                            key={part.toolCallId}
                            output={output}
                          />
                        );
                      default:
                        return (
                          <div
                            key={part.toolCallId}
                            className="mt-3 flex items-center gap-2 text-muted-foreground text-xs"
                          >
                            <Check className="h-3.5 w-3.5 text-emerald-600" />
                            <span>Done</span>
                          </div>
                        );
                    }
                  })}
                </div>

                {/* User avatar */}
                {m.role === "user" && (
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl bg-pastel-blue">
                    <span className="text-xs font-bold text-[#3730A3]">
                      {avatarInitials}
                    </span>
                  </div>
                )}
              </div>
            );
          })}

          {/* Loading indicator */}
          {isLoading &&
            messageList.length > 0 &&
            messageList[messageList.length - 1]?.role !== "assistant" && (
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl bg-pastel-mint overflow-hidden">
                  <Image src="/avatar.png" alt="AI" width={20} height={20} className="rounded-full" />
                </div>
                <div className="flex items-center gap-2 rounded-3xl rounded-bl-lg border border-border/60 bg-white px-5 py-3 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                  <div className="flex gap-1.5">
                    <span className="h-2 w-2 animate-bounce rounded-full bg-primary/40 [animation-delay:0ms]" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-primary/40 [animation-delay:150ms]" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-primary/40 [animation-delay:300ms]" />
                  </div>
                </div>
              </div>
            )}

          <div ref={messagesEndRef} className="h-4" />
        </div>
      </div>

      {/* Input area */}
      <div className="px-8 pb-6 pt-2">
        <form onSubmit={handleSubmit} className="mx-auto max-w-2xl">
          <div className="card-playful flex items-center gap-2 px-5 py-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder="Tell me about your yield goals..."
              disabled={isLoading}
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 outline-none py-2 disabled:opacity-50"
            />
            <Button
              type="submit"
              size="icon"
              disabled={isLoading || !input?.trim()}
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

// ==========================================================================
// BalancesCard
// ==========================================================================

function BalancesCard({ output }: { output: any }) {
  const balances = output?.balances;
  const lpPositions = output?.lpPositions;

  if (!balances || balances.length === 0) {
    return (
      <div className="mt-3 text-xs text-muted-foreground">
        No token balances found.
      </div>
    );
  }

  return (
    <div className="mt-3 w-full">
      <div className="rounded-2xl bg-[#F1F5F9] px-4 py-3">
        <div className="flex items-center gap-2 text-xs font-medium text-[#1F2937] mb-2">
          <Wallet className="h-3.5 w-3.5 text-primary" />
          Your Balances
        </div>
        <div className="space-y-1.5">
          {balances.map((b: any, idx: number) => (
            <div
              key={idx}
              className="flex items-center justify-between text-xs"
            >
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
            {lpPositions.map((lp: any) => (
              <div
                key={lp.tokenId}
                className="flex items-center justify-between text-xs"
              >
                <span className="text-muted-foreground">#{lp.tokenId}</span>
                <span className="font-mono text-[#1F2937]">
                  {BigInt(lp.liquidity) > 0n ? "Active" : "Empty"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ==========================================================================
// PositionsCard
// ==========================================================================

function PositionsCard({ output }: { output: any }) {
  const positions = output?.positions;
  const message = output?.message;

  if (!positions || positions.length === 0) {
    return (
      <div className="mt-3 text-xs text-muted-foreground">
        {message || "No LP positions found."}
      </div>
    );
  }

  return (
    <div className="mt-3 w-full">
      <div className="rounded-2xl bg-[#F1F5F9] px-4 py-3">
        <div className="flex items-center gap-2 text-xs font-medium text-[#1F2937] mb-3">
          <Droplets className="h-3.5 w-3.5 text-primary" />
          Your LP Positions ({positions.length})
        </div>
        <div className="space-y-3">
          {positions.map((pos: any) => (
            <div
              key={pos.tokenId}
              className="rounded-xl bg-white px-3 py-2.5 border border-border/40"
            >
              {/* Header */}
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-[#1F2937]">
                    {pos.pair}
                  </span>
                  <span className="text-[10px] text-muted-foreground bg-[#F1F5F9] rounded px-1.5 py-0.5">
                    {pos.feeTier}
                  </span>
                </div>
                <span
                  className={cn(
                    "text-[10px] font-medium px-1.5 py-0.5 rounded",
                    pos.isActive
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-gray-100 text-gray-500",
                  )}
                >
                  {pos.isActive ? "Active" : "Closed"}
                </span>
              </div>

              {/* Amounts */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">
                    {pos.token0Symbol}
                  </span>
                  <span className="font-medium text-[#1F2937]">
                    {formatNum(pos.amount0)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">
                    {pos.token1Symbol}
                  </span>
                  <span className="font-medium text-[#1F2937]">
                    {formatNum(pos.amount1)}
                  </span>
                </div>
              </div>

              {/* Uncollected fees */}
              {pos.hasUnclaimedFees && (
                <div className="mt-1.5 pt-1.5 border-t border-border/30">
                  <p className="text-[10px] text-muted-foreground mb-0.5">
                    Uncollected fees
                  </p>
                  <div className="flex items-center gap-3 text-[11px]">
                    <span className="text-emerald-700">
                      +{formatNum(pos.unclaimedFees0)} {pos.token0Symbol}
                    </span>
                    <span className="text-emerald-700">
                      +{formatNum(pos.unclaimedFees1)} {pos.token1Symbol}
                    </span>
                  </div>
                </div>
              )}

              {/* Token ID */}
              <div className="mt-1.5 text-[10px] text-muted-foreground">
                Position #{pos.tokenId}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ==========================================================================
// SwapCard
// ==========================================================================

function SwapCard({ output }: { output: any }) {
  return (
    <div className="mt-3 w-full">
      <div className="rounded-2xl bg-[#F1F5F9] px-4 py-3">
        <div className="flex items-center gap-2 text-xs font-medium text-[#1F2937] mb-2">
          <ArrowRightLeft className="h-3.5 w-3.5 text-primary" />
          Swap Complete
        </div>
        <p className="text-sm font-medium text-[#1F2937]">
          {output.amountIn} {output.fromToken} → {output.expectedOut}{" "}
          {output.toToken}
        </p>
        {output.txHash && output.explorerUrl && (
          <TxHashLink txHash={output.txHash} explorerUrl={output.explorerUrl} />
        )}
      </div>
    </div>
  );
}

// ==========================================================================
// LiquidityCard
// ==========================================================================

function LiquidityCard({
  output,
  action,
}: {
  output: any;
  action: "add" | "remove";
}) {
  const isAdd = action === "add";
  const txHash = output.txHash || output.collectTxHash || "";

  return (
    <div className="mt-3 w-full">
      <div className="rounded-2xl bg-[#F1F5F9] px-4 py-3">
        <div className="flex items-center gap-2 text-xs font-medium text-[#1F2937] mb-2">
          <Droplets className="h-3.5 w-3.5 text-primary" />
          {isAdd ? "Liquidity Added" : "Liquidity Removed"}
        </div>
        {isAdd ? (
          <p className="text-sm font-medium text-[#1F2937]">
            {output.amountUSDT} USDT + {output.amountWOKB} WOKB →{" "}
            {output.pool ?? "USDT/WOKB"} pool
          </p>
        ) : (
          <p className="text-sm font-medium text-[#1F2937]">
            Position #{output.tokenId} — {output.percentRemoved ?? 100}%
            removed
          </p>
        )}
        {txHash && output.explorerUrl && (
          <TxHashLink txHash={txHash} explorerUrl={output.explorerUrl} />
        )}
      </div>
    </div>
  );
}

// ==========================================================================
// TransferCard
// ==========================================================================

function TransferCard({ output }: { output: any }) {
  return (
    <div className="mt-3 w-full">
      <div className="rounded-2xl bg-[#F1F5F9] px-4 py-3">
        <div className="flex items-center gap-2 text-xs font-medium text-[#1F2937] mb-2">
          <ArrowUpRight className="h-3.5 w-3.5 text-primary" />
          Transfer Sent
        </div>
        <p className="text-sm font-medium text-[#1F2937]">
          {output.amount} {output.token} →{" "}
          <span className="font-mono">
            {output.toAddress ? shortAddr(output.toAddress) : ""}
          </span>
        </p>
        {output.txHash && output.explorerUrl && (
          <TxHashLink txHash={output.txHash} explorerUrl={output.explorerUrl} />
        )}
      </div>
    </div>
  );
}

// ==========================================================================
// TxHashLink
// ==========================================================================

function TxHashLink({
  txHash,
  explorerUrl,
}: {
  txHash: string;
  explorerUrl: string;
}) {
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
