/**
 * InvestInGas Relayer Service (v2)
 * 
 * Updated for InvestInGasHook (Uniswap v4 hook with NFT positions)
 * 
 * Flow:
 * 1. User signs intent in frontend
 * 2. Frontend sends intent to this relayer
 * 3. Relayer fetches gas price from Sui oracle
 * 4. Relayer submits transaction to InvestInGasHook
 * 5. For redemptions, relayer generates LiFi calldata
 */

import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import { SuiOracleReader } from './sui-reader.js';
import { EvmHookClient, GasPosition } from './evm-client.js';
import { LiFiClient } from './lifi-client.js';

// Load config from environment
const config = {
    port: parseInt(process.env.PORT || '3001'),
    evmRpcUrl: process.env.EVM_RPC_URL || '',
    hookAddress: process.env.HOOK_ADDRESS || '',  // InvestInGasHook address
    bridgerAddress: process.env.BRIDGER_ADDRESS || '',  // LiFiBridger address
    relayerPrivateKey: process.env.RELAYER_PRIVATE_KEY || '',
    suiNetwork: (process.env.SUI_NETWORK || 'testnet') as 'testnet' | 'mainnet' | 'devnet',
    suiOracleObjectId: process.env.SUI_ORACLE_OBJECT_ID || '',
    maxSlippageBps: parseInt(process.env.MAX_SLIPPAGE_BPS || '100'),
    sourceChain: process.env.SOURCE_CHAIN || 'sepolia',  // Chain where hook is deployed
};

// Initialize clients
const suiOracle = new SuiOracleReader(config.suiNetwork, config.suiOracleObjectId);
const evmClient = new EvmHookClient(
    config.evmRpcUrl,
    config.relayerPrivateKey,
    config.hookAddress
);
const lifiClient = new LiFiClient(config.maxSlippageBps);

// Price staleness threshold (5 minutes)
const PRICE_STALENESS_MS = 5 * 60 * 1000;

// Express app
const app = express();
app.use(express.json());

// CORS middleware
app.use((req: Request, res: Response, next: NextFunction) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
        return;
    }
    next();
});

// ============ Health & Info Endpoints ============

app.get('/health', async (req: Request, res: Response) => {
    try {
        const isAuthorized = await evmClient.isAuthorizedRelayer();
        const protocolFee = await evmClient.getProtocolFeeBps();

        res.json({
            status: 'ok',
            version: '2.0.0',
            architecture: 'uniswap-v4-hook',
            relayerAddress: evmClient.getAddress(),
            hookAddress: config.hookAddress,
            isAuthorizedRelayer: isAuthorized,
            protocolFeeBps: protocolFee,
            sourceChain: config.sourceChain,
        });
    } catch (error) {
        res.status(500).json({ error: 'Health check failed' });
    }
});

// ============ Price Endpoints ============

app.get('/api/prices', async (req: Request, res: Response) => {
    try {
        const gasPrices = await suiOracle.fetchAllPrices();
        res.json({ gasPrices, sourceChain: config.sourceChain });
    } catch (error) {
        console.error('Error fetching prices:', error);
        res.status(500).json({ error: 'Failed to fetch prices' });
    }
});

app.get('/api/prices/:chain', async (req: Request, res: Response) => {
    try {
        const { chain } = req.params;
        const gasPrice = await suiOracle.fetchChainPrice(chain);

        if (!gasPrice) {
            res.status(404).json({ error: 'Chain not found' });
            return;
        }

        // Check staleness
        const isStale = Date.now() - gasPrice.timestampMs > PRICE_STALENESS_MS;

        res.json({
            gasPrice,
            isStale,
            staleSinceMs: isStale ? Date.now() - gasPrice.timestampMs : 0,
        });
    } catch (error) {
        console.error('Error fetching price:', error);
        res.status(500).json({ error: 'Failed to fetch price' });
    }
});

// ============ Position Endpoints ============

app.get('/api/positions/:user', async (req: Request, res: Response) => {
    try {
        const { user } = req.params;
        const positions = await evmClient.getUserPositions(user);

        // Enrich with gas units available
        const enrichedPositions = await Promise.all(
            positions.map(async (pos) => ({
                ...pos,
                gasUnitsAvailable: (await evmClient.getGasUnitsAvailable(pos.tokenId)).toString(),
                isExpired: pos.expiry < Math.floor(Date.now() / 1000),
            }))
        );

        res.json({ positions: enrichedPositions });
    } catch (error) {
        console.error('Error fetching positions:', error);
        res.status(500).json({ error: 'Failed to fetch positions' });
    }
});

app.get('/api/positions/token/:tokenId', async (req: Request, res: Response) => {
    try {
        const tokenId = parseInt(req.params.tokenId);
        const position = await evmClient.getPosition(tokenId);

        if (!position) {
            res.status(404).json({ error: 'Position not found' });
            return;
        }

        const gasUnitsAvailable = await evmClient.getGasUnitsAvailable(tokenId);

        res.json({
            position: {
                ...position,
                gasUnitsAvailable: gasUnitsAvailable.toString(),
                isExpired: position.expiry < Math.floor(Date.now() / 1000),
            },
        });
    } catch (error) {
        console.error('Error fetching position:', error);
        res.status(500).json({ error: 'Failed to fetch position' });
    }
});

// ============ Purchase Endpoint ============

app.post('/api/purchase', async (req: Request, res: Response) => {
    try {
        const {
            user,
            usdcAmount,       // Amount in USDC (6 decimals)
            targetChain,      // e.g. "arbitrum", "base", "sepolia"
            expiryDays,       // Duration until expiry
            userSignature,    // EIP-712 signature
            timestamp,        // Signature timestamp
        } = req.body;

        // Validate required fields
        if (!user || !usdcAmount || !targetChain || !expiryDays || !userSignature || !timestamp) {
            res.status(400).json({ error: 'Missing required fields' });
            return;
        }

        // Check chain is supported
        const isSupported = await evmClient.isChainSupported(targetChain);
        if (!isSupported) {
            res.status(400).json({ error: `Chain ${targetChain} not supported` });
            return;
        }

        // Fetch gas price from Sui oracle
        const gasPrice = await suiOracle.fetchChainPrice(targetChain);
        if (!gasPrice) {
            res.status(400).json({ error: 'Failed to fetch gas price for chain' });
            return;
        }

        // Check staleness
        if (Date.now() - gasPrice.timestampMs > PRICE_STALENESS_MS) {
            res.status(400).json({
                error: 'Gas price is stale',
                staleSinceMs: Date.now() - gasPrice.timestampMs
            });
            return;
        }

        // Verify user signature
        const isValid = EvmHookClient.verifyPurchaseSignature(
            user,
            BigInt(usdcAmount),
            targetChain,
            parseInt(expiryDays),
            timestamp,
            userSignature
        );

        if (!isValid) {
            res.status(403).json({ error: 'Invalid user signature' });
            return;
        }

        // Convert gas price to wei (from gwei string)
        const lockedGasPriceWei = BigInt(gasPrice.priceWei);

        // Calculate expiry duration in seconds
        const expiryDuration = parseInt(expiryDays) * 24 * 60 * 60;

        // Calculate minimum WETH output (with slippage)
        // For now, use 0 as minWethOut (rely on price oracle being fresh)
        const minWethOut = 0n;

        console.log(`Processing purchase for ${user}: ${usdcAmount} USDC -> ${targetChain}`);
        console.log(`  Gas price: ${gasPrice.priceGwei} gwei, Expiry: ${expiryDays} days`);

        // Submit transaction
        const { txHash, tokenId } = await evmClient.purchasePosition(
            BigInt(usdcAmount),
            minWethOut,
            lockedGasPriceWei,
            targetChain,
            expiryDuration,
            user
        );

        console.log(`Purchase successful: ${txHash}, tokenId: ${tokenId}`);

        res.json({
            success: true,
            txHash,
            tokenId: tokenId.toString(),
            lockedGasPriceWei: lockedGasPriceWei.toString(),
            lockedGasPriceGwei: gasPrice.priceGwei,
            expiryTimestamp: Math.floor(Date.now() / 1000) + expiryDuration,
        });
    } catch (error: any) {
        console.error('Purchase error:', error);
        res.status(500).json({ error: error.message || 'Purchase failed' });
    }
});

// ============ Redeem Endpoint ============

app.post('/api/redeem', async (req: Request, res: Response) => {
    try {
        const {
            user,
            tokenId,          // Position NFT ID
            wethAmount,       // Amount of WETH to redeem (use "max" for full)
            userSignature,    // EIP-712 signature
            timestamp,        // Signature timestamp
        } = req.body;

        // Validate required fields
        if (!user || tokenId === undefined || !wethAmount || !userSignature || !timestamp) {
            res.status(400).json({ error: 'Missing required fields' });
            return;
        }

        // Get position
        const position = await evmClient.getPosition(parseInt(tokenId));
        if (!position) {
            res.status(400).json({ error: 'Position not found' });
            return;
        }

        // Check ownership
        if (position.owner.toLowerCase() !== user.toLowerCase()) {
            res.status(403).json({ error: 'Not position owner' });
            return;
        }

        // Check expiry
        if (position.expiry < Math.floor(Date.now() / 1000)) {
            res.status(400).json({ error: 'Position expired, use claimExpired instead' });
            return;
        }

        // Calculate redeem amount
        let redeemAmount: bigint;
        if (wethAmount === 'max') {
            redeemAmount = position.remainingWethAmount;
        } else {
            redeemAmount = BigInt(wethAmount);
        }

        if (redeemAmount > position.remainingWethAmount) {
            res.status(400).json({ error: 'Insufficient remaining amount' });
            return;
        }

        // Verify user signature
        const isValid = EvmHookClient.verifyRedeemSignature(
            user,
            parseInt(tokenId),
            redeemAmount,
            timestamp,
            userSignature
        );

        if (!isValid) {
            res.status(403).json({ error: 'Invalid user signature' });
            return;
        }

        // Generate LiFi calldata if cross-chain
        let lifiData = '0x';
        let bridgeInfo: any = { type: 'direct' };

        if (!lifiClient.isSameChain(config.sourceChain, position.targetChain)) {
            console.log(`Getting LiFi quote: ${config.sourceChain} -> ${position.targetChain}`);

            const quote = await lifiClient.getQuote(
                config.sourceChain,
                position.targetChain,
                redeemAmount,
                config.bridgerAddress,
                user
            );

            lifiData = quote.calldata;
            bridgeInfo = {
                type: 'bridge',
                tool: quote.bridgeTool,
                estimatedReceive: quote.estimatedReceive.toString(),
                minReceive: quote.minReceive.toString(),
            };
        }

        console.log(`Processing redeem for ${user}: token ${tokenId}, ${redeemAmount} wei`);

        // Submit transaction
        const txHash = await evmClient.redeemPosition(
            parseInt(tokenId),
            redeemAmount,
            lifiData,
            user
        );

        console.log(`Redeem successful: ${txHash}`);

        res.json({
            success: true,
            txHash,
            wethRedeemed: redeemAmount.toString(),
            targetChain: position.targetChain,
            bridge: bridgeInfo,
        });
    } catch (error: any) {
        console.error('Redeem error:', error);
        res.status(500).json({ error: error.message || 'Redeem failed' });
    }
});

// ============ LiFi Endpoints ============

app.get('/api/lifi/quote', async (req: Request, res: Response) => {
    try {
        const { toChain, amount, recipient } = req.query as any;

        if (!toChain || !amount || !recipient) {
            res.status(400).json({ error: 'Missing required query params: toChain, amount, recipient' });
            return;
        }

        if (lifiClient.isSameChain(config.sourceChain, toChain)) {
            res.json({
                type: 'direct',
                estimatedReceive: amount,
                minReceive: amount,
                tool: 'direct-transfer',
            });
            return;
        }

        const quote = await lifiClient.getQuote(
            config.sourceChain,
            toChain,
            BigInt(amount),
            config.bridgerAddress,
            recipient
        );

        res.json({
            type: 'bridge',
            estimatedReceive: quote.estimatedReceive.toString(),
            minReceive: quote.minReceive.toString(),
            tool: quote.bridgeTool,
            calldata: quote.calldata,
        });
    } catch (error: any) {
        console.error('LiFi quote error:', error);
        res.status(500).json({ error: error.message || 'Quote failed' });
    }
});

app.get('/api/lifi/chains', async (req: Request, res: Response) => {
    try {
        const chains = await lifiClient.getSupportedChains();
        res.json({ chains, sourceChain: config.sourceChain });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch chains' });
    }
});

// ============ Server Start ============

async function main() {
    console.log('Starting InvestInGas Relayer v2...');
    console.log('===================================');
    console.log('Architecture: Uniswap v4 Hook + LiFi Bridge');

    // Validate config
    if (!config.evmRpcUrl || !config.hookAddress || !config.relayerPrivateKey) {
        console.error('Missing required environment variables. Check .env file.');
        console.error('Required: EVM_RPC_URL, HOOK_ADDRESS, RELAYER_PRIVATE_KEY');
        process.exit(1);
    }

    console.log(`Hook address: ${config.hookAddress}`);
    console.log(`Source chain: ${config.sourceChain}`);

    // Check if authorized
    try {
        const isAuthorized = await evmClient.isAuthorizedRelayer();
        console.log(`Relayer address: ${evmClient.getAddress()}`);
        console.log(`Is authorized relayer: ${isAuthorized}`);

        if (!isAuthorized) {
            console.warn('\nWARNING: This wallet is NOT the authorized relayer!');
            console.warn('Call setRelayer() on the hook contract to authorize this wallet.');
        }
    } catch (error) {
        console.warn('Could not verify relayer authorization:', error);
    }

    app.listen(config.port, () => {
        console.log(`\nRelayer listening on port ${config.port}`);
        console.log(`Health: http://localhost:${config.port}/health`);
        console.log(`Prices: http://localhost:${config.port}/api/prices`);
        console.log(`Positions: http://localhost:${config.port}/api/positions/:user`);
    });
}

main().catch(console.error);
