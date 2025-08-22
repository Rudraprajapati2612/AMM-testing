import express from "express";
import { PrismaClient } from "@prisma/client";

const app = express();
const prisma = new PrismaClient();

app.get("/pool",async (req,res)=>{
    const pools = await prisma.pool.findMany({
        include :{tokenA:true,tokenB:true}
    })

    res.json(pools)
})


app.get("/pool/:id",async (req,res)=>{
    const ID = Number(req.params.id);
    const poolId = await prisma.pool.findUnique({
        where : {id : ID},
        include: { liquidity: true, swaps: true },
    })

    res.json(poolId);
})
app.listen(3000,()=>{
    console.log("Backend Server Started");
    
})