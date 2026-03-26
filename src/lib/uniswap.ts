/**
 * Uniswap V3 interaction library for X Layer
 *
 * Uses ethers.js to encode contract calls for Uniswap V3:
 * - SwapRouter: exact input swaps
 * - NonfungiblePositionManager: mint/add/remove liquidity
 * - Pool: read slot0, liquidity, etc.
 *
 * All transactions are signed and broadcast via the OKX Agentic Wallet API.
 * This module only encodes calldata — it does NOT send transactions itself.
 */

import { ethers } from "ethers";

// ---------------------------------------------------------------------------
// X Layer RPC & Uniswap V3 deployment addresses
// ---------------------------------------------------------------------------

export const XLAYER_RPC = "https://rpc.xlayer.tech";
export const XLAYER_CHAIN_ID = 196;

/** Standard Uniswap V3 deployment addresses (same as mainnet for most EVM chains) */
export const UNISWAP_V3 = {
  factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
  swapRouter: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
  positionManager: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
  quoter: "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6",
} as const;

/** Known tokens on X Layer */
export const TOKENS = {
  WOKB: {
    address: "0xe538905cf8410324e03A5A23C1c177a474D59b2b",
    decimals: 18,
    symbol: "WOKB",
  },
  USDT: {
    address: "0x779ded0c9e1022225f8e0630b35a9b54be713736",
    decimals: 6,
    symbol: "USDT",
  },
} as const;

/** The main pool we interact with */
export const USDT_WOKB_POOL = "0x63d62734847E55A266FCa4219A9aD0a02D5F6e02";

// ---------------------------------------------------------------------------
// ABIs (minimal — only the functions we need)
// ---------------------------------------------------------------------------

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)",
];

const POOL_ABI = [
  "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function fee() external view returns (uint24)",
  "function token0() external view returns (address)",
  "function token1() external view returns (address)",
  "function liquidity() external view returns (uint128)",
  "function tickSpacing() external view returns (int24)",
];

const SWAP_ROUTER_ABI = [
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)",
];

const POSITION_MANAGER_ABI = [
  "function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline)) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
  "function decreaseLiquidity((uint256 tokenId, uint128 liquidity, uint256 amount0Min, uint256 amount1Min, uint256 deadline)) external payable returns (uint256 amount0, uint256 amount1)",
  "function collect((uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max)) external payable returns (uint256 amount0, uint256 amount1)",
  "function positions(uint256 tokenId) external view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
  "function balanceOf(address owner) external view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) external view returns (uint256)",
];

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

let _provider: ethers.JsonRpcProvider | null = null;

export function getProvider(): ethers.JsonRpcProvider {
  if (!_provider) {
    _provider = new ethers.JsonRpcProvider(XLAYER_RPC);
  }
  return _provider;
}

// ---------------------------------------------------------------------------
// Pool info
// ---------------------------------------------------------------------------

export interface PoolInfo {
  token0: string;
  token1: string;
  fee: number;
  tickSpacing: number;
  sqrtPriceX96: bigint;
  tick: number;
  liquidity: bigint;
}

export async function getPoolInfo(
  poolAddress: string = USDT_WOKB_POOL,
): Promise<PoolInfo> {
  const provider = getProvider();
  const pool = new ethers.Contract(poolAddress, POOL_ABI, provider);

  const [slot0, fee, token0, token1, liquidity, tickSpacing] =
    await Promise.all([
      pool.slot0(),
      pool.fee(),
      pool.token0(),
      pool.token1(),
      pool.liquidity(),
      pool.tickSpacing(),
    ]);

  return {
    token0: token0 as string,
    token1: token1 as string,
    fee: Number(fee),
    tickSpacing: Number(tickSpacing),
    sqrtPriceX96: BigInt(slot0[0]),
    tick: Number(slot0[1]),
    liquidity: BigInt(liquidity),
  };
}

/**
 * Calculate the price of token0 in terms of token1 from sqrtPriceX96.
 */
export function sqrtPriceX96ToPrice(
  sqrtPriceX96: bigint,
  token0Decimals: number,
  token1Decimals: number,
): number {
  const Q96 = BigInt(2) ** BigInt(96);
  const price =
    Number(sqrtPriceX96 * sqrtPriceX96) /
    Number(Q96 * Q96) *
    10 ** (token0Decimals - token1Decimals);
  return price;
}

// ---------------------------------------------------------------------------
// ERC-20 helpers
// ---------------------------------------------------------------------------

export function encodeApprove(
  spender: string,
  amount: bigint,
): string {
  const iface = new ethers.Interface(ERC20_ABI);
  return iface.encodeFunctionData("approve", [spender, amount]);
}

export async function getAllowance(
  tokenAddress: string,
  owner: string,
  spender: string,
): Promise<bigint> {
  const provider = getProvider();
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
  return BigInt(await token.allowance(owner, spender));
}

export async function getTokenBalance(
  tokenAddress: string,
  owner: string,
): Promise<bigint> {
  const provider = getProvider();
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
  return BigInt(await token.balanceOf(owner));
}

export async function getNativeBalance(address: string): Promise<bigint> {
  const provider = getProvider();
  return await provider.getBalance(address);
}

// ---------------------------------------------------------------------------
// Swap: exact input single
// ---------------------------------------------------------------------------

export interface SwapParams {
  tokenIn: string;
  tokenOut: string;
  fee: number;
  recipient: string;
  amountIn: bigint;
  amountOutMinimum: bigint;
  sqrtPriceLimitX96?: bigint;
}

/**
 * Encode a Uniswap V3 exactInputSingle swap calldata.
 */
export function encodeSwap(params: SwapParams): string {
  const iface = new ethers.Interface(SWAP_ROUTER_ABI);
  const deadline = Math.floor(Date.now() / 1000) + 1800; // 30 min

  return iface.encodeFunctionData("exactInputSingle", [
    {
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      fee: params.fee,
      recipient: params.recipient,
      deadline,
      amountIn: params.amountIn,
      amountOutMinimum: params.amountOutMinimum,
      sqrtPriceLimitX96: params.sqrtPriceLimitX96 ?? 0n,
    },
  ]);
}

// ---------------------------------------------------------------------------
// Liquidity: mint position (full range)
// ---------------------------------------------------------------------------

export interface MintParams {
  token0: string;
  token1: string;
  fee: number;
  tickLower: number;
  tickUpper: number;
  amount0Desired: bigint;
  amount1Desired: bigint;
  amount0Min: bigint;
  amount1Min: bigint;
  recipient: string;
}

/**
 * Encode a NonfungiblePositionManager mint calldata for adding liquidity.
 */
export function encodeMint(params: MintParams): string {
  const iface = new ethers.Interface(POSITION_MANAGER_ABI);
  const deadline = Math.floor(Date.now() / 1000) + 1800;

  return iface.encodeFunctionData("mint", [
    {
      token0: params.token0,
      token1: params.token1,
      fee: params.fee,
      tickLower: params.tickLower,
      tickUpper: params.tickUpper,
      amount0Desired: params.amount0Desired,
      amount1Desired: params.amount1Desired,
      amount0Min: params.amount0Min,
      amount1Min: params.amount1Min,
      recipient: params.recipient,
      deadline,
    },
  ]);
}

// ---------------------------------------------------------------------------
// Liquidity: decrease liquidity + collect
// ---------------------------------------------------------------------------

export interface DecreaseLiquidityParams {
  tokenId: bigint;
  liquidity: bigint;
  amount0Min: bigint;
  amount1Min: bigint;
}

export function encodeDecreaseLiquidity(
  params: DecreaseLiquidityParams,
): string {
  const iface = new ethers.Interface(POSITION_MANAGER_ABI);
  const deadline = Math.floor(Date.now() / 1000) + 1800;

  return iface.encodeFunctionData("decreaseLiquidity", [
    {
      tokenId: params.tokenId,
      liquidity: params.liquidity,
      amount0Min: params.amount0Min,
      amount1Min: params.amount1Min,
      deadline,
    },
  ]);
}

export function encodeCollect(
  tokenId: bigint,
  recipient: string,
): string {
  const iface = new ethers.Interface(POSITION_MANAGER_ABI);
  const MAX_UINT128 = (1n << 128n) - 1n;

  return iface.encodeFunctionData("collect", [
    {
      tokenId,
      recipient,
      amount0Max: MAX_UINT128,
      amount1Max: MAX_UINT128,
    },
  ]);
}

// ---------------------------------------------------------------------------
// Position helpers
// ---------------------------------------------------------------------------

export interface PositionInfo {
  tokenId: bigint;
  token0: string;
  token1: string;
  fee: number;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
}

/**
 * Get all Uniswap V3 LP positions owned by an address.
 */
export async function getPositions(owner: string): Promise<PositionInfo[]> {
  const provider = getProvider();
  const pm = new ethers.Contract(
    UNISWAP_V3.positionManager,
    POSITION_MANAGER_ABI,
    provider,
  );

  const balance = Number(await pm.balanceOf(owner));
  const positions: PositionInfo[] = [];

  for (let i = 0; i < balance; i++) {
    const tokenId = BigInt(await pm.tokenOfOwnerByIndex(owner, i));
    const pos = await pm.positions(tokenId);

    // Only include positions with liquidity > 0
    if (BigInt(pos[7]) > 0n) {
      positions.push({
        tokenId,
        token0: pos[2] as string,
        token1: pos[3] as string,
        fee: Number(pos[4]),
        tickLower: Number(pos[5]),
        tickUpper: Number(pos[6]),
        liquidity: BigInt(pos[7]),
      });
    }
  }

  return positions;
}

// ---------------------------------------------------------------------------
// Tick math helpers
// ---------------------------------------------------------------------------

/**
 * Calculate a full-range tick range for a given tick spacing.
 * Uses near-maximum ticks aligned to the tick spacing.
 */
export function getFullRangeTicks(tickSpacing: number): {
  tickLower: number;
  tickUpper: number;
} {
  const MAX_TICK = 887272;
  const tickLower =
    -Math.floor(MAX_TICK / tickSpacing) * tickSpacing;
  const tickUpper =
    Math.floor(MAX_TICK / tickSpacing) * tickSpacing;
  return { tickLower, tickUpper };
}

/**
 * Calculate the amounts of token0 and token1 needed to provide liquidity
 * at the current price, given a desired amount of one token.
 * 
 * For a full-range position, the ratio is approximately:
 *   amount1 = amount0 * price
 * where price = (sqrtPriceX96 / 2^96)^2 * 10^(decimals0 - decimals1)
 */
export function calculateAmountsForPool(
  sqrtPriceX96: bigint,
  token0Decimals: number,
  token1Decimals: number,
  amount0?: bigint,
  amount1?: bigint,
): { amount0: bigint; amount1: bigint } {
  // price of token0 in terms of token1
  const price = sqrtPriceX96ToPrice(sqrtPriceX96, token0Decimals, token1Decimals);

  if (amount0 !== undefined && amount0 > 0n) {
    // Calculate amount1 from amount0
    const amount0Human = Number(amount0) / 10 ** token0Decimals;
    const amount1Human = amount0Human * price;
    const calcAmount1 = BigInt(
      Math.floor(amount1Human * 10 ** token1Decimals),
    );
    return { amount0, amount1: calcAmount1 };
  }

  if (amount1 !== undefined && amount1 > 0n) {
    // Calculate amount0 from amount1
    const amount1Human = Number(amount1) / 10 ** token1Decimals;
    const amount0Human = amount1Human / price;
    const calcAmount0 = BigInt(
      Math.floor(amount0Human * 10 ** token0Decimals),
    );
    return { amount0: calcAmount0, amount1 };
  }

  return { amount0: 0n, amount1: 0n };
}

// ---------------------------------------------------------------------------
// Quote swap (read-only, on-chain)
// ---------------------------------------------------------------------------

const QUOTER_ABI = [
  "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)",
];

/**
 * Get a swap quote using the Uniswap V3 Quoter contract.
 * Note: This uses staticCall since the quoter reverts with the result.
 */
export async function quoteSwap(
  tokenIn: string,
  tokenOut: string,
  fee: number,
  amountIn: bigint,
): Promise<bigint> {
  const provider = getProvider();
  const quoter = new ethers.Contract(UNISWAP_V3.quoter, QUOTER_ABI, provider);

  const amountOut = await quoter.quoteExactInputSingle.staticCall(
    tokenIn,
    tokenOut,
    fee,
    amountIn,
    0,
  );

  return BigInt(amountOut);
}

/**
 * Parse a human-readable amount to the smallest unit based on decimals.
 */
export function parseAmount(amount: string, decimals: number): bigint {
  return ethers.parseUnits(amount, decimals);
}

/**
 * Format a token amount from smallest unit to human-readable.
 */
export function formatAmount(amount: bigint, decimals: number): string {
  return ethers.formatUnits(amount, decimals);
}

/**
 * Wait for a transaction to be confirmed.
 */
export async function waitForTx(txHash: string, confirmations = 1): Promise<void> {
  const provider = getProvider();
  const receipt = await provider.waitForTransaction(txHash, confirmations, 60000);
  if (!receipt || receipt.status === 0) {
    throw new Error(`Transaction ${txHash} failed or was reverted`);
  }
}
