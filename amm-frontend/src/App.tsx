import React, { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { CONTRACTS, TOKEN_LIST } from "./contracts";

// Import full ABIs (not fragments) from your build
import factoryAbi from "./abis/AMMFactory.json";
import ammAbi from "./abis/AMM.json";
import routerAbi from "./abis/AMMRouter.json";
import erc20Abi from "./abis/ERC20.json";

type signerLike = ethers.Signer | null;

const zero = (v = 0n) => v === 0n;
const isZeroAddr = (a: string) => a === ethers.ZeroAddress;

export default function App() {
  const [account, setAccount] = useState<string>("");
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [signer, setSigner] = useState<signerLike>(null);

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

  // Helpers to get contracts
  const getFactory = () => new ethers.Contract(CONTRACTS.factory, factoryAbi, signer!);
  const getRouter  = () => new ethers.Contract(CONTRACTS.router,  routerAbi,  signer!);
  const getERC20   = (addr: string) => new ethers.Contract(addr, erc20Abi, signer!);
  const getAMM     = (addr: string) => new ethers.Contract(addr, ammAbi, signer!);

  // Helper function to get AMM contract data (based on your AMM.sol contract)
  const getAMMData = async (ammContract: ethers.Contract) => {
    try {
      // Your AMM contract uses token0, token1, reserve0, reserve1
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signer, cpTokenA, cpTokenB]);

  const createPair = async () => {
    if (!signer) return;
    if (cpTokenA === cpTokenB) return alert("Select 2 different tokens");
    
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
    } catch (error: any) {
      console.error("Create pair error:", error);
      alert(`Error creating pair: ${error.reason || error.message}`);
    }
  };

  // =========================================================
  //                      ADD LIQUIDITY
  // =========================================================
  const [alTokenA, setAlTokenA] = useState(TOKEN_LIST[0].address);
  const [alTokenB, setAlTokenB] = useState(TOKEN_LIST[1].address);
  const [alAmountA, setAlAmountA] = useState<string>(""); // human
  const [alAmountB, setAlAmountB] = useState<string>(""); // human
  const [alPair, setAlPair] = useState<string>("");
  const [alDecimalsA, setAlDecimalsA] = useState<number>(18);
  const [alDecimalsB, setAlDecimalsB] = useState<number>(18);
  const [alResA, setAlResA] = useState<bigint>(0n);
  const [alResB, setAlResB] = useState<bigint>(0n);
  const [alAMMTokenA, setAlAMMTokenA] = useState<string>(""); // stored tokenA in AMM
  const [alAMMTokenB, setAlAMMTokenB] = useState<string>(""); // stored tokenB in AMM

  const refreshAlPair = async () => {
    if (!signer) return;
    try {
      const f = getFactory();
      const pairAddr = await f.getPair(alTokenA, alTokenB);
      setAlPair(pairAddr);

      if (!isZeroAddr(pairAddr)) {
        const amm = getAMM(pairAddr);
        
        try {
          const { tokenA, tokenB, reserveA, reserveB } = await getAMMData(amm);
          setAlAMMTokenA(tokenA);
          setAlAMMTokenB(tokenB);
          setAlResA(BigInt(reserveA));
          setAlResB(BigInt(reserveB));
        } catch (ammError) {
          console.error("Failed to get AMM data:", ammError);
          let message = "Unknown error";
          if (ammError && typeof ammError === "object") {
            if ("message" in ammError && typeof (ammError as any).message === "string") {
              message = (ammError as any).message;
            } else if ("reason" in ammError && typeof (ammError as any).reason === "string") {
              message = (ammError as any).reason;
            }
          }
          alert(`Error: ${message}`);
          setAlAMMTokenA("");
          setAlAMMTokenB("");
          setAlResA(0n);
          setAlResB(0n);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signer, alTokenA, alTokenB]);

  // Auto-calc amountB from ratio if pool exists and user types amountA
  useEffect(() => {
    if (alAmountA === "") return;
    if (isZeroAddr(alPair)) return; // first-time pool: user sets both

    // figure which reserve corresponds to which selected token
    // AMM stores tokenA/tokenB sorted by address in factory
    try {
      const amountAWei = ethers.parseUnits(alAmountA || "0", alDecimalsA);
      let suggestedB: bigint = 0n;

      if (!isZeroAddr(alPair) && !zero(alResA) && !zero(alResB)) {
        // Map selected tokens to AMM reserves
        // If selected alTokenA equals amm.tokenA -> use reserveA/reserveB; else flip
        const [resIn, resOut] =
          alTokenA.toLowerCase() === alAMMTokenA.toLowerCase()
            ? [alResA, alResB]
            : [alResB, alResA];

        // amountB = amountA * resOut / resIn
        suggestedB = resIn === 0n ? 0n : (amountAWei * resOut) / resIn;

        setAlAmountB(ethers.formatUnits(suggestedB, alDecimalsB));
      }
    } catch {
      /* ignore parse errors */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alAmountA, alPair, alResA, alResB, alAMMTokenA, alAMMTokenB, alDecimalsA, alDecimalsB]);

  // Fixed Add Liquidity function
 // Fixed Add Liquidity function with proper approvals and error handling
const doAddLiquidity = async () => {
  if (!signer) return;
  if (!alAmountA || !alAmountB) return alert("Enter both amounts");
  if (alTokenA === alTokenB) return alert("Select different tokens");

  try {
    // Convert amounts to wei
    const amountADesired = ethers.parseUnits(alAmountA, alDecimalsA);
    const amountBDesired = ethers.parseUnits(alAmountB, alDecimalsB);
    
    console.log("Desired amounts:", {
      amountA: amountADesired.toString(),
      amountB: amountBDesired.toString()
    });

    // Get contract instances
    const router = getRouter();
    const tokenAContract = getERC20(alTokenA);
    const tokenBContract = getERC20(alTokenB);

    // Check current balances
    const [balanceA, balanceB] = await Promise.all([
      tokenAContract.balanceOf(account),
      tokenBContract.balanceOf(account)
    ]);

    console.log("Current balances:", {
      balanceA: balanceA.toString(),
      balanceB: balanceB.toString()
    });

    // Check if user has enough balance
    if (balanceA < amountADesired) {
      return alert(`Insufficient ${labelFor(alTokenA)} balance. Required: ${ethers.formatUnits(amountADesired, alDecimalsA)}, Available: ${ethers.formatUnits(balanceA, alDecimalsA)}`);
    }
    
    if (balanceB < amountBDesired) {
      return alert(`Insufficient ${labelFor(alTokenB)} balance. Required: ${ethers.formatUnits(amountBDesired, alDecimalsB)}, Available: ${ethers.formatUnits(balanceB, alDecimalsB)}`);
    }

    // Check current allowances
    const [allowanceA, allowanceB] = await Promise.all([
      tokenAContract.allowance(account, CONTRACTS.router),
      tokenBContract.allowance(account, CONTRACTS.router)
    ]);

    console.log("Current allowances:", {
      allowanceA: allowanceA.toString(),
      allowanceB: allowanceB.toString()
    });

    // Approve tokens to router if needed
    if (allowanceA < amountADesired) {
      console.log(`Approving ${labelFor(alTokenA)}...`);
      const approveTxA = await tokenAContract.approve(CONTRACTS.router, amountADesired);
      await approveTxA.wait();
      console.log(`${labelFor(alTokenA)} approved`);
    }
    
    if (allowanceB < amountBDesired) {
      console.log(`Approving ${labelFor(alTokenB)}...`);
      const approveTxB = await tokenBContract.approve(CONTRACTS.router, amountBDesired);
      await approveTxB.wait();
      console.log(`${labelFor(alTokenB)} approved`);
    }

    // Calculate minimum amounts (allowing 0.5% slippage)
    const minAmountA = (amountADesired * 995n) / 1000n;
    const minAmountB = (amountBDesired * 995n) / 1000n;
    
    // Set deadline (10 minutes from now)
    const deadline = Math.floor(Date.now() / 1000) + 600;

    // Check if pair exists, if not it will be created
    const factory = getFactory();
    const existingPair = await factory.getPair(alTokenA, alTokenB);
    
    if (isZeroAddr(existingPair)) {
      console.log("Pair doesn't exist, will be created during addLiquidity");
    } else {
      console.log("Pair exists:", existingPair);
    }

    // Call router addLiquidity
    console.log("Calling addLiquidity with params:", {
      tokenA: alTokenA,
      tokenB: alTokenB,
      amountADesired: amountADesired.toString(),
      amountBDesired: amountBDesired.toString(),
      minAmountA: minAmountA.toString(),
      minAmountB: minAmountB.toString(),
      to: account,
      deadline
    });

    // Estimate gas first to catch errors early
    try {
      const gasEstimate = await router.addLiquidity.estimateGas(
        alTokenA,
        alTokenB,
        amountADesired,
        amountBDesired,
        minAmountA,
        minAmountB,
        account,
        deadline
      );
      console.log("Gas estimate:", gasEstimate.toString());
    } catch (gasError) {
      console.error("Gas estimation failed:", gasError);
      
      // Try to decode the error
      // Type guard for gasError
      const errorData = (typeof gasError === "object" && gasError !== null && "data" in gasError)
        ? (gasError as { data: string }).data
        : undefined;

      if (errorData) {
        // Common AMM error signatures
        const errorSignatures = {
          "0xe450d38c": "InsufficientAAmount()",
          "0x025dbdd4": "InsufficientBAmount()", 
          "0x8c379a00": "Error(string)", // Generic revert with message
          "0x4e487b71": "Panic(uint256)" // Panic errors
        };
        // Type guard for gasError
        const errorData = (typeof gasError === "object" && gasError !== null && "data" in gasError)
          ? (gasError as { data: string }).data
          : undefined;

        const errorSig = typeof errorData === "string" ? errorData.slice(0, 10) : "";
        const knownError = (errorSignatures as Record<string, string>)[errorSig];

        if (knownError) {
          return alert(`Transaction would fail: ${knownError}. This might be due to insufficient balance, allowance, or slippage issues.`);
        } else {
          return alert(`Transaction would fail with unknown error: ${errorSig}`);
        }
      }
      
      throw gasError;
    }

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

    console.log("Transaction sent:", tx.hash);
    await tx.wait();
    alert("✅ Liquidity added successfully!");
    
    // Refresh UI
    await refreshAlPair();
    setAlAmountA("");
    setAlAmountB("");
    
  } catch (error: any) {
    console.error("AddLiquidity error:", error);
    
    // Better error messages based on common issues
    let errorMessage = "Unknown error occurred";
    
    if (error.reason) {
      errorMessage = error.reason;
    } else if (error.message) {
      if (error.message.includes("insufficient funds")) {
        errorMessage = "Insufficient ETH for gas fees";
      } else if (error.message.includes("execution reverted")) {
        errorMessage = "Transaction reverted - check token balances and allowances";
      } else {
        errorMessage = error.message;
      }
    }
    
    alert(`Error adding liquidity: ${errorMessage}`);
  }
};

  // =========================================================
  //                           SWAP
  // =========================================================
  const [swSell, setSwSell] = useState(TOKEN_LIST[0].address);
  const [swBuy,  setSwBuy]  = useState(TOKEN_LIST[1].address);
  const [swSellAmt, setSwSellAmt] = useState<string>("");
  const [swBuyEst,  setSwBuyEst]  = useState<string>("");
  const [swDecSell, setSwDecSell] = useState<number>(18);
  const [swDecBuy,  setSwDecBuy]  = useState<number>(18);
  const [swSlippageBps, setSwSlippageBps] = useState<number>(100); // 1.00% = 100 bps

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signer, swSell, swBuy]);

  // Live quote using Router.getAmountsOut
  const quoteSwap = async () => {
    if (!signer) return;
    if (!swSellAmt || swSell === swBuy) {
      setSwBuyEst("");
      return;
    }
    try {
      const amountIn = ethers.parseUnits(swSellAmt, swDecSell);
      const router = getRouter();
      const amounts: bigint[] = await router.getAmountsOut(amountIn, [swSell, swBuy]);
      const out = amounts[amounts.length - 1];
      setSwBuyEst(ethers.formatUnits(out, swDecBuy));
    } catch (error) {
      console.error("Quote swap error:", error);
      setSwBuyEst("");
    }
  };

  useEffect(() => {
    quoteSwap().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swSell, swBuy, swSellAmt, swDecSell, swDecBuy]);

  const doSwap = async () => {
    if (!signer) return;
    if (!swSellAmt) return alert("Enter sell amount");
    if (swSell === swBuy) return alert("Select different tokens");

    try {
      const amountIn  = ethers.parseUnits(swSellAmt, swDecSell);
      // minOut = quote * (1 - slippage)
      const router = getRouter();
      const amounts: bigint[] = await router.getAmountsOut(amountIn, [swSell, swBuy]);
      const quotedOut = amounts[amounts.length - 1];
      const minOut = (quotedOut * BigInt(10000 - swSlippageBps)) / 10000n;

      // approve router
      await (await getERC20(swSell).approve(CONTRACTS.router, amountIn)).wait();
      
      // Set deadline
      const deadline = Math.floor(Date.now() / 1000) + 600;
      
      await (await router.swapExactTokensForTokens(
        amountIn, 
        minOut, 
        [swSell, swBuy], 
        account,
        deadline
      )).wait();
      
      alert("✅ Swap completed");
      setSwSellAmt("");
      setSwBuyEst("");
    } catch (error: any) {
      console.error("Swap error:", error);
      alert(`Error swapping: ${error.reason || error.message}`);
    }
  };

  const flipSwap = () => {
    setSwSell(swBuy);
    setSwBuy(swSell);
    setSwSellAmt("");
    setSwBuyEst("");
  };

  // =========================================================
  //                       REMOVE LIQUIDITY
  // =========================================================
  const [rlTokenA, setRlTokenA] = useState(TOKEN_LIST[0].address);
  const [rlTokenB, setRlTokenB] = useState(TOKEN_LIST[1].address);
  const [rlPair, setRlPair] = useState<string>("");
  const [rlLpAmt, setRlLpAmt] = useState<string>(""); // human, LP has 18 decimals

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signer, rlTokenA, rlTokenB]);

  const doRemoveLiquidity = async () => {
    if (!signer) return;
    if (isZeroAddr(rlPair)) return alert("Pair not found");
    if (!rlLpAmt) return alert("Enter LP amount");
    
    try {
      const amt = ethers.parseUnits(rlLpAmt, 18); // your LP uses ERC20 default 18
      
      // Try router removeLiquidity first, then fallback to direct pair method
      try {
        const router = getRouter();
        const deadline = Math.floor(Date.now() / 1000) + 600;
        
        // Approve LP tokens to router
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
        // Fallback to direct pair method
        await (await getAMM(rlPair).removeLiquidity(amt)).wait();
      }
      
      alert("✅ Liquidity removed");
      setRlLpAmt("");
      await refreshRlPair();
    } catch (error: any) {
      console.error("Remove liquidity error:", error);
      alert(`Error removing liquidity: ${error.reason || error.message}`);
    }
  };

  // =========================================================
  //                           UI
  // =========================================================
  const labelFor = (addr: string) => TOKEN_LIST.find(t => t.address === addr)?.symbol ?? addr.slice(0,6);

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-8">
      {/* Connect */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">AMM dApp</h1>
        <button onClick={connectWallet} className="px-4 py-2 bg-blue-600 text-white rounded-2xl shadow">
          {account ? `Connected: ${account.slice(0, 6)}…` : "Connect Wallet"}
        </button>
      </div>

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
          <button onClick={createPair} className="px-3 py-1 bg-green-600 text-white rounded">Create</button>
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
          {isZeroAddr(alPair)
            ? "Pool not created yet — it will be created on first add."
            : `Pool: ${alPair} • Reserves (stored order): ${ethers.formatUnits(alResA, alDecimalsA)} / ${ethers.formatUnits(alResB, alDecimalsB)} (mapped to AMM.tokenA/tokenB)`}
        </div>

        <button
          onClick={doAddLiquidity}
          className="px-4 py-2 bg-purple-600 text-white rounded"
        >
          Add Liquidity
        </button>
      </section>

      {/* Swap */}
      <section className="border rounded-2xl p-4 space-y-3 shadow-sm">
        <h2 className="font-semibold">Swap</h2>

        <div className="flex gap-2 items-center">
          <input
            value={swSellAmt}
            onChange={(e)=>setSwSellAmt(e.target.value)}
            placeholder="Sell amount"
            className="border px-2 py-1 rounded flex-1"
          />
          <select
            className="border px-2 py-1 rounded"
            value={swSell}
            onChange={e => setSwSell(e.target.value as typeof swSell)}
          >
            {TOKEN_LIST.map(t => (
              <option key={t.address} value={t.address}>
                {t.symbol}
              </option>
            ))}
          </select>

          <button onClick={flipSwap} className="px-2 py-1 border rounded">⇄</button>

          <input
            value={swBuyEst}
            readOnly
            placeholder="Buy (estimated)"
            className="border px-2 py-1 rounded flex-1 bg-gray-50"
          />
          <select
            className="border px-2 py-1 rounded"
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

        <div className="flex items-center gap-3 text-sm text-gray-700">
          <label className="flex items-center gap-2">
            Slippage:
            <input
              type="number"
              min={0}
              step={0.05}
              value={(swSlippageBps/100).toString()}
              onChange={(e)=>setSwSlippageBps(Math.round(Number(e.target.value)*100))}
              className="border px-2 py-1 rounded w-20"
            />%
          </label>
          <span className="text-gray-500">Estimated out updates as you type.</span>
        </div>

        <button onClick={doSwap} className="px-4 py-2 bg-orange-600 text-white rounded">
          Swap
        </button>
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
        <button onClick={doRemoveLiquidity} className="px-4 py-2 bg-red-600 text-white rounded">
          Remove Liquidity
        </button>
      </section>
    </div>
  );
}