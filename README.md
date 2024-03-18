# Commodity Trade Escrow

This project contains an example and test escrow contract between two parties in which a seller sells tangible commodity in exchange for a specified price in ETH or ERC-20 tokens paid by buyer.

In case of disputes an arbitrator role is defined to solve them. Arbitrator can solve the dispute both in seller or buyer favor.

The smart contract allows to create any amount of agreements.

## Installation
`npm i`

## Testing
Run test suite with: `npm run test`
or run coverage report `npm run coverage`.

## Interface
Documented in code.

## Example flows

### Successfully settled agreement with commodity delivered
1. Seller creates an agreement. `seller -> createETHagreement(...)`
2. Agreement is accepted by buyer by paying the specified price in ETH or tokens. `buyer -> pay(...)`
3. Buyer confirms that the he received the commodity. Agreement is settled. `buyer -> confirmCommodityReceival(...)`
4. Seller withdraws the funds locked by the buyer in the escrow contract. `seller -> sellerWithdrawFunds(...)`

### Refund by seller (i.e. in case of commodity return because of damage)
1. Seller creates an agreement. `seller -> createETHagreement(...)`
2. Agreement is accepted by buyer by paying the specified price in ETH or tokens. `buyer -> pay(...)`
3. Buyer returns the commodity to the seller, he does not aknowledge the receival of commodity, therefore seller decides to settle the agreement as refunded. Agreeement is settled. `seller -> sellerRefundBuyer(...)`
4. Buyer withdraws the funds he previously locked in the escrow contract. `buyer -> buyerWithdrawFunds(...)`

### Agreement closed by one side
1. Seller creates an agreement. `seller -> createETHagreement(...)`
2. Buyer does not want to participate and for formality he closes the agreement before payment. `buyer -> closeAgreement(...)`

### Calling an arbitrator to settle a dispute
1. Seller creates an agreement. `seller -> createETHagreement(...)`
2. Agreement is accepted by buyer by paying the specified price in ETH or tokens. `buyer -> pay(...)`
3. Buyer received the commodity but he does not want to aknowledge the commodity receival. Seller raises a dispute. From now on only the arbitrator is able settle the dispute. `seller -> raiseDispute(...)`
4. Arbitrator settles the dispute in favor of seller. Arbitrator confirm commodity receival by buyer. `arbitrator -> arbitratorConfirmCommodityReceival(...)`
4. Seller withdraws the funds locked by the buyer in the escrow contract. `seller -> sellerWithdrawFunds(...)`