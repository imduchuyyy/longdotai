"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Copy,
  Check,
  Wallet,
  ExternalLink,
  AlertCircle,
  Mail,
  Shield,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DoodleMascot } from "@/components/doodle-mascot";
import { useApp } from "@/providers/app-provider";

interface ProfileModalProps {
  open: boolean;
  onClose: () => void;
}

export function ProfileModal({ open, onClose }: ProfileModalProps) {
  const { email, userAddress, addresses, accountId, session } = useApp();
  const [copied, setCopied] = useState(false);

  async function copyAddress() {
    if (!userAddress) return;
    try {
      await navigator.clipboard.writeText(userAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for non-HTTPS
      const textarea = document.createElement("textarea");
      textarea.value = userAddress;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  // Find X Layer address specifically
  const xlayerAddress =
    addresses.find((a) => a.chainIndex === "196")?.address ?? userAddress;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto py-8"
        >
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/20 backdrop-blur-sm fixed"
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="relative z-10 w-full max-w-md mx-4"
          >
            {/* Close button */}
            <button
              onClick={onClose}
              className="absolute -top-2 -right-2 z-20 flex h-8 w-8 items-center justify-center rounded-full bg-white border border-border/60 shadow-md text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </button>

            <Card className="border-0 bg-gradient-to-br from-pastel-blue/30 via-white to-pastel-mint/20 shadow-lg overflow-hidden">
              <CardContent className="pt-6 pb-5 px-5">
                {/* Header with mascot */}
                <div className="flex flex-col items-center mb-4">
                  <DoodleMascot size={48} mood="happy" className="mb-2" />
                  <h2 className="text-base font-bold text-[#1F2937]">
                    Your Agent Wallet
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Powered by OKX on X Layer
                  </p>
                </div>

                {/* Email + Account */}
                <div className="space-y-2 mb-4">
                  <div className="flex items-center gap-3 rounded-xl bg-white border border-border/60 px-3 py-2.5">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-pastel-lavender">
                      <Mail className="h-3.5 w-3.5 text-[#5B21B6]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
                        Email
                      </p>
                      <p className="text-xs font-medium text-[#1F2937] truncate">
                        {email}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 rounded-xl bg-white border border-border/60 px-3 py-2.5">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-pastel-mint">
                      <Shield className="h-3.5 w-3.5 text-[#065F46]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
                        Account ID
                      </p>
                      <p className="text-xs font-mono text-[#1F2937] truncate">
                        {accountId ?? "—"}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Wallet Address + QR */}
                {xlayerAddress && (
                  <div className="rounded-xl bg-white border border-border/60 p-4 mb-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Wallet className="h-3.5 w-3.5 text-[#3730A3]" />
                      <span className="text-[11px] font-semibold text-[#1F2937] uppercase tracking-wide">
                        X Layer Address
                      </span>
                      <Badge variant="pastel" className="text-[10px] ml-auto">
                        X Layer
                      </Badge>
                    </div>

                    {/* QR Code */}
                    <div className="flex justify-center mb-3">
                      <div className="rounded-xl bg-white p-2.5 border border-border/40 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                        <QRCodeSVG
                          value={xlayerAddress}
                          size={120}
                          level="M"
                          bgColor="#FFFFFF"
                          fgColor="#1F2937"
                        />
                      </div>
                    </div>

                    {/* Address display */}
                    <div className="rounded-lg bg-[#F8FAFC] border border-border/40 px-3 py-2 mb-3">
                      <p className="text-[11px] font-mono text-[#1F2937] break-all leading-relaxed text-center select-all">
                        {xlayerAddress}
                      </p>
                    </div>

                    {/* Action buttons */}
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 gap-1.5"
                        onClick={copyAddress}
                      >
                        {copied ? (
                          <>
                            <Check className="h-3.5 w-3.5 text-[#059669]" />
                            Copied!
                          </>
                        ) : (
                          <>
                            <Copy className="h-3.5 w-3.5" />
                            Copy Address
                          </>
                        )}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 gap-1.5"
                        onClick={() =>
                          window.open(
                            `https://www.okx.com/explorer/xlayer/address/${xlayerAddress}`,
                            "_blank",
                          )
                        }
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        Explorer
                      </Button>
                    </div>
                  </div>
                )}

                {/* Deposit USDT Notice */}
                <div className="rounded-xl bg-pastel-peach/60 border border-[#FDE68A]/60 px-3.5 py-3">
                  <div className="flex gap-2.5">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#FEF3C7]">
                      <AlertCircle className="h-3.5 w-3.5 text-[#92400E]" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-[#92400E] mb-0.5">
                        Deposit USDT to get started
                      </p>
                      <p className="text-[11px] text-[#92400E]/80 leading-relaxed">
                        Send <span className="font-bold">USDT on X Layer</span>{" "}
                        to your wallet address above. The AI agent will use
                        these funds for yield strategies.
                      </p>
                      <p className="text-[10px] text-[#92400E]/60 mt-1 font-medium">
                        Only send assets on X Layer network.
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
