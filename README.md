# InvestInGas Relayer v2

The **InvestInGas Relayer** is a critical infrastructure component that connects the frontend, the Uniswap v4 Hook (on Sepolia), and the Sui Gas Oracle. It enables users to purchase gas futures with signatures rather than direct contract interaction, providing a seamless UX.

## 🏗 Architecture

```mermaid
graph LR
    User[User / Frontend] -- 1. Sign Intent --> Relayer
    Relayer -- 2. Read Gas Price --> SuiOracle[Sui Oracle]
    Relayer -- 3. Execute Trade --> Hook[InvestInGasHook (Sepolia)]
    Relayer -- 4. Bridge Funds --> LiFi[LiFi Bridge]
```

## 🚀 Quick Start

### 1. Prerequisites
- Node.js v18+
- Use a wallet with **Sepolia ETH** (for gas fees).
- Deployed `InvestInGasHook` and `LiFiBridger` contracts.
- A valid `Sui Oracle Object ID` (deployed on Sui Testnet).

### 2. Installation
```bash
# Install dependencies
npm install

# Build the project
npm run build
```

### 3. Configuration
Copy the example environment file:
```bash
cp .env.example .env
```

Edit `.env` and fill in the required values:
```ini
EVM_RPC_URL=https://sepolia.infura.io/v3/YOUR_KEY
RELAYER_PRIVATE_KEY=your_private_key_here

HOOK_ADDRESS=0x...      
BRIDGER_ADDRESS=0x...   

SUI_NETWORK=testnet
SUI_ORACLE_OBJECT_ID=0x... 
```

### 4. Running the Relayer
```bash
npm start

npm run dev
```

You should see:
```
Relayer listening on port 3001
Is authorized relayer: true
```

## 🔐 Authorization
For the relayer to work, the wallet associated with `RELAYER_PRIVATE_KEY` must be authorized on the Hook contract.

**If you see:** `WARNING: This wallet is NOT the authorized relayer!`

**Fix:** Call `setRelayer(YOUR_RELAYER_ADDRESS)` on the `InvestInGasHook` contract using the contract owner's wallet.

## 📡 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| **Health** | | |
| `/health` | GET | Check relayer status and authorization |
| **Market Data** | | |
| `/api/prices` | GET | Fetch all gas prices from Sui Oracle |
| `/api/prices/:chain` | GET | Fetch specific chain price |
| `/api/lifi/chains` | GET | List supported destination chains |
| **User Data** | | |
| `/api/positions/:user` | GET | List user's active gas positions |
| `/api/positions/token/:id`| GET | Get details for a specific position |
| **Actions** | | |
| `/api/purchase` | POST | Execute a purchase (requires signature) |
| `/api/redeem` | POST | Redeem a position (requires signature) |

## 🛠 Troubleshooting

**"Gas price is stale"**
- The Sui Oracle hasn't been updated in >5 minutes.
- Check if your `oracle-bot` is running and publishing prices.

**"Chain not supported"**
- Ensure the chain is added to the `InvestInGasHook` via `addChain`.
