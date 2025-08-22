// Central place to update after redeploys
export const CONTRACTS = {
  factory: "0x09B2a4df6A1641Abd1E00922Eac450c5B32E3A2f",
  router:  "0xfB312a26b6fB55C1C93a9280625166FeFfD1199b",
  tokens: {
    TETH:  "0x93B186eA98DF7A37A87AA3ac708d246a245F3352",
    TUSDC: "0x856B26dB17Be30856C92e908A1F53aAB33A5eebA",
    TUSDT: "0x7CF7D3b2448359F352142ad170a2e7Bc9727Ebe8",
  },
} as const;

export const TOKEN_LIST = Object.entries(CONTRACTS.tokens).map(([symbol, address]) => ({ symbol, address }));
