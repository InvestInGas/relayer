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
            // Get dynamic field for this chain from the prices table
            const dynamicFields = await this.client.getDynamicFields({
                parentId: this.oracleObjectId,
            });

            // Find the prices table field
            const pricesField = dynamicFields.data.find(
                (field) => field.name.value === 'prices'
            );

            if (!pricesField) {
                // Fallback: try to get the object directly and parse it
                const object = await this.client.getObject({
                    id: this.oracleObjectId,
                    options: { showContent: true },
                });

                if (!object.data?.content || object.data.content.dataType !== 'moveObject') {
                    return null;
                }

                // Parse directly from object fields if table is embedded
                const fields = object.data.content.fields as any;

                // Navigate to prices table
                if (fields.prices?.fields?.contents) {
                    const pricesMap = fields.prices.fields.contents;
                    const chainEntry = pricesMap.find((item: any) =>
                        item.fields?.key === chain
                    );

                    if (chainEntry) {
                        const priceFields = chainEntry.fields.value.fields;
                        const priceWei = priceFields.price_wei;

                        return {
                            chain,
                            priceWei: priceWei.toString(),
                            priceGwei: this.weiToGwei(priceWei.toString()),
                            high24h: priceFields.high_24h?.toString() || priceWei.toString(),
                            low24h: priceFields.low_24h?.toString() || priceWei.toString(),
                            timestampMs: parseInt(priceFields.timestamp_ms || '0'),
                            gasToken: priceFields.gas_token || 'ETH',
                        };
                    }
                }
            }

            return null;
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

