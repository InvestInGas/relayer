/**
 * LiFi SDK Client
 * Generates bridge quotes and calldata for cross-chain gas delivery
 */

// LiFi API types
interface LiFiQuoteRequest {
    fromChain: number;
    toChain: number;
    fromToken: string;
    toToken: string;
    fromAmount: string;
    fromAddress: string;
    toAddress: string;
    slippage?: number;
}

interface LiFiQuoteResponse {
    transactionRequest: {
        data: string;
        to: string;
        value: string;
        gasLimit: string;
    };
    estimate: {
        fromAmount: string;
        toAmount: string;
        toAmountMin: string;
        approvalAddress: string;
    };
    tool: string;
    toolDetails: {
        name: string;
    };
}

// Chain ID mappings
const CHAIN_IDS: Record<string, number> = {
    ethereum: 11155111,
    arbitrum: 421614,  // Arbitrum Sepolia
    base: 84532,       // Base Sepolia
    polygon: 80002,    // Polygon Amoy
    optimism: 11155420, // Optimism Sepolia
};

// Native token addresses (use zero address for native)
const NATIVE_TOKEN = '0x0000000000000000000000000000000000000000';
const ETH_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

// Gas tokens per chain
const GAS_TOKENS: Record<string, string> = {
    ethereum: ETH_ADDRESS,
    arbitrum: ETH_ADDRESS,
    base: ETH_ADDRESS,
    polygon: NATIVE_TOKEN, // MATIC
    optimism: ETH_ADDRESS,
};

export interface LiFiBridgeData {
    calldata: string;
    toAddress: string;
    minReceive: bigint;
    bridgeTool: string;
    estimatedReceive: bigint;
}

export class LiFiClient {
    private apiUrl: string;
    private maxSlippageBps: number;

    constructor(maxSlippageBps: number = 100) {
        this.apiUrl = 'https://li.quest/v1';
        this.maxSlippageBps = maxSlippageBps;
    }

    /**
     * Get a quote for bridging ETH to target chain
     * @param fromChain Source chain name (e.g., "sepolia")
     * @param toChain Target chain name (e.g., "arbitrum")
     * @param amount Amount in wei
     * @param fromAddress Sender address (hook/bridger contract)
     * @param toAddress Recipient address on target chain
     */
    async getQuote(
        fromChain: string,
        toChain: string,
        amount: bigint,
        fromAddress: string,
        toAddress: string
    ): Promise<LiFiBridgeData> {
        const fromChainId = CHAIN_IDS[fromChain];
        const toChainId = CHAIN_IDS[toChain];

        if (!fromChainId || !toChainId) {
            throw new Error(`Unsupported chain: ${fromChain} or ${toChain}`);
        }

        const fromToken = GAS_TOKENS[fromChain] || ETH_ADDRESS;
        const toToken = GAS_TOKENS[toChain] || ETH_ADDRESS;

        const request: LiFiQuoteRequest = {
            fromChain: fromChainId,
            toChain: toChainId,
            fromToken,
            toToken,
            fromAmount: amount.toString(),
            fromAddress,
            toAddress,
            slippage: this.maxSlippageBps / 10000, // Convert bps to decimal
        };

        const queryParams = new URLSearchParams({
            fromChain: request.fromChain.toString(),
            toChain: request.toChain.toString(),
            fromToken: request.fromToken,
            toToken: request.toToken,
            fromAmount: request.fromAmount,
            fromAddress: request.fromAddress,
            toAddress: request.toAddress,
            slippage: (request.slippage || 0.01).toString(),
        });

        const response = await fetch(`${this.apiUrl}/quote?${queryParams}`);

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`LiFi quote failed: ${error}`);
        }

        const quote: LiFiQuoteResponse = await response.json();

        return {
            calldata: quote.transactionRequest.data,
            toAddress: quote.transactionRequest.to,
            minReceive: BigInt(quote.estimate.toAmountMin),
            bridgeTool: quote.toolDetails.name,
            estimatedReceive: BigInt(quote.estimate.toAmount),
        };
    }

    /**
     * Check if a route is available between chains
     */
    async isRouteAvailable(fromChain: string, toChain: string): Promise<boolean> {
        try {
            const fromChainId = CHAIN_IDS[fromChain];
            const toChainId = CHAIN_IDS[toChain];

            if (!fromChainId || !toChainId) {
                return false;
            }

            const response = await fetch(
                `${this.apiUrl}/connections?fromChain=${fromChainId}&toChain=${toChainId}`
            );

            if (!response.ok) {
                return false;
            }

            const data = await response.json();
            return data.connections && data.connections.length > 0;
        } catch {
            return false;
        }
    }

    /**
     * Get supported chains from LiFi
     */
    async getSupportedChains(): Promise<string[]> {
        try {
            const response = await fetch(`${this.apiUrl}/chains`);
            if (!response.ok) {
                return Object.keys(CHAIN_IDS);
            }

            const data = await response.json();
            return data.chains?.map((c: any) => c.key) || Object.keys(CHAIN_IDS);
        } catch {
            return Object.keys(CHAIN_IDS);
        }
    }

    /**
     * Check if this is a same-chain transfer (no bridge needed)
     */
    isSameChain(fromChain: string, toChain: string): boolean {
        return fromChain === toChain;
    }

    /**
     * Get chain ID from name
     */
    getChainId(chainName: string): number | undefined {
        return CHAIN_IDS[chainName];
    }

    /**
     * Get gas token for chain
     */
    getGasToken(chainName: string): string {
        return GAS_TOKENS[chainName] || ETH_ADDRESS;
    }
}
