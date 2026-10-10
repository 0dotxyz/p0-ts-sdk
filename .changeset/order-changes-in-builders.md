---
"@0dotxyz/p0-ts-sdk": minor
---

Order closes and placement in the transaction builders, so the built transactions, and a simulation of them, include the order changes that land with the action:

- **Closes:** the deposit, repay, withdraw and borrow builders (every venue), `makeLoopTx`, `makeSwapCollateralTx`, `makeSwapDebtTx`, `makeRepayWithCollatTx`, `makeRollPtTx`, the `makeBridged*Tx` variants, `makeBulkWithdrawTx`, `makeBulkRepayTx` and `makeTransferPositionsTx` take `ordersToClose` (order PDAs); `makeTransferPositionsTx` also takes `destinationOrdersToClose`. Single-transaction builders put the closes in front of the action and throw the new `ORDER_CLOSES_DONT_FIT` when they don't fit; a close is never left out (the premium refresh is dropped first). Flashloan builders add one transaction after the action, throwing `ORDER_CLOSES_DONT_FIT` past that; bulk builders pack the closes in with the action and bundle a batch that splits.
- **Placement:** `makeLoopTx` and `makeBridgedLoopTx` take `placeOrder`, the trigger of a take-profit / stop-loss order to place on the loop's pair after the loop. Put the pair's existing order in `ordersToClose` to replace it.
- **`makeOrderChangesTx`:** builds the one order transaction to run after an action, e.g. to add a loop's order to transactions built earlier without a new quote. `composeBridgedSwap` takes `reservedTxs` to leave bundle slots for appended transactions.
- **`mustBeAtomicBundle`:** the flashloan builders (`makeLoopTx`, `makeSwapCollateralTx`, `makeSwapDebtTx`, `makeRepayWithCollatTx`, `makeRollPtTx`, `makeTransferPositionsTx`) now set it whenever they return more than one transaction, including when the only extra one is the ATA setup.
