"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { LogOut, Mail, X } from "lucide-react";
import { useApp } from "@/providers/app-provider";
import { Button } from "@/components/ui/button";
import { EmailLogin } from "@/components/email-login";
import { ProfileModal } from "@/components/profile-modal";

export function Header() {
  const { sidebarOpen, isAuthenticated, email, userAddress, logout } = useApp();
  const [showLogin, setShowLogin] = useState(false);
  const [showProfile, setShowProfile] = useState(false);

  return (
    <>
      <header className="flex h-16 items-center justify-between px-8">
        <div className={sidebarOpen ? "" : "ml-12"}>
          <h1 className="text-sm font-medium text-muted-foreground">
            AI Yield Agent on X Layer
          </h1>
        </div>

        {isAuthenticated ? (
          <div className="flex items-center gap-3">
            {/* Clickable profile area — opens ProfileModal */}
            <button
              onClick={() => setShowProfile(true)}
              className="flex items-center gap-3 rounded-2xl px-3 py-1.5 -mr-1 transition-colors hover:bg-[#F1F5F9]"
            >
              <div className="text-right">
                <p className="text-xs font-medium text-[#1F2937]">{email}</p>
                {userAddress && (
                  <p className="text-[10px] text-muted-foreground font-mono">
                    {userAddress.slice(0, 6)}...{userAddress.slice(-4)}
                  </p>
                )}
              </div>
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-pastel-blue">
                <Mail className="h-3.5 w-3.5 text-[#3730A3]" />
              </div>
            </button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={logout}
              className="text-muted-foreground hover:text-destructive"
              title="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <Button
            size="sm"
            className="gap-2"
            onClick={() => setShowLogin(true)}
          >
            <Mail className="h-3.5 w-3.5" />
            Sign In
          </Button>
        )}
      </header>

      {/* Login Modal Overlay */}
      <AnimatePresence>
        {showLogin && !isAuthenticated && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 flex items-center justify-center"
          >
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/20 backdrop-blur-sm"
              onClick={() => setShowLogin(false)}
            />

            {/* Modal */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="relative z-10 w-full max-w-sm mx-4"
            >
              <button
                onClick={() => setShowLogin(false)}
                className="absolute -top-2 -right-2 z-20 flex h-8 w-8 items-center justify-center rounded-full bg-white border border-border/60 shadow-md text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
              <EmailLogin onSuccess={() => setShowLogin(false)} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Profile Modal */}
      <ProfileModal
        open={showProfile && isAuthenticated}
        onClose={() => setShowProfile(false)}
      />
    </>
  );
}
