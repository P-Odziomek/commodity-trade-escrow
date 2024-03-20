// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title Escrow contract for setting up buy/sell agreements
 * @author P.Odziomek
 * @notice This contract allows to set up an agreement between two parties for selling a commodity
 * in exchange for ETH or ERC20 tokens. Supports disputes and resolving them by an arbitrator.
 */
contract CommodityTradeEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /** DEFINITIONS */
    /**
     * @notice Struct used for holding agreements' data in storage.
     */
    struct Agreement {
        address payable seller; // address of the seller, by default the account that creates agreement
        address payable buyer; // address of the buyer
        address arbitrator; // in case of disputes, the account that decides of settlement
        uint256 price; // commodity price
        bool paid; // if the commodity price has been paid
        bool withdrawn; // if the paid value has been withdrawn by an eligible side
        address token; // address of the token in which price is paid, address(0) if ETH
        AgreementStatus agreementStatus; // status of the agreement
        SettlementStatus settlementStatus; // status of the settlement
        string data; // any additional information related to the agreement
    }

    enum AgreementStatus {
        Open, // new agreement is created
        Paid, // buyer paid the necessary amount
        InDispute, // any party calls for an arbitrator to settle the transaction on their behalf
        Settled, // both parties agree that the agreement is settled, funds are unlocked for one of the parties
        Closed // agreement was closed by one party before payment done
    }

    enum SettlementStatus {
        NotSettled, // agreement still in progress
        CommodityReceivedByBuyer, // buyer confirmed that he received the paid commodity
        BuyerRefundedBySeller, // seller refunded the buyer
        CommodityReceivedConfirmedByArbitrator, // arbitrator confirmed that buyer received the commodity
        BuyerRefundedByArbitrator // arbitrator refunded the buyer
    }

    /** PROPERTIES */
    mapping(uint256 => Agreement) public agreements; // holds the list of all agreements
    uint256 public agreementsCurrentIndex; // iterator for agreement id

    /** EVENTS */
    event Created(
        uint256 agreementId,
        address seller,
        address buyer,
        address arbitrator,
        address token,
        uint256 price,
        string data
    );
    event Paid(
        uint256 agreementId,
        address buyer,
        address token,
        uint256 price
    );
    event DisputeRaised(uint256 agreementId, address caller);
    event Settled(uint256 agreementId, SettlementStatus status);
    event Closed(uint256 agreementId, address caller);
    event FundsWithdrawn(uint256 agreementId, address beneficiary);

    /*****************************
     * SELLER specific functions *
     *****************************/
    /**
     * @notice Seller creates an agreement to sell a commodity for ETH
     * @param buyer address of the buyer
     * @param arbitrator address of an arbitrator
     * @param price price of the commodity
     * @param agreementData any additional human readable information about the agreement
     */
    function createETHAgreement(
        address buyer,
        address arbitrator,
        uint256 price,
        string calldata agreementData
    ) external {
        createAgreement(
            msg.sender,
            buyer,
            arbitrator,
            address(0), // we treat address zero as ETH
            price,
            agreementData
        );
    }

    /**
     * @notice Seller creates an agreement to sell a commodity for any ERC-20 token
     * @param buyer address of the buyer
     * @param arbitrator address of an arbitrator
     * @param price price of the commodity
     * @param agreementData any additional human readable information about the agreement
     */
    function createTokenAgreement(
        address buyer,
        address arbitrator,
        address token,
        uint256 price,
        string calldata agreementData
    ) external {
        // here we treat address zero as invalid token address
        require(token != address(0), "wrong token address");
        createAgreement(
            msg.sender,
            buyer,
            arbitrator,
            token,
            price,
            agreementData
        );
    }

    /**
     * Initiates the new commodity transaction agreement.
     * @param seller seller of the commodity
     * @param buyer buyer of the commodity
     * @param arbitrator account that will resolve disputes if raised
     * @param token the ERC20 token address or Zero address if the price is to be paid in ETH
     * @param price price of the commodity. Needs to be paid in full by the buyer
     */
    function createAgreement(
        address seller,
        address buyer,
        address arbitrator,
        address token,
        uint256 price,
        string calldata agreementData
    ) internal {
        require(buyer != address(0), "invalid buyer address");
        require(buyer != seller, "seller is buyer");
        require(
            buyer != arbitrator && seller != arbitrator,
            "arbitrator cannot be a party"
        );
        require(arbitrator != address(0), "invalid arbitrator address");
        require(price != 0, "price not set");

        Agreement memory agreement;
        agreement.seller = payable(seller);
        agreement.buyer = payable(buyer);
        agreement.arbitrator = arbitrator;
        agreement.price = price;
        agreement.paid = false;
        agreement.withdrawn = false;
        agreement.token = token;
        agreement.data = agreementData;

        uint256 index = agreementsCurrentIndex++;
        agreements[index] = agreement;

        emit Created(
            index,
            seller,
            buyer,
            arbitrator,
            token,
            price,
            agreementData
        );
    }

    /**
     * @notice Seller refunds the buyer and settles the agreement
     * @param agreementId id of the agreement
     */
    function sellerRefundBuyer(
        uint256 agreementId
    ) external onlySeller(agreementId) {
        Agreement storage agreement = agreements[agreementId];

        require(
            agreement.agreementStatus == AgreementStatus.Paid,
            "cannot refund"
        );

        agreement.agreementStatus = AgreementStatus.Settled;
        agreement.settlementStatus = SettlementStatus.BuyerRefundedBySeller;

        emit Settled(agreementId, SettlementStatus.BuyerRefundedBySeller);
    }

    /**
     * @notice if the transaction is set as settled, seller is eligible to withdraw the paid amount
     * @param agreementId id of the agreement
     */
    function sellerWithdrawFunds(
        uint256 agreementId
    ) external onlySeller(agreementId) nonReentrant {
        Agreement storage agreement = agreements[agreementId];
        require(agreement.agreementStatus == AgreementStatus.Settled);
        require(
            agreement.settlementStatus ==
                SettlementStatus.CommodityReceivedByBuyer ||
                agreement.settlementStatus ==
                SettlementStatus.CommodityReceivedConfirmedByArbitrator,
            "not eligible to redeem"
        );
        require(!agreement.withdrawn, "already redeemed");

        agreement.withdrawn = true;
        if (agreement.token == address(0)) {
            (bool success, ) = agreement.seller.call{value: agreement.price}("");
            require(success, "eth transfer failed");
        } else {
            IERC20(agreement.token).safeTransfer(
                agreement.seller,
                agreement.price
            );
        }

        emit FundsWithdrawn(agreementId, msg.sender);
    }

    /*****************************
     * BUYER specific operations *
     *****************************/

    /**
     * @notice buyer pays the price of the commodity in an agreed currency.
     * Proper value should be attached when buying with ETH
     * or
     * proper approve should be done on the payment ERC20 token beforehand.
     * @param agreementId id of the agreement
     */
    function pay(
        uint256 agreementId
    ) external payable onlyBuyer(agreementId) nonReentrant {
        Agreement storage agreement = agreements[agreementId];

        require(
            agreement.agreementStatus == AgreementStatus.Open,
            "not payable anymore"
        );

        agreement.paid = true;
        agreement.agreementStatus = AgreementStatus.Paid;
        if (address(agreement.token) == address(0)) {
            require(msg.value == agreement.price, "wrong amount");
        } else {
            require(msg.value == 0, "payable in tokens only");
            IERC20(agreement.token).safeTransferFrom(
                agreement.buyer,
                address(this),
                agreement.price
            );
        }

        emit Paid(
            agreementId,
            msg.sender,
            address(agreement.token),
            agreement.price
        );
    }

    /**
     * @notice Buyer acknowleges the receival of commodity and settles the agreement.
     * @param agreementId id of the agreement
     */
    function confirmCommodityReceival(
        uint256 agreementId
    ) external onlyBuyer(agreementId) {
        Agreement storage agreement = agreements[agreementId];

        require(agreement.agreementStatus == AgreementStatus.Paid);

        agreement.agreementStatus = AgreementStatus.Settled;
        agreement.settlementStatus = SettlementStatus.CommodityReceivedByBuyer;

        emit Settled(agreementId, SettlementStatus.CommodityReceivedByBuyer);
    }

    /**
     * @notice if the transaction is set as refunded, buyer may withdraw the paid amount
     * @param agreementId id of the agreement
     */
    function buyerWithdrawFunds(
        uint256 agreementId
    ) external onlyBuyer(agreementId) nonReentrant {
        Agreement storage agreement = agreements[agreementId];

        require(agreement.agreementStatus == AgreementStatus.Settled);
        require(
            agreement.settlementStatus ==
                SettlementStatus.BuyerRefundedBySeller ||
                agreement.settlementStatus ==
                SettlementStatus.BuyerRefundedByArbitrator,
            "not eligible to redeem"
        );
        require(!agreement.withdrawn, "already redeemed");

        agreement.withdrawn = true;
        if (agreement.token == address(0)) {
            (bool success, ) = agreement.buyer.call{value: agreement.price}("");
            require(success, "eth transfer failed");
        } else {
            IERC20(agreement.token).safeTransfer(
                agreement.buyer,
                agreement.price
            );
        }

        emit FundsWithdrawn(agreementId, msg.sender);
    }

    /*********************
     * COMMON operations *
     *********************/
    /**
     * @notice Buyer or seller may raise a dispute. Disputes may be raised only after the price has been
     * paid by the buyer and no other actions have been taken
     * @param agreementId id of the agreement
     */
    function raiseDispute(
        uint256 agreementId
    ) external onlyBuyerOrSeller(agreementId) {
        Agreement storage agreement = agreements[agreementId];
        
        require(
            agreement.agreementStatus == AgreementStatus.Paid && agreement.paid,
            "nothing to dispute"
        
        );
        
        agreement.agreementStatus = AgreementStatus.InDispute;
        
        emit DisputeRaised(agreementId, msg.sender);
    }

    /**
     * @notice Buyer or Seller closes the agreement before any other action is done.
     * This states that the agreement is no longer valid and should not be proceeded.
     * @param agreementId id of the agreement
     */
    function closeAgreement(
        uint256 agreementId
    ) external onlyBuyerOrSeller(agreementId) {
        Agreement storage agreement = agreements[agreementId];
        
        require(
            agreement.agreementStatus == AgreementStatus.Open,
            "not available to close"
        );
        
        agreement.agreementStatus = AgreementStatus.Closed;
        
        emit Closed(agreementId, msg.sender);
    }

    /**********************************
     * ARBITRATOR specific operations *
     **********************************/

    /**
     * @notice When in dispute Arbitrator may perform a refund to the buyer
     * stating that the transaction was not properly settled by the seller
     * @param agreementId id of the agreement
     */
    function arbitratorPerformRefund(
        uint256 agreementId
    ) external onlyArbitrator(agreementId) {
        Agreement storage agreement = agreements[agreementId];
        
        require(agreement.agreementStatus == AgreementStatus.InDispute);
        
        agreement.agreementStatus = AgreementStatus.Settled;
        agreement.settlementStatus = SettlementStatus.BuyerRefundedByArbitrator;
        
        emit Settled(agreementId, SettlementStatus.BuyerRefundedByArbitrator);
    }

    /**
     * @notice When in dispute Arbitrator may settle the transaction on behalf
     * of the buyer, when the buyer does not wish to settle the transaction on
     * his side.
     */
    function arbitratorConfirmCommodityReceival(
        uint256 agreementId
    ) external onlyArbitrator(agreementId) {
        Agreement storage agreement = agreements[agreementId];
        
        require(agreement.agreementStatus == AgreementStatus.InDispute);
        
        agreement.agreementStatus = AgreementStatus.Settled;
        agreement.settlementStatus = SettlementStatus
            .CommodityReceivedConfirmedByArbitrator;
        
        emit Settled(
            agreementId,
            SettlementStatus.CommodityReceivedConfirmedByArbitrator
        );
    }

    /*************
     * MODIFIERS *
     *************/

    modifier onlyBuyer(uint256 agreementId) {
        Agreement storage agreement = agreements[agreementId];
        
        require(msg.sender == agreement.buyer, "not a buyer");
        _;
    }

    modifier onlySeller(uint256 agreementId) {
        Agreement storage agreement = agreements[agreementId];
        
        require(msg.sender == agreement.seller, "not a seller");
        _;
    }

    modifier onlyBuyerOrSeller(uint256 agreementId) {
        Agreement storage agreement = agreements[agreementId];
        
        require(
            msg.sender == agreement.seller || msg.sender == agreement.buyer,
            "not a buyer or seller"
        );
        _;
    }

    modifier onlyArbitrator(uint256 agreementId) {
        Agreement storage agreement = agreements[agreementId];
        
        require(msg.sender == agreement.arbitrator, "not an arbitrator");
        _;
    }
}
