export type Strategy = {
  id: string;
  protocol: string;
  name: string;
  asset: string;
  apy: number;
  allocation: number;
  balance: number;
  risk: "Low" | "Medium";
  color: string;
};

export type ActivityItem = {
  id: string;
  type: "Deposit" | "Yield" | "Allocation" | "Withdraw";
  title: string;
  detail: string;
  amount: string;
  time: string;
  status: "Complete" | "Earning" | "Private";
};

export const strategies: Strategy[] = [
  {
    id: "vesu-usdc",
    protocol: "Vesu",
    name: "Prime USDC",
    asset: "USDC",
    apy: 8.42,
    allocation: 42,
    balance: 10584.2,
    risk: "Low",
    color: "#d7ff43",
  },
  {
    id: "nostra-usdc",
    protocol: "Nostra",
    name: "Lending pool",
    asset: "USDC",
    apy: 6.81,
    allocation: 28,
    balance: 7056.12,
    risk: "Low",
    color: "#73dfc4",
  },
  {
    id: "endur-strk",
    protocol: "Endur",
    name: "Liquid staking",
    asset: "STRK",
    apy: 10.28,
    allocation: 18,
    balance: 4536.08,
    risk: "Medium",
    color: "#f5a65b",
  },
  {
    id: "reserve",
    protocol: "Sotto",
    name: "Shielded reserve",
    asset: "USDC",
    apy: 0,
    allocation: 12,
    balance: 3024.05,
    risk: "Low",
    color: "#d5d9d1",
  },
];

export const activity: ActivityItem[] = [
  {
    id: "a1",
    type: "Yield",
    title: "Yield accrued",
    detail: "Vesu Prime USDC",
    amount: "+$12.48",
    time: "2h ago",
    status: "Earning",
  },
  {
    id: "a2",
    type: "Allocation",
    title: "Position rebalanced",
    detail: "Nostra to shielded reserve",
    amount: "$840.00",
    time: "Yesterday",
    status: "Private",
  },
  {
    id: "a3",
    type: "Deposit",
    title: "Private deposit",
    detail: "Base via CCTP",
    amount: "+$5,000.00",
    time: "Aug 14",
    status: "Complete",
  },
  {
    id: "a4",
    type: "Withdraw",
    title: "Fresh withdrawal",
    detail: "Starknet to new address",
    amount: "-$1,200.00",
    time: "Aug 11",
    status: "Complete",
  },
];

export const chains = [
  { id: "starknet", name: "Starknet", symbol: "ST", color: "#222222" },
  { id: "ethereum", name: "Ethereum", symbol: "E", color: "#627eea" },
  { id: "base", name: "Base", symbol: "B", color: "#0052ff" },
  { id: "arbitrum", name: "Arbitrum", symbol: "A", color: "#28a0f0" },
];

export const chartData = [
  22420, 22510, 22470, 22640, 22730, 22685, 22890, 23040, 23110, 23060, 23310,
  23420, 23580, 23520, 23760, 23910, 24180, 24090, 24320, 24610, 24530, 24840,
  25010, 25200,
];
