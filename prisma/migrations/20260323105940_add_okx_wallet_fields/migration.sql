/*
  Warnings:

  - Added the required column `updatedAt` to the `AgentWallet` table without a default value. This is not possible if the table is not empty.

*/
-- CreateTable
CREATE TABLE "AgentWalletAddress" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "walletId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "chainIndex" TEXT NOT NULL,
    "chainName" TEXT NOT NULL,
    "addressType" TEXT NOT NULL DEFAULT '',
    "chainPath" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "AgentWalletAddress_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "AgentWallet" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AgentWallet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userAddress" TEXT NOT NULL,
    "agentAddress" TEXT NOT NULL,
    "projectId" TEXT,
    "accountId" TEXT,
    "accountName" TEXT,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "sessionCert" TEXT,
    "encryptedSessionSk" TEXT,
    "teeId" TEXT,
    "sessionKeyExpireAt" TEXT,
    "isOkxWallet" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_AgentWallet" ("agentAddress", "createdAt", "id", "userAddress") SELECT "agentAddress", "createdAt", "id", "userAddress" FROM "AgentWallet";
DROP TABLE "AgentWallet";
ALTER TABLE "new_AgentWallet" RENAME TO "AgentWallet";
CREATE UNIQUE INDEX "AgentWallet_userAddress_key" ON "AgentWallet"("userAddress");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "AgentWalletAddress_walletId_chainIndex_key" ON "AgentWalletAddress"("walletId", "chainIndex");
