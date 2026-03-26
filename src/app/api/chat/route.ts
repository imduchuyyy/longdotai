import { openai } from "@ai-sdk/openai";
import { streamText, convertToModelMessages, tool, stepCountIs, type UIMessage } from "ai";
import { z } from "zod";
import { createHmac } from "node:crypto";
import { serverSignAndBroadcast, getWalletAddress } from "@/lib/okx-server";
import type { OkxSession } from "@/lib/okx-auth-store";
import {
  getPoolInfo,
  getTokenBalance,
  getNativeBalance,
  getAllowance,
  getPositions,
  getDetailedPositions,
  getFullRangeTicks,
  calculateAmountsForPool,
  encodeApprove,
  encodeSwap,
  encodeMint,
  encodeDecreaseLiquidity,
  encodeCollect,
  quoteSwap,
  parseAmount,
  formatAmount,
  waitForTx,
  sqrtPriceX96ToPrice,
  UNISWAP_V3,
  TOKENS,
  USDT_WOKB_POOL,
} from "@/lib/uniswap";

export const maxDuration = 120;

// OKX API key credentials (server-side only) for balance lookups
const OKX_API_BASE = "https://web3.okx.com";
const OKX_ACCESS_KEY = process.env.OKX_ACCESS_KEY ?? "";
const OKX_SECRET_KEY = process.env.OKX_SECRET_KEY ?? "";
const OKX_PASSPHRASE = process.env.OKX_PASSPHRASE ?? "";

const XLAYER_CHAIN_INDEX = "196";

function getOkxHeaders(
  method: string,
  requestPath: string,
  body: string = "",
): Record<string, string> {
  const timestamp = new Date().toISOString();
  const preSign = timestamp + method.toUpperCase() + requestPath + body;
  const sign = createHmac("sha256", OKX_SECRET_KEY)
    .update(preSign)
    .digest("base64");
  return {
    "Content-Type": "application/json",
    "OK-ACCESS-KEY": OKX_ACCESS_KEY,
    "OK-ACCESS-SIGN": sign,
    "OK-ACCESS-PASSPHRASE": OKX_PASSPHRASE,
    "OK-ACCESS-TIMESTAMP": timestamp,
  };
}

export async function POST(req: Request) {
  const {
    messages,
    persona,
    userAddress,
    walletAddress,
    session: clientSession,
  }: {
    messages: UIMessage[];
    persona?: {
      riskLevel: number;
      systemPrompt: string;
      allowSwap: boolean;
      allowBridge: boolean;
      allowDeposit: boolean;
    };
    userAddress?: string;
    walletAddress?: string;
    session?: OkxSession;
  } = await req.json();

  const riskLevel = persona?.riskLevel ?? 50;
  const riskLabel = getRiskLabel(riskLevel);

  const systemPrompt = `You are SusuOnX, a DeFi AI agent on X Layer blockchain (OKX Layer 2).

USER PROFILE:
- Risk tolerance: ${riskLabel} (${riskLevel}/100)
- Email: ${userAddress || "not connected"}
- Wallet address: ${walletAddress || "not connected"}

KNOWN TOKENS ON X LAYER:
- OKB (native gas token): no contract address, 18 decimals
- WOKB (Wrapped OKB): ${TOKENS.WOKB.address}, 18 decimals  
- USDT: ${TOKENS.USDT.address}, 6 decimals

AVAILABLE UNISWAP V3 POOLS ON X LAYER:
- USDT/WOKB pool: ${USDT_WOKB_POOL} (~9.76% APY, TVL $2.3M)
  Token0: USDT, Token1: WOKB, Fee tier: 3000 (0.3%)

YOUR CAPABILITIES (tools available):
1. get_balances — Check the user's wallet balances on X Layer
2. get_positions — Find all of the user's Uniswap V3 LP positions with detailed info (token amounts, fees, etc.)
3. swap_token — Swap tokens on Uniswap V3 (e.g. USDT -> WOKB or WOKB -> USDT)
4. add_liquidity — Add liquidity to a Uniswap V3 pool (mint a new LP position)
5. remove_liquidity — Remove liquidity from a Uniswap V3 pool (burn LP position)
6. withdraw_to_address — Send/withdraw tokens to an external wallet address

IMPORTANT BEHAVIORAL RULES:

1. When the user asks about earning yield, recommend the USDT/WOKB Uniswap V3 pool. Explain the APY and risks (impermanent loss).

2. When the user wants to deposit into a Uniswap pool:
   a. First call get_balances to check what tokens they have
   b. The pool needs BOTH USDT and WOKB. Check if they have both.
   c. If they only have one side (e.g. only USDT), tell them you'll swap half to get both tokens, then ask for confirmation.
   d. Once confirmed, execute the steps: swap if needed, approve tokens, then add_liquidity.
   e. IMPORTANT: You MUST get explicit user confirmation before executing any swap or deposit. Say exactly what you'll do and wait for "yes" or confirmation.

3. When the user wants to withdraw/exit a pool position, or asks about their positions:
   a. ALWAYS call get_positions first to find all their LP positions with amounts and fees.
   b. Present the positions clearly: show token pair, token amounts, uncollected fees, and position ID.
   c. If they have multiple positions, ask which one they want to withdraw from.
   d. Once confirmed, call remove_liquidity with the specific tokenId.
   e. After removing liquidity, the tokens (USDT + WOKB) are returned to their wallet.
   f. If the user wants to convert everything to a single token after withdrawal, offer to swap.

4. For token swaps, use the swap_token tool. Always confirm the amounts with the user first.

5. For sending tokens to external addresses, use withdraw_to_address. Always verify the destination address with the user.

6. Be concise and professional. Format numbers clearly. Don't explain technical details of transactions unless asked.
7. When showing balances, format them nicely with USD values when available.
8. After executing transactions, always report the result with the transaction hash.

${persona?.systemPrompt ? `\nADDITIONAL USER INSTRUCTIONS:\n${persona.systemPrompt}` : ""}`;

  const result = streamText({
    model: openai("gpt-4o"),
    system: systemPrompt,
    messages: await convertToModelMessages(messages),
    stopWhen: stepCountIs(10),
    tools: {
      // ================================================================
      // Tool: get_balances
      // ================================================================
      get_balances: tool({
        description:
          "Fetch the user's token balances on X Layer. Call this before any swap/deposit/withdraw to check available funds. Also use when user asks 'what do I have' or 'check balance'.",
        inputSchema: z.object({}),
        execute: async () => {
          if (!walletAddress) {
            return { error: true, message: "Wallet not connected." };
          }

          try {
            // Try OKX Balance API first for comprehensive balances
            if (OKX_ACCESS_KEY && OKX_SECRET_KEY) {
              const queryParams = new URLSearchParams({
                address: walletAddress,
                chains: XLAYER_CHAIN_INDEX,
              });
              const requestPath = `/api/v6/dex/balance/all-token-balances-by-address?${queryParams.toString()}`;
              const headers = getOkxHeaders("GET", requestPath);

              const res = await fetch(`${OKX_API_BASE}${requestPath}`, {
                method: "GET",
                headers,
              });

              if (res.ok) {
                const data = await res.json();
                if (String(data.code) === "0") {
                  const tokenAssets = data.data?.[0]?.tokenAssets ?? [];
                  const balances = tokenAssets
                    .filter(
                      (b: { balance: string }) => parseFloat(b.balance) > 0,
                    )
                    .map(
                      (b: {
                        symbol: string;
                        balance: string;
                        tokenPrice: string;
                        tokenContractAddress: string;
                      }) => ({
                        symbol: b.symbol,
                        balance: b.balance,
                        usdValue: (
                          parseFloat(b.balance) *
                          parseFloat(b.tokenPrice || "0")
                        ).toFixed(2),
                        tokenAddress: b.tokenContractAddress || "",
                      }),
                    );

                  // Also get LP positions
                  let positions: { tokenId: string; liquidity: string; token0: string; token1: string }[] = [];
                  try {
                    const lpPositions = await getPositions(walletAddress);
                    positions = lpPositions.map((p) => ({
                      tokenId: p.tokenId.toString(),
                      liquidity: p.liquidity.toString(),
                      token0: p.token0,
                      token1: p.token1,
                    }));
                  } catch {
                    // Ignore LP position errors
                  }

                  return {
                    error: false,
                    address: walletAddress,
                    balances,
                    lpPositions: positions,
                    totalTokens: balances.length,
                  };
                }
              }
            }

            // Fallback: direct RPC balance check
            const [nativeBalance, usdtBalance, wokbBalance] =
              await Promise.all([
                getNativeBalance(walletAddress),
                getTokenBalance(TOKENS.USDT.address, walletAddress),
                getTokenBalance(TOKENS.WOKB.address, walletAddress),
              ]);

            const balances = [];
            if (nativeBalance > 0n) {
              balances.push({
                symbol: "OKB",
                balance: formatAmount(nativeBalance, 18),
                usdValue: "0",
                tokenAddress: "",
              });
            }
            if (usdtBalance > 0n) {
              balances.push({
                symbol: "USDT",
                balance: formatAmount(usdtBalance, 6),
                usdValue: formatAmount(usdtBalance, 6),
                tokenAddress: TOKENS.USDT.address,
              });
            }
            if (wokbBalance > 0n) {
              balances.push({
                symbol: "WOKB",
                balance: formatAmount(wokbBalance, 18),
                usdValue: "0",
                tokenAddress: TOKENS.WOKB.address,
              });
            }

            let positions: { tokenId: string; liquidity: string; token0: string; token1: string }[] = [];
            try {
              const lpPositions = await getPositions(walletAddress);
              positions = lpPositions.map((p) => ({
                tokenId: p.tokenId.toString(),
                liquidity: p.liquidity.toString(),
                token0: p.token0,
                token1: p.token1,
              }));
            } catch {
              // Ignore
            }

            return {
              error: false,
              address: walletAddress,
              balances,
              lpPositions: positions,
              totalTokens: balances.length,
            };
          } catch (err) {
            return {
              error: true,
              message:
                err instanceof Error ? err.message : "Balance fetch failed.",
            };
          }
        },
      }),

      // ================================================================
      // Tool: get_positions
      // ================================================================
      get_positions: tool({
        description:
          "Find all Uniswap V3 LP positions owned by the user on X Layer. Returns detailed info for each position: token pair, token amounts, uncollected fees, fee tier, and whether the position is active. ALWAYS call this before removing liquidity so you know which positions exist and their token IDs.",
        inputSchema: z.object({}),
        execute: async () => {
          if (!walletAddress) {
            return { error: true, message: "Wallet not connected." };
          }

          try {
            const positions = await getDetailedPositions(walletAddress);

            if (positions.length === 0) {
              return {
                error: false,
                positions: [],
                message: "No Uniswap V3 LP positions found for this wallet.",
              };
            }

            return {
              error: false,
              totalPositions: positions.length,
              positions: positions.map((p) => ({
                tokenId: p.tokenId.toString(),
                pair: `${p.token0Symbol}/${p.token1Symbol}`,
                feeTier: p.feeTierLabel,
                isActive: p.isActive,
                amount0: p.amount0,
                amount1: p.amount1,
                token0Symbol: p.token0Symbol,
                token1Symbol: p.token1Symbol,
                unclaimedFees0: p.fees0,
                unclaimedFees1: p.fees1,
                hasUnclaimedFees: p.hasUnclaimedFees,
                liquidity: p.liquidity.toString(),
              })),
            };
          } catch (err) {
            return {
              error: true,
              message:
                err instanceof Error
                  ? err.message
                  : "Failed to fetch positions.",
            };
          }
        },
      }),

      // ================================================================
      // Tool: swap_token
      // ================================================================
      swap_token: tool({
        description:
          "Swap tokens on Uniswap V3 on X Layer. Use this to swap between USDT and WOKB. The swap is executed through the Uniswap V3 SwapRouter. Call this when user wants to swap tokens, or when you need to prepare tokens for a liquidity deposit (e.g. swap half of USDT to WOKB before adding liquidity).",
        inputSchema: z.object({
          fromToken: z
            .enum(["USDT", "WOKB"])
            .describe("Token to swap from."),
          toToken: z
            .enum(["USDT", "WOKB"])
            .describe("Token to swap to."),
          amount: z
            .string()
            .describe(
              "Amount of fromToken to swap in human-readable units (e.g. '50' for 50 USDT).",
            ),
          slippagePercent: z
            .number()
            .optional()
            .default(1)
            .describe("Slippage tolerance in percent (default 1%)."),
        }),
        execute: async ({ fromToken, toToken, amount, slippagePercent }) => {
          if (!clientSession) {
            return { error: true, message: "Not authenticated. Please sign in first." };
          }
          const wallet = getWalletAddress(clientSession);
          if (!wallet) {
            return { error: true, message: "No wallet address found." };
          }

          const fromTokenInfo = TOKENS[fromToken as keyof typeof TOKENS];
          const toTokenInfo = TOKENS[toToken as keyof typeof TOKENS];
          if (!fromTokenInfo || !toTokenInfo) {
            return { error: true, message: "Unknown token." };
          }

          try {
            const amountIn = parseAmount(amount, fromTokenInfo.decimals);

            // Step 1: Check balance
            const balance = await getTokenBalance(fromTokenInfo.address, wallet);
            if (balance < amountIn) {
              return {
                error: true,
                message: `Insufficient ${fromToken} balance. Have ${formatAmount(balance, fromTokenInfo.decimals)}, need ${amount}.`,
              };
            }

            // Step 2: Get quote
            const poolInfo = await getPoolInfo(USDT_WOKB_POOL);
            const expectedOut = await quoteSwap(
              fromTokenInfo.address,
              toTokenInfo.address,
              poolInfo.fee,
              amountIn,
            );
            const minOut =
              (expectedOut * BigInt(Math.floor((100 - (slippagePercent ?? 1)) * 100))) /
              10000n;

            // Step 3: Approve token for SwapRouter
            const allowance = await getAllowance(
              fromTokenInfo.address,
              wallet,
              UNISWAP_V3.swapRouter,
            );
            if (allowance < amountIn) {
              const approveData = encodeApprove(
                UNISWAP_V3.swapRouter,
                amountIn * 2n, // approve extra for convenience
              );
              const approveResult = await serverSignAndBroadcast({
                session: clientSession,
                toAddr: fromTokenInfo.address,
                value: "0",
                contractAddr: fromTokenInfo.address,
                inputData: approveData,
                isContractCall: true,
              });
              // Wait for approval confirmation
              await waitForTx(approveResult.txHash);
            }

            // Step 4: Execute swap
            const swapData = encodeSwap({
              tokenIn: fromTokenInfo.address,
              tokenOut: toTokenInfo.address,
              fee: poolInfo.fee,
              recipient: wallet,
              amountIn,
              amountOutMinimum: minOut,
            });

            const swapResult = await serverSignAndBroadcast({
              session: clientSession,
              toAddr: UNISWAP_V3.swapRouter,
              value: "0",
              contractAddr: UNISWAP_V3.swapRouter,
              inputData: swapData,
              isContractCall: true,
            });

            return {
              error: false,
              action: "swap",
              fromToken,
              toToken,
              amountIn: amount,
              expectedOut: formatAmount(expectedOut, toTokenInfo.decimals),
              minOut: formatAmount(minOut, toTokenInfo.decimals),
              txHash: swapResult.txHash,
              explorerUrl: `https://www.okx.com/explorer/xlayer/tx/${swapResult.txHash}`,
            };
          } catch (err) {
            return {
              error: true,
              message: err instanceof Error ? err.message : "Swap failed.",
            };
          }
        },
      }),

      // ================================================================
      // Tool: add_liquidity
      // ================================================================
      add_liquidity: tool({
        description:
          "Add liquidity to the USDT/WOKB Uniswap V3 pool on X Layer. This creates a new LP position. Both USDT and WOKB must be in the wallet. The position uses full-range ticks. Call this after ensuring the user has both tokens (swap first if needed).",
        inputSchema: z.object({
          amountUSDT: z
            .string()
            .describe("Amount of USDT to provide as liquidity (human-readable, e.g. '100')."),
          amountWOKB: z
            .string()
            .describe("Amount of WOKB to provide as liquidity (human-readable, e.g. '5.5')."),
        }),
        execute: async ({ amountUSDT, amountWOKB }) => {
          if (!clientSession) {
            return { error: true, message: "Not authenticated. Please sign in first." };
          }
          const wallet = getWalletAddress(clientSession);
          if (!wallet) {
            return { error: true, message: "No wallet address found." };
          }

          try {
            const poolInfo = await getPoolInfo(USDT_WOKB_POOL);
            const { tickLower, tickUpper } = getFullRangeTicks(
              poolInfo.tickSpacing,
            );

            // Determine token ordering (Uniswap requires token0 < token1)
            const token0 = poolInfo.token0.toLowerCase();
            const token1 = poolInfo.token1.toLowerCase();

            const isUSDTToken0 =
              token0 === TOKENS.USDT.address.toLowerCase();

            let amount0: bigint, amount1: bigint;
            let token0Addr: string, token1Addr: string;

            if (isUSDTToken0) {
              amount0 = parseAmount(amountUSDT, TOKENS.USDT.decimals);
              amount1 = parseAmount(amountWOKB, TOKENS.WOKB.decimals);
              token0Addr = TOKENS.USDT.address;
              token1Addr = TOKENS.WOKB.address;
            } else {
              amount0 = parseAmount(amountWOKB, TOKENS.WOKB.decimals);
              amount1 = parseAmount(amountUSDT, TOKENS.USDT.decimals);
              token0Addr = TOKENS.WOKB.address;
              token1Addr = TOKENS.USDT.address;
            }

            // Check balances
            const usdtBalance = await getTokenBalance(TOKENS.USDT.address, wallet);
            const wokbBalance = await getTokenBalance(TOKENS.WOKB.address, wallet);

            const neededUSDT = parseAmount(amountUSDT, TOKENS.USDT.decimals);
            const neededWOKB = parseAmount(amountWOKB, TOKENS.WOKB.decimals);

            if (usdtBalance < neededUSDT) {
              return {
                error: true,
                message: `Insufficient USDT. Have ${formatAmount(usdtBalance, TOKENS.USDT.decimals)}, need ${amountUSDT}.`,
              };
            }
            if (wokbBalance < neededWOKB) {
              return {
                error: true,
                message: `Insufficient WOKB. Have ${formatAmount(wokbBalance, TOKENS.WOKB.decimals)}, need ${amountWOKB}.`,
              };
            }

            // Approve USDT for NonfungiblePositionManager
            const usdtAllowance = await getAllowance(
              TOKENS.USDT.address,
              wallet,
              UNISWAP_V3.positionManager,
            );
            if (usdtAllowance < neededUSDT) {
              const approveData = encodeApprove(
                UNISWAP_V3.positionManager,
                neededUSDT * 2n,
              );
              const approveTx = await serverSignAndBroadcast({
                session: clientSession,
                toAddr: TOKENS.USDT.address,
                value: "0",
                contractAddr: TOKENS.USDT.address,
                inputData: approveData,
                isContractCall: true,
              });
              await waitForTx(approveTx.txHash);
            }

            // Approve WOKB for NonfungiblePositionManager
            const wokbAllowance = await getAllowance(
              TOKENS.WOKB.address,
              wallet,
              UNISWAP_V3.positionManager,
            );
            if (wokbAllowance < neededWOKB) {
              const approveData = encodeApprove(
                UNISWAP_V3.positionManager,
                neededWOKB * 2n,
              );
              const approveTx = await serverSignAndBroadcast({
                session: clientSession,
                toAddr: TOKENS.WOKB.address,
                value: "0",
                contractAddr: TOKENS.WOKB.address,
                inputData: approveData,
                isContractCall: true,
              });
              await waitForTx(approveTx.txHash);
            }

            // Mint LP position
            const mintData = encodeMint({
              token0: token0Addr,
              token1: token1Addr,
              fee: poolInfo.fee,
              tickLower,
              tickUpper,
              amount0Desired: amount0,
              amount1Desired: amount1,
              amount0Min: 0n, // Accept any amount (slippage handled by pool)
              amount1Min: 0n,
              recipient: wallet,
            });

            const mintResult = await serverSignAndBroadcast({
              session: clientSession,
              toAddr: UNISWAP_V3.positionManager,
              value: "0",
              contractAddr: UNISWAP_V3.positionManager,
              inputData: mintData,
              isContractCall: true,
            });

            return {
              error: false,
              action: "add_liquidity",
              pool: "USDT/WOKB",
              amountUSDT,
              amountWOKB,
              txHash: mintResult.txHash,
              explorerUrl: `https://www.okx.com/explorer/xlayer/tx/${mintResult.txHash}`,
            };
          } catch (err) {
            return {
              error: true,
              message:
                err instanceof Error ? err.message : "Add liquidity failed.",
            };
          }
        },
      }),

      // ================================================================
      // Tool: remove_liquidity
      // ================================================================
      remove_liquidity: tool({
        description:
          "Remove liquidity from a Uniswap V3 pool on X Layer. Burns the LP position and returns both tokens (USDT + WOKB) to the wallet. If tokenId is not provided, removes from the first active position found.",
        inputSchema: z.object({
          tokenId: z
            .string()
            .optional()
            .describe(
              "The NFT token ID of the LP position to remove. If not provided, uses the first active position.",
            ),
          percentToRemove: z
            .number()
            .optional()
            .default(100)
            .describe(
              "Percentage of liquidity to remove (1-100, default 100 for full withdrawal).",
            ),
        }),
        execute: async ({ tokenId, percentToRemove }) => {
          if (!clientSession) {
            return { error: true, message: "Not authenticated. Please sign in first." };
          }
          const wallet = getWalletAddress(clientSession);
          if (!wallet) {
            return { error: true, message: "No wallet address found." };
          }

          try {
            let targetTokenId: bigint;
            let positionLiquidity: bigint;

            if (tokenId) {
              targetTokenId = BigInt(tokenId);
              // We need to look up the position's liquidity
              const positions = await getPositions(wallet);
              const pos = positions.find(
                (p) => p.tokenId === targetTokenId,
              );
              if (!pos) {
                return {
                  error: true,
                  message: `Position ${tokenId} not found or has no liquidity.`,
                };
              }
              positionLiquidity = pos.liquidity;
            } else {
              // Find first active position
              const positions = await getPositions(wallet);
              if (positions.length === 0) {
                return {
                  error: true,
                  message:
                    "No active Uniswap V3 LP positions found for this wallet.",
                };
              }
              targetTokenId = positions[0].tokenId;
              positionLiquidity = positions[0].liquidity;
            }

            const pct = Math.min(Math.max(percentToRemove ?? 100, 1), 100);
            const liquidityToRemove =
              (positionLiquidity * BigInt(pct)) / 100n;

            // Step 1: Decrease liquidity
            const decreaseData = encodeDecreaseLiquidity({
              tokenId: targetTokenId,
              liquidity: liquidityToRemove,
              amount0Min: 0n,
              amount1Min: 0n,
            });

            const decreaseTx = await serverSignAndBroadcast({
              session: clientSession,
              toAddr: UNISWAP_V3.positionManager,
              value: "0",
              contractAddr: UNISWAP_V3.positionManager,
              inputData: decreaseData,
              isContractCall: true,
            });

            await waitForTx(decreaseTx.txHash);

            // Step 2: Collect tokens
            const collectData = encodeCollect(targetTokenId, wallet);

            const collectTx = await serverSignAndBroadcast({
              session: clientSession,
              toAddr: UNISWAP_V3.positionManager,
              value: "0",
              contractAddr: UNISWAP_V3.positionManager,
              inputData: collectData,
              isContractCall: true,
            });

            return {
              error: false,
              action: "remove_liquidity",
              tokenId: targetTokenId.toString(),
              percentRemoved: pct,
              decreaseTxHash: decreaseTx.txHash,
              collectTxHash: collectTx.txHash,
              explorerUrl: `https://www.okx.com/explorer/xlayer/tx/${collectTx.txHash}`,
            };
          } catch (err) {
            return {
              error: true,
              message:
                err instanceof Error
                  ? err.message
                  : "Remove liquidity failed.",
            };
          }
        },
      }),

      // ================================================================
      // Tool: withdraw_to_address
      // ================================================================
      withdraw_to_address: tool({
        description:
          "Send/transfer/withdraw tokens from the agent wallet to an external address on X Layer. Use for OKB (native), USDT, or WOKB transfers.",
        inputSchema: z.object({
          token: z
            .enum(["OKB", "USDT", "WOKB"])
            .describe("Token to send."),
          amount: z
            .string()
            .describe(
              'Amount to send in human-readable units (e.g. "10.5").',
            ),
          toAddress: z
            .string()
            .describe("Destination wallet address (0x...)."),
        }),
        execute: async ({ token, amount, toAddress }) => {
          if (!clientSession) {
            return { error: true, message: "Not authenticated. Please sign in first." };
          }
          const wallet = getWalletAddress(clientSession);
          if (!wallet) {
            return { error: true, message: "No wallet address found." };
          }

          // Validate address
          if (!/^0x[a-fA-F0-9]{40}$/.test(toAddress)) {
            return {
              error: true,
              message: "Invalid destination address format.",
            };
          }

          try {
            if (token === "OKB") {
              // Native token transfer
              const balance = await getNativeBalance(wallet);
              const amountWei = parseAmount(amount, 18);
              if (balance < amountWei) {
                return {
                  error: true,
                  message: `Insufficient OKB. Have ${formatAmount(balance, 18)}, need ${amount}.`,
                };
              }

              const result = await serverSignAndBroadcast({
                session: clientSession,
                toAddr: toAddress,
                value: amountWei.toString(),
                isContractCall: false,
              });

              return {
                error: false,
                action: "send",
                token: "OKB",
                amount,
                toAddress,
                txHash: result.txHash,
                explorerUrl: `https://www.okx.com/explorer/xlayer/tx/${result.txHash}`,
              };
            }

            // ERC-20 transfer
            const tokenInfo = TOKENS[token as keyof typeof TOKENS];
            if (!tokenInfo) {
              return { error: true, message: "Unknown token." };
            }

            const balance = await getTokenBalance(tokenInfo.address, wallet);
            const amountUnits = parseAmount(amount, tokenInfo.decimals);
            if (balance < amountUnits) {
              return {
                error: true,
                message: `Insufficient ${token}. Have ${formatAmount(balance, tokenInfo.decimals)}, need ${amount}.`,
              };
            }

            // Encode ERC-20 transfer(address to, uint256 amount)
            const transferData =
              "0xa9059cbb" +
              toAddress.slice(2).padStart(64, "0") +
              amountUnits.toString(16).padStart(64, "0");

            const result = await serverSignAndBroadcast({
              session: clientSession,
              toAddr: tokenInfo.address,
              value: "0",
              contractAddr: tokenInfo.address,
              inputData: transferData,
              isContractCall: true,
            });

            return {
              error: false,
              action: "send",
              token,
              amount,
              toAddress,
              txHash: result.txHash,
              explorerUrl: `https://www.okx.com/explorer/xlayer/tx/${result.txHash}`,
            };
          } catch (err) {
            return {
              error: true,
              message: err instanceof Error ? err.message : "Transfer failed.",
            };
          }
        },
      }),
    },
  });

  return result.toUIMessageStreamResponse();
}

function getRiskLabel(level: number): string {
  if (level <= 25) return "Safe Bet";
  if (level <= 50) return "Cautious";
  if (level <= 75) return "Balanced";
  return "Ape In";
}
