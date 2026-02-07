/**
 * Sui Oracle Reader
 * Fetches gas prices from the Sui GasOracle module
 */

import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';

export interface SuiGasPrice {
    chain: string;
    priceWei: string;
    priceGwei: string;
    high24h: string;
    low24h: string;
    timestampMs: number;
    gasToken: string;
}

export class SuiOracleReader {
    private client: SuiClient;
    private oracleObjectId: string;

    constructor(network: 'testnet' | 'mainnet' | 'devnet', oracleObjectId: string) {
        this.client = new SuiClient({ url: getFullnodeUrl(network) });
        this.oracleObjectId = oracleObjectId;
    }

    /**
     * Fetch all gas prices from the Sui oracle
     */
    async fetchAllPrices(): Promise<SuiGasPrice[]> {
        try {
            const object = await this.client.getObject({
                id: this.oracleObjectId,
                options: { showContent: true },
            });

            if (!object.data?.content || object.data.content.dataType !== 'moveObject') {
                throw new Error('Invalid oracle object');
            }

            const fields = object.data.content.fields as any;
            const supportedChains: string[] = fields.supported_chains || [];

            // For each chain, we need to read from the prices table
            // This requires reading the dynamic fields
            const prices: SuiGasPrice[] = [];

            for (const chain of supportedChains) {
                try {
                    const priceData = await this.fetchChainPrice(chain);
                    if (priceData) {
                        prices.push(priceData);
                    }
                } catch (e) {
                    console.warn(`Failed to fetch price for ${chain}:`, e);
                }
            }

            return prices;
        } catch (error) {
            console.error('Error fetching from Sui oracle:', error);
            throw error;
        }
    }

    /**
     * Fetch gas price for a specific chain
     */
    async fetchChainPrice(chain: string): Promise<SuiGasPrice | null> {
        try {
            // 1. Get the oracle object to find the prices table ID
            const object = await this.client.getObject({
                id: this.oracleObjectId,
                options: { showContent: true },
            });

            if (!object.data?.content || object.data.content.dataType !== 'moveObject') {
                return null;
            }

            const fields = object.data.content.fields as any;
            const tableId = fields.prices?.fields?.id?.id;

            if (!tableId) {
                console.error('Prices table ID not found in oracle object');
                return null;
            }

            // 2. Fetch the specific price from the table using dynamic field lookup
            // Key is 0x1::string::String for Table<String, GasPrice>
            const response = await this.client.getDynamicFieldObject({
                parentId: tableId,
                name: {
                    type: '0x1::string::String',
                    value: chain
                }
            });

            if (!response.data?.content || response.data.content.dataType !== 'moveObject') {
                return null;
            }

            const priceFields = response.data.content.fields as any;
            const value = priceFields.value?.fields;

            if (!value) return null;

            return {
                chain,
                priceWei: value.price_wei.toString(),
                priceGwei: this.weiToGwei(value.price_wei.toString()),
                high24h: value.high_24h?.toString() || value.price_wei.toString(),
                low24h: value.low_24h?.toString() || value.price_wei.toString(),
                timestampMs: Number(value.timestamp_ms || 0),
                gasToken: value.gas_token || 'ETH',
            };
        } catch (error) {
            console.error(`Error fetching price for ${chain}:`, error);
            return null;
        }
    }

    private weiToGwei(weiStr: string): string {
        const wei = BigInt(weiStr);
        const gwei = Number(wei) / 1e9;
        return gwei.toFixed(6);
    }

    /**
     * Check if price for a chain is stale
     * @param chain - Chain name
     * @param maxAgeMs - Maximum age in milliseconds (default 5 minutes)
     */
    async isPriceStale(chain: string, maxAgeMs: number = 300000): Promise<boolean> {
        const price = await this.fetchChainPrice(chain);
        if (!price) return true;
        return Date.now() - price.timestampMs > maxAgeMs;
    }
}

