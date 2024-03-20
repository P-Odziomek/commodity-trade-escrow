import {
  loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import hre, { ethers } from "hardhat";

const examplePrice = 0.25
const examplePriceFormatted = ethers.parseEther(examplePrice.toString());
const initialTokenMint = 1;
const initialTokenMintFormatted = ethers.parseEther(initialTokenMint.toString());

enum AgreementStatus {
  Open,
  Paid,
  InDispute,
  Settled,
  Closed
}

enum SettlementStatus {
  NotSettled,
  CommodityReceivedByBuyer,
  BuyerRefundedBySeller,
  CommodityReceivedConfirmedByArbitrator,
  BuyerRefundedByArbitrator
}

describe("CommodityTradeEscrow", function () {
  async function deployEmptyFixture() {

    const [owner, seller, buyer, arbitrator, anotherAccount] = await hre.ethers.getSigners();

    const CTE = await hre.ethers.getContractFactory("CommodityTradeEscrow");
    const cte = await CTE.deploy();

    // we deploy a erc20 token mock
    const TestToken = await hre.ethers.getContractFactory("TestToken");
    const testToken = await TestToken.deploy(owner.address);
    await testToken.mint(buyer.address, initialTokenMintFormatted);

    return { cte, testToken, seller, buyer, arbitrator, anotherAccount };
  }

  async function deployFixtureWithAgreementInETH() {
    const { cte, testToken, seller, buyer, arbitrator, anotherAccount } = await deployEmptyFixture();
    await cte.connect(seller).createETHAgreement(buyer.address, arbitrator.address, examplePriceFormatted, 'Agreement in ETH');
    return { cte, testToken, seller, buyer, arbitrator, anotherAccount }
  }

  async function deployFixtureWithAgreementInTokens() {
    const { cte, testToken, seller, buyer, arbitrator, anotherAccount } = await deployEmptyFixture();
    await cte.connect(seller).createTokenAgreement(buyer.address, arbitrator.address, await testToken.getAddress(), examplePriceFormatted, 'Agreement in Tokens');
    return { cte, testToken, seller, buyer, arbitrator, anotherAccount }
  }

  async function deployFixtureWithPaidAgreementInETH() {
    const { cte, testToken, seller, buyer, arbitrator, anotherAccount } = await deployFixtureWithAgreementInETH();
    await cte.connect(buyer).pay(0, { value: examplePriceFormatted });
    return { cte, testToken, seller, buyer, arbitrator, anotherAccount }
  }

  async function deployFixtureWithPaidAgreementInTokens() {
    const { cte, testToken, seller, buyer, arbitrator, anotherAccount } = await deployFixtureWithAgreementInTokens();
    await testToken.connect(buyer).approve(await cte.getAddress(), examplePriceFormatted);
    await cte.connect(buyer).pay(0);
    return { cte, testToken, seller, buyer, arbitrator, anotherAccount }
  }

  async function deployFixtureWithPaidAgreementInETHWithDispute() {
    const { cte, testToken, seller, buyer, arbitrator, anotherAccount } = await deployFixtureWithPaidAgreementInETH();
    await cte.connect(buyer).raiseDispute(0);
    return { cte, testToken, seller, buyer, arbitrator, anotherAccount }
  }

  function checkAgreementStatus(
    agreement: any,
    sellerAddress: any,
    buyerAddress: any,
    arbitratorAddress: any,
    price: any,
    isPaid: any,
    isWithdrawn: any,
    tokenAddress: any,
    agreementStatus: any,
    settlementStatus: any,
    data: any
  ) {
    expect(agreement.seller).to.equal(sellerAddress);
    expect(agreement.buyer).to.equal(buyerAddress);
    expect(agreement.arbitrator).to.equal(arbitratorAddress);
    expect(agreement.price).to.equal(price);
    expect(agreement.paid).to.equal(isPaid);
    expect(agreement.withdrawn).to.equal(isWithdrawn);
    expect(agreement.token).to.equal(tokenAddress);
    expect(agreement.agreementStatus).to.equal(agreementStatus);
    expect(agreement.settlementStatus).to.equal(settlementStatus);
    expect(agreement.data).to.equal(data);
  }

  describe("Create agreements", function () {
    it("Should create an agreement by seller and update index", async function () {
      const { cte, testToken, seller, buyer, arbitrator } = await loadFixture(deployEmptyFixture);
      const tx = cte.connect(seller).createTokenAgreement(buyer.address, arbitrator.address, await testToken.getAddress(), examplePriceFormatted, '');
      await expect(tx)
        .to.emit(cte, "Created")
        .withArgs(0, seller.address, buyer.address, arbitrator.address, testToken.getAddress(), examplePriceFormatted, '');
      checkAgreementStatus(
        await cte.agreements(0),
        seller.address,
        buyer.address,
        arbitrator.address,
        examplePriceFormatted,
        false,
        false,
        await testToken.getAddress(),
        AgreementStatus.Open,
        SettlementStatus.NotSettled,
        ''
      )
      expect(await cte.agreementsCurrentIndex()).to.equal(1);
    });

    it("Should not be able to create an agreement if seller is buyer", async function () {
      const { cte, testToken, seller, buyer, arbitrator, anotherAccount } = await loadFixture(deployEmptyFixture);

      const tx = cte.connect(seller).createTokenAgreement(seller.address, arbitrator.address, await testToken.getAddress(), examplePriceFormatted, '');

      await expect(tx)
        .to.be.revertedWith(
          "seller is buyer"
        );
    });

    it("Should not be able to create an agreement if an arbitrator is a party of the transaction", async function () {
      const { cte, testToken, seller, buyer, arbitrator, anotherAccount } = await loadFixture(deployEmptyFixture);

      const tx = cte.connect(seller).createTokenAgreement(arbitrator.address, arbitrator.address, await testToken.getAddress(), examplePriceFormatted, '');
      await expect(tx)
        .to.be.revertedWith(
          "arbitrator cannot be a party"
        );

      const tx2 = cte.connect(arbitrator).createTokenAgreement(buyer.address, arbitrator.address, await testToken.getAddress(), examplePriceFormatted, '');
      await expect(tx2)
        .to.be.revertedWith(
          "arbitrator cannot be a party"
        );
    });

    it("Should not be able to create an agreement if no price set", async function () {
      const { cte, testToken, seller, buyer, arbitrator, anotherAccount } = await loadFixture(deployEmptyFixture);

      const tx = cte.connect(seller).createTokenAgreement(buyer.address, arbitrator.address, await testToken.getAddress(), 0, '');

      await expect(tx)
        .to.be.revertedWith(
          "price not set"
        );
    });

    it("Should properly create multiple agreements", async function () {
      const { cte, testToken, seller, buyer, arbitrator, anotherAccount } = await loadFixture(deployEmptyFixture);

      expect(await cte.agreementsCurrentIndex()).to.equal(0);
      await cte.connect(seller).createTokenAgreement(buyer.address, arbitrator.address, testToken.getAddress(), 1, 'Order no: 3919314');
      checkAgreementStatus(
        await cte.agreements(0),
        seller.address,
        buyer.address,
        arbitrator.address,
        1,
        false,
        false,
        await testToken.getAddress(),
        AgreementStatus.Open,
        SettlementStatus.NotSettled,
        'Order no: 3919314'
      )
      expect(await cte.agreementsCurrentIndex()).to.equal(1);
      await cte.connect(seller).createTokenAgreement(anotherAccount.address, arbitrator.address, testToken.getAddress(), 15442, 'Another agreement');
      checkAgreementStatus(
        await cte.agreements(1),
        seller.address,
        anotherAccount.address,
        arbitrator.address,
        15442,
        false,
        false,
        await testToken.getAddress(),
        AgreementStatus.Open,
        SettlementStatus.NotSettled,
        'Another agreement'
      )
      expect(await cte.agreementsCurrentIndex()).to.equal(2);
      await cte.connect(anotherAccount).createTokenAgreement(buyer.address, arbitrator.address, testToken.getAddress(), 2137, '');
      checkAgreementStatus(
        await cte.agreements(2),
        anotherAccount.address,
        buyer.address,
        arbitrator.address,
        2137,
        false,
        false,
        await testToken.getAddress(),
        AgreementStatus.Open,
        SettlementStatus.NotSettled,
        ''
      )
      expect(await cte.agreementsCurrentIndex()).to.equal(3);
    });


    it("Seller can close the agreement prematurely", async function () {
      const { cte, testToken, seller, buyer, arbitrator, anotherAccount } = await loadFixture(deployFixtureWithAgreementInTokens);
      const tx = cte.connect(seller).closeAgreement(0);
      await expect(tx).to.emit(cte, "Closed")
        .withArgs(0, seller.address);
      checkAgreementStatus(
        await cte.agreements(0),
        seller.address,
        buyer.address,
        arbitrator.address,
        examplePriceFormatted,
        false,
        false,
        await testToken.getAddress(),
        AgreementStatus.Closed,
        SettlementStatus.NotSettled,
        'Agreement in Tokens'
      )
    });


    it("Buyer can close the agreement prematurely", async function () {
      const { cte, testToken, seller, buyer, arbitrator, anotherAccount } = await loadFixture(deployFixtureWithAgreementInTokens);
      const tx = cte.connect(buyer).closeAgreement(0);
      await expect(tx).to.emit(cte, "Closed")
        .withArgs(0, buyer.address);
      checkAgreementStatus(
        await cte.agreements(0),
        seller.address,
        buyer.address,
        arbitrator.address,
        examplePriceFormatted,
        false,
        false,
        await testToken.getAddress(),
        AgreementStatus.Closed,
        SettlementStatus.NotSettled,
        'Agreement in Tokens'
      )
    });

    it("Arbitrator cannot close the agreement prematurely", async function () {
      const { cte, testToken, seller, buyer, arbitrator, anotherAccount } = await loadFixture(deployFixtureWithAgreementInTokens);
      const tx = cte.connect(arbitrator).closeAgreement(0);
      await expect(tx)
        .to.be.revertedWith(
          "not a buyer or seller"
        );
    });
  });

  describe("Payments", function () {
    it("Buyer should be able to pay with ETH", async function () {
      const { cte, testToken, seller, buyer, arbitrator, anotherAccount } = await loadFixture(deployFixtureWithAgreementInETH);
      expect(await ethers.provider.getBalance(await cte.getAddress())).to.equal(0);
      const tx = cte.connect(buyer).pay(0, { value: examplePriceFormatted });
      await expect(tx).to.emit(cte, "Paid").withArgs(0, buyer.address, ethers.ZeroAddress, examplePriceFormatted);
      expect(await ethers.provider.getBalance(await cte.getAddress())).to.equal(examplePriceFormatted);
      checkAgreementStatus(
        await cte.agreements(0),
        seller.address,
        buyer.address,
        arbitrator.address,
        examplePriceFormatted,
        true,
        false,
        ethers.ZeroAddress,
        AgreementStatus.Paid,
        SettlementStatus.NotSettled,
        'Agreement in ETH'
      )
    });

    it("Buyer should be able to pay with tokens", async function () {
      const { cte, testToken, seller, buyer, arbitrator, anotherAccount } = await loadFixture(deployFixtureWithAgreementInTokens);

      await testToken.connect(buyer).approve(await cte.getAddress(), examplePriceFormatted);
      const tx = cte.connect(buyer).pay(0);
      await expect(tx).to.emit(cte, "Paid").withArgs(0, buyer.address, await testToken.getAddress(), examplePriceFormatted);
      expect(await testToken.balanceOf(await cte.getAddress())).to.equal(examplePriceFormatted);
      checkAgreementStatus(
        await cte.agreements(0),
        seller.address,
        buyer.address,
        arbitrator.address,
        examplePriceFormatted,
        true,
        false,
        await testToken.getAddress(),
        AgreementStatus.Paid,
        SettlementStatus.NotSettled,
        'Agreement in Tokens'
      )
    });

    it("Buyer should not be able to accidentaly attach ETH value when the payment is in tokens", async function () {
      const { cte, testToken, seller, buyer, arbitrator, anotherAccount } = await loadFixture(deployFixtureWithAgreementInTokens);
      const tx = cte.connect(buyer).pay(0, { value: examplePriceFormatted });
      await expect(tx)
        .to.be.revertedWith(
          "payable in tokens only"
        );
    });

    it("Should not accept payment in ETH when value different from the price is provided", async function () {
      const { cte, testToken, seller, buyer, arbitrator, anotherAccount } = await loadFixture(deployFixtureWithAgreementInETH);

      // should revert if value is less than price
      const tx = cte.connect(buyer).pay(0, { value: ethers.parseEther((examplePrice - 0.01).toString()) });
      await expect(tx)
        .to.be.revertedWith(
          "wrong amount"
        );

      // should revert if value is more than price
      const tx2 = cte.connect(buyer).pay(0, { value: ethers.parseEther((examplePrice + 0.01).toString()) });
      await expect(tx2)
        .to.be.revertedWith(
          "wrong amount"
        );
    });

    it("Buyer should not be able to pay twice", async function () {
      const { cte, testToken, seller, buyer, arbitrator, anotherAccount } = await loadFixture(deployFixtureWithAgreementInETH);

      await cte.connect(buyer).pay(0, { value: examplePriceFormatted });
      const tx = cte.connect(buyer).pay(0, { value: examplePriceFormatted });
      await expect(tx)
        .to.be.revertedWith(
          "not payable anymore"
        );
    });

    it("No one except buyer should be able to pay", async function () {
      const { cte, testToken, seller, buyer, arbitrator, anotherAccount } = await loadFixture(deployFixtureWithAgreementInETH);

      const tx = cte.connect(anotherAccount).pay(0, { value: examplePriceFormatted });
      await expect(tx)
        .to.be.revertedWith(
          "not a buyer"
        );
    });
  });

  describe("Settlements", function () {
    it("Buyer confirms commodity receival to settle the agreement", async function () {
      const { cte, testToken, seller, buyer, arbitrator, anotherAccount } = await loadFixture(deployFixtureWithPaidAgreementInETH);
      const tx = cte.connect(buyer).confirmCommodityReceival(0);
      await expect(tx).to.emit(cte, "Settled").withArgs(0, SettlementStatus.CommodityReceivedByBuyer);
      checkAgreementStatus(
        await cte.agreements(0),
        seller.address,
        buyer.address,
        arbitrator.address,
        examplePriceFormatted,
        true,
        false,
        ethers.ZeroAddress,
        AgreementStatus.Settled,
        SettlementStatus.CommodityReceivedByBuyer,
        'Agreement in ETH'
      )
    });

    it("Only the seller may withdraw funds when fully settled. Agreement in ETH.", async function () {
      const { cte, testToken, seller, buyer, arbitrator, anotherAccount } = await loadFixture(deployFixtureWithPaidAgreementInETH);
      await cte.connect(buyer).confirmCommodityReceival(0);
      
      const tx = await cte.connect(seller).sellerWithdrawFunds(0);
      await expect(tx).to.emit(cte, "FundsWithdrawn").withArgs(0, seller.address);
      checkAgreementStatus(
        await cte.agreements(0),
        seller.address,
        buyer.address,
        arbitrator.address,
        examplePriceFormatted,
        true,
        true,
        ethers.ZeroAddress,
        AgreementStatus.Settled,
        SettlementStatus.CommodityReceivedByBuyer,
        'Agreement in ETH'
      )
    });

    it("Only the seller may withdraw funds when fully settled. Agreement in Tokens.", async function () {
      const { cte, testToken, seller, buyer, arbitrator, anotherAccount } = await loadFixture(deployFixtureWithPaidAgreementInTokens);
      await cte.connect(buyer).confirmCommodityReceival(0);
      
      const tx = await cte.connect(seller).sellerWithdrawFunds(0);
      await expect(tx).to.emit(cte, "FundsWithdrawn").withArgs(0, seller.address);
      checkAgreementStatus(
        await cte.agreements(0),
        seller.address,
        buyer.address,
        arbitrator.address,
        examplePriceFormatted,
        true,
        true,
        await testToken.getAddress(),
        AgreementStatus.Settled,
        SettlementStatus.CommodityReceivedByBuyer,
        'Agreement in Tokens'
      )
      expect(await testToken.balanceOf(seller.address)).to.equal(examplePriceFormatted);
    });

    it("Seller may refund the buyer", async function () {
      const { cte, testToken, seller, buyer, arbitrator, anotherAccount } = await loadFixture(deployFixtureWithPaidAgreementInETH);
      const tx = cte.connect(seller).sellerRefundBuyer(0);
      await expect(tx).to.emit(cte, "Settled").withArgs(0, SettlementStatus.BuyerRefundedBySeller);
      checkAgreementStatus(
        await cte.agreements(0),
        seller.address,
        buyer.address,
        arbitrator.address,
        examplePriceFormatted,
        true,
        false,
        ethers.ZeroAddress,
        AgreementStatus.Settled,
        SettlementStatus.BuyerRefundedBySeller,
        'Agreement in ETH'
      )
    });

    it("Only the buyer may withdraw funds when refunded. Withdraw in ETH.", async function () {
      const { cte, testToken, seller, buyer, arbitrator, anotherAccount } = await loadFixture(deployFixtureWithPaidAgreementInETH);
      await cte.connect(seller).sellerRefundBuyer(0);

      const preWithdrawBalance = await ethers.provider.getBalance(buyer.address)
      const tx = cte.connect(buyer).buyerWithdrawFunds(0);
      await expect(tx).to.emit(cte, "FundsWithdrawn").withArgs(0, buyer.address);
      checkAgreementStatus(
        await cte.agreements(0),
        seller.address,
        buyer.address,
        arbitrator.address,
        examplePriceFormatted,
        true,
        true,
        ethers.ZeroAddress,
        AgreementStatus.Settled,
        SettlementStatus.BuyerRefundedBySeller,
        'Agreement in ETH'
      )
      const txReceipt = await ethers.provider.getTransactionReceipt((await tx).hash)
      const gasCost = txReceipt?.gasPrice * txReceipt?.gasUsed;
      const postWithdrawBalance = await ethers.provider.getBalance(buyer.address)
      expect(postWithdrawBalance).to.equal((preWithdrawBalance + BigInt(examplePriceFormatted) - gasCost).toString())
     console.log(await ethers.provider.getBalance(buyer.address))
      
    });

    it("Only the buyer may withdraw funds when refunded. Withdraw in Tokens.", async function () {
      const { cte, testToken, seller, buyer, arbitrator, anotherAccount } = await loadFixture(deployFixtureWithPaidAgreementInTokens);
      await cte.connect(seller).sellerRefundBuyer(0);
      expect(await testToken.balanceOf(buyer.address)).to.equal(ethers.parseEther((initialTokenMint - examplePrice).toString()));
      const tx = cte.connect(buyer).buyerWithdrawFunds(0);
      await expect(tx).to.emit(cte, "FundsWithdrawn").withArgs(0, buyer.address);
      checkAgreementStatus(
        await cte.agreements(0),
        seller.address,
        buyer.address,
        arbitrator.address,
        examplePriceFormatted,
        true,
        true,
        await testToken.getAddress(),
        AgreementStatus.Settled,
        SettlementStatus.BuyerRefundedBySeller,
        'Agreement in Tokens'
      )
      expect(await testToken.balanceOf(buyer.address)).to.equal(initialTokenMintFormatted);
    });
  });

  describe("Disputes", function () {
    it("Should not be able to start a dispute before pay", async function () {
      const { cte, testToken, seller, buyer, arbitrator, anotherAccount } = await deployFixtureWithAgreementInETH();

      const txSeller = cte.connect(seller).raiseDispute(0);
      await expect(txSeller)
        .to.be.revertedWith(
          "nothing to dispute"
        );

      const txBuyer = cte.connect(buyer).raiseDispute(0);
      await expect(txBuyer)
        .to.be.revertedWith(
          "nothing to dispute"
        );
    });

    it("Seller may start a dispute", async function () {
      const { cte, testToken, seller, buyer, arbitrator, anotherAccount } = await deployFixtureWithPaidAgreementInETH();

      const tx = cte.connect(seller).raiseDispute(0);
      await expect(tx).to.emit(cte, "DisputeRaised").withArgs(0, seller.address);
      checkAgreementStatus(
        await cte.agreements(0),
        seller.address,
        buyer.address,
        arbitrator.address,
        examplePriceFormatted,
        true,
        false,
        ethers.ZeroAddress,
        AgreementStatus.InDispute,
        SettlementStatus.NotSettled,
        'Agreement in ETH'
      )
    });

    it("Buyer may start a dispute", async function () {
      const { cte, testToken, seller, buyer, arbitrator, anotherAccount } = await deployFixtureWithPaidAgreementInETH();

      const tx = cte.connect(buyer).raiseDispute(0);
      await expect(tx).to.emit(cte, "DisputeRaised").withArgs(0, buyer.address);
      checkAgreementStatus(
        await cte.agreements(0),
        seller.address,
        buyer.address,
        arbitrator.address,
        examplePriceFormatted,
        true,
        false,
        ethers.ZeroAddress,
        AgreementStatus.InDispute,
        SettlementStatus.NotSettled,
        'Agreement in ETH'
      )
    });

    it("Arbitrator should be able to refund buyer", async function () {
      const { cte, testToken, seller, buyer, arbitrator, anotherAccount } = await deployFixtureWithPaidAgreementInETHWithDispute();
      const tx = cte.connect(arbitrator).arbitratorPerformRefund(0);
      await expect(tx).to.emit(cte, "Settled").withArgs(0, SettlementStatus.BuyerRefundedByArbitrator);
      checkAgreementStatus(
        await cte.agreements(0),
        seller.address,
        buyer.address,
        arbitrator.address,
        examplePriceFormatted,
        true,
        false,
        ethers.ZeroAddress,
        AgreementStatus.Settled,
        SettlementStatus.BuyerRefundedByArbitrator,
        'Agreement in ETH'
      )
    });

    it("Buyer should be able to withdraw funds when refunded by arbitrator", async function () {
      const { cte, testToken, seller, buyer, arbitrator, anotherAccount } = await deployFixtureWithPaidAgreementInETHWithDispute();
      await cte.connect(arbitrator).arbitratorPerformRefund(0);

      await cte.connect(buyer).buyerWithdrawFunds(0);
      checkAgreementStatus(
        await cte.agreements(0),
        seller.address,
        buyer.address,
        arbitrator.address,
        examplePriceFormatted,
        true,
        true,
        ethers.ZeroAddress,
        AgreementStatus.Settled,
        SettlementStatus.BuyerRefundedByArbitrator,
        'Agreement in ETH'
      )
    });

    it("Arbitrator should be able to confirm commodity receival by buyer", async function () {
      const { cte, testToken, seller, buyer, arbitrator, anotherAccount } = await deployFixtureWithPaidAgreementInETHWithDispute();
      const tx = cte.connect(arbitrator).arbitratorConfirmCommodityReceival(0);
      await expect(tx).to.emit(cte, "Settled").withArgs(0, SettlementStatus.CommodityReceivedConfirmedByArbitrator);
      checkAgreementStatus(
        await cte.agreements(0),
        seller.address,
        buyer.address,
        arbitrator.address,
        examplePriceFormatted,
        true,
        false,
        ethers.ZeroAddress,
        AgreementStatus.Settled,
        SettlementStatus.CommodityReceivedConfirmedByArbitrator,
        'Agreement in ETH'
      )
    });

    it("Seller should be able to withdraw funds when arbitrator confirmed commodity receival", async function () {
      const { cte, testToken, seller, buyer, arbitrator, anotherAccount } = await deployFixtureWithPaidAgreementInETHWithDispute();
      await cte.connect(arbitrator).arbitratorConfirmCommodityReceival(0);
      await cte.connect(seller).sellerWithdrawFunds(0);
      checkAgreementStatus(
        await cte.agreements(0),
        seller.address,
        buyer.address,
        arbitrator.address,
        examplePriceFormatted,
        true,
        true,
        ethers.ZeroAddress,
        AgreementStatus.Settled,
        SettlementStatus.CommodityReceivedConfirmedByArbitrator,
        'Agreement in ETH'
      )
    });
  });
});
