/* eslint-disable prefer-const */
import { BigDecimal, Address, dataSource } from "@graphprotocol/graph-ts/index";
import { Pair, Token, Bundle } from "../generated/schema";
import { ZERO_BD, factoryContract, ADDRESS_ZERO, ONE_BD } from "./utils";

let WBNB_ADDRESS = "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c";
let BUSD_WBNB_PAIR = "0x58f876857a02d6762e0101bb5c46a8c1ed44dc16"; // created block 589414
let USDT_WBNB_PAIR = "0x16b9a82891338f9ba80e2d6970fdda79d1eb0dae"; // created block 648115

export function getBnbPriceInUSD(): BigDecimal {
  // fetch eth prices for each stablecoin
  let usdtPair = Pair.load(USDT_WBNB_PAIR); // usdt is token0
  let busdPair = Pair.load(BUSD_WBNB_PAIR); // busd is token1

  if (busdPair !== null && usdtPair !== null) {
    let totalLiquidityBNB = busdPair.reserve0.plus(usdtPair.reserve1);
    if (totalLiquidityBNB.notEqual(ZERO_BD)) {
      let busdWeight = busdPair.reserve0.div(totalLiquidityBNB);
      let usdtWeight = usdtPair.reserve1.div(totalLiquidityBNB);
      return busdPair.token1Price
        .times(busdWeight)
        .plus(usdtPair.token0Price.times(usdtWeight));
    } else {
      return ZERO_BD;
    }
  } else if (busdPair !== null) {
    return busdPair.token1Price;
  } else if (usdtPair !== null) {
    return usdtPair.token0Price;
  } else {
    return ZERO_BD;
  }
}

let network = dataSource.network();

// token where amounts should contribute to tracked volume and liquidity
export const WHITELIST: string[] =
[
  "0xb365ab13bc6bd2826a0217a5d3c26c4da9c739ca", // vUSD
  "0x0586a2240013daaa41ec91c4447a0e9e30c4becc", // vTHB
  // "0xce610182e55b8fabbfbe990811fc546ffb26b5c9", // vEUR
  "0x4bfde56e7eb7ed22cd5fb7c7595d1D11b1414581", // vSGD
  // "0x805a6d33250c9129b17245b39f4aa9bdac3231c9", // vCHF
  // "0x55d398326f99059ff775485246999027b3197955", // USDT
];
// [
//   "0x5108c124a162221a11181d82889cb4b85251b99e", // vUSD
//   "0x7950d937be6ad204d73345609a3c91259236b139", // vTHB
//   "0x927098c1f03f4f624c2b30f5cc956f0edc175e61", // vEUR
//   "0x4149c3b3807cdc4cb2249f9c4579391a77a93043", // vSGD
//   "0xf313ca0e69ebd1c5230bf939c46b0e097463fe49", // vCHF
//   "0xe2d4098010f4fcd04c11c70d8b322b711ffbdcca", // USDT
// ]

// minimum liquidity for price to get tracked
let MINIMUM_LIQUIDITY_THRESHOLD_BNB = BigDecimal.fromString("10");

/**
 * Search through graph to find derived BNB per token.
 * @todo update to be derived BNB (add stablecoin estimates)
 **/
export function findBnbPerToken(token: Token): BigDecimal {
  if (token.id == WBNB_ADDRESS) {
    return ONE_BD;
  }
  // loop through whitelist and check if paired with any
  for (let i = 0; i < WHITELIST.length; ++i) {
    let pairAddress = factoryContract.getPair(
      Address.fromString(token.id),
      Address.fromString(WHITELIST[i])
    );
    if (pairAddress.toHex() != ADDRESS_ZERO) {
      let pair = Pair.load(pairAddress.toHex());
      if (
        pair.token0 == token.id &&
        pair.reserveBNB.gt(MINIMUM_LIQUIDITY_THRESHOLD_BNB)
      ) {
        let token1 = Token.load(pair.token1);
        return pair.token1Price.times(token1.derivedBNB as BigDecimal); // return token1 per our token * BNB per token 1
      }
      if (
        pair.token1 == token.id &&
        pair.reserveBNB.gt(MINIMUM_LIQUIDITY_THRESHOLD_BNB)
      ) {
        let token0 = Token.load(pair.token0);
        return pair.token0Price.times(token0.derivedBNB as BigDecimal); // return token0 per our token * BNB per token 0
      }
    }
  }
  return ZERO_BD; // nothing was found return 0
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD.
 * If both are, return average of two amounts
 * If neither is, return 0
 */
export function getTrackedVolumeUSD(
  bundle: Bundle,
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token
): BigDecimal {
  let price0 = token0.derivedBNB.times(bundle.bnbPrice);
  let price1 = token1.derivedBNB.times(bundle.bnbPrice);

  // both are whitelist tokens, take average of both amounts
  if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount0
      .times(price0)
      .plus(tokenAmount1.times(price1))
      .div(BigDecimal.fromString("2"));
  }

  // take full value of the whitelisted token amount
  if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0);
  }

  // take full value of the whitelisted token amount
  if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount1.times(price1);
  }

  // neither token is on white list, tracked volume is 0
  return ZERO_BD;
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD * 2.
 * If both are, return sum of two amounts
 * If neither is, return 0
 */
export function getTrackedLiquidityUSD(
  bundle: Bundle,
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token
): BigDecimal {
  let price0 = token0.derivedBNB.times(bundle.bnbPrice);
  let price1 = token1.derivedBNB.times(bundle.bnbPrice);

  // both are whitelist tokens, take average of both amounts
  if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0).plus(tokenAmount1.times(price1));
  }

  // take double value of the whitelisted token amount
  if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0).times(BigDecimal.fromString("2"));
  }

  // take double value of the whitelisted token amount
  if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount1.times(price1).times(BigDecimal.fromString("2"));
  }

  // neither token is on white list, tracked volume is 0
  return ZERO_BD;
}
