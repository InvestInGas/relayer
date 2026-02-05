/**
 * EVM Hook Client
 * Interacts with InvestInGasHook contract (Uniswap v4 hook)
 */

import { ethers, Wallet, Contract, JsonRpcProvider } from 'ethers';

// ABI for InvestInGasHook functions
const HOOK_ABI = [
    // Core functions
    'function purchasePosition(uint256 usdcAmount, uint256 minWethOut, uint96 lockedGasPriceWei, string targetChain, uint40 expiryDuration, address buyer) external returns (uint256 tokenId)',
    'function redeemPosition(uint256 tokenId, uint256 wethAmount, bytes lifiData, address recipient) external',
    'function claimExpired(uint256 tokenId) external',

    // View functions
    'function relayer() view returns (address)',
    'function owner() view returns (address)',
    'function getPosition(uint256 tokenId) view returns (tuple(uint256 wethAmount, uint256 remainingWethAmount, uint96 lockedGasPriceWei, uint40 purchaseTimestamp, uint40 expiry, string targetChain))',
    'function getGasUnitsAvailable(uint256 tokenId) view returns (uint256)',
    'function chainIds(string chain) view returns (uint256)',
    'function PROTOCOL_FEE_BPS() view returns (uint16)',
    'function MAX_SLIPPAGE_BPS() view returns (uint16)',

    // ERC721 functions
    'function ownerOf(uint256 tokenId) view returns (address)',
    'function balanceOf(address owner) view returns (uint256)',
    'function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)',
];

// Position struct interface
export interface GasPosition {
    tokenId: number;
    wethAmount: bigint;
    remainingWethAmount: bigint;
    lockedGasPriceWei: bigint;
    purchaseTimestamp: number;
    expiry: number;
    targetChain: string;
    owner: string;
}

export class EvmHookClient {
    private provider: JsonRpcProvider;
    private wallet: Wallet;
    private contract: Contract;
    private contractAddress: string;

    constructor(rpcUrl: string, privateKey: string, hookAddress: string) {
        this.provider = new JsonRpcProvider(rpcUrl);
        this.wallet = new Wallet(privateKey, this.provider);
        this.contract = new Contract(hookAddress, HOOK_ABI, this.wallet);
        this.contractAddress = hookAddress;
    }

    /**
     * Get relayer address from contract
     */
    async getRelayerAddress(): Promise<string> {
        return await this.contract.relayer();
    }

    /**
     * Verify this wallet is the authorized relayer
     */
    async isAuthorizedRelayer(): Promise<boolean> {
        const relayerAddr = await this.getRelayerAddress();
        return relayerAddr.toLowerCase() === this.wallet.address.toLowerCase();
    }

    /**
     * Purchase a gas position for a user
     * @param usdcAmount - USDC amount to spend (6 decimals)
     * @param minWethOut - Minimum WETH to receive (slippage protection)
     * @param lockedGasPriceWei - Gas price to lock (from oracle)
     * @param targetChain - Target chain name (e.g., "sepolia", "arbitrum")
     * @param expiryDuration - Duration in seconds until position expires
     * @param buyer - Address of the buyer
     */
    async purchasePosition(
        usdcAmount: bigint,
        minWethOut: bigint,
        lockedGasPriceWei: bigint,
        targetChain: string,
        expiryDuration: number,
        buyer: string
    ): Promise<{ txHash: string; tokenId: bigint }> {
        const tx = await this.contract.purchasePosition(
            usdcAmount,
            minWethOut,
            lockedGasPriceWei,
            targetChain,
            expiryDuration,
            buyer
        );
        const receipt = await tx.wait();

        // Parse PositionPurchased event for tokenId
        const event = receipt.logs.find((log: any) => {
            try {
                const parsed = this.contract.interface.parseLog(log);
                return parsed?.name === 'PositionPurchased';
            } catch {
                return false;
            }
        });

        let tokenId = 0n;
        if (event) {
            const parsed = this.contract.interface.parseLog(event);
            tokenId = parsed?.args.tokenId || 0n;
        }

        return { txHash: receipt.hash, tokenId };
    }

    /**
     * Redeem a gas position (full or partial)
     * @param tokenId - Position NFT ID
     * @param wethAmount - Amount of WETH to redeem
     * @param lifiData - LiFi bridge calldata (empty for same-chain)
     * @param recipient - Address to receive gas on target chain
     */
    async redeemPosition(
        tokenId: number,
        wethAmount: bigint,
        lifiData: string,
        recipient: string
    ): Promise<string> {
        const tx = await this.contract.redeemPosition(
            tokenId,
            wethAmount,
            lifiData,
            recipient
        );
        const receipt = await tx.wait();
        return receipt.hash;
    }

    /**
     * Get a position by token ID
     */
    async getPosition(tokenId: number): Promise<GasPosition | null> {
        try {
            const owner = await this.contract.ownerOf(tokenId);
            const pos = await this.contract.getPosition(tokenId);

            return {
                tokenId,
                wethAmount: pos.wethAmount,
                remainingWethAmount: pos.remainingWethAmount,
                lockedGasPriceWei: pos.lockedGasPriceWei,
                purchaseTimestamp: Number(pos.purchaseTimestamp),
                expiry: Number(pos.expiry),
                targetChain: pos.targetChain,
                owner,
            };
        } catch {
            return null;
        }
    }

    /**
     * Get all positions for a user
     * Note: This is an approximation - we scan recent token IDs
     */
    async getUserPositions(user: string, maxTokenId: number = 1000): Promise<GasPosition[]> {
        const positions: GasPosition[] = [];

        // Scan for tokens owned by user
        for (let i = 0; i < maxTokenId; i++) {
            try {
                const owner = await this.contract.ownerOf(i);
                if (owner.toLowerCase() === user.toLowerCase()) {
                    const pos = await this.getPosition(i);
                    if (pos) positions.push(pos);
                }
            } catch {
                // Token doesn't exist or was burned
            }
        }

        return positions;
    }

    /**
     * Get gas units available for a position
     */
    async getGasUnitsAvailable(tokenId: number): Promise<bigint> {
        return await this.contract.getGasUnitsAvailable(tokenId);
    }

    /**
     * Check if chain is supported
     */
    async isChainSupported(chain: string): Promise<boolean> {
        const chainId = await this.contract.chainIds(chain);
        return chainId > 0n;
    }

    /**
     * Get protocol fee in basis points
     */
    async getProtocolFeeBps(): Promise<number> {
        return Number(await this.contract.PROTOCOL_FEE_BPS());
    }

    /**
     * Get max slippage in basis points
     */
    async getMaxSlippageBps(): Promise<number> {
        return Number(await this.contract.MAX_SLIPPAGE_BPS());
    }

    /**
     * Get relayer wallet address
     */
    getAddress(): string {
        return this.wallet.address;
    }

    /**
     * Get contract address
     */
    getContractAddress(): string {
        return this.contractAddress;
    }

    /**
     * Verify a user's signature for purchase intent
     */
    static verifyPurchaseSignature(
        user: string,
        usdcAmount: bigint,
        targetChain: string,
        expiryDays: number,
        timestamp: number,
        signature: string
    ): boolean {
        const messageHash = ethers.solidityPackedKeccak256(
            ['string', 'address', 'uint256', 'string', 'uint256', 'uint256'],
            ['InvestInGas:Purchase', user, usdcAmount, targetChain, expiryDays, timestamp]
        );

        const recovered = ethers.verifyMessage(ethers.getBytes(messageHash), signature);
        return recovered.toLowerCase() === user.toLowerCase();
    }

    /**
     * Verify a user's signature for redeem intent
     */
    static verifyRedeemSignature(
        user: string,
        tokenId: number,
        wethAmount: bigint,
        timestamp: number,
        signature: string
    ): boolean {
        const messageHash = ethers.solidityPackedKeccak256(
            ['string', 'address', 'uint256', 'uint256', 'uint256'],
            ['InvestInGas:Redeem', user, tokenId, wethAmount, timestamp]
        );

        const recovered = ethers.verifyMessage(ethers.getBytes(messageHash), signature);
        return recovered.toLowerCase() === user.toLowerCase();
    }
}
