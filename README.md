# InvestInGas Relayer v2

Express API service for processing gas futures intents with the Uniswap v4 hook architecture.

## Architecture

```
Frontend → Relayer → InvestInGasHook (Sepolia)
                  ↓
            Sui Oracle (gas prices)
                  ↓
            LiFi Bridge (cross-chain)
```

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check and relayer status |
| `/api/prices` | GET | All gas prices from Sui oracle |
| `/api/prices/:chain` | GET | Gas price for specific chain |
| `/api/positions/:user` | GET | User's NFT positions |
| `/api/positions/token/:tokenId` | GET | Specific position details |
| `/api/purchase` | POST | Purchase gas position |
| `/api/redeem` | POST | Redeem gas position |
| `/api/lifi/quote` | GET | Get LiFi bridge quote |
| `/api/lifi/chains` | GET | Supported chains |

## Setup

```bash
# Install dependencies
npm install

# Copy env template
cp .env.example .env

# Edit .env with your configuration

# Run in development
npm run dev

# Build for production
npm run build
npm start
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `EVM_RPC_URL` | Yes | Sepolia RPC URL |
| `HOOK_ADDRESS` | Yes | InvestInGasHook contract address |
| `BRIDGER_ADDRESS` | Yes | LiFiBridger contract address |
| `RELAYER_PRIVATE_KEY` | Yes | Relayer wallet private key |
| `SUI_NETWORK` | Yes | Sui network (testnet/mainnet) |
| `SUI_ORACLE_OBJECT_ID` | Yes | Sui gas oracle object ID |
| `PORT` | No | Server port (default: 3001) |
| `MAX_SLIPPAGE_BPS` | No | Max slippage in bps (default: 100) |
| `SOURCE_CHAIN` | No | Source chain name (default: sepolia) |

## API Examples

### Purchase Position

```bash
curl -X POST http://localhost:3001/api/purchase \
  -H "Content-Type: application/json" \
  -d '{
    "user": "0x...",
    "usdcAmount": "100000000",
    "targetChain": "arbitrum",
    "expiryDays": 30,
    "userSignature": "0x...",
    "timestamp": 1234567890
  }'
```

### Redeem Position

```bash
curl -X POST http://localhost:3001/api/redeem \
  -H "Content-Type: application/json" \
  -d '{
    "user": "0x...",
    "tokenId": 0,
    "wethAmount": "max",
    "userSignature": "0x...",
    "timestamp": 1234567890
  }'
```

### Get Positions

```bash
curl http://localhost:3001/api/positions/0xYourAddress
```
