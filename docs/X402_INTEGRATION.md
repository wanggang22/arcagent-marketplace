# ArcAgent x402 真实集成方案

> 使用 Circle Nanopayments（`@circle-fin/x402-batching`）在 Arc Testnet 上实现真正的 x402 微支付。

---

## 现状 vs 目标

| | 现在（Demo） | 目标（真实 x402） |
|---|---|---|
| 支付 | NanopayDemo 合约记录日志 | Circle Gateway 链下签名 + 批量结算 |
| Agent 回复 | 前端模拟预设文本 | Agent Server 真正调 AI 返回结果 |
| Gas | 每次调 recordPayment 要 gas | 零 gas（Gateway 批量结算） |
| 用户签名 | 链上交易（eth_sendTransaction） | 链下签名（eth_signTypedData_v4） |

---

## 技术方案

### 核心依赖

```bash
npm install @circle-fin/x402-batching @x402/core viem
```

### Arc Testnet 配置

| 参数 | 值 |
|------|-----|
| Chain ID | 5042002（CAIP-2: `eip155:5042002`） |
| Gateway Domain ID | 26 |
| RPC | `https://rpc.testnet.arc.network` |
| USDC | `0x3600000000000000000000000000000000000000` |
| Gateway Wallet | `0x0077777d7EBA4688BDeF3E311b846F25870A19B9` |
| Gateway API | `https://gateway-api-testnet.circle.com` |
| Explorer | `https://testnet.arcscan.app` |

### 不需要额外 API Key

Circle Gateway testnet 端点是公开的，不需要 Circle API Key。只需要 EVM 私钥（Agent 收款地址）。

---

## 三个 HTTP Header

| Header | 方向 | 内容 |
|--------|------|------|
| `PAYMENT-REQUIRED` | Server → Client | Base64 JSON，支付要求（金额、网络、地址） |
| `PAYMENT-SIGNATURE` | Client → Server | Base64 JSON，用户签名的支付授权 |
| `PAYMENT-RESPONSE` | Server → Client | Base64 JSON，结算结果 |

---

## 完整流程

```
用户请求 Agent API
      ↓
Agent 返回 HTTP 402 + PAYMENT-REQUIRED header
      ↓
用户钱包签名（eth_signTypedData_v4，零 gas）
      ↓
用户重新请求，附带 PAYMENT-SIGNATURE header
      ↓
Agent Server 调 Circle Gateway /v1/x402/settle
      ↓
Gateway 验证签名 → 记账（链下）→ 批量结算（链上，Gateway 付 gas）
      ↓
Agent 执行任务 → 返回结果 + PAYMENT-RESPONSE header
```

---

## Seller（Agent Server）实现

### 方式一：Express 中间件（推荐）

```javascript
import express from 'express';
import { createGatewayMiddleware } from '@circle-fin/x402-batching/server';

const app = express();

const gateway = createGatewayMiddleware({
  sellerAddress: '0xYOUR_AGENT_ADDRESS',  // Agent 收款地址
  networks: ['eip155:5042002'],            // Arc Testnet
});

// 定价 $0.001 的分析接口
app.get('/api/analyze', gateway.require('$0.001'), (req, res) => {
  // 到这里说明已经付款成功
  const result = doAnalysis(req.query);
  res.json({ result });
});

// 定价 $0.01 的翻译接口
app.get('/api/translate', gateway.require('$0.01'), (req, res) => {
  const result = doTranslation(req.query.text);
  res.json({ result });
});

app.listen(3000);
```

### 方式二：手动 verify + settle

```javascript
import { BatchFacilitatorClient } from '@circle-fin/x402-batching/server';

const facilitator = new BatchFacilitatorClient();
// 默认连接 https://gateway-api-testnet.circle.com

// 验证支付
const verifyResult = await facilitator.verify(paymentPayload, paymentRequirements);
if (!verifyResult.isValid) {
  return res.status(402).json({ error: verifyResult.invalidReason });
}

// 结算支付（Circle 推荐直接 settle，不需要先 verify）
const settleResult = await facilitator.settle(paymentPayload, paymentRequirements);
if (!settleResult.success) {
  return res.status(402).json({ error: settleResult.errorReason });
}

// 结算成功，执行任务
console.log(`Payer: ${settleResult.payer}, Tx: ${settleResult.transaction}`);
```

---

## Buyer（前端/Client）实现

### 方式一：GatewayClient（SDK 调用，适合 Node.js）

```javascript
import { GatewayClient } from '@circle-fin/x402-batching/client';

const client = new GatewayClient({
  chain: 'arcTestnet',
  privateKey: process.env.PRIVATE_KEY,
});

// 1. 首次使用：存入 USDC 到 Gateway（链上交易，一次性）
await client.deposit('1.00');

// 2. 付费请求（零 gas！）
const response = await client.pay('https://agent-api.com/api/analyze');
console.log(response.data);        // Agent 返回的结果
console.log(response.formattedAmount); // 付了多少 USDC

// 3. 查余额
const balances = await client.getBalances();
console.log('可用:', balances.gateway.formattedAvailable, 'USDC');

// 4. 提现
await client.withdraw('0.5');
```

### 方式二：浏览器前端（MetaMask 签名）

```javascript
// 1. 请求 Agent API
const res = await fetch('https://agent-api.com/api/analyze');

if (res.status === 402) {
  // 2. 解析支付要求
  const paymentRequired = JSON.parse(
    atob(res.headers.get('PAYMENT-REQUIRED'))
  );

  // 3. 构造 EIP-712 签名数据（TransferWithAuthorization）
  const msgParams = buildEIP712Message(paymentRequired);

  // 4. 用户签名（MetaMask 弹窗显示 "Sign"，零 gas）
  const signature = await window.ethereum.request({
    method: 'eth_signTypedData_v4',
    params: [userAccount, JSON.stringify(msgParams)],
  });

  // 5. 带签名重新请求
  const paymentPayload = buildPaymentPayload(signature, paymentRequired);
  const result = await fetch('https://agent-api.com/api/analyze', {
    headers: {
      'PAYMENT-SIGNATURE': btoa(JSON.stringify(paymentPayload)),
    },
  });

  // 6. 拿到结果
  const data = await result.json();
}
```

---

## 与 OKX facilitator 对比

| | OKX（X Layer） | Circle（Arc） |
|---|---|---|
| 包 | 自己的 REST API | `@circle-fin/x402-batching` |
| 验证 | `POST /api/v6/x402/verify` | `POST /v1/x402/verify` |
| 结算 | `POST /api/v6/x402/settle` | `POST /v1/x402/settle` |
| 认证 | OKX API Key + Secret + Passphrase | 不需要（公开 testnet 端点） |
| 结算方式 | 每笔单独链上结算 | 批量链下记账 + 定期链上结算 |
| Gas | OKX 代付 | Gateway 代付（批量分摊） |
| 链 | X Layer（chainIndex: 196） | Arc Testnet（Domain: 26） |
| 用户签名 | `eth_signTypedData_v4` | `eth_signTypedData_v4`（相同） |
| 最低支付 | ~$0.001 | ~$0.000001（亚分级） |

### 核心差异

**OKX：** 每笔 verify → settle → 一笔链上交易。简单直接。

**Circle：** 收集签名 → 链下记账 → TEE 验证 → 批量链上结算。1000 笔合成一笔，gas 成本除以 1000。

---

## Gateway 余额系统

用户需要先将 USDC 存入 Gateway Wallet 合约，之后的支付都在链下完成：

```
用户钱包 USDC
    ↓ deposit（链上，一次性）
Gateway Wallet（链上合约）
    ↓ 签名授权（链下，零 gas，多次）
Gateway 记账系统
    ↓ 批量结算（链上，Gateway 付 gas）
Agent 收款地址
```

**余额状态：**
| 状态 | 含义 |
|------|------|
| Available | 可用余额，可以支付 |
| Locked | 已签名授权但未结算 |
| Withdrawing | 提现中 |
| Withdrawable | 紧急提现就绪（7 天后） |

**提现方式：**
- 同链提现：即时
- 跨链提现：通过 Gateway 即时
- 紧急提现（无需 Circle API）：7 天延迟

---

## 需要改的文件

### 1. Agent Server（`scripts/agent-server.mjs`）

```
- 安装 @circle-fin/x402-batching
- 用 createGatewayMiddleware 替换现有的模拟逻辑
- 为每个 API endpoint 设定价格
- 接入真实 AI（可选，用 Anthropic/OpenAI）
```

### 2. 前端（`docs/index.html`）

```
- Nanopay 区域改为真实 x402 流程
- 用 eth_signTypedData_v4 替换 eth_sendTransaction
- 显示 Gateway 余额（需要先 deposit）
- 去掉 "Demo Mode" 标签
```

### 3. NanopayDemo 合约

```
- 可以保留作为额外的链上记录
- 或者完全不用（Gateway 自带链上记录）
```

### 4. SDK（`sdk/arcagent-sdk.mjs`）

```
- 可选：集成 x402 seller 功能
- 让开发者通过 SDK 一行代码开启 x402 定价
```

---

## 实施步骤

1. `npm install @circle-fin/x402-batching @x402/core`
2. Agent Server 加 `createGatewayMiddleware`，设定 API 价格
3. 部署 Agent Server 到 Railway
4. 前端改 Nanopay 区域为真实 x402 请求流程
5. 测试：存入 USDC → 签名付费 → 收到 AI 结果
6. 去掉 Demo Mode 标签

---

*文档编写于 2026 年 3 月 28 日。基于 `@circle-fin/x402-batching` v2.0.4 和 Circle Gateway Testnet。*
