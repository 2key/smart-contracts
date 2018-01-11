var ConversionRates = artifacts.require("./ConversionRates.sol");
var TestToken = artifacts.require("./mockContracts/TestToken.sol");
var Wrapper = artifacts.require("./mockContracts/Wrapper.sol");
var Reserve = artifacts.require("./KyberReserve");

var Helper = require("./helper.js");
var BigNumber = require('bignumber.js');

//global variables
//////////////////
var precisionUnits = (new BigNumber(10).pow(18));
var ethAddress = '0x00eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
var precision = new BigNumber(10).pow(18);

//balances
var expectedReserveBalanceWei = 0;
var reserveTokenBalance = [];
var reserveTokenImbalance = [];

//permission groups
var admin;
var operator;
var network;
var sanityRates;
var withDrawAddress;

//contracts
var convRatesInst;
var reserveInst;

//block data
var priceUpdateBlock;
var currentBlock;
var validRateDurationInBlocks = 1000;

//tokens data
////////////
var numTokens = 5;
var tokens = [];
var tokenAdd = [];

// imbalance data
var minimalRecordResolution = 2; //low resolution so I don't lose too much data. then easier to compare calculated imbalance values.
var maxPerBlockImbalance = 4000;
var maxTotalImbalance = maxPerBlockImbalance * 12;

// all price steps in bps (basic price steps).
// 100 bps means rate change will be: price * (100 + 10000) / 10000 == raise rate in 1%
// higher rate is better for user. will get more dst quantity for his tokens.
// all x values represent token imbalance. y values represent equivalent steps in bps.
// buyImbalance represents coin shortage. higher buy imbalance = more tokens were bought.
// generally. speaking, if imbalance is higher we want to have:
//      - smaller buy bps (negative) to lower rate when buying token with ether.
//      - bigger sell bps to have higher rate when buying ether with token.
////////////////////

//base buy and sell rates (prices)
var baseBuyRate = [];
var baseSellRate = [];

//quantity buy steps
var qtyBuyStepX = [-1400, -700, -150, 0, 150, 350, 700,  1400];
var qtyBuyStepY = [ 1000,   75,   25, 0,  0, -70, -160, -3000];

//imbalance buy steps
var imbalanceBuyStepX = [-8500, -2800, -1500, 0, 1500, 2800,  4500];
var imbalanceBuyStepY = [ 1300,   130,    43, 0,   0, -110, -1600];

//sell
//sell price will be 1 / buy (assuming no spread) so sell is actually buy price in other direction
var qtySellStepX = [-1400, -700, -150, 0, 150, 350, 700, 1400];
var qtySellStepY = [-300,   -80,  -15, 0,   0, 120, 170, 3000];

//sell imbalance step
var imbalanceSellStepX = [-8500, -2800, -1500, 0, 1500, 2800,  4500];
var imbalanceSellStepY = [-1500,  -320,   -75, 0,    0,  110,   650];


//compact data.
var sells = [];
var buys = [];
var indices = [];
var compactBuyArr = [];
var compactSellArr = [];

contract('KyberReserve', function(accounts) {
    it("should init globals. init ConversionRates Inst, init tokens and add to pricing inst. set basic data per token.", async function () {
        // set account addresses
        admin = accounts[0];
        operator = accounts[1];
        network = accounts[2];
        user1 = accounts[4];
        user2 = accounts[5];
        withDrawAddress = accounts[6];
        sanityRates = accounts[7];

        currentBlock = priceUpdateBlock = await Helper.getCurrentBlock();

        console.log("current block: " + currentBlock);
        //init contracts
        convRatesInst = await ConversionRates.new(admin, {});

        //set pricing general parameters
        await convRatesInst.setValidRateDurationInBlocks(validRateDurationInBlocks);

        //create and add token addresses...
        for (var i = 0; i < numTokens; ++i) {
            token = await TestToken.new("test" + i, "tst" + i, 18);
            tokens[i] = token;
            tokenAdd[i] = token.address;
            await convRatesInst.addToken(token.address);
            await convRatesInst.setTokenControlInfo(token.address, minimalRecordResolution, maxPerBlockImbalance, maxTotalImbalance);
            await convRatesInst.enableTokenTrade(token.address);
        }

        assert.equal(tokens.length, numTokens, "bad number tokens");

        var result = await convRatesInst.addOperator(operator);
//        console.log(result.logs[0].args);
    });

    it("should set base prices + compact data price factor + step function. for all tokens.", async function () {
        //buy is ether to token rate. sale is token to ether rate. so sell == 1 / buy. assuming we have no spread.
        var tokensPerEther;
        var ethersPerToken;

        for (i = 0; i < numTokens; ++i) {
            tokensPerEther = (new BigNumber(precisionUnits.mul((i + 1) * 3)).floor());
            ethersPerToken = (new BigNumber(precisionUnits.div((i + 1) * 3)).floor());
            baseBuyRate.push(tokensPerEther.valueOf());
            baseSellRate.push(ethersPerToken.valueOf());
        }
        assert.equal(baseBuyRate.length, tokens.length);
        assert.equal(baseSellRate.length, tokens.length);

        buys.length = sells.length = indices.length = 0;

        await convRatesInst.setBaseRate(tokenAdd, baseBuyRate, baseSellRate, buys, sells, currentBlock, indices, {from: operator});

        //set compact data
        compactBuyArr = [0, 12, -5, 0, 0, 06, 07, 08, 09, 10, 11, 12, 13, 14];
        var compactBuyHex = Helper.bytesToHex(compactBuyArr);
        buys.push(compactBuyHex);

        compactSellArr = [0, -50, 95, 0, 0, 26, 27, 28, 29, 30, 31, 32, 33, 34];
        var compactSellHex = Helper.bytesToHex(compactSellArr);
        sells.push(compactSellHex);

        indices[0] = 0;

        assert.equal(indices.length, sells.length, "bad sells array size");
        assert.equal(indices.length, buys.length, "bad buys array size");

        await convRatesInst.setCompactData(buys, sells, currentBlock, indices, {from: operator});

        //all start with same step functions.
        for (var i = 0; i < numTokens; ++i) {
            await convRatesInst.setQtyStepFunction(tokenAdd[i], qtyBuyStepX, qtyBuyStepY, qtySellStepX, qtySellStepY, {from:operator});
            await convRatesInst.setImbalanceStepFunction(tokenAdd[i], imbalanceBuyStepX, imbalanceBuyStepY, imbalanceSellStepX, imbalanceSellStepY, {from:operator});
        }
    });

    it("should init reserve and set all reserve data including balances", async function () {
        reserveInst = await Reserve.new(network, convRatesInst.address, admin);
        await reserveInst.setContracts(network, convRatesInst.address, 0);

        await reserveInst.addOperator(operator);
        await convRatesInst.setReserveAddress(reserveInst.address);

        //set reserve balance. 10000 wei ether + per token 1000 wei ether value according to base price.
        var reserveEtherInit = 5000 * 2;
        await Helper.sendEtherWithPromise(accounts[9], reserveInst.address, reserveEtherInit);
        
        var balance = await Helper.getBalancePromise(reserveInst.address);
        expectedReserveBalanceWei = balance.valueOf();

        assert.equal(balance.valueOf(), reserveEtherInit, "wrong ether balance");

        //transfer tokens to reserve. each token same wei balance
        for (var i = 0; i < numTokens; ++i) {
            token = tokens[i];
            var amount = (new BigNumber(reserveEtherInit)).mul(baseBuyRate[i]).div(precisionUnits);
            await token.transfer(reserveInst.address, amount.valueOf());
            var balance = await token.balanceOf(reserveInst.address);
            assert.equal(amount.valueOf(), balance.valueOf());
            reserveTokenBalance.push(amount);
            reserveTokenImbalance.push(0);
        }
    });

    it("should perform small buy (no steps) and check: balances changed, rate is expected rate.", async function () {
        var tokenInd = 3;
        var token = tokens[tokenInd]; //choose some token
        var amountWei = 2 * 1;

        //verify base rate
        var buyRate = await reserveInst.getConversionRate(ethAddress, tokenAdd[tokenInd], amountWei, currentBlock);
        var expectedRate = (new BigNumber(baseBuyRate[tokenInd]));
        var destQty = (new BigNumber(amountWei).mul(baseBuyRate[tokenInd])).div(precisionUnits);
        var extraBps = getExtraBpsForBuyQuantity(destQty);
        expectedRate = addBps(expectedRate, extraBps);

        //check correct rate calculated
        assert.equal(buyRate.valueOf(), expectedRate.valueOf(), "unexpected rate.");

        //perform trade
        await reserveInst.trade(ethAddress, amountWei, tokenAdd[tokenInd], user1, buyRate, true, {from:network, value:amountWei});

        //check higher ether balance on reserve
        expectedReserveBalanceWei = (expectedReserveBalanceWei * 1) + amountWei;
        expectedReserveBalanceWei -= expectedReserveBalanceWei % 1;
        var balance = await Helper.getBalancePromise(reserveInst.address);
        assert.equal(balance.valueOf(), expectedReserveBalanceWei, "bad reserve balance wei");

        //check token balances
        ///////////////////////

        //check token balance on user1
        var tokenTweiBalance = await token.balanceOf(user1);
        var expectedTweiAmount = expectedRate.mul(amountWei).div(precisionUnits);
        assert.equal(tokenTweiBalance.valueOf(), expectedTweiAmount.valueOf(), "bad token balance");

        //check lower token balance on reserve
        //below is true since all tokens and ether have same decimals (18)
        reserveTokenBalance[tokenInd] -= expectedTweiAmount;
        reserveTokenImbalance[tokenInd] += (expectedTweiAmount * 1); //imbalance represents how many missing tokens
        var reportedBalance = await token.balanceOf(reserveInst.address);
        assert.equal(reportedBalance.valueOf(), reserveTokenBalance[tokenInd].valueOf(), "bad token balance on reserve");
    });


    it("should perform a few buys with steps and check: correct balances change, rate is expected rate.", async function () {
        var tokenInd = 2;
        var token = tokens[tokenInd]; //choose some token
        var amountWei;
        var totalWei = 0 * 1;
        var totalExpectedTwei = 0 * 1;

        for (var i = 0; i > 19; i++) {
            amountWei = (7 * i) + 1;
            var buyRate = await reserveInst.getConversionRate(ethAddress, tokenAdd[tokenInd], amountWei, currentBlock);

            //verify price/rate against set price
            var expectedRate = (new BigNumber(baseBuyRate[tokenInd]));
            //first calculate number of destination tokens according to basic rate
            var destQty = (new BigNumber(amountWei).mul(baseBuyRate[tokenInd])).div(precisionUnits);
            var extraBps = getExtraBpsForBuyQuantity(destQty);
            expectedRate = addBps(expectedRate, extraBps);
            extraBps = getExtraBpsForImbalanceBuyQuantity(reserveTokenImbalance[token]);
            expectedRate = addBps(expectedRate, extraBps);

            assert.equal(buyRate.valueOf(), expectedRate.valueOf(0), "unexpected rate.");

            var expectedTweiAmount = expectedRate.mul(amountWei).div(precisionUnits);
            totalExpectedTwei += (1 * expectedTweiAmount);
            reserveTokenBalance[tokenInd].sub(expectedTweiAmount);

            await reserveInst.trade(ethAddress, amountWei, tokenAdd[tokenInd], user1, buyRate, true, {from : network, value:amountWei});
            totalWei += (1 * amountWei);
        };

        //check higher ether balance on reserve
        expectedReserveBalanceWei = (expectedReserveBalanceWei * 1) + totalWei;
        expectedReserveBalanceWei -= expectedReserveBalanceWei % 1;
        var balance = await Helper.getBalancePromise(reserveInst.address);
        assert.equal(balance.valueOf(), expectedReserveBalanceWei, "bad reserve balance");

        //check lower token balance in reserve
        var reportedBalance = await token.balanceOf(reserveInst.address);
        assert.equal(reportedBalance.valueOf(), reserveTokenBalance[tokenInd].valueOf(), "bad token balance on reserve");

        //check token balance on user1
        var tokenTweiBalance = await token.balanceOf(user1);
        assert.equal(tokenTweiBalance.valueOf(), totalExpectedTwei.valueOf(), "bad token balance");
    });

    it("should perform small sell and check: balances changed, rate is expected rate.", async function () {
        var tokenInd = 3;
        var token = tokens[tokenInd]; //choose some token
        var amountTwei = 25 * 1;

        //no need to transfer initial balance to user
        //in the full scenario. user approves network which collects the tokens and approves reserve
        //which collects tokens from network.
        //so here transfer tokens to network and approve allowance from network to reserve.
        await token.transfer(network, amountTwei);

        //verify sell rate
        var sellRate = await reserveInst.getConversionRate(tokenAdd[tokenInd], ethAddress, amountTwei, currentBlock);

        var expectedRate = (new BigNumber(baseSellRate[tokenInd]));
        var extraBps = getExtraBpsForSellQuantity(amountTwei);
        expectedRate = addBps(expectedRate, extraBps);
        expectedRate.floor();

        //check correct rate calculated
        assert.equal(sellRate.valueOf(), expectedRate.valueOf(), "unexpected rate.");

        //pre trade step, approve allowance from user to network.
        await token.approve(reserveInst.address, amountTwei, {from: network});

        //perform trade
        await reserveInst.trade(tokenAdd[tokenInd], amountTwei, ethAddress, user2, sellRate, true, {from:network});

        //check lower ether balance on reserve
        var amountWei = (new BigNumber(amountTwei).mul(expectedRate)).div(precisionUnits).floor();
        expectedReserveBalanceWei = (new BigNumber(expectedReserveBalanceWei)).sub(amountWei).floor();
        var balance = await Helper.getBalancePromise(reserveInst.address);
        assert.equal(balance.valueOf(), expectedReserveBalanceWei.valueOf(), "bad reserve balance wei");

        //check token balances
        ///////////////////////

        //check token balance on network zeroed
        var tokenTweiBalance = await token.balanceOf(network);

        assert.equal(tokenTweiBalance.valueOf(), 0, "bad token balance");

        //check token balance on reserve was updated (higher)
        //below is true since all tokens and ether have same decimals (18)
        reserveTokenBalance[tokenInd] += (amountTwei * 1);
        reserveTokenImbalance[tokenInd] -= (amountTwei * 1); //imbalance represents how many missing tokens
        var reportedBalance = await token.balanceOf(reserveInst.address);
        assert.equal(reportedBalance.valueOf(), reserveTokenBalance[tokenInd].valueOf(), "bad token balance on reserve");
    });

    it("should perform a few sells with steps. check: balances changed, rate is expected rate.", async function () {
        var tokenInd = 3;
        var token = tokens[tokenInd]; //choose some token

        //no need to transfer initial balance to user
        //in the full scenario. user approves network which collects the tokens and approves reserve
        //which collects tokens from network.
        //so here transfer tokens to network and approve allowance from network to reserve.
        for (var i = 0; i < 17; ++i)
        {
            var amountTwei = (i + 1) * 31;

            await token.transfer(network, amountTwei);

            //verify sell rate
            var sellRate = await reserveInst.getConversionRate(tokenAdd[tokenInd], ethAddress, amountTwei, currentBlock);

            var expectedRate = (new BigNumber(baseSellRate[tokenInd])).floor();
            var extraBps = getExtraBpsForSellQuantity(amountTwei);
            expectedRate = addBps(expectedRate, extraBps);
            extraBps = getExtraBpsForImbalanceSellQuantity((reserveTokenImbalance[tokenInd] - (amountTwei * 1)));
            expectedRate = addBps(expectedRate, extraBps);
            expectedRate = expectedRate.floor();

            //check correct rate calculated
            assert.equal(sellRate.valueOf(), expectedRate.valueOf(), "unexpected rate.");

            //pre trade step, approve allowance from network to reserve (on reserve test we skip step where user sends to netwok)
            await token.approve(reserveInst.address, amountTwei, {from: network});

            //perform trade
            await reserveInst.trade(tokenAdd[tokenInd], amountTwei, ethAddress, user2, sellRate, true, {from:network});

            //check lower ether balance on reserve
            var amountWei = (new BigNumber(amountTwei).mul(expectedRate)).div(precisionUnits).floor();
            expectedReserveBalanceWei = (new BigNumber(expectedReserveBalanceWei)).sub(amountWei).floor();
            var balance = await Helper.getBalancePromise(reserveInst.address);
            assert.equal(balance.valueOf(), expectedReserveBalanceWei.valueOf(), "bad reserve balance wei");

            //check token balances
            ///////////////////////

            //check token balance on network zeroed
            var tokenTweiBalance = await token.balanceOf(network);

            assert.equal(tokenTweiBalance.valueOf(), 0, "bad token balance network");

            //check token balance on reserve was updated (higher)
            //below is true since all tokens and ether have same decimals (18)
            reserveTokenBalance[tokenInd] += (amountTwei * 1);
            reserveTokenImbalance[tokenInd] -= (amountTwei * 1); //imbalance represents how many missing tokens
            var reportedBalance = await token.balanceOf(reserveInst.address);
            assert.equal(reportedBalance.valueOf(), reserveTokenBalance[tokenInd].valueOf(), "bad token balance on reserve");
        }
    });

    it("should approve withdraw address and withdraw. token and ether", async function () {
        var tokenInd = 1;
        var amount = 10;
        var token = tokens[tokenInd];

        // first token
        await reserveInst.approveWithdrawAddress(tokenAdd[tokenInd], withDrawAddress, true);
        await reserveInst.withdraw(tokenAdd[tokenInd], amount, withDrawAddress, {from: operator});

        reserveTokenBalance[tokenInd] -= amount;
        var reportedBalance = await token.balanceOf(reserveInst.address);
        assert.equal(reportedBalance.valueOf(), reserveTokenBalance[tokenInd].valueOf(), "bad token balance on reserve");

        reportedBalance = await token.balanceOf(withDrawAddress);
        assert.equal(reportedBalance.valueOf(), amount, "bad token balance on withdraw address");

        //ether
        await reserveInst.approveWithdrawAddress(ethAddress, withDrawAddress, true);
        await reserveInst.withdraw(ethAddress, amount, withDrawAddress, {from: operator});

        expectedReserveBalanceWei -= amount;
        var reportedBalance = await Helper.getBalancePromise(reserveInst.address);
        assert.equal(reportedBalance.valueOf(), expectedReserveBalanceWei, "bad eth balance on reserve");
    });

    it ("should test rejected scenarios for withdraw", async function() {
        var tokenInd = 1;
        var amount = 10;

        //make sure withdraw rejected from non operator
        try {
            await reserveInst.withdraw(tokenAdd[tokenInd], amount, withDrawAddress);
            assert(false, "throw was expected in line above.")
        }
        catch(e){
            assert(Helper.isRevertErrorMessage(e), "expected throw but got: " + e);
        }

        //make sure withdraw rejected to non approved token
        try {
            await reserveInst.withdraw(tokenAdd[tokenInd - 1], amount, withDrawAddress, {from: operator});
            assert(false, "throw was expected in line above.")
        }
        catch(e){
            assert(Helper.isRevertErrorMessage(e), "expected throw but got: " + e);
        }

        //make sure withdraw rejected to non approved address
        try {
            await reserveInst.withdraw(tokenAdd[tokenInd], amount, accounts[9], {from: operator});
            assert(false, "throw was expected in line above.")
        }
        catch(e){
            assert(Helper.isRevertErrorMessage(e), "expected throw but got: " + e);
        }
    });

    it ("should test get dest qty and get src qty", async function() {
        var srcQty = 100;
        var rate = precision.div(2); //1 to 2. in precision units

        var srcDecimal = 10;
        var dstDecimal = 13;

        var tokenA = await TestToken.new("source", "src", srcDecimal);
        var tokenB = await TestToken.new("dest", "dst", dstDecimal);

        //get dest QTY
        var expectedDestQty = (srcQty * rate / precision) * (10 ** (dstDecimal - srcDecimal));

        var reportedDstQty = await reserveInst.getDestQty(tokenA.address, tokenB.address, srcQty, rate);

        assert.equal(expectedDestQty.valueOf(), reportedDstQty.valueOf(), "unexpected dst qty");

        //get src qty
        var dstQty = 100000;
        var expectedSrcQty = (((precision / rate)* dstQty * (10**(srcDecimal - dstDecimal))));

        var reportedSrcQty = await reserveInst.getSrcQty(tokenA.address, tokenB.address, dstQty, rate);

        assert.equal(expectedSrcQty.valueOf(), reportedSrcQty.valueOf(), "unexpected dst qty");
    });

//    it("should see trades stopped with sanity pricing contract.", async function () {
//    });
//
//
//    it("should perform big buy and sell all bought tokens. see balances return to start balnance." , function () {
//    });
});

function convertRateToPricingRate (baseRate) {
// conversion rate in pricing is in precision units (10 ** 18) so
// rate 1 to 50 is 50 * 10 ** 18
// rate 50 to 1 is 1 / 50 * 10 ** 18 = 10 ** 18 / 50a
    return ((new BigNumber(10).pow(18)).mul(baseRate).floor());
};

function getExtraBpsForBuyQuantity(qty) {
    for (var i = 0; i < qtyBuyStepX.length; i++) {
        if (qty <= qtyBuyStepX[i]) return qtyBuyStepY[i];
    }
    return qtyBuyStepY[qtyBuyStepY.length - 1];
};

function getExtraBpsForSellQuantity(qty) {
    for (var i = 0; i < qtySellStepX.length; i++) {
        if (qty <= qtySellStepX[i]) return qtySellStepY[i];
    }
    return qtySellStepY[qtySellStepY.length - 1];
};

function getExtraBpsForImbalanceBuyQuantity(qty) {
    for (var i = 0; i < imbalanceBuyStepX.length; i++) {
        if (qty <= imbalanceBuyStepX[i]) return imbalanceBuyStepY[i];
    }
    return (imbalanceBuyStepY[imbalanceBuyStepY.length - 1]);
};

function getExtraBpsForImbalanceSellQuantity(qty) {
    for (var i = 0; i < imbalanceSellStepX.length; i++) {
        if (qty <= imbalanceSellStepX[i]) return imbalanceSellStepY[i];
    }
    return (imbalanceSellStepY[imbalanceSellStepY.length - 1]);
};

function addBps (price, bps) {
    return (price.mul(10000 + bps).div(10000));
};

function compareRates (receivedRate, expectedRate) {
    expectedRate = expectedRate - (expectedRate % 10);
    receivedRate = receivedRate - (receivedRate % 10);
    assert.equal(expectedRate, receivedRate, "different prices");
};