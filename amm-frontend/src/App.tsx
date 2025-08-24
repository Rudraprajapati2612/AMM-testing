import React, { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { CONTRACTS, TOKEN_LIST } from "./contracts";

// Import full ABIs (not fragments) from your build
import factoryAbi from "./abis/AMMFactory.json";
import ammAbi from "./abis/AMM.json";
import routerAbi from "./abis/AMMRouter.json";
import erc20Abi from "./abis/ERC20.json";

type signerLike = ethers.Signer | null;

// Pool types for API data
interface Token {
  id: number;
  address: string;
  symbol: string;
  name?: string;
  decimals: number | string;
}

interface Pool {
  id: number;
  address: string;
  tokenA: Token;
  tokenB: Token;
  liquidity: Array<{
    amountA: string;
    amountB: string;
    provider: string;
    createdAt: string;
  }>;
  swaps?: Array<{
    trader: string;
    amountIn: string;
    amountOut: string;
    tokenIn: string;
    tokenOut: string;
    createdAt: string;
  }>;
}

const zero = (v = 0n) => v === 0n;
const isZeroAddr = (a: string) => a === ethers.ZeroAddress;

export default function App() {
  const [account, setAccount] = useState<string>("");
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [signer, setSigner] = useState<signerLike>(null);
  
  // Pool data from API
  const [pools, setPools] = useState<Pool[]>([]);
  const [selectedPool, setSelectedPool] = useState<Pool | null>(null);
  const [loadingPools, setLoadingPools] = useState(false);
  const [showPools, setShowPools] = useState(false);

  // Loading states for better UX
  const [isCreatingPair, setIsCreatingPair] = useState(false);
  const [isAddingLiquidity, setIsAddingLiquidity] = useState(false);
  const [isSwapping, setIsSwapping] = useState(false);
  const [isRemovingLiquidity, setIsRemovingLiquidity] = useState(false);

  // API Base URL - adjust this to your backend URL
  const API_BASE = "http://localhost:3000";

  // ---------- Connect ----------
  const connectWallet = async () => {
    const eth = (window as any).ethereum;
    if (!eth) return alert("Install MetaMask!");
    const prov = new ethers.BrowserProvider(eth);
    const accounts = await prov.send("eth_requestAccounts", []);
    setAccount(accounts[0]);
    setProvider(prov);
    setSigner(await prov.getSigner());
  };

  // Fetch pools from API
  const fetchPools = async () => {
    setLoadingPools(true);
    try {
      const response = await fetch(`${API_BASE}/pools`);
      if (!response.ok) throw new Error('Failed to fetch pools');
      const data = await response.json();
      setPools(data);
    } catch (error) {
      console.error("Error fetching pools:", error);
      alert("Failed to fetch pools from API");
    } finally {
      setLoadingPools(false);
    }
  };

  // Fetch specific pool details
  const fetchPoolDetails = async (poolId: number) => {
    try {
      const response = await fetch(`${API_BASE}/pool/${poolId}`);
      if (!response.ok) throw new Error('Pool not found');
      const data = await response.json();
      setSelectedPool(data);
    } catch (error) {
      console.error("Error fetching pool details:", error);
      alert("Failed to fetch pool details");
    }
  };

  // Calculate pool metrics (handle both string and number decimals)
  const getPoolMetrics = (pool: Pool) => {
    const tokenADecimals = typeof pool.tokenA.decimals === 'string' ? 
      parseInt(pool.tokenA.decimals) : pool.tokenA.decimals;
    const tokenBDecimals = typeof pool.tokenB.decimals === 'string' ? 
      parseInt(pool.tokenB.decimals) : pool.tokenB.decimals;
      
    const reserveA = pool.liquidity.reduce((acc, l) => {
      const amount = parseFloat(l.amountA);
      return acc + (isNaN(amount) ? 0 : amount);
    }, 0);
    
    const reserveB = pool.liquidity.reduce((acc, l) => {
      const amount = parseFloat(l.amountB);
      return acc + (isNaN(amount) ? 0 : amount);
    }, 0);
    
    const totalSwaps = pool.swaps?.length || 0;
    
    return {
      reserveA: reserveA / Math.pow(10, tokenADecimals),
      reserveB: reserveB / Math.pow(10, tokenBDecimals),
      totalSwaps,
      pairName: `${pool.tokenA.symbol}/${pool.tokenB.symbol}`
    };
  };

  // Helpers to get contracts
  const getFactory = () => new ethers.Contract(CONTRACTS.factory, factoryAbi, signer!);
  const getRouter  = () => new ethers.Contract(CONTRACTS.router,  routerAbi,  signer!);
  const getERC20   = (addr: string) => new ethers.Contract(addr, erc20Abi, signer!);
  const getAMM     = (addr: string) => new ethers.Contract(addr, ammAbi, signer!);

  // Helper function to get AMM contract data
  const getAMMData = async (ammContract: ethers.Contract) => {
    try {
      const [token0, token1, reserve0, reserve1] = await Promise.all([
        ammContract.token0(),
        ammContract.token1(),
        ammContract.reserve0(),
        ammContract.reserve1(),
      ]);

      return { 
        tokenA: token0, 
        tokenB: token1, 
        reserveA: reserve0, 
        reserveB: reserve1 
      };
    } catch (error) {
      console.error("Error getting AMM data:", error);
      throw new Error("Could not get AMM contract data. Check your AMM ABI and contract implementation.");
    }
  };

  // Improved error message decoder
  const decodeContractError = (error: any): string => {
    // Common error messages
    const errorMappings: Record<string, string> = {
      "0xe450d38c": "Insufficient A Amount - Try reducing amount A",
      "0x025dbdd4": "Insufficient B Amount - Try reducing amount B",
      "0x8c379a00": "Contract execution failed",
      "0x4e487b71": "Arithmetic overflow/underflow"
    };

    if (error.reason) {
      return error.reason;
    }

    if (error.data && typeof error.data === 'string') {
      const errorSig = error.data.slice(0, 10);
      const knownError = errorMappings[errorSig];
      if (knownError) return knownError;
    }

    if (error.message) {
      if (error.message.includes("insufficient funds")) {
        return "Insufficient ETH for gas fees";
      }
      if (error.message.includes("execution reverted")) {
        return "Transaction reverted - check token balances and allowances";
      }
      if (error.message.includes("user rejected")) {
        return "Transaction cancelled by user";
      }
      return error.message;
    }

    return "Unknown error occurred";
  };

  // =========================================================
  //                    CREATE PAIR (Dynamic)
  // =========================================================
  const [cpTokenA, setCpTokenA] = useState(TOKEN_LIST[0].address);
  const [cpTokenB, setCpTokenB] = useState(TOKEN_LIST[1].address);
  const [cpPair, setCpPair] = useState<string>("");

  const refreshCreatePairInfo = async () => {
    if (!signer) return;
    try {
      const f = getFactory();
      const pairAddr = await f.getPair(cpTokenA, cpTokenB);
      setCpPair(pairAddr);
    } catch (error) {
      console.error("Error refreshing pair info:", error);
    }
  };

  useEffect(() => {
    refreshCreatePairInfo().catch(() => {});
  }, [signer, cpTokenA, cpTokenB]);

  const createPair = async () => {
    if (!signer) return;
    if (cpTokenA === cpTokenB) return alert("Select 2 different tokens");
    
    setIsCreatingPair(true);
    try {
      const f = getFactory();
      const existing = await f.getPair(cpTokenA, cpTokenB);
      if (!isZeroAddr(existing)) {
        alert(`Pair already exists: ${existing}`);
        setCpPair(existing);
        return;
      }
      const tx = await f.createPair(cpTokenA, cpTokenB);
      await tx.wait();
      const newPair = await f.getPair(cpTokenA, cpTokenB);
      setCpPair(newPair);
      alert(`✅ Pair created: ${newPair}`);
      
      // Refresh pools after creating new pair
      setTimeout(() => fetchPools(), 2000);
    } catch (error: any) {
      console.error("Create pair error:", error);
      alert(`Error creating pair: ${decodeContractError(error)}`);
    } finally {
      setIsCreatingPair(false);
    }
  };

  // =========================================================
  //                      ADD LIQUIDITY
  // =========================================================
  const [alTokenA, setAlTokenA] = useState(TOKEN_LIST[0].address);
  const [alTokenB, setAlTokenB] = useState(TOKEN_LIST[1].address);
  const [alAmountA, setAlAmountA] = useState<string>("");
  const [alAmountB, setAlAmountB] = useState<string>("");
  const [alPair, setAlPair] = useState<string>("");
  const [alDecimalsA, setAlDecimalsA] = useState<number>(18);
  const [alDecimalsB, setAlDecimalsB] = useState<number>(18);
  const [alResA, setAlResA] = useState<bigint>(0n);
  const [alResB, setAlResB] = useState<bigint>(0n);
  const [alAMMTokenA, setAlAMMTokenA] = useState<string>("");
  const [alAMMTokenB, setAlAMMTokenB] = useState<string>("");
  
  // API-based reserves for display
  const [alApiReserveA, setAlApiReserveA] = useState<number>(0);
  const [alApiReserveB, setAlApiReserveB] = useState<number>(0);
  const [alApiPairData, setAlApiPairData] = useState<Pool | null>(null);

  const refreshAlPair = async () => {
    if (!signer) return;
    try {
      const f = getFactory();
      const pairAddr = await f.getPair(alTokenA, alTokenB);
      setAlPair(pairAddr);

      // Reset API data
      setAlApiReserveA(0);
      setAlApiReserveB(0);
      setAlApiPairData(null);

      if (!isZeroAddr(pairAddr)) {
        // Get blockchain data for calculations
        const amm = getAMM(pairAddr);
        
        try {
          const { tokenA, tokenB, reserveA, reserveB } = await getAMMData(amm);
          setAlAMMTokenA(tokenA);
          setAlAMMTokenB(tokenB);
          setAlResA(BigInt(reserveA));
          setAlResB(BigInt(reserveB));
        } catch (ammError) {
          console.error("Failed to get AMM data:", ammError);
          setAlAMMTokenA("");
          setAlAMMTokenB("");
          setAlResA(0n);
          setAlResB(0n);
        }

        // Fetch API data for display
        try {
          const matchingPool = pools.find(pool => 
            pool.address.toLowerCase() === pairAddr.toLowerCase()
          );
          
          if (matchingPool) {
            setAlApiPairData(matchingPool);
            const metrics = getPoolMetrics(matchingPool);
            setAlApiReserveA(metrics.reserveA);
            setAlApiReserveB(metrics.reserveB);
          }
        } catch (apiError) {
          console.error("Failed to get API pool data:", apiError);
        }
      } else {
        setAlAMMTokenA("");
        setAlAMMTokenB("");
        setAlResA(0n);
        setAlResB(0n);
      }

      // fetch decimals
      const [dA, dB] = await Promise.all([
        getERC20(alTokenA).decimals(),
        getERC20(alTokenB).decimals(),
      ]);
      setAlDecimalsA(Number(dA));
      setAlDecimalsB(Number(dB));
    } catch (error) {
      console.error("Error refreshing AL pair:", error);
    }
  };

  useEffect(() => {
    refreshAlPair().catch(() => {});
  }, [signer, alTokenA, alTokenB, pools]);

  // Auto-calculate optimal amountB from ratio if pool exists
  useEffect(() => {
    if (alAmountA === "") {
      setAlAmountB("");
      return;
    }
    if (isZeroAddr(alPair)) return; // first-time pool: user sets both

    try {
      const amountAWei = ethers.parseUnits(alAmountA || "0", alDecimalsA);
      
      if (!isZeroAddr(alPair) && !zero(alResA) && !zero(alResB)) {
        // Map selected tokens to AMM reserves
        const [resIn, resOut] = alTokenA.toLowerCase() === alAMMTokenA.toLowerCase()
          ? [alResA, alResB]
          : [alResB, alResA];

        // Calculate optimal amount B
        const suggestedB = resIn === 0n ? 0n : (amountAWei * resOut) / resIn;
        setAlAmountB(ethers.formatUnits(suggestedB, alDecimalsB));
      }
    } catch {
      // ignore parse errors
    }
  }, [alAmountA, alPair, alResA, alResB, alAMMTokenA, alAMMTokenB, alDecimalsA, alDecimalsB]);

  // Improved Add Liquidity function
  const doAddLiquidity = async () => {
    if (!signer) return;
    if (!alAmountA || !alAmountB) return alert("Enter both amounts");
    if (alTokenA === alTokenB) return alert("Select different tokens");

    setIsAddingLiquidity(true);
    try {
      const amountADesired = ethers.parseUnits(alAmountA, alDecimalsA);
      const amountBDesired = ethers.parseUnits(alAmountB, alDecimalsB);
      
      const router = getRouter();
      const tokenAContract = getERC20(alTokenA);
      const tokenBContract = getERC20(alTokenB);

      // Check current balances
      const [balanceA, balanceB] = await Promise.all([
        tokenAContract.balanceOf(account),
        tokenBContract.balanceOf(account)
      ]);

      // Check if user has enough balance
      if (balanceA < amountADesired) {
        throw new Error(`Insufficient ${labelFor(alTokenA)} balance. Required: ${ethers.formatUnits(amountADesired, alDecimalsA)}, Available: ${ethers.formatUnits(balanceA, alDecimalsA)}`);
      }
      
      if (balanceB < amountBDesired) {
        throw new Error(`Insufficient ${labelFor(alTokenB)} balance. Required: ${ethers.formatUnits(amountBDesired, alDecimalsB)}, Available: ${ethers.formatUnits(balanceB, alDecimalsB)}`);
      }

      // Check and approve if needed
      const [allowanceA, allowanceB] = await Promise.all([
        tokenAContract.allowance(account, CONTRACTS.router),
        tokenBContract.allowance(account, CONTRACTS.router)
      ]);

      if (allowanceA < amountADesired) {
        const approveTxA = await tokenAContract.approve(CONTRACTS.router, amountADesired);
        await approveTxA.wait();
      }
      
      if (allowanceB < amountBDesired) {
        const approveTxB = await tokenBContract.approve(CONTRACTS.router, amountBDesired);
        await approveTxB.wait();
      }

      // Calculate minimum amounts (0.5% slippage tolerance)
      const minAmountA = (amountADesired * 995n) / 1000n;
      const minAmountB = (amountBDesired * 995n) / 1000n;
      const deadline = Math.floor(Date.now() / 1000) + 600;

      // Estimate gas first
      await router.addLiquidity.estimateGas(
        alTokenA,
        alTokenB,
        amountADesired,
        amountBDesired,
        minAmountA,
        minAmountB,
        account,
        deadline
      );

      const tx = await router.addLiquidity(
        alTokenA,
        alTokenB,
        amountADesired,
        amountBDesired,
        minAmountA,
        minAmountB,
        account,
        deadline
      );

      await tx.wait();
      alert("✅ Liquidity added successfully!");
      
      // Refresh UI
      await refreshAlPair();
      setAlAmountA("");
      setAlAmountB("");
      setTimeout(() => fetchPools(), 2000);
      
    } catch (error: any) {
      console.error("AddLiquidity error:", error);
      alert(`Error adding liquidity: ${decodeContractError(error)}`);
    } finally {
      setIsAddingLiquidity(false);
    }
  };

  // =========================================================
  //                    ENHANCED SWAP SECTION
  // =========================================================
  const [swSell, setSwSell] = useState(TOKEN_LIST[0].address);
  const [swBuy,  setSwBuy]  = useState(TOKEN_LIST[1].address);
  const [swSellAmt, setSwSellAmt] = useState<string>("");
  const [swBuyEst,  setSwBuyEst]  = useState<string>("");
  const [swDecSell, setSwDecSell] = useState<number>(18);
  const [swDecBuy,  setSwDecBuy]  = useState<number>(18);
  const [swSlippageBps, setSwSlippageBps] = useState<number>(100);

  // New states for routing
  const [routingData, setRoutingData] = useState<any>(null);
  const [selectedPath, setSelectedPath] = useState<'direct' | 'optimal'>('optimal');
  const [isLoadingRoute, setIsLoadingRoute] = useState(false);
  const [showAllPaths, setShowAllPaths] = useState(false);
  const [allPaths, setAllPaths] = useState<any[]>([]);

  const refreshSwapDecimals = async () => {
    if (!signer) return;
    try {
      const dIn  = await getERC20(swSell).decimals();
      const dOut = await getERC20(swBuy).decimals();
      setSwDecSell(Number(dIn));
      setSwDecBuy(Number(dOut));
    } catch (error) {
      console.error("Error refreshing swap decimals:", error);
    }
  };

  useEffect(() => {
    refreshSwapDecimals().catch(() => {});
  }, [signer, swSell, swBuy]);

  // Enhanced quote function using backend routing
  const quoteSwap = async () => {
    if (!signer || !swSellAmt || swSell === swBuy) {
      setSwBuyEst("");
      setRoutingData(null);
      return;
    }

    setIsLoadingRoute(true);
    try {
      const amountIn = ethers.parseUnits(swSellAmt, swDecSell);
      
      // Get optimal path from backend
      const pathResponse = await fetch(
        `${API_BASE}/optimal-path/${swSell}/${swBuy}?amount=${amountIn.toString()}`
      );
      
      if (!pathResponse.ok) {
        throw new Error('Failed to get optimal path');
      }
      
      const pathData = await pathResponse.json();
      setRoutingData(pathData);
      
      // Set the estimated output based on selected path
      const selectedPathData = selectedPath === 'direct' ? pathData.direct : pathData.optimal;
      if (selectedPathData) {
        setSwBuyEst(ethers.formatUnits(selectedPathData.expectedOutput, swDecBuy));
      } else {
        setSwBuyEst("");
      }
      
    } catch (error) {
      console.error("Quote swap error:", error);
      setSwBuyEst("");
      setRoutingData(null);
      
      // Fallback to direct router quote
      try {
        const amountIn = ethers.parseUnits(swSellAmt, swDecSell);
        const router = getRouter();
        const amounts: bigint[] = await router.getAmountsOut(amountIn, [swSell, swBuy]);
        const out = amounts[amounts.length - 1];
        setSwBuyEst(ethers.formatUnits(out, swDecBuy));
      } catch (fallbackError) {
        console.error("Fallback quote also failed:", fallbackError);
        setSwBuyEst("");
      }
    } finally {
      setIsLoadingRoute(false);
    }
  };

  // Load all paths for comparison
  const loadAllPaths = async () => {
    if (!swSellAmt || swSell === swBuy) return;
    
    try {
      const response = await fetch(`${API_BASE}/all-paths/${swSell}/${swBuy}?maxHops=3`);
      if (!response.ok) throw new Error('Failed to get all paths');
      const data = await response.json();
      setAllPaths(data.paths || []);
    } catch (error) {
      console.error("Error loading all paths:", error);
      setAllPaths([]);
    }
  };

  useEffect(() => {
    quoteSwap().catch(() => {});
  }, [swSell, swBuy, swSellAmt, swDecSell, swDecBuy, selectedPath]);

  // Enhanced swap function with multi-hop support
  const doSwap = async () => {
    if (!signer) return;
    if (!swSellAmt) return alert("Enter sell amount");
    if (swSell === swBuy) return alert("Select different tokens");

    setIsSwapping(true);
    try {
      const amountIn = ethers.parseUnits(swSellAmt, swDecSell);
      const router = getRouter();
      
      // Get the selected path data
      const pathData = routingData?.[selectedPath];
      if (!pathData) {
        throw new Error("No valid path found for swap");
      }
      
      const swapPath = pathData.path;
      const expectedOut = BigInt(pathData.expectedOutput);
      const minOut = (expectedOut * BigInt(10000 - swSlippageBps)) / 10000n;

      // Approve router for the input token
      const sellToken = getERC20(swSell);
      const currentAllowance = await sellToken.allowance(account, CONTRACTS.router);
      
      if (currentAllowance < amountIn) {
        const approveTx = await sellToken.approve(CONTRACTS.router, amountIn);
        await approveTx.wait();
      }
      
      const deadline = Math.floor(Date.now() / 1000) + 600;
      
      let tx;
      if (swapPath.length === 2) {
        // Direct swap
        tx = await router.swapExactTokensForTokens(
          amountIn, 
          minOut, 
          swapPath, 
          account,
          deadline
        );
      } else {
        // Multi-hop swap - use the same function but with longer path
        tx = await router.swapExactTokensForTokens(
          amountIn, 
          minOut, 
          swapPath, 
          account,
          deadline
        );
      }
      
      await tx.wait();
      
      alert(`✅ Swap completed via ${swapPath.length - 1} hop${swapPath.length > 2 ? 's' : ''}`);
      setSwSellAmt("");
      setSwBuyEst("");
      setRoutingData(null);
      setTimeout(() => fetchPools(), 2000);
      
    } catch (error: any) {
      console.error("Swap error:", error);
      alert(`Error swapping: ${decodeContractError(error)}`);
    } finally {
      setIsSwapping(false);
    }
  };

  // Get multi-hop quote for specific path
  const getMultiHopQuote = async (path: string[]) => {
    if (!swSellAmt) return null;
    
    try {
      const amountIn = ethers.parseUnits(swSellAmt, swDecSell);
      const response = await fetch(`${API_BASE}/multi-hop-quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, amountIn: amountIn.toString() })
      });
      
      if (!response.ok) throw new Error('Quote failed');
      return await response.json();
    } catch (error) {
      console.error("Multi-hop quote error:", error);
      return null;
    }
  };

  const flipSwap = () => {
    setSwSell(swBuy);
    setSwBuy(swSell);
    setSwSellAmt("");
    setSwBuyEst("");
    setRoutingData(null);
    setAllPaths([]);
  };

  // Helper to format token symbols from addresses
  const getTokenSymbol = (address: string) => {
    return TOKEN_LIST.find(t => t.address.toLowerCase() === address.toLowerCase())?.symbol || 
           address.slice(0, 6) + '...';
  };

  // =========================================================
  //                       REMOVE LIQUIDITY
  // =========================================================
  const [rlTokenA, setRlTokenA] = useState(TOKEN_LIST[0].address);
  const [rlTokenB, setRlTokenB] = useState(TOKEN_LIST[1].address);
  const [rlPair, setRlPair] = useState<string>("");
  const [rlLpAmt, setRlLpAmt] = useState<string>("");

  const refreshRlPair = async () => {
    if (!signer) return;
    try {
      const p = await getFactory().getPair(rlTokenA, rlTokenB);
      setRlPair(p);
    } catch (error) {
      console.error("Error refreshing RL pair:", error);
    }
  };

  useEffect(() => {
    refreshRlPair().catch(() => {});
  }, [signer, rlTokenA, rlTokenB]);

  const doRemoveLiquidity = async () => {
    if (!signer) return;
    if (isZeroAddr(rlPair)) return alert("Pair not found");
    if (!rlLpAmt) return alert("Enter LP amount");
    
    setIsRemovingLiquidity(true);
    try {
      const amt = ethers.parseUnits(rlLpAmt, 18);
      
      // Try router removeLiquidity first
      try {
        const router = getRouter();
        const deadline = Math.floor(Date.now() / 1000) + 600;
        
        const pairContract = getAMM(rlPair);
        await (await pairContract.approve(CONTRACTS.router, amt)).wait();
        
        const tx = await router.removeLiquidity(
          rlTokenA,
          rlTokenB,
          amt,
          0, // minAmountA
          0, // minAmountB
          account,
          deadline
        );
        await tx.wait();
      } catch (routerError) {
        console.log("Router removeLiquidity failed, trying direct method:", routerError);
        await (await getAMM(rlPair).removeLiquidity(amt)).wait();
      }
      
      alert("✅ Liquidity removed");
      setRlLpAmt("");
      await refreshRlPair();
      setTimeout(() => fetchPools(), 2000);
    } catch (error: any) {
      console.error("Remove liquidity error:", error);
      alert(`Error removing liquidity: ${decodeContractError(error)}`);
    } finally {
      setIsRemovingLiquidity(false);
    }
  };

  // =========================================================
  //                           UI
  // =========================================================
  const labelFor = (addr: string) => TOKEN_LIST.find(t => t.address === addr)?.symbol ?? addr.slice(0,6);

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-gray-900">AMM dApp</h1>
        <div className="flex gap-4">
          <button 
            onClick={() => {setShowPools(!showPools); if (!showPools) fetchPools();}} 
            className="px-4 py-2 bg-green-600 text-white rounded-2xl shadow hover:bg-green-700 transition-colors"
          >
            {showPools ? "Hide Pools" : "View Pools"}
          </button>
          <button onClick={connectWallet} className="px-4 py-2 bg-blue-600 text-white rounded-2xl shadow hover:bg-blue-700 transition-colors">
            {account ? `Connected: ${account.slice(0, 6)}…` : "Connect Wallet"}
          </button>
        </div>
      </div>

      {/* Pool Display Section */}
      {showPools && (
        <section className="border rounded-2xl p-6 space-y-4 shadow-lg bg-gradient-to-r from-blue-50 to-indigo-50">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold text-gray-800">Pool Analytics</h2>
            <button 
              onClick={fetchPools} 
              disabled={loadingPools}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50"
            >
              {loadingPools ? "Loading..." : "Refresh"}
            </button>
          </div>

          {/* Pools Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {pools.map(pool => {
              const metrics = getPoolMetrics(pool);
              return (
                <div 
                  key={pool.id} 
                  className="bg-white rounded-xl p-4 shadow-md hover:shadow-lg transition-shadow cursor-pointer border border-gray-200"
                  onClick={() => fetchPoolDetails(pool.id)}
                >
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-lg font-semibold text-gray-800">{metrics.pairName}</h3>
                    <span className="text-sm text-gray-500">#{pool.id}</span>
                  </div>
                  
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Reserve {pool.tokenA.symbol}:</span>
                      <span className="font-medium">{metrics.reserveA.toFixed(4)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Reserve {pool.tokenB.symbol}:</span>
                      <span className="font-medium">{metrics.reserveB.toFixed(4)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Total Swaps:</span>
                      <span className="font-medium">{metrics.totalSwaps}</span>
                    </div>
                  </div>
                  
                  <div className="mt-3 pt-3 border-t border-gray-200">
                    <p className="text-xs text-gray-500 truncate">
                      Contract: {pool.address.slice(0, 8)}...{pool.address.slice(-6)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          {pools.length === 0 && !loadingPools && (
            <div className="text-center py-8 text-gray-500">
              <p className="text-lg">No pools found</p>
              <p className="text-sm">Create your first trading pair to get started!</p>
            </div>
          )}

          {/* Pool Details Modal - keeping the existing implementation */}
          {selectedPool && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
                <div className="p-6 border-b border-gray-200">
                  <div className="flex items-center justify-between">
                    <h2 className="text-2xl font-bold text-gray-800">
                      Pool Details: {selectedPool.tokenA.symbol}/{selectedPool.tokenB.symbol}
                    </h2>
                    <button 
                      onClick={() => setSelectedPool(null)}
                      className="text-gray-500 hover:text-gray-700 text-2xl"
                    >
                      ×
                    </button>
                  </div>
                </div>
                
                <div className="p-6 space-y-6">
                  {/* Pool Info */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-4">
                      <h3 className="text-lg font-semibold text-gray-800">Pool Information</h3>
                      <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                        <div className="flex justify-between">
                          <span className="text-gray-600">Pool Address:</span>
                          <span className="font-mono text-sm">{selectedPool.address}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Pool ID:</span>
                          <span className="font-medium">#{selectedPool.id}</span>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <h3 className="text-lg font-semibold text-gray-800">Token Information</h3>
                      <div className="space-y-3">
                        <div className="bg-blue-50 rounded-lg p-3">
                          <div className="font-medium text-blue-800">{selectedPool.tokenA.symbol}</div>
                          <div className="text-sm text-blue-600">{selectedPool.tokenA.name || 'N/A'}</div>
                          <div className="text-xs text-blue-500 font-mono">{selectedPool.tokenA.address}</div>
                          <div className="text-xs text-blue-500">Decimals: {selectedPool.tokenA.decimals}</div>
                        </div>
                        <div className="bg-purple-50 rounded-lg p-3">
                          <div className="font-medium text-purple-800">{selectedPool.tokenB.symbol}</div>
                          <div className="text-sm text-purple-600">{selectedPool.tokenB.name || 'N/A'}</div>
                          <div className="text-xs text-purple-500 font-mono">{selectedPool.tokenB.address}</div>
                          <div className="text-xs text-purple-500">Decimals: {selectedPool.tokenB.decimals}</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Reserves & Metrics */}
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold text-gray-800">Current Reserves & Metrics</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="bg-green-50 rounded-lg p-4 text-center">
                        <div className="text-2xl font-bold text-green-800">
                          {getPoolMetrics(selectedPool).reserveA.toFixed(4)}
                        </div>
                        <div className="text-green-600">{selectedPool.tokenA.symbol} Reserve</div>
                      </div>
                      <div className="bg-blue-50 rounded-lg p-4 text-center">
                        <div className="text-2xl font-bold text-blue-800">
                          {getPoolMetrics(selectedPool).reserveB.toFixed(4)}
                        </div>
                        <div className="text-blue-600">{selectedPool.tokenB.symbol} Reserve</div>
                      </div>
                      <div className="bg-purple-50 rounded-lg p-4 text-center">
                        <div className="text-2xl font-bold text-purple-800">
                          {getPoolMetrics(selectedPool).totalSwaps}
                        </div>
                        <div className="text-purple-600">Total Swaps</div>
                      </div>
                    </div>
                  </div>

                  {/* Recent Swaps */}
                  {selectedPool.swaps && selectedPool.swaps.length > 0 && (
                    <div className="space-y-4">
                      <h3 className="text-lg font-semibold text-gray-800">Recent Swaps</h3>
                      <div className="bg-gray-50 rounded-lg overflow-hidden">
                        <div className="max-h-60 overflow-y-auto">
                          <table className="w-full text-sm">
                            <thead className="bg-gray-100 sticky top-0">
                              <tr>
                                <th className="text-left p-3">Trader</th>
                                <th className="text-left p-3">Token In</th>
                                <th className="text-left p-3">Amount In</th>
                                <th className="text-left p-3">Token Out</th>
                                <th className="text-left p-3">Amount Out</th>
                                <th className="text-left p-3">Time</th>
                              </tr>
                            </thead>
                            <tbody>
                              {selectedPool.swaps.map((swap, index) => (
                                <tr key={index} className="border-t border-gray-200">
                                  <td className="p-3 font-mono text-xs">
                                    {swap.trader.slice(0, 6)}...{swap.trader.slice(-4)}
                                  </td>
                                  <td className="p-3">
                                    {swap.tokenIn === 'token0' ? selectedPool.tokenA.symbol : selectedPool.tokenB.symbol}
                                  </td>
                                  <td className="p-3">
                                    {parseFloat(swap.amountIn as string) / Math.pow(10, swap.tokenIn === 'token0' ? Number(selectedPool.tokenA.decimals) : Number(selectedPool.tokenB.decimals))}
                                  </td>
                                  <td className="p-3">
                                    {swap.tokenOut === 'token0' ? selectedPool.tokenA.symbol : selectedPool.tokenB.symbol}
                                  </td>
                                  <td className="p-3">
                                    {parseFloat(swap.amountOut as string) / Math.pow(10, swap.tokenOut === 'token0' ? Number(selectedPool.tokenA.decimals) : Number(selectedPool.tokenB.decimals))}
                                  </td>
                                  <td className="p-3">
                                    {new Date(Number(swap.createdAt)).toLocaleString()}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Liquidity History */}
                  {selectedPool.liquidity && selectedPool.liquidity.length > 0 && (
                    <div className="space-y-4">
                      <h3 className="text-lg font-semibold text-gray-800">Liquidity History</h3>
                      <div className="bg-gray-50 rounded-lg overflow-hidden">
                        <div className="max-h-60 overflow-y-auto">
                          <table className="w-full text-sm">
                            <thead className="bg-gray-100 sticky top-0">
                              <tr>
                                <th className="text-left p-3">Provider</th>
                                <th className="text-left p-3">Action</th>
                                <th className="text-left p-3">{selectedPool.tokenA.symbol}</th>
                                <th className="text-left p-3">{selectedPool.tokenB.symbol}</th>
                                <th className="text-left p-3">Time</th>
                              </tr>
                            </thead>
                            <tbody>
                              {selectedPool.liquidity.map((liq, index) => {
                                const amountA = parseFloat(liq.amountA);
                                const amountB = parseFloat(liq.amountB);
                                const isAdd = amountA >= 0 && amountB >= 0;
                                
                                return (
                                  <tr key={index} className="border-t border-gray-200">
                                    <td className="p-3 font-mono text-xs">
                                      {liq.provider.slice(0, 6)}...{liq.provider.slice(-4)}
                                    </td>
                                    <td className="p-3">
                                      <span className={`px-2 py-1 rounded text-xs ${isAdd ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                        {isAdd ? 'Add' : 'Remove'}
                                      </span>
                                    </td>
                                    <td className="p-3">
                                      {Math.abs(amountA) / Math.pow(10, Number(selectedPool.tokenA.decimals))}
                                    </td>
                                    <td className="p-3">
                                      {Math.abs(amountB) / Math.pow(10, Number(selectedPool.tokenB.decimals))}
                                    </td>
                                    <td className="p-3">
                                      {new Date(Number(liq.createdAt)).toLocaleString()}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Create Pair */}
      <section className="border rounded-2xl p-4 space-y-3 shadow-sm">
        <h2 className="font-semibold">Create Pair</h2>
        <div className="flex gap-3">
          <select
            className="border px-2 py-1 rounded"
            value={cpTokenA}
            onChange={e => setCpTokenA(e.target.value as typeof cpTokenA)}
          >
            {TOKEN_LIST.map(t => (
              <option key={t.address} value={t.address}>
                {t.symbol}
              </option>
            ))}
          </select>
          <select
            className="border px-2 py-1 rounded"
            value={cpTokenB}
            onChange={e => setCpTokenB(e.target.value as typeof cpTokenB)}
          >
            {TOKEN_LIST.map(t => (
              <option key={t.address} value={t.address}>
                {t.symbol}
              </option>
            ))}
          </select>
          <button 
            onClick={createPair} 
            disabled={isCreatingPair}
            className="px-3 py-1 bg-green-600 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isCreatingPair ? "Creating..." : "Create"}
          </button>
        </div>
        <p className="text-sm text-gray-600">
          {cpPair && !isZeroAddr(cpPair) ? `Pair exists: ${cpPair}` : "No pair yet."}
        </p>
      </section>

      {/* Add Liquidity */}
      <section className="border rounded-2xl p-4 space-y-3 shadow-sm">
        <h2 className="font-semibold">Add Liquidity</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex gap-2">
            <input
              value={alAmountA}
              onChange={(e)=>setAlAmountA(e.target.value)}
              placeholder="Amount A"
              className="border px-2 py-1 rounded flex-1"
            />
            <select
              className="border px-2 py-1 rounded"
              value={alTokenA}
              onChange={e => setAlTokenA(e.target.value as typeof alTokenA)}
            >
              {TOKEN_LIST.map(t => (
                <option key={t.address} value={t.address}>
                  {t.symbol}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <input
              value={alAmountB}
              onChange={(e)=>setAlAmountB(e.target.value)}
              placeholder="Amount B"
              className="border px-2 py-1 rounded flex-1"
            />
            <select
              className="border px-2 py-1 rounded"
              value={alTokenB}
              onChange={e => setAlTokenB(e.target.value as typeof alTokenB)}
            >
              {TOKEN_LIST.map(t => (
                <option key={t.address} value={t.address}>
                  {t.symbol}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="text-sm text-gray-600">
          {isZeroAddr(alPair) ? (
            "Pool not created yet — it will be created on first add."
          ) : alApiPairData ? (
            <div className="space-y-1">
              <div>Pool: {alPair}</div>
              <div className="flex gap-4">
                <span>Database Reserves: {alApiReserveA.toFixed(4)} {alApiPairData.tokenA.symbol} / {alApiReserveB.toFixed(4)} {alApiPairData.tokenB.symbol}</span>
                <span className="text-blue-600">Total Swaps: {alApiPairData.swaps?.length || 0}</span>
              </div>
              <div className="text-xs text-gray-500">
                Blockchain Reserves (for calculations): {ethers.formatUnits(alResA, alDecimalsA)} / {ethers.formatUnits(alResB, alDecimalsB)}
              </div>
            </div>
          ) : (
            `Pool: ${alPair} • Loading reserves...`
          )}
        </div>

        <button
          onClick={doAddLiquidity}
          disabled={isAddingLiquidity}
          className="px-4 py-2 bg-purple-600 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isAddingLiquidity ? "Adding..." : "Add Liquidity"}
        </button>
      </section>

      {/* Enhanced Swap */}
      <section className="border rounded-2xl p-4 space-y-4 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-lg">Advanced Swap</h2>
          {routingData && (
            <div className="flex gap-2">
              <button
                onClick={() => setShowAllPaths(!showAllPaths)}
                className="text-sm px-3 py-1 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                {showAllPaths ? 'Hide' : 'Show'} All Paths
              </button>
              <button
                onClick={loadAllPaths}
                className="text-sm px-3 py-1 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors"
              >
                Analyze Paths
              </button>
            </div>
          )}
        </div>

        {/* Main swap interface */}
        <div className="flex gap-2 items-center">
          <input
            value={swSellAmt}
            onChange={(e)=>setSwSellAmt(e.target.value)}
            placeholder="Sell amount"
            className="border px-3 py-2 rounded-lg flex-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <select
            className="border px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={swSell}
            onChange={e => setSwSell(e.target.value as typeof swSell)}
          >
            {TOKEN_LIST.map(t => (
              <option key={t.address} value={t.address}>
                {t.symbol}
              </option>
            ))}
          </select>

          <button 
            onClick={flipSwap} 
            className="px-3 py-2 border rounded-lg hover:bg-gray-50 transition-colors font-mono"
            title="Flip tokens"
          >
            ⇄
          </button>

          <input
            value={swBuyEst}
            readOnly
            placeholder={isLoadingRoute ? "Loading..." : "Buy (estimated)"}
            className="border px-3 py-2 rounded-lg flex-1 bg-gray-50 text-gray-700"
          />
          <select
            className="border px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={swBuy}
            onChange={e => setSwBuy(e.target.value as typeof swBuy)}
          >
            {TOKEN_LIST.map(t => (
              <option key={t.address} value={t.address}>
                {t.symbol}
              </option>
            ))}
          </select>
        </div>

        {/* Routing options */}
        {routingData && (
          <div className="bg-blue-50 rounded-lg p-4 space-y-3">
            <h3 className="font-medium text-blue-800">🛣️ Available Routes</h3>
            
            <div className="space-y-2">
              {routingData.direct && (
                <label className="flex items-center gap-3 p-3 bg-white rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                  <input
                    type="radio"
                    name="swapPath"
                    value="direct"
                    checked={selectedPath === 'direct'}
                    onChange={() => setSelectedPath('direct')}
                    className="text-blue-600"
                  />
                  <div className="flex-1">
                    <div className="font-medium">🎯 Direct Path ({routingData.direct.hops} hop)</div>
                    <div className="text-sm text-gray-600">
                      Output: {ethers.formatUnits(routingData.direct.expectedOutput, swDecBuy)} {getTokenSymbol(swBuy)}
                    </div>
                    <div className="text-xs text-gray-500">
                      Gas: ~{Math.floor(Number(routingData.direct.gasEstimate) / 1000)}k
                    </div>
                  </div>
                </label>
              )}
              
              {routingData.optimal && routingData.optimal !== routingData.direct && (
                <label className="flex items-center gap-3 p-3 bg-white rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                  <input
                    type="radio"
                    name="swapPath"
                    value="optimal"
                    checked={selectedPath === 'optimal'}
                    onChange={() => setSelectedPath('optimal')}
                    className="text-blue-600"
                  />
                  <div className="flex-1">
                    <div className="font-medium">⚡ Optimal Path ({routingData.optimal.hops} hops)</div>
                    <div className="text-sm text-gray-600">
                      Output: {ethers.formatUnits(routingData.optimal.expectedOutput, swDecBuy)} {getTokenSymbol(swBuy)}
                    </div>
                    <div className="text-xs text-gray-500">
                      Route: {routingData.optimal.path.map(getTokenSymbol).join(' → ')}
                    </div>
                    <div className="text-xs text-gray-500">
                      Gas: ~{Math.floor(Number(routingData.optimal.gasEstimate) / 1000)}k
                    </div>
                  </div>
                </label>
              )}
            </div>
            
            {routingData.optimal && routingData.direct && (
              <div className="text-xs text-green-700 bg-green-100 p-2 rounded">
                💡 Optimal route gives you {(
                  (Number(ethers.formatUnits(routingData.optimal.expectedOutput, swDecBuy)) - 
                   Number(ethers.formatUnits(routingData.direct.expectedOutput, swDecBuy))) /
                  Number(ethers.formatUnits(routingData.direct.expectedOutput, swDecBuy)) * 100
                ).toFixed(2)}% more tokens!
              </div>
            )}
          </div>
        )}

        {/* All paths analysis */}
        {showAllPaths && allPaths.length > 0 && (
          <div className="bg-gray-50 rounded-lg p-4 space-y-3">
            <h3 className="font-medium text-gray-800">📊 All Available Paths</h3>
            <div className="grid gap-2 max-h-48 overflow-y-auto">
              {allPaths.map((pathInfo, index) => (
                <div key={index} className="bg-white p-3 rounded border text-sm">
                  <div className="font-medium">Path {index + 1}: {pathInfo.hops} hop{pathInfo.hops > 1 ? 's' : ''}</div>
                  <div className="text-xs text-gray-600 font-mono">
                    {pathInfo.path.map(getTokenSymbol).join(' → ')}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Slippage and controls */}
        <div className="flex items-center justify-between gap-4 text-sm">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2">
              <span className="text-gray-700">Slippage:</span>
              <input
                type="number"
                min={0}
                max={50}
                step={0.1}
                value={(swSlippageBps/100).toString()}
                onChange={(e)=>setSwSlippageBps(Math.round(Number(e.target.value)*100))}
                className="border px-2 py-1 rounded w-20 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <span className="text-gray-500">%</span>
            </label>
            
            {routingData && (
              <div className="text-gray-600">
                Route via {routingData[selectedPath]?.hops || 0} hop{(routingData[selectedPath]?.hops || 0) > 1 ? 's' : ''}
              </div>
            )}
          </div>
          
          {isLoadingRoute && (
            <div className="text-blue-600 text-sm">🔄 Finding best route...</div>
          )}
        </div>

        {/* Swap button */}
        <button 
          onClick={doSwap} 
          disabled={isSwapping || isLoadingRoute || !swBuyEst}
          className="w-full px-4 py-3 bg-orange-600 text-white rounded-lg font-medium hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isSwapping ? "Swapping..." : 
           isLoadingRoute ? "Finding Route..." :
           !swBuyEst ? "Enter Amount" :
           `Swap via ${routingData?.[selectedPath]?.hops || 1} hop${(routingData?.[selectedPath]?.hops || 1) > 1 ? 's' : ''}`}
        </button>
        
        {/* Warning for multi-hop */}
        {routingData?.[selectedPath]?.hops > 1 && (
          <div className="text-xs text-amber-700 bg-amber-50 p-2 rounded border border-amber-200">
            ⚠️ Multi-hop swap: Higher gas cost but better price. Transaction may fail if liquidity changes.
          </div>
        )}
      </section>

      {/* Remove Liquidity */}
      <section className="border rounded-2xl p-4 space-y-3 shadow-sm">
        <h2 className="font-semibold">Remove Liquidity</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <select
            className="border px-2 py-1 rounded"
            value={rlTokenA}
            onChange={e => setRlTokenA(e.target.value as typeof rlTokenA)}
          >
            {TOKEN_LIST.map(t => (
              <option key={t.address} value={t.address}>
                {t.symbol}
              </option>
            ))}
          </select>
          <select
            className="border px-2 py-1 rounded"
            value={rlTokenB}
            onChange={e => setRlTokenB(e.target.value as typeof rlTokenB)}
          >
            {TOKEN_LIST.map(t => (
              <option key={t.address} value={t.address}>
                {t.symbol}
              </option>
            ))}
          </select>
          <input
            value={rlLpAmt}
            onChange={(e)=>setRlLpAmt(e.target.value)}
            placeholder="LP amount"
            className="border px-2 py-1 rounded"
          />
        </div>
        <div className="text-sm text-gray-600">
          {rlPair && !isZeroAddr(rlPair) ? `Pair: ${rlPair}` : "Pair not found yet."}
        </div>
        <button 
          onClick={doRemoveLiquidity} 
          disabled={isRemovingLiquidity}
          className="px-4 py-2 bg-red-600 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isRemovingLiquidity ? "Removing..." : "Remove Liquidity"}
        </button>
      </section>
    </div>
  );
}