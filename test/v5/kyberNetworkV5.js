const Web3 = require('web3');
const TestToken = artifacts.require("Token.sol");
const MockReserve = artifacts.require("MockReserve.sol");
const KyberNetwork = artifacts.require("KyberNetwork.sol");
const FeeHandler = artifacts.require("FeeHandler.sol");
const Helper = require("../v4/helper.js");

const BN = web3.utils.BN;
const { constants, expectEvent, expectRevert } = require('@openzeppelin/test-helpers');

//global variables
//////////////////
const precisionUnits = (new BN(10).pow(new BN(18)));
const ethDecimals = new BN(18);
const ethAddress = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const zeroAddress = constants.ZERO_ADDRESS;
const gasPrice = (new BN(10).pow(new BN(9)).mul(new BN(50)));
const negligibleRateDiffBps = new BN(50); //0.05% 
const BPS = new BN(10000);
const maxDestAmt = new BN(2).pow(new BN(255));
const minConversionRate = new BN(0);
const emptyHint = '0x';
let takerFeesBps = new BN(25);
let platformFeeBps = new BN(0);
let takerFeeAmount;
let txResult;

let admin;
let alerter;
let network;
let networkProxy;
let feeHandler;
let operator;
let user;
let platformWallet;

//reserve data
//////////////
let numReserves = 3;
let reserves = [];
let reserve;
let reserveAddresses = [];
let isFeePaying = [];
let reserveEtherInit = new BN(10).pow(new BN(19)).mul(new BN(2));

//tokens data
////////////
let numTokens = 4;
let tokens = [];
let tokenDecimals = [];
let srcTokenId;
let destTokenId;
let srcToken;
let destToken;
let srcQty;
let ethSrcQty = precisionUnits;

//rates data
////////////
let buyRates = [];
let sellRates = [];

contract('KyberNetwork', function(accounts) {
    before("one time init", async() => {
        //init accounts
        admin = accounts[0];
        networkProxy = accounts[0];
        operator = accounts[1];
        alerter = accounts[2];
        user = accounts[3];
        platformWallet = accounts[4];

        //init network
        network = await KyberNetwork.new(admin);

        //init feeHandler
        feeHandler = await FeeHandler.new();

        //init tokens
        for (let i = 0; i < numTokens; i++) {
            tokenDecimals[i] = new BN(15).add(new BN(i));
            token = await TestToken.new("test" + i, "tst" + i, tokenDecimals[i]);
            tokens[i] = token;
            
            tokenAmountForTrades = new BN(10000).mul(new BN(10).pow(tokenDecimals[i]));
            //transfer tokens to network
            await token.transfer(network.address, tokenAmountForTrades);
        }

        //init reserves
        for (let i = 0; i < numReserves; i++) {
            tokensPerEther = precisionUnits.mul(new BN((i + 1) * 1000));
            ethersPerToken = precisionUnits.div(new BN((i + 1) * 1000));
            buyRates.push(tokensPerEther);
            sellRates.push(ethersPerToken);
            reserve = await MockReserve.new();
            reserves[i] = reserve;
            reserveAddresses[i] = reserve.address;
            //send ETH
            await Helper.sendEtherWithPromise(accounts[9], reserve.address, reserveEtherInit);
            await assertSameEtherBalance(reserve.address, reserveEtherInit);
            for (let j = 0; j < numTokens; j++) {
                token = tokens[j];
                //set rates and send tokens based on eth -> token rate
                await reserve.setRate(token.address, tokensPerEther, ethersPerToken);
                let initialTokenAmount = Helper.calcDstQty(reserveEtherInit, ethDecimals, tokenDecimals[j], tokensPerEther);
                await token.transfer(reserve.address, initialTokenAmount);
                await assertSameTokenBalance(reserve.address, token, initialTokenAmount);
            }
            //first half are fee paying, other half aren't
            isFeePaying[i] = (i >= (numReserves / 2));
        }

        //setup network
        await network.addOperator(operator);
        await network.addKyberProxy(networkProxy);
        await network.setFeeHandler(feeHandler.address);

        for (let i = 0; i < numReserves; i++) {
            reserve = reserves[i];
            network.addReserve(reserve.address, new BN(i+1), isFeePaying[i], reserve.address, {from: operator});
            for (let j = 0; j < numTokens; j++) {
                network.listPairForReserve(reserve.address, tokens[j].address, true, true, true, {from: operator});
            }
        }
        await network.setParams(gasPrice, negligibleRateDiffBps);
        await network.setEnable(true);
    });

    beforeEach("randomly select tokens before each test", async() => {
        srcTokenId = 0;
        destTokenId = 0;
        while (srcTokenId == destTokenId) {
            srcTokenId = getRandomInt(0,numTokens-1);
            destTokenId = getRandomInt(0,numTokens-1);
        }
        
        srcToken = tokens[srcTokenId];
        destToken = tokens[destTokenId];
        srcDecimals = tokenDecimals[srcTokenId];
        destDecimals = tokenDecimals[destTokenId];

        srcQty = new BN(100).mul(new BN(10).pow(srcDecimals));
    })

    it("should test set contract events", async() => {
        let tempNetwork = await KyberNetwork.new(admin);
        let ethSender = accounts[9];
        txResult = await tempNetwork.send(ethSrcQty, {from: ethSender});
        expectEvent(txResult, 'EtherReceival', {
            sender: ethSender,
            amount: ethSrcQty
        });
        
        txResult = await tempNetwork.addOperator(operator);
        expectEvent(txResult, 'OperatorAdded', {
            newOperator: operator,
            isAdd: true
        });

        txResult = await tempNetwork.addReserve(reserve.address, new BN(1), true, user, {from: operator});
        expectEvent(txResult, 'AddReserveToNetwork', {
            reserve: reserve.address,
            reserveId: new BN(1),
            isFeePaying: true,
            rebateWallet: user,
            add: true
        });

        //TODO: RemoveReserveFromNetwork
        //TODO: ListReservePairs
        //TODO: FeeHandlerContractSet
        //TODO: KyberNetworkParamsSet
        //TODO: KyberNetworkSetEnable
        //TODO: KyberProxyAdded
        //TODO: KyberProxyRemoved
        //TODO: HandlePlatformFee
        //TODO: KyberTrade
    });

    it("should test enable API", async() => {
        let isEnabled = await network.enabled();
        assert.equal(isEnabled, true);

        await network.setEnable(false);

        isEnabled = await network.enabled();
        assert.equal(isEnabled, false);

        await network.setEnable(true);
    });

    it("should get best rate for T2E and E2T for small taker fee bps", async() => {
        takerFeeAmount = ethSrcQty.mul(takerFeesBps).div(BPS);
        result = await network.searchBestRate(reserveAddresses, ethAddress, destToken.address, ethSrcQty, takerFeeAmount);
        bestReserve = getBestReserve(buyRates);
        actualRate = result[1];
        Helper.assertEqual(bestReserve.rateNoFee, actualRate, "expected best buy rate != actual best buy rate");

        result = await network.searchBestRate(reserveAddresses, srcToken.address, ethAddress, srcQty, takerFeesBps);
        bestReserve = getBestReserve(sellRates);
        actualRate = result[1];
        Helper.assertEqual(bestReserve.rateNoFee, actualRate, "expected best sell rate != actual best sell rate");
    });

    it("should get expected rate (with network fee) for T2E, E2T & T2T", async() => {
        result = await network.getExpectedRate(srcToken.address, ethAddress, srcQty);
        bestReserve = getBestReserve(sellRates);
        bestSellRate = bestReserve.rateWithNetworkFee;
        Helper.assertEqual(bestSellRate, result.expectedRate, "expected rate with network fee != actual rate for token -> ETH");

        result = await network.getExpectedRate(ethAddress, destToken.address, ethSrcQty);
        bestReserve = getBestReserve(buyRates);
        bestBuyRate = bestReserve.rateWithNetworkFee;
        Helper.assertEqual(bestBuyRate, result.expectedRate, "expected rate with network fee != actual rate for ETH -> token");

        result = await network.getExpectedRate(srcToken.address, destToken.address, srcQty);
        expectedWeiAmt = Helper.calcDstQty(srcQty, srcDecimals, ethDecimals, bestSellRate);
        expectedDestAmt = Helper.calcDstQty(expectedWeiAmt, ethDecimals, destDecimals, bestBuyRate);
        expectedRate = Helper.calcRateFromQty(srcQty, expectedDestAmt, srcDecimals, destDecimals);
        Helper.assertEqual(expectedRate, result.expectedRate, "expected rate with network fee != actual rate for token -> token");
    });

    it("should perform a token -> ETH trade and check balances change as expected", async() => {
        //best sell rate is 1st reserve
        bestReserve = reserves[0];

        //get initial balances
        initialTokenReserveBalance = await srcToken.balanceOf(bestReserve.address);
        initialTokenUserBalance = await srcToken.balanceOf(network.address); //assume user sends to network already
        initialEtherReserveBalance = await Helper.getBalancePromise(bestReserve.address);
        initialEtherUserBalance = await Helper.getBalancePromise(user);

        rate = await network.getExpectedRate(srcToken.address, ethAddress, srcQty);
        expectedDestAmt = Helper.calcDstQty(srcQty, srcDecimals, ethDecimals, rate[0]);

        //perform trade, give ETH to user
        txResult = await network.tradeWithHint(networkProxy, srcToken.address, srcQty, ethAddress, user, 
            maxDestAmt, minConversionRate, platformWallet, emptyHint);
        console.log(`token -> ETH: ${txResult.receipt.gasUsed} gas used`);

        //compare balances
        await assertSameEtherBalance(bestReserve.address, initialEtherReserveBalance.sub(expectedDestAmt));
        await assertSameEtherBalance(user, initialEtherUserBalance.add(expectedDestAmt));
        await assertSameTokenBalance(network.address, srcToken, initialTokenUserBalance.sub(srcQty));
        await assertSameTokenBalance(bestReserve.address, srcToken, initialTokenReserveBalance.add(srcQty));
    });

    it("should perform a ETH -> token trade and check balances change as expected", async() => {
        //best buy rate is last reserve
        bestReserve = reserves[numReserves - 1];

        //get initial balances
        initialTokenReserveBalance = await destToken.balanceOf(bestReserve.address);
        initialTokenUserBalance = await destToken.balanceOf(user);
        initialEtherReserveBalance = await Helper.getBalancePromise(bestReserve.address);
 
        rate = await network.getExpectedRateWithHintAndFee(ethAddress, destToken.address, ethSrcQty, platformFeeBps, emptyHint);
        expectedDestAmt = Helper.calcDstQty(ethSrcQty, ethDecimals, destDecimals, rate.expectedRateAfterNetworkFees);
        //reserve gets ETH minus network fee (if applicable)
        expectedAddedEthForReserve = Helper.calcSrcQty(expectedDestAmt, ethDecimals, destDecimals, rate.expectedRateNoFees);
        
        //perform trade, give dest tokens to user
        txResult = await network.tradeWithHint(networkProxy, ethAddress, ethSrcQty, destToken.address, user, 
            maxDestAmt, minConversionRate, platformWallet, emptyHint, {value: ethSrcQty});
            console.log(`ETH -> token: ${txResult.receipt.gasUsed} gas used`);

        //compare balances
        await assertSameEtherBalance(bestReserve.address, initialEtherReserveBalance.add(expectedAddedEthForReserve));
        await assertSameTokenBalance(bestReserve.address, destToken, initialTokenReserveBalance.sub(expectedDestAmt));
        await assertSameTokenBalance(user, destToken, initialTokenUserBalance.add(expectedDestAmt));
    });

    //srcToken: (user -> sell reserve) => user bal goes down, sell reserve bal goes up
    //ETH: (sell -> buy reserve) => sell reserve bal goes down, buy reserve bal goes up
    //destToken: (buy reserve -> user) => bal goes down, user bal goes up
    it("should perform a token -> token trade and check balances change as expected", async() => {
        //best sell rate is 1st reserve
        bestSellReserve = reserves[0];
        //best buy rate is last reserve
        bestBuyReserve = reserves[numReserves - 1];

        //initial balances
        initialSrcTokenUserBalance = await srcToken.balanceOf(network.address); //assume user gave funds to proxy already
        initialDestTokenUserBalance = await destToken.balanceOf(user);
        initialEtherSellReserveBalance = await Helper.getBalancePromise(bestSellReserve.address);
        initialSrcTokenSellReserveBalance = await srcToken.balanceOf(bestSellReserve.address);
        initialEtherBuyReserveBalance = await Helper.getBalancePromise(bestBuyReserve.address);
        initialDestTokenBuyReserveBalance = await destToken.balanceOf(bestBuyReserve.address);

        overallRate = await network.getExpectedRateWithHintAndFee(srcToken.address, destToken.address, srcQty, platformFeeBps, emptyHint);
        expectedDestTokenDeltaAmount = Helper.calcDstQty(srcQty, srcDecimals, destDecimals, overallRate.expectedRateAfterNetworkFees);
        expectedSrcTokenDeltaAmount = srcQty;
        // //perform trade, give dest tokens to user
        txResult = await network.tradeWithHint(networkProxy, srcToken.address, srcQty, destToken.address, user, 
            maxDestAmt, minConversionRate, platformWallet, emptyHint);
        console.log(`token -> token: ${txResult.receipt.gasUsed} gas used`);
        
        //compare balances
        await assertSameTokenBalance(network.address, srcToken, initialSrcTokenUserBalance.sub(expectedSrcTokenDeltaAmount));
        await assertSameTokenBalance(bestSellReserve.address, srcToken, initialSrcTokenSellReserveBalance.add(expectedSrcTokenDeltaAmount));
        await assertSameTokenBalance(bestBuyReserve.address, destToken, initialDestTokenBuyReserveBalance.sub(expectedDestTokenDeltaAmount));
        await assertSameTokenBalance(user, destToken, initialDestTokenUserBalance.add(expectedDestTokenDeltaAmount));
        
        //check sell reserve eth bal down
        //check buy reserve eth bal up
    });
})

async function assertSameEtherBalance(accountAddress, expectedBalance) {
    let balance = await Helper.getBalancePromise(accountAddress);
    Helper.assertEqual(balance, expectedBalance, "wrong ether balance");
}

async function assertSameTokenBalance(accountAddress, token, expectedBalance) {
    let balance = await token.balanceOf(accountAddress);
    Helper.assertEqual(balance, expectedBalance, "wrong token balance");
}

//returns random integer between min (inclusive) and max (inclusive)
function getRandomInt(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getBestReserve(rateArr) {
    bestReserve = {
        rateNoFee: new BN(0), 
        rateWithNetworkFee: new BN(0)
    }

    for (let i=0; i < rateArr.length; i++) {
        let rate = rateArr[i];
        let rateForComparison = rate;
        if (isFeePaying[i]) {
            rateForComparison = rate.mul(BPS.sub(takerFeesBps)).div(BPS);
        }

        if (rateForComparison.gt(bestReserve.rateNoFee)) {
            bestReserve.rateNoFee = rate;
            bestReserve.rateWithNetworkFee = rateForComparison;
        }
    }
    return bestReserve;
}
