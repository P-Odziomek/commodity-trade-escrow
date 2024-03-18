import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const CTEModule = buildModule("CTEModule", (m) => {
  
  const cte = m.contract("CommodityTradeEscrow");

  return { cte };
});

export default CTEModule;
