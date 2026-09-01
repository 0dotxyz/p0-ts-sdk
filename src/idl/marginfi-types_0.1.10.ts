/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/marginfi.json`.
 */
export type Marginfi = {
  "address": string,
  "metadata": {
    "name": "marginfi",
    "version": "0.1.10",
    "spec": "0.1.0",
    "description": "Borrow Lending Prime Broker"
  },
  "instructions": [
    {
      "name": "adminCloseAccount",
      "docs": [
        "(permissionless) Close an account that is empty, inactive for >60 days, and has no",
        "blocking state flags. Rent is returned to the group's global fee wallet."
      ],
      "discriminator": [
        131,
        60,
        75,
        215,
        109,
        34,
        157,
        26
      ],
      "accounts": [
        {
          "name": "group",
          "relations": [
            "marginfiAccount"
          ]
        },
        {
          "name": "marginfiAccount",
          "writable": true
        },
        {
          "name": "globalFeeWallet",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "configGroupFee",
      "docs": [
        "(global fee admin only) Enable or disable program fees for any group. Does not require the",
        "group admin to sign: the global fee state admin can turn program fees on or off for any",
        "group"
      ],
      "discriminator": [
        231,
        205,
        66,
        242,
        220,
        87,
        145,
        38
      ],
      "accounts": [
        {
          "name": "marginfiGroup",
          "writable": true
        },
        {
          "name": "globalFeeAdmin",
          "docs": [
            "`global_fee_admin` of the FeeState"
          ],
          "signer": true,
          "relations": [
            "feeState"
          ]
        },
        {
          "name": "feeState",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "enableProgramFee",
          "type": "bool"
        }
      ]
    },
    {
      "name": "configureBankRateLimits",
      "docs": [
        "(admin or delegate_limit_admin) Configure bank-level rate limits for withdraw/borrow.",
        "Rate limits track net outflow in native tokens. Deposits offset withdraws.",
        "Set to 0 to disable. Hourly and daily windows are independent."
      ],
      "discriminator": [
        175,
        84,
        85,
        221,
        206,
        220,
        110,
        174
      ],
      "accounts": [
        {
          "name": "group",
          "relations": [
            "bank"
          ]
        },
        {
          "name": "admin",
          "signer": true
        },
        {
          "name": "bank",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "hourlyMaxOutflow",
          "type": {
            "option": "u64"
          }
        },
        {
          "name": "dailyMaxOutflow",
          "type": {
            "option": "u64"
          }
        }
      ]
    },
    {
      "name": "configureDeleverageWithdrawalLimit",
      "docs": [
        "(admin or delegate_limit_admin) Set the daily withdrawal limit for deleverages per group."
      ],
      "discriminator": [
        28,
        132,
        205,
        158,
        67,
        77,
        177,
        63
      ],
      "accounts": [
        {
          "name": "marginfiGroup",
          "writable": true
        },
        {
          "name": "admin",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "limit",
          "type": "u32"
        }
      ]
    },
    {
      "name": "configureGroupRateLimits",
      "docs": [
        "(admin or delegate_limit_admin) Configure group-level rate limits for withdraw/borrow.",
        "Rate limits track aggregate net outflow in USD.",
        "Example: $10M = 10_000_000. Set to 0 to disable."
      ],
      "discriminator": [
        111,
        47,
        213,
        142,
        158,
        51,
        226,
        102
      ],
      "accounts": [
        {
          "name": "marginfiGroup",
          "writable": true
        },
        {
          "name": "admin",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "hourlyMaxOutflowUsd",
          "type": {
            "option": "u64"
          }
        },
        {
          "name": "dailyMaxOutflowUsd",
          "type": {
            "option": "u64"
          }
        }
      ]
    },
    {
      "name": "disableStakedOracles",
      "docs": [
        "(admin only) Disable stake pricing, i.e. effectively forbidding all operations involving stake banks.",
        "To be used during the rollout of the SVSP upgrade.",
        "To be removed once SVSP update is rolled out (likely in 1.10)"
      ],
      "discriminator": [
        43,
        90,
        152,
        55,
        66,
        101,
        232,
        200
      ],
      "accounts": [
        {
          "name": "group"
        },
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "group"
          ]
        },
        {
          "name": "stakedSettings",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  107,
                  101,
                  100,
                  95,
                  115,
                  101,
                  116,
                  116,
                  105,
                  110,
                  103,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "group"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "driftClaimBadDebt",
      "docs": [
        "(permissionless) Claim a Drift bad-debt portal allocation for a Drift bank.",
        "The merkle claimant is the bank's liquidity_vault_authority PDA, and claimed tokens are",
        "swept to the global fee wallet's canonical ATA."
      ],
      "discriminator": [
        163,
        67,
        144,
        231,
        119,
        20,
        220,
        33
      ],
      "accounts": [
        {
          "name": "payer",
          "docs": [
            "Pays transaction fees, ATA creation, and ClaimStatus rent."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "bank"
        },
        {
          "name": "feeState",
          "docs": [
            "Global fee state containing the global_fee_wallet destination owner."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "liquidityVaultAuthority",
          "docs": [
            "The bank's liquidity vault authority. This PDA is the claimant in Drift's merkle tree."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  113,
                  117,
                  105,
                  100,
                  105,
                  116,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "integrationAcc2",
          "docs": [
            "Drift user account owned by liquidity_vault_authority."
          ],
          "relations": [
            "bank"
          ]
        },
        {
          "name": "integrationAcc3",
          "docs": [
            "Drift user stats account owned by liquidity_vault_authority."
          ],
          "relations": [
            "bank"
          ]
        },
        {
          "name": "distributor",
          "writable": true
        },
        {
          "name": "claimStatus",
          "docs": [
            "program. The distributor initializes and validates this account."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  67,
                  108,
                  97,
                  105,
                  109,
                  83,
                  116,
                  97,
                  116,
                  117,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "liquidityVaultAuthority"
              },
              {
                "kind": "account",
                "path": "distributor"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                146,
                236,
                26,
                197,
                144,
                103,
                53,
                152,
                100,
                169,
                178,
                41,
                101,
                122,
                227,
                41,
                118,
                44,
                195,
                207,
                0,
                4,
                127,
                191,
                210,
                197,
                189,
                231,
                111,
                46,
                30,
                226
              ]
            }
          }
        },
        {
          "name": "from",
          "docs": [
            "Distributor token vault."
          ],
          "writable": true
        },
        {
          "name": "claimMint"
        },
        {
          "name": "globalFeeWallet"
        },
        {
          "name": "claimantTokenAccount",
          "docs": [
            "Canonical ATA for the claim mint owned by liquidity_vault_authority."
          ],
          "writable": true
        },
        {
          "name": "destinationTokenAccount",
          "docs": [
            "Canonical ATA for the claim mint owned by FeeState.global_fee_wallet."
          ],
          "writable": true
        },
        {
          "name": "merkleDistributorProgram",
          "address": "AtXLVASdFhmdq2KZxzhVFonmNXL76dTTsEABXySEHgLh"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "proof",
          "type": {
            "vec": {
              "array": [
                "u8",
                32
              ]
            }
          }
        }
      ]
    },
    {
      "name": "driftDeposit",
      "docs": [
        "(user) Deposit into a Drift spot market through a marginfi account",
        "* amount - in the underlying token (e.g., USDC), in native decimals"
      ],
      "discriminator": [
        252,
        63,
        250,
        201,
        98,
        55,
        130,
        12
      ],
      "accounts": [
        {
          "name": "group",
          "relations": [
            "marginfiAccount",
            "bank"
          ]
        },
        {
          "name": "marginfiAccount",
          "writable": true
        },
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "bank",
          "writable": true
        },
        {
          "name": "driftOracle",
          "docs": [
            "The oracle account for the asset (not needed if using oracle type QuoteAsset)"
          ],
          "optional": true
        },
        {
          "name": "liquidityVaultAuthority",
          "docs": [
            "The bank's liquidity vault authority, which owns the Drift user account"
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  113,
                  117,
                  105,
                  100,
                  105,
                  116,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "liquidityVault",
          "docs": [
            "Used as an intermediary to deposit tokens into Drift"
          ],
          "writable": true,
          "relations": [
            "bank"
          ]
        },
        {
          "name": "signerTokenAccount",
          "docs": [
            "Owned by authority, the source account for the token deposit"
          ],
          "writable": true
        },
        {
          "name": "driftState",
          "docs": [
            "The Drift state account"
          ]
        },
        {
          "name": "integrationAcc2",
          "docs": [
            "The Drift user account owned by liquidity_vault_authority"
          ],
          "writable": true,
          "relations": [
            "bank"
          ]
        },
        {
          "name": "integrationAcc3",
          "docs": [
            "The Drift user stats account owned by liquidity_vault_authority"
          ],
          "writable": true,
          "relations": [
            "bank"
          ]
        },
        {
          "name": "integrationAcc1",
          "docs": [
            "The Drift spot market for this asset"
          ],
          "writable": true,
          "relations": [
            "bank"
          ]
        },
        {
          "name": "driftSpotMarketVault",
          "docs": [
            "The Drift spot market vault that will receive tokens"
          ],
          "writable": true
        },
        {
          "name": "mint",
          "docs": [
            "Bank's liquidity token mint"
          ],
          "relations": [
            "bank"
          ]
        },
        {
          "name": "driftProgram",
          "address": "dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "driftHarvestReward",
      "docs": [
        "(permissionless) Harvest rewards from admin deposits in Drift spot markets.",
        "Rewards are always sent to the global fee wallet's canonical ATA.",
        "The harvest spot market must be different from the bank's main drift spot market."
      ],
      "discriminator": [
        167,
        161,
        240,
        194,
        138,
        54,
        87,
        189
      ],
      "accounts": [
        {
          "name": "bank"
        },
        {
          "name": "feeState",
          "docs": [
            "Global fee state that contains the global_fee_wallet"
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "liquidityVaultAuthority",
          "docs": [
            "The bank's liquidity vault authority"
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  113,
                  117,
                  105,
                  100,
                  105,
                  116,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "intermediaryTokenAccount",
          "docs": [
            "To create this manually just send some of the reward token",
            "to the liquidity vault authority address before claiming"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "liquidityVaultAuthority"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "rewardMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "destinationTokenAccount",
          "docs": [
            "Destination token account must be owned by the global fee wallet"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "feeState"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "rewardMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "driftState",
          "docs": [
            "Drift accounts"
          ]
        },
        {
          "name": "integrationAcc2",
          "writable": true,
          "relations": [
            "bank"
          ]
        },
        {
          "name": "integrationAcc3",
          "writable": true,
          "relations": [
            "bank"
          ]
        },
        {
          "name": "harvestDriftSpotMarket",
          "docs": [
            "The harvest spot market - MUST be different from bank's Drift spot market (integration_acc_1)",
            "This is the market that contains admin deposits to harvest"
          ],
          "writable": true
        },
        {
          "name": "harvestDriftSpotMarketVault",
          "docs": [
            "The harvest spot market vault - derived from harvest_drift_spot_market"
          ],
          "writable": true
        },
        {
          "name": "driftSigner",
          "docs": [
            "The Drift signer PDA"
          ]
        },
        {
          "name": "rewardMint"
        },
        {
          "name": "driftProgram",
          "address": "dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH"
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "driftInitUser",
      "docs": [
        "(permissionless) Initialize a Drift user and user stats for a marginfi bank",
        "Creates user with sub_account_id = 0 and empty name",
        "Requires a minimum deposit to ensure the account remains active",
        "* amount - minimum deposit amount (at least 10 units) in native decimals"
      ],
      "discriminator": [
        29,
        18,
        236,
        190,
        29,
        254,
        114,
        169
      ],
      "accounts": [
        {
          "name": "feePayer",
          "docs": [
            "Pays to init the drift user and user stats accounts and provides initial deposit"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "signerTokenAccount",
          "docs": [
            "The fee payer must provide a nominal amount of bank tokens so the account is not empty.",
            "This amount is irrecoverable and will prevent the account from being closed."
          ],
          "writable": true
        },
        {
          "name": "bank"
        },
        {
          "name": "liquidityVaultAuthority",
          "docs": [
            "The liquidity vault authority (PDA that will own the Drift user)"
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  113,
                  117,
                  105,
                  100,
                  105,
                  116,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "liquidityVault",
          "docs": [
            "Used as an intermediary to deposit a nominal amount of token into Drift."
          ],
          "writable": true,
          "relations": [
            "bank"
          ]
        },
        {
          "name": "mint",
          "docs": [
            "Bank's liquidity token mint (e.g., USDC)"
          ],
          "writable": true,
          "relations": [
            "bank"
          ]
        },
        {
          "name": "integrationAcc3",
          "docs": [
            "The user stats account to be created"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  101,
                  114,
                  95,
                  115,
                  116,
                  97,
                  116,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "liquidityVaultAuthority"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                9,
                84,
                219,
                190,
                158,
                201,
                96,
                201,
                138,
                122,
                41,
                63,
                226,
                19,
                54,
                150,
                111,
                225,
                128,
                209,
                81,
                174,
                75,
                129,
                121,
                86,
                31,
                137,
                133,
                74,
                83,
                246
              ]
            }
          },
          "relations": [
            "bank"
          ]
        },
        {
          "name": "integrationAcc2",
          "docs": [
            "The user account to be created (sub_account_id = 0)"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "liquidityVaultAuthority"
              },
              {
                "kind": "const",
                "value": [
                  0,
                  0
                ]
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                9,
                84,
                219,
                190,
                158,
                201,
                96,
                201,
                138,
                122,
                41,
                63,
                226,
                19,
                54,
                150,
                111,
                225,
                128,
                209,
                81,
                174,
                75,
                129,
                121,
                86,
                31,
                137,
                133,
                74,
                83,
                246
              ]
            }
          },
          "relations": [
            "bank"
          ]
        },
        {
          "name": "driftState",
          "writable": true
        },
        {
          "name": "integrationAcc1",
          "writable": true,
          "relations": [
            "bank"
          ]
        },
        {
          "name": "driftSpotMarketVault",
          "docs": [
            "The Drift spot market vault where tokens will be deposited"
          ],
          "writable": true
        },
        {
          "name": "driftOracle",
          "docs": [
            "Oracle for the asset (can be null for USDC/market 0)"
          ],
          "optional": true
        },
        {
          "name": "driftProgram",
          "address": "dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "driftWithdraw",
      "docs": [
        "(user) Withdraw from a Drift spot market through a marginfi account",
        "* amount - in the underlying token (e.g., USDC), in native decimals",
        "* if group rate limits are enabled, include the withdrawn bank's oracle group in",
        "`remaining_accounts`",
        "* withdraw_all - if true, withdraws entire position"
      ],
      "discriminator": [
        86,
        59,
        186,
        123,
        183,
        181,
        234,
        137
      ],
      "accounts": [
        {
          "name": "group",
          "relations": [
            "marginfiAccount",
            "bank"
          ]
        },
        {
          "name": "marginfiAccount",
          "writable": true
        },
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "bank",
          "writable": true
        },
        {
          "name": "driftOracle",
          "docs": [
            "The oracle account for the asset (not needed if using oracle type QuoteAsset)"
          ],
          "optional": true
        },
        {
          "name": "liquidityVaultAuthority",
          "docs": [
            "The bank's liquidity vault authority, which owns the Drift user account"
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  113,
                  117,
                  105,
                  100,
                  105,
                  116,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "liquidityVault",
          "docs": [
            "Receives tokens from Drift withdrawal"
          ],
          "writable": true,
          "relations": [
            "bank"
          ]
        },
        {
          "name": "destinationTokenAccount",
          "docs": [
            "Token account that will receive the withdrawn tokens"
          ],
          "writable": true
        },
        {
          "name": "driftState",
          "docs": [
            "The Drift state account"
          ]
        },
        {
          "name": "integrationAcc2",
          "docs": [
            "The Drift user account owned by liquidity_vault_authority"
          ],
          "writable": true,
          "relations": [
            "bank"
          ]
        },
        {
          "name": "integrationAcc3",
          "docs": [
            "The Drift user stats account owned by liquidity_vault_authority"
          ],
          "writable": true,
          "relations": [
            "bank"
          ]
        },
        {
          "name": "integrationAcc1",
          "docs": [
            "The Drift spot market for this asset"
          ],
          "writable": true,
          "relations": [
            "bank"
          ]
        },
        {
          "name": "driftSpotMarketVault",
          "docs": [
            "The Drift spot market vault that holds tokens"
          ],
          "writable": true
        },
        {
          "name": "driftRewardOracle",
          "docs": [
            "Optional: Oracle for first reward asset (only needed if rewards exist)"
          ],
          "optional": true
        },
        {
          "name": "driftRewardSpotMarket",
          "docs": [
            "Optional: Spot market for first reward asset (only needed if rewards exist)"
          ],
          "optional": true
        },
        {
          "name": "driftRewardMint",
          "docs": [
            "Optional: Mint for first reward asset (only needed if rewards exist)"
          ],
          "optional": true
        },
        {
          "name": "driftRewardOracle2",
          "docs": [
            "Optional: Oracle for second reward asset (backup in case multiple rewards)"
          ],
          "optional": true
        },
        {
          "name": "driftRewardSpotMarket2",
          "docs": [
            "Optional: Spot market for second reward asset (backup in case multiple rewards)"
          ],
          "optional": true
        },
        {
          "name": "driftRewardMint2",
          "docs": [
            "Optional: Mint for second reward asset (backup in case multiple rewards)"
          ],
          "optional": true
        },
        {
          "name": "driftSigner",
          "docs": [
            "The Drift signer PDA"
          ]
        },
        {
          "name": "mint",
          "docs": [
            "Bank's liquidity token mint"
          ],
          "relations": [
            "bank"
          ]
        },
        {
          "name": "driftProgram",
          "address": "dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "withdrawAll",
          "type": {
            "option": "bool"
          }
        }
      ]
    },
    {
      "name": "editGlobalFeeState",
      "docs": [
        "(global fee admin only) Adjust fees, admin, wallet, or pause delegate admin"
      ],
      "discriminator": [
        52,
        62,
        35,
        129,
        93,
        69,
        165,
        202
      ],
      "accounts": [
        {
          "name": "globalFeeAdmin",
          "docs": [
            "Admin of the global FeeState"
          ],
          "signer": true,
          "relations": [
            "feeState"
          ]
        },
        {
          "name": "feeState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "admin",
          "type": {
            "option": "pubkey"
          }
        },
        {
          "name": "feeWallet",
          "type": {
            "option": "pubkey"
          }
        },
        {
          "name": "bankInitFlatSolFee",
          "type": {
            "option": "u32"
          }
        },
        {
          "name": "liquidationFlatSolFee",
          "type": {
            "option": "u32"
          }
        },
        {
          "name": "orderInitFlatSolFee",
          "type": {
            "option": "u32"
          }
        },
        {
          "name": "programFeeFixed",
          "type": {
            "option": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          }
        },
        {
          "name": "programFeeRate",
          "type": {
            "option": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          }
        },
        {
          "name": "liquidationMaxFee",
          "type": {
            "option": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          }
        },
        {
          "name": "orderExecutionMaxFee",
          "type": {
            "option": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          }
        },
        {
          "name": "pauseDelegateAdmin",
          "type": {
            "option": "pubkey"
          }
        },
        {
          "name": "accountTransferFee",
          "type": {
            "option": "u32"
          }
        }
      ]
    },
    {
      "name": "editStakedSettings",
      "docs": [
        "(admin only) Edit the staked collateral settings for the group."
      ],
      "discriminator": [
        11,
        108,
        215,
        87,
        240,
        9,
        66,
        241
      ],
      "accounts": [
        {
          "name": "marginfiGroup",
          "relations": [
            "stakedSettings"
          ]
        },
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "marginfiGroup"
          ]
        },
        {
          "name": "stakedSettings",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "settings",
          "type": {
            "defined": {
              "name": "stakedSettingsEditConfig"
            }
          }
        }
      ]
    },
    {
      "name": "enableStakedOracleOnramp",
      "docs": [
        "(admin only) Enable SPL single-pool on-ramp lamports in staked-collateral oracle pricing.",
        "To be removed once SVSP update is rolled out (likely in 1.10)",
        "This flips a per-group config flag so that every staked oracle uses the canonical single-pool NAV",
        "formula."
      ],
      "discriminator": [
        114,
        248,
        244,
        6,
        74,
        212,
        222,
        230
      ],
      "accounts": [
        {
          "name": "group"
        },
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "group"
          ]
        },
        {
          "name": "stakedSettings",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  107,
                  101,
                  100,
                  95,
                  115,
                  101,
                  116,
                  116,
                  105,
                  110,
                  103,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "group"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "endDeleverage",
      "docs": [
        "(risk_admin only) End forced deleverage. Validates health did not worsen."
      ],
      "discriminator": [
        114,
        14,
        250,
        143,
        252,
        104,
        214,
        209
      ],
      "accounts": [
        {
          "name": "marginfiAccount",
          "writable": true
        },
        {
          "name": "liquidationRecord",
          "writable": true,
          "relations": [
            "marginfiAccount"
          ]
        },
        {
          "name": "group",
          "relations": [
            "marginfiAccount"
          ]
        },
        {
          "name": "riskAdmin",
          "signer": true,
          "relations": [
            "group"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "endLiquidation",
      "docs": [
        "(liquidation_receiver, set in start_liquidation) End receivership liquidation. Validates",
        "health improved and seized assets are within fee limits. Charges a flat SOL fee."
      ],
      "discriminator": [
        110,
        11,
        244,
        54,
        229,
        181,
        22,
        184
      ],
      "accounts": [
        {
          "name": "marginfiAccount",
          "docs": [
            "Account under liquidation"
          ],
          "writable": true
        },
        {
          "name": "liquidationRecord",
          "docs": [
            "The associated liquidation record PDA for the given `marginfi_account`"
          ],
          "writable": true,
          "relations": [
            "marginfiAccount"
          ]
        },
        {
          "name": "group",
          "relations": [
            "marginfiAccount"
          ]
        },
        {
          "name": "liquidationReceiver",
          "writable": true,
          "signer": true,
          "relations": [
            "liquidationRecord"
          ]
        },
        {
          "name": "feeState",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "globalFeeWallet",
          "writable": true,
          "relations": [
            "feeState"
          ]
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "feePayer",
          "docs": [
            "Optional separate payer for the flat liquidation fee. When provided it must sign and pays the",
            "fee; when omitted, the `liquidation_receiver` pays (the default)."
          ],
          "writable": true,
          "signer": true,
          "optional": true
        }
      ],
      "args": []
    },
    {
      "name": "initBankMetadata",
      "docs": [
        "(permissionless) pay the rent to open metadata for a bank. The bank account does not have",
        "to exist yet — callers can pre-create metadata for an upcoming bank pubkey at their own",
        "rent expense. When the bank is initialized and its seed is on-chain, the PDA is verified."
      ],
      "discriminator": [
        94,
        239,
        50,
        136,
        137,
        204,
        254,
        213
      ],
      "accounts": [
        {
          "name": "bank",
          "docs": [
            "keypair-based bank. When initialized with a known seed, the PDA is verified in the handler."
          ]
        },
        {
          "name": "feePayer",
          "docs": [
            "Pays the init fee"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "metadata",
          "docs": [
            "Note: unique per-bank."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  101,
                  116,
                  97,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initGlobalFeeState",
      "docs": [
        "(Runs once per program) Configures the fee state account, where the global admin sets fees",
        "that are assessed to the protocol"
      ],
      "discriminator": [
        82,
        48,
        247,
        59,
        220,
        109,
        231,
        44
      ],
      "accounts": [
        {
          "name": "payer",
          "docs": [
            "Pays the init fee"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "feeState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "admin",
          "type": "pubkey"
        },
        {
          "name": "feeWallet",
          "type": "pubkey"
        },
        {
          "name": "bankInitFlatSolFee",
          "type": "u32"
        },
        {
          "name": "liquidationFlatSolFee",
          "type": "u32"
        },
        {
          "name": "orderInitFlatSolFee",
          "type": "u32"
        },
        {
          "name": "programFeeFixed",
          "type": {
            "defined": {
              "name": "wrappedI80f48"
            }
          }
        },
        {
          "name": "programFeeRate",
          "type": {
            "defined": {
              "name": "wrappedI80f48"
            }
          }
        },
        {
          "name": "liquidationMaxFee",
          "type": {
            "defined": {
              "name": "wrappedI80f48"
            }
          }
        },
        {
          "name": "orderExecutionMaxFee",
          "type": {
            "defined": {
              "name": "wrappedI80f48"
            }
          }
        }
      ]
    },
    {
      "name": "initStakedSettings",
      "docs": [
        "(group admin only) Init the Staked Settings account, which is used to create staked",
        "collateral banks, and must run before any staked collateral bank can be created with",
        "`add_pool_permissionless`. Running this ix effectively opts the group into the staked",
        "collateral feature."
      ],
      "discriminator": [
        52,
        35,
        149,
        44,
        69,
        86,
        69,
        80
      ],
      "accounts": [
        {
          "name": "marginfiGroup"
        },
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "marginfiGroup"
          ]
        },
        {
          "name": "feePayer",
          "docs": [
            "Pays the init fee"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "stakedSettings",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  107,
                  101,
                  100,
                  95,
                  115,
                  101,
                  116,
                  116,
                  105,
                  110,
                  103,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "marginfiGroup"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "settings",
          "type": {
            "defined": {
              "name": "stakedSettingsConfig"
            }
          }
        }
      ]
    },
    {
      "name": "juplendDeposit",
      "docs": [
        "(user) Deposit into a JupLend lending pool through a marginfi account.",
        "* amount - in the underlying token (e.g., USDC), in native decimals"
      ],
      "discriminator": [
        114,
        11,
        218,
        81,
        183,
        165,
        143,
        255
      ],
      "accounts": [
        {
          "name": "group",
          "writable": true,
          "relations": [
            "marginfiAccount",
            "bank"
          ]
        },
        {
          "name": "marginfiAccount",
          "writable": true
        },
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "bank",
          "writable": true
        },
        {
          "name": "signerTokenAccount",
          "docs": [
            "Owned by authority, the source account for the token deposit."
          ],
          "writable": true
        },
        {
          "name": "liquidityVaultAuthority",
          "docs": [
            "The bank's liquidity vault authority PDA (acts as signer for JupLend CPIs).",
            "NOTE: JupLend marks the signer as writable in their deposit instruction."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  113,
                  117,
                  105,
                  100,
                  105,
                  116,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "liquidityVault",
          "docs": [
            "Bank liquidity vault (holds underlying mint and is used as depositor_token_account)."
          ],
          "writable": true,
          "relations": [
            "bank"
          ]
        },
        {
          "name": "mint",
          "docs": [
            "Underlying mint."
          ],
          "relations": [
            "bank"
          ]
        },
        {
          "name": "integrationAcc1",
          "docs": [
            "JupLend lending state account."
          ],
          "writable": true,
          "relations": [
            "bank"
          ]
        },
        {
          "name": "fTokenMint",
          "docs": [
            "JupLend fToken mint."
          ],
          "writable": true,
          "relations": [
            "integrationAcc1"
          ]
        },
        {
          "name": "integrationAcc2",
          "docs": [
            "Bank's fToken vault (validated via has_one on bank)."
          ],
          "writable": true,
          "relations": [
            "bank"
          ]
        },
        {
          "name": "lendingAdmin"
        },
        {
          "name": "supplyTokenReservesLiquidity",
          "writable": true
        },
        {
          "name": "lendingSupplyPositionOnLiquidity",
          "writable": true
        },
        {
          "name": "rateModel"
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "liquidity",
          "writable": true
        },
        {
          "name": "liquidityProgram",
          "address": "jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC"
        },
        {
          "name": "rewardsRateModel"
        },
        {
          "name": "juplendProgram",
          "address": "jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "juplendInitPosition",
      "docs": [
        "(permissionless) Initialize the bank-level JupLend position.",
        "",
        "This creates the bank's fToken ATA (owned by the bank liquidity vault authority) and",
        "performs a nominal seed deposit into JupLend, then flips the bank from `Paused` to",
        "`Operational`."
      ],
      "discriminator": [
        176,
        255,
        151,
        106,
        5,
        207,
        74,
        215
      ],
      "accounts": [
        {
          "name": "feePayer",
          "docs": [
            "Provides a nominal deposit amount."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "signerTokenAccount",
          "docs": [
            "Token account owned by the fee payer holding the underlying mint."
          ],
          "writable": true
        },
        {
          "name": "bank",
          "writable": true
        },
        {
          "name": "liquidityVaultAuthority",
          "docs": [
            "The bank's liquidity vault authority PDA (acts as signer for JupLend CPIs)."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  113,
                  117,
                  105,
                  100,
                  105,
                  116,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "liquidityVault",
          "docs": [
            "Bank liquidity vault (holds underlying mint and is used as depositor_token_account)."
          ],
          "writable": true,
          "relations": [
            "bank"
          ]
        },
        {
          "name": "mint",
          "docs": [
            "Underlying mint (must match bank mint and JupLend lending state mint)."
          ],
          "relations": [
            "bank"
          ]
        },
        {
          "name": "integrationAcc1",
          "docs": [
            "JupLend lending state account."
          ],
          "writable": true,
          "relations": [
            "bank"
          ]
        },
        {
          "name": "fTokenMint",
          "docs": [
            "JupLend fToken mint."
          ],
          "writable": true,
          "relations": [
            "integrationAcc1"
          ]
        },
        {
          "name": "integrationAcc2",
          "docs": [
            "Bank's fToken vault (validated via has_one on bank)."
          ],
          "writable": true,
          "relations": [
            "bank"
          ]
        },
        {
          "name": "lendingAdmin"
        },
        {
          "name": "supplyTokenReservesLiquidity",
          "writable": true
        },
        {
          "name": "lendingSupplyPositionOnLiquidity",
          "writable": true
        },
        {
          "name": "rateModel"
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "liquidity",
          "writable": true
        },
        {
          "name": "liquidityProgram",
          "address": "jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC"
        },
        {
          "name": "rewardsRateModel"
        },
        {
          "name": "juplendProgram",
          "address": "jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "juplendWithdraw",
      "docs": [
        "(user) Withdraw from a JupLend lending pool through a marginfi account.",
        "* amount - in the underlying token (e.g., USDC), in native decimals",
        "* if group rate limits are enabled, include the withdrawn bank's oracle group in",
        "`remaining_accounts`"
      ],
      "discriminator": [
        245,
        164,
        253,
        202,
        53,
        77,
        251,
        221
      ],
      "accounts": [
        {
          "name": "group",
          "relations": [
            "marginfiAccount",
            "bank"
          ]
        },
        {
          "name": "marginfiAccount",
          "writable": true
        },
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "bank",
          "writable": true
        },
        {
          "name": "destinationTokenAccount",
          "docs": [
            "Token account that will receive the underlying withdrawal.",
            "WARN: Completely unchecked!"
          ],
          "writable": true
        },
        {
          "name": "liquidityVaultAuthority",
          "docs": [
            "The bank's liquidity vault authority PDA (acts as signer for JupLend CPIs).",
            "NOTE: JupLend marks the signer as writable in their withdraw instruction."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  113,
                  117,
                  105,
                  100,
                  105,
                  116,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "mint",
          "docs": [
            "Underlying mint."
          ],
          "relations": [
            "bank"
          ]
        },
        {
          "name": "integrationAcc1",
          "docs": [
            "JupLend lending state account."
          ],
          "writable": true,
          "relations": [
            "bank"
          ]
        },
        {
          "name": "fTokenMint",
          "docs": [
            "JupLend fToken mint."
          ],
          "writable": true,
          "relations": [
            "integrationAcc1"
          ]
        },
        {
          "name": "integrationAcc2",
          "docs": [
            "Bank's fToken vault (validated via has_one on bank)."
          ],
          "writable": true,
          "relations": [
            "bank"
          ]
        },
        {
          "name": "integrationAcc3",
          "docs": [
            "Withdraw intermediary ATA (authority = liquidity_vault_authority).",
            "This must be an ATA to satisfy JupLend's withdraw constraints."
          ],
          "writable": true,
          "relations": [
            "bank"
          ]
        },
        {
          "name": "lendingAdmin"
        },
        {
          "name": "supplyTokenReservesLiquidity",
          "writable": true
        },
        {
          "name": "lendingSupplyPositionOnLiquidity",
          "writable": true
        },
        {
          "name": "rateModel"
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "claimAccount",
          "docs": [
            "JupLend claim account for liquidity_vault_authority.",
            "TEMPORARY: Mainnet currently requires this account (passing None causes ConstraintMut errors),",
            "but an upcoming upgrade is expected to make it truly optional. The account is never actually",
            "validated or used - you can pass any mutable account. We create the canonical PDA for consistency.",
            "Seeds: [\"user_claim\", liquidity_vault_authority, mint] on Liquidity program."
          ],
          "writable": true
        },
        {
          "name": "liquidity",
          "writable": true
        },
        {
          "name": "liquidityProgram",
          "address": "jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC"
        },
        {
          "name": "rewardsRateModel"
        },
        {
          "name": "juplendProgram",
          "address": "jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "withdrawAll",
          "type": {
            "option": "bool"
          }
        }
      ]
    },
    {
      "name": "kaminoDeposit",
      "docs": [
        "(user) Deposit into a Kamino pool through a marginfi account",
        "* amount - in the liquidity token (e.g. if there is a Kamino USDC bank, pass the amount of",
        "USDC desired), in native decimals."
      ],
      "discriminator": [
        237,
        8,
        188,
        187,
        115,
        99,
        49,
        85
      ],
      "accounts": [
        {
          "name": "group",
          "relations": [
            "marginfiAccount",
            "bank"
          ]
        },
        {
          "name": "marginfiAccount",
          "writable": true
        },
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "bank",
          "writable": true
        },
        {
          "name": "signerTokenAccount",
          "docs": [
            "Owned by authority, the source account for the token deposit."
          ],
          "writable": true
        },
        {
          "name": "liquidityVaultAuthority",
          "docs": [
            "The bank's liquidity vault authority, which owns the Kamino obligation. Note: Kamino needs",
            "this to be mut because `deposit` might return the rent here"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  113,
                  117,
                  105,
                  100,
                  105,
                  116,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "liquidityVault",
          "docs": [
            "Used as an intermediary to deposit token into Kamino"
          ],
          "writable": true,
          "relations": [
            "bank"
          ]
        },
        {
          "name": "integrationAcc2",
          "writable": true,
          "relations": [
            "bank"
          ]
        },
        {
          "name": "lendingMarket"
        },
        {
          "name": "lendingMarketAuthority"
        },
        {
          "name": "integrationAcc1",
          "docs": [
            "The Kamino reserve that holds liquidity"
          ],
          "writable": true,
          "relations": [
            "bank"
          ]
        },
        {
          "name": "mint",
          "docs": [
            "Bank's liquidity token mint (e.g., USDC). Kamino calls this the `reserve_liquidity_mint`"
          ],
          "relations": [
            "bank"
          ]
        },
        {
          "name": "reserveLiquiditySupply",
          "writable": true
        },
        {
          "name": "reserveCollateralMint",
          "docs": [
            "The reserve's mint for tokenized representations of Kamino deposits."
          ],
          "writable": true
        },
        {
          "name": "reserveDestinationDepositCollateral",
          "docs": [
            "The reserve's destination for tokenized representations of deposits. Note: the",
            "`reserve_collateral_mint` will mint tokens directly to this account."
          ],
          "writable": true
        },
        {
          "name": "obligationFarmUserState",
          "docs": [
            "Required if the Kamino reserve has an active farm."
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "reserveFarmState",
          "docs": [
            "Required if the Kamino reserve has an active farm."
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "kaminoProgram",
          "address": "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD"
        },
        {
          "name": "farmsProgram",
          "docs": [
            "Farms program for Kamino staking functionality"
          ],
          "address": "FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr"
        },
        {
          "name": "collateralTokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "liquidityTokenProgram"
        },
        {
          "name": "instructionSysvarAccount",
          "address": "Sysvar1nstructions1111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "refreshReserve",
          "type": {
            "option": "bool"
          }
        }
      ]
    },
    {
      "name": "kaminoHarvestReward",
      "docs": [
        "(permissionless) Harvest the specified reward index from the Kamino Farm attached to this",
        "bank. Rewards are always sent to the global fee wallet's canonical ATA.",
        "",
        "* `reward_index` — index of the reward token in the Kamino Farm's reward list"
      ],
      "discriminator": [
        163,
        202,
        248,
        141,
        106,
        20,
        116,
        5
      ],
      "accounts": [
        {
          "name": "bank"
        },
        {
          "name": "feeState",
          "docs": [
            "Global fee state that contains the global_fee_admin"
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "destinationTokenAccount",
          "docs": [
            "Destination token account must be owned by the global fee admin"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "feeState"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "rewardMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "liquidityVaultAuthority",
          "docs": [
            "The bank's liquidity vault authority, which owns the Kamino obligation."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  113,
                  117,
                  105,
                  100,
                  105,
                  116,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "userState",
          "writable": true
        },
        {
          "name": "farmState",
          "writable": true
        },
        {
          "name": "globalConfig"
        },
        {
          "name": "rewardMint"
        },
        {
          "name": "userRewardAta",
          "docs": [
            "An initialized ATA of type reward mint owned by liquidity vault"
          ],
          "writable": true
        },
        {
          "name": "rewardsVault",
          "writable": true
        },
        {
          "name": "rewardsTreasuryVault",
          "writable": true
        },
        {
          "name": "farmVaultsAuthority"
        },
        {
          "name": "scopePrices",
          "optional": true
        },
        {
          "name": "farmsProgram",
          "address": "FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr"
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "rewardIndex",
          "type": "u64"
        }
      ]
    },
    {
      "name": "kaminoInitObligation",
      "docs": [
        "(permissionless) Initialize a Kamino obligation for a marginfi bank",
        "* amount - In token, in native decimals. Must be >10 (i.e. 10 lamports, not 10 tokens). Lost",
        "forever. Generally, try to make this the equivalent of around $1, in case Kamino ever",
        "rounds small balances down to zero."
      ],
      "discriminator": [
        253,
        177,
        160,
        225,
        70,
        156,
        217,
        109
      ],
      "accounts": [
        {
          "name": "feePayer",
          "docs": [
            "Pays to init the obligation and pays a nominal amount to ensure the obligation has a",
            "non-zero balance."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "bank"
        },
        {
          "name": "signerTokenAccount",
          "docs": [
            "The fee payer must provide a nominal amount of bank tokens so the obligation is not empty.",
            "This amount is irrecoverable and and will prevent the obligation from ever being closed,",
            "even if the bank is otherwise empty (Kamino normally closes empty obligations automatically)"
          ],
          "writable": true
        },
        {
          "name": "liquidityVaultAuthority",
          "docs": [
            "The liquidity vault authority (PDA that will own the Kamino obligation). Note: Kamino needs",
            "this to be mut because `deposit` might return the rent here"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  113,
                  117,
                  105,
                  100,
                  105,
                  116,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "liquidityVault",
          "docs": [
            "Used as an intermediary to deposit a nominal amount of token into the obligation."
          ],
          "writable": true,
          "relations": [
            "bank"
          ]
        },
        {
          "name": "integrationAcc2",
          "docs": [
            "The obligation account to be created. Note that the key was already derived when",
            "initializing the bank, and this must match the obligation recorded at that time."
          ],
          "writable": true,
          "relations": [
            "bank"
          ]
        },
        {
          "name": "userMetadata",
          "writable": true
        },
        {
          "name": "lendingMarket"
        },
        {
          "name": "lendingMarketAuthority"
        },
        {
          "name": "integrationAcc1",
          "writable": true,
          "relations": [
            "bank"
          ]
        },
        {
          "name": "mint",
          "docs": [
            "Bank's liquidity token mint (e.g., USDC). Kamino calls this the `reserve_liquidity_mint`"
          ],
          "writable": true,
          "relations": [
            "bank"
          ]
        },
        {
          "name": "reserveLiquiditySupply",
          "writable": true
        },
        {
          "name": "reserveCollateralMint",
          "docs": [
            "The reserve's mint for tokenized representations of Kamino deposits."
          ],
          "writable": true
        },
        {
          "name": "reserveDestinationDepositCollateral",
          "docs": [
            "The reserve's destination for tokenized representations of deposits. Note: the",
            "`reserve_collateral_mint` will mint tokens directly to this account."
          ],
          "writable": true
        },
        {
          "name": "obligationFarmUserState",
          "docs": [
            "Required if the Kamino reserve has an active farm."
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "reserveFarmState",
          "docs": [
            "Required if the Kamino reserve has an active farm."
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "kaminoProgram",
          "address": "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD"
        },
        {
          "name": "farmsProgram",
          "docs": [
            "Farms program for Kamino staking functionality"
          ],
          "address": "FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr"
        },
        {
          "name": "collateralTokenProgram",
          "docs": [
            "Note: the collateral token always uses Token classic, never Token22."
          ],
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "liquidityTokenProgram",
          "docs": [
            "Note: Kamino does not have full Token22 support, certain Token22 features are disallowed.",
            "Expect this to update over time. Check with the Kamino source."
          ]
        },
        {
          "name": "instructionSysvarAccount",
          "address": "Sysvar1nstructions1111111111111111111111111"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "kaminoWithdraw",
      "docs": [
        "(user) Withdraw from a Kamino pool through a marginfi account",
        "* amount - in the collateral token (NOT liquidity token), in native decimals. Must convert",
        "from collateral to liquidity token amounts using the current exchange rate.",
        "* if group rate limits are enabled, include the withdrawn bank's oracle group in",
        "`remaining_accounts`",
        "* flags - optional bitflags:",
        "- bit 0 (`0x01`): withdraw all",
        "- bit 1 (`0x02`): refresh reserve via batch refresh"
      ],
      "discriminator": [
        199,
        101,
        41,
        45,
        213,
        98,
        224,
        200
      ],
      "accounts": [
        {
          "name": "group",
          "relations": [
            "marginfiAccount",
            "bank"
          ]
        },
        {
          "name": "marginfiAccount",
          "writable": true
        },
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "bank",
          "writable": true
        },
        {
          "name": "destinationTokenAccount",
          "docs": [
            "Token account that will receive the withdrawn tokens. Mint/owner are validated by the",
            "SPL transfer; the caller controls the destination."
          ],
          "writable": true
        },
        {
          "name": "liquidityVaultAuthority",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  113,
                  117,
                  105,
                  100,
                  105,
                  116,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "liquidityVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  113,
                  117,
                  105,
                  100,
                  105,
                  116,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          },
          "relations": [
            "bank"
          ]
        },
        {
          "name": "integrationAcc2",
          "writable": true,
          "relations": [
            "bank"
          ]
        },
        {
          "name": "lendingMarket",
          "docs": [
            "The Kamino lending market"
          ]
        },
        {
          "name": "lendingMarketAuthority",
          "docs": [
            "The Kamino lending market authority"
          ]
        },
        {
          "name": "integrationAcc1",
          "docs": [
            "The Kamino reserve that holds liquidity"
          ],
          "writable": true,
          "relations": [
            "bank"
          ]
        },
        {
          "name": "mint",
          "docs": [
            "The liquidity token mint (e.g., USDC)",
            "Needs serde to get the mint decimals for transfer checked"
          ],
          "writable": true,
          "relations": [
            "bank"
          ]
        },
        {
          "name": "reserveLiquiditySupply",
          "docs": [
            "The reserve's liquidity supply account"
          ],
          "writable": true
        },
        {
          "name": "reserveCollateralMint",
          "docs": [
            "The reserve's collateral mint"
          ],
          "writable": true
        },
        {
          "name": "reserveSourceCollateral",
          "docs": [
            "The reserve's source for collateral tokens"
          ],
          "writable": true
        },
        {
          "name": "obligationFarmUserState",
          "docs": [
            "Optional farms accounts for Kamino staking functionality"
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "reserveFarmState",
          "writable": true,
          "optional": true
        },
        {
          "name": "kaminoProgram",
          "address": "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD"
        },
        {
          "name": "farmsProgram",
          "docs": [
            "Farms program for Kamino staking functionality"
          ],
          "address": "FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr"
        },
        {
          "name": "collateralTokenProgram",
          "docs": [
            "The token program for the collateral token"
          ],
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "liquidityTokenProgram",
          "docs": [
            "The token program for the liquidity token"
          ]
        },
        {
          "name": "instructionSysvarAccount",
          "docs": [
            "Used by kamino validate CPI calls"
          ],
          "address": "Sysvar1nstructions1111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "flags",
          "type": {
            "option": "u8"
          }
        }
      ]
    },
    {
      "name": "lendingAccountBorrow",
      "docs": [
        "(account authority) Borrow assets from a bank. Accrues interest, records liability, applies",
        "origination fee, transfers tokens, and runs a health check. If group rate limits are",
        "enabled, `remaining_accounts` must include the borrowed bank's oracle group for USD",
        "pricing."
      ],
      "discriminator": [
        4,
        126,
        116,
        53,
        48,
        5,
        212,
        31
      ],
      "accounts": [
        {
          "name": "group",
          "relations": [
            "marginfiAccount",
            "bank"
          ]
        },
        {
          "name": "marginfiAccount",
          "writable": true
        },
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "bank",
          "writable": true
        },
        {
          "name": "destinationTokenAccount",
          "writable": true
        },
        {
          "name": "bankLiquidityVaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  113,
                  117,
                  105,
                  100,
                  105,
                  116,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "liquidityVault",
          "writable": true,
          "relations": [
            "bank"
          ]
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "lendingAccountCloseBalance",
      "docs": [
        "(account authority) Close a balance position with dust-level amounts."
      ],
      "discriminator": [
        245,
        54,
        41,
        4,
        243,
        202,
        31,
        17
      ],
      "accounts": [
        {
          "name": "group",
          "relations": [
            "marginfiAccount",
            "bank"
          ]
        },
        {
          "name": "marginfiAccount",
          "writable": true
        },
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "bank",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "lendingAccountDeposit",
      "docs": [
        "(account authority) Deposit assets into a bank. Accrues interest, records deposit, and",
        "transfers tokens from the signer's token account to the bank's liquidity vault."
      ],
      "discriminator": [
        171,
        94,
        235,
        103,
        82,
        64,
        212,
        140
      ],
      "accounts": [
        {
          "name": "group",
          "relations": [
            "marginfiAccount",
            "bank"
          ]
        },
        {
          "name": "marginfiAccount",
          "writable": true
        },
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "bank",
          "writable": true
        },
        {
          "name": "signerTokenAccount",
          "writable": true
        },
        {
          "name": "liquidityVault",
          "writable": true,
          "relations": [
            "bank"
          ]
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "depositUpToLimit",
          "type": {
            "option": "bool"
          }
        }
      ]
    },
    {
      "name": "lendingAccountEndFlashloan",
      "docs": [
        "(account authority) End a flash loan and run the health check."
      ],
      "discriminator": [
        105,
        124,
        201,
        106,
        153,
        2,
        8,
        156
      ],
      "accounts": [
        {
          "name": "marginfiAccount",
          "writable": true
        },
        {
          "name": "group",
          "relations": [
            "marginfiAccount"
          ]
        },
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "marginfiAccount"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "lendingAccountLiquidate",
      "docs": [
        "(permissionless) Liquidate a lending account balance of an unhealthy marginfi account.",
        "The liquidator takes on the liability and receives discounted collateral (2.5% liquidator",
        "fee + 2.5% insurance fee).",
        "* `asset_amount` - amount of collateral to liquidate",
        "* `liquidatee_accounts` - number of remaining accounts for the liquidatee",
        "* `liquidator_accounts` - number of remaining accounts for the liquidator"
      ],
      "discriminator": [
        214,
        169,
        151,
        213,
        251,
        167,
        86,
        219
      ],
      "accounts": [
        {
          "name": "group",
          "relations": [
            "assetBank",
            "liabBank",
            "liquidatorMarginfiAccount",
            "liquidateeMarginfiAccount"
          ]
        },
        {
          "name": "assetBank",
          "writable": true
        },
        {
          "name": "liabBank",
          "writable": true
        },
        {
          "name": "liquidatorMarginfiAccount",
          "writable": true
        },
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "liquidateeMarginfiAccount",
          "writable": true
        },
        {
          "name": "bankLiquidityVaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  113,
                  117,
                  105,
                  100,
                  105,
                  116,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "liabBank"
              }
            ]
          }
        },
        {
          "name": "bankLiquidityVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  113,
                  117,
                  105,
                  100,
                  105,
                  116,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "liabBank"
              }
            ]
          }
        },
        {
          "name": "bankInsuranceVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  115,
                  117,
                  114,
                  97,
                  110,
                  99,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "liabBank"
              }
            ]
          }
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "assetAmount",
          "type": "u64"
        },
        {
          "name": "liquidateeAccounts",
          "type": "u8"
        },
        {
          "name": "liquidatorAccounts",
          "type": "u8"
        }
      ]
    },
    {
      "name": "lendingAccountPulseHealth",
      "docs": [
        "(Permissionless) Refresh the internal risk engine health cache. Useful for liquidators and",
        "other consumers that want to see the internal risk state of a user account. This cache is",
        "read-only and serves no purpose except being populated by this ix.",
        "* remaining accounts expected in the same order as borrow, etc. I.e., for each balance the",
        "user has, pass bank and oracle: <bank1, oracle1, bank2, oracle2>"
      ],
      "discriminator": [
        186,
        52,
        117,
        97,
        34,
        74,
        39,
        253
      ],
      "accounts": [
        {
          "name": "marginfiAccount",
          "writable": true
        },
        {
          "name": "group",
          "relations": [
            "marginfiAccount"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "lendingAccountRepay",
      "docs": [
        "(account authority, or any signer during receivership) Repay borrowed assets. Accrues",
        "interest, records repayment, and transfers tokens to the bank's liquidity vault."
      ],
      "discriminator": [
        79,
        209,
        172,
        177,
        222,
        51,
        173,
        151
      ],
      "accounts": [
        {
          "name": "group",
          "relations": [
            "marginfiAccount",
            "bank"
          ]
        },
        {
          "name": "marginfiAccount",
          "writable": true
        },
        {
          "name": "authority",
          "docs": [
            "Must be marginfi_account's authority, unless in liquidation/deleverage receivership or order execution",
            "",
            "Note: during receivership and order execution, there are no signer checks whatsoever: any key can repay as",
            "long as the invariants checked at the end of execution are met."
          ],
          "signer": true
        },
        {
          "name": "bank",
          "writable": true
        },
        {
          "name": "signerTokenAccount",
          "writable": true
        },
        {
          "name": "liquidityVault",
          "writable": true,
          "relations": [
            "bank"
          ]
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "repayAll",
          "type": {
            "option": "bool"
          }
        }
      ]
    },
    {
      "name": "lendingAccountStartFlashloan",
      "docs": [
        "(account authority) Start a flash loan. Must have a corresponding `end_flashloan` ix in the",
        "same tx. Health checks are skipped until the flash loan ends."
      ],
      "discriminator": [
        14,
        131,
        33,
        220,
        81,
        186,
        180,
        107
      ],
      "accounts": [
        {
          "name": "marginfiAccount",
          "writable": true
        },
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "marginfiAccount"
          ]
        },
        {
          "name": "ixsSysvar",
          "address": "Sysvar1nstructions1111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "endIndex",
          "type": "u64"
        }
      ]
    },
    {
      "name": "lendingAccountWithdraw",
      "docs": [
        "(account authority, or any signer during receivership) Withdraw assets from a bank. Accrues",
        "interest, records withdrawal, transfers tokens, and runs a health check (skipped during",
        "receivership). If group rate limits are enabled, `remaining_accounts` must include the",
        "withdrawn bank's oracle group for USD pricing."
      ],
      "discriminator": [
        36,
        72,
        74,
        19,
        210,
        210,
        192,
        192
      ],
      "accounts": [
        {
          "name": "group",
          "relations": [
            "marginfiAccount",
            "bank"
          ]
        },
        {
          "name": "marginfiAccount",
          "writable": true
        },
        {
          "name": "authority",
          "docs": [
            "Must be marginfi_account's authority, unless in liquidation/deleverage receivership or order execution",
            "",
            "Note: during receivership and order execution, there are no signer checks whatsoever: any key can repay as",
            "long as the invariants checked at the end of execution are met."
          ],
          "signer": true
        },
        {
          "name": "bank",
          "writable": true
        },
        {
          "name": "destinationTokenAccount",
          "writable": true
        },
        {
          "name": "bankLiquidityVaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  113,
                  117,
                  105,
                  100,
                  105,
                  116,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "liquidityVault",
          "writable": true,
          "relations": [
            "bank"
          ]
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "withdrawAll",
          "type": {
            "option": "bool"
          }
        }
      ]
    },
    {
      "name": "lendingPoolAccrueBankInterest",
      "docs": [
        "(permissionless) Accrue interest on a bank, updating share values and collecting fees."
      ],
      "discriminator": [
        108,
        201,
        30,
        87,
        47,
        65,
        97,
        188
      ],
      "accounts": [
        {
          "name": "group",
          "relations": [
            "bank"
          ]
        },
        {
          "name": "bank",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "lendingPoolAddBank",
      "docs": [
        "(admin only) Add a new bank to the lending pool"
      ],
      "discriminator": [
        215,
        68,
        72,
        78,
        208,
        218,
        103,
        182
      ],
      "accounts": [
        {
          "name": "marginfiGroup",
          "writable": true
        },
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "marginfiGroup"
          ]
        },
        {
          "name": "feePayer",
          "docs": [
            "Pays to init accounts and pays `fee_state.bank_init_flat_sol_fee` lamports to the protocol"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "feeState",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "globalFeeWallet",
          "writable": true,
          "relations": [
            "feeState"
          ]
        },
        {
          "name": "bankMint"
        },
        {
          "name": "bank",
          "writable": true,
          "signer": true
        },
        {
          "name": "liquidityVaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  113,
                  117,
                  105,
                  100,
                  105,
                  116,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "liquidityVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  113,
                  117,
                  105,
                  100,
                  105,
                  116,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "insuranceVaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  115,
                  117,
                  114,
                  97,
                  110,
                  99,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "insuranceVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  115,
                  117,
                  114,
                  97,
                  110,
                  99,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "feeVaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "feeVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "bankConfig",
          "type": {
            "defined": {
              "name": "bankConfigCompact"
            }
          }
        }
      ]
    },
    {
      "name": "lendingPoolAddBankDrift",
      "docs": [
        "(group admin only) Add a Drift bank to the group."
      ],
      "discriminator": [
        62,
        63,
        49,
        48,
        76,
        55,
        108,
        155
      ],
      "accounts": [
        {
          "name": "group",
          "writable": true
        },
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "group"
          ]
        },
        {
          "name": "feePayer",
          "writable": true,
          "signer": true
        },
        {
          "name": "bankMint",
          "docs": [
            "Must match the mint used by `integration_acc_1`"
          ]
        },
        {
          "name": "bank",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "group"
              },
              {
                "kind": "account",
                "path": "bankMint"
              },
              {
                "kind": "arg",
                "path": "bankSeed"
              }
            ]
          }
        },
        {
          "name": "integrationAcc1",
          "docs": [
            "Drift spot market account that must match the bank mint"
          ]
        },
        {
          "name": "integrationAcc2",
          "docs": [
            "Drift user account for the marginfi program (derived from liquidity_vault_authority)"
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "liquidityVaultAuthority"
              },
              {
                "kind": "const",
                "value": [
                  0,
                  0
                ]
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                9,
                84,
                219,
                190,
                158,
                201,
                96,
                201,
                138,
                122,
                41,
                63,
                226,
                19,
                54,
                150,
                111,
                225,
                128,
                209,
                81,
                174,
                75,
                129,
                121,
                86,
                31,
                137,
                133,
                74,
                83,
                246
              ]
            }
          }
        },
        {
          "name": "integrationAcc3",
          "docs": [
            "Drift user stats account for the marginfi program (derived from liquidity_vault_authority)"
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  101,
                  114,
                  95,
                  115,
                  116,
                  97,
                  116,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "liquidityVaultAuthority"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                9,
                84,
                219,
                190,
                158,
                201,
                96,
                201,
                138,
                122,
                41,
                63,
                226,
                19,
                54,
                150,
                111,
                225,
                128,
                209,
                81,
                174,
                75,
                129,
                121,
                86,
                31,
                137,
                133,
                74,
                83,
                246
              ]
            }
          }
        },
        {
          "name": "liquidityVaultAuthority",
          "docs": [
            "Will be authority of the bank's liquidity vault. Used as intermediary for deposits/withdraws"
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  113,
                  117,
                  105,
                  100,
                  105,
                  116,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "liquidityVault",
          "docs": [
            "For Drift banks, the `liquidity_vault` never holds assets, but is instead used as an",
            "intermediary when depositing/withdrawing, e.g., withdrawn funds move from Drift -> here ->",
            "the user's token account."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  113,
                  117,
                  105,
                  100,
                  105,
                  116,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "insuranceVaultAuthority",
          "docs": [
            "Note: Currently does nothing."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  115,
                  117,
                  114,
                  97,
                  110,
                  99,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "insuranceVault",
          "docs": [
            "Note: Currently does nothing."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  115,
                  117,
                  114,
                  97,
                  110,
                  99,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "feeVaultAuthority",
          "docs": [
            "Note: Currently does nothing."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "feeVault",
          "docs": [
            "Note: Currently does nothing."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "bankConfig",
          "type": {
            "defined": {
              "name": "driftConfigCompact"
            }
          }
        },
        {
          "name": "bankSeed",
          "type": "u64"
        }
      ]
    },
    {
      "name": "lendingPoolAddBankJuplend",
      "docs": [
        "(admin) Add a JupLend bank to the marginfi group.",
        "",
        "Remaining accounts (for oracle validation):",
        "0. underlying oracle feed (pyth push or switchboard pull)",
        "1. JupLend `Lending` state"
      ],
      "discriminator": [
        18,
        208,
        117,
        90,
        53,
        111,
        195,
        41
      ],
      "accounts": [
        {
          "name": "group",
          "writable": true
        },
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "group"
          ]
        },
        {
          "name": "feePayer",
          "writable": true,
          "signer": true
        },
        {
          "name": "bankMint",
          "docs": [
            "Must match the mint used by the JupLend lending state."
          ]
        },
        {
          "name": "bank",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "group"
              },
              {
                "kind": "account",
                "path": "bankMint"
              },
              {
                "kind": "arg",
                "path": "bankSeed"
              }
            ]
          }
        },
        {
          "name": "integrationAcc1",
          "docs": [
            "JupLend lending state account that must match the bank mint."
          ]
        },
        {
          "name": "liquidityVaultAuthority",
          "docs": [
            "Will be authority of the bank's liquidity vault. Used as intermediary for deposits/withdraws."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  113,
                  117,
                  105,
                  100,
                  105,
                  116,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "liquidityVault",
          "docs": [
            "For JupLend banks, the `liquidity_vault` is used as an intermediary when depositing/",
            "withdrawing, e.g., withdrawn funds move from JupLend -> here -> the user's token account."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  113,
                  117,
                  105,
                  100,
                  105,
                  116,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "insuranceVaultAuthority",
          "docs": [
            "Note: Currently does nothing."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  115,
                  117,
                  114,
                  97,
                  110,
                  99,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "insuranceVault",
          "docs": [
            "Note: Currently does nothing."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  115,
                  117,
                  114,
                  97,
                  110,
                  99,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "feeVaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "feeVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "fTokenMint",
          "relations": [
            "integrationAcc1"
          ]
        },
        {
          "name": "integrationAcc2",
          "docs": [
            "The bank's fToken vault holds the fTokens received when depositing into JupLend.",
            ""
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  95,
                  116,
                  111,
                  107,
                  101,
                  110,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "docs": [
            "Token program for both underlying mint and fToken mint (SPL Token or Token-2022).",
            "JupLend creates fToken mints using the same token program as the underlying."
          ]
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "bankConfig",
          "type": {
            "defined": {
              "name": "juplendConfigCompact"
            }
          }
        },
        {
          "name": "bankSeed",
          "type": "u64"
        }
      ]
    },
    {
      "name": "lendingPoolAddBankKamino",
      "docs": [
        "(group admin only) Add a Kamino bank to the group. Pass the oracle and reserve in remaining",
        "accounts 0 and 1 respectively."
      ],
      "discriminator": [
        118,
        53,
        16,
        243,
        255,
        245,
        149,
        241
      ],
      "accounts": [
        {
          "name": "group",
          "writable": true
        },
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "group"
          ]
        },
        {
          "name": "feePayer",
          "writable": true,
          "signer": true
        },
        {
          "name": "bankMint",
          "docs": [
            "Must match the mint used by the Kamino reserve (integration_acc_1), Kamino calls this the",
            "`reserve_liquidity_mint` aka `liquidity.mint_pubkey`"
          ]
        },
        {
          "name": "bank",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "group"
              },
              {
                "kind": "account",
                "path": "bankMint"
              },
              {
                "kind": "arg",
                "path": "bankSeed"
              }
            ]
          }
        },
        {
          "name": "integrationAcc1"
        },
        {
          "name": "integrationAcc2",
          "docs": [
            "Note: not yet initialized in this instruction, run `init_obligation` after."
          ]
        },
        {
          "name": "liquidityVaultAuthority",
          "docs": [
            "Will be authority of the bank's Kamino obligation (integration_acc_2). Note: When",
            "depositing/withdrawing Kamino assets, the source/destination must also be owned by the",
            "obligation authority.",
            "Kamino assets, the source/destination must also be owned by the obligation authority. This",
            "account owns the `liquidity_vault`, and thus acts as intermediary for deposits/withdraws"
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  113,
                  117,
                  105,
                  100,
                  105,
                  116,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "liquidityVault",
          "docs": [
            "For Kamino banks, the `liquidity_vault` never holds assets, but is instead used as an",
            "intermediary when depositing/withdrawing, e.g., withdrawn funds move from Kamino -> here ->",
            "the user's token account."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  113,
                  117,
                  105,
                  100,
                  105,
                  116,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "insuranceVaultAuthority",
          "docs": [
            "Note: Currently does nothing."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  115,
                  117,
                  114,
                  97,
                  110,
                  99,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "insuranceVault",
          "docs": [
            "Note: Currently does nothing."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  115,
                  117,
                  114,
                  97,
                  110,
                  99,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "feeVaultAuthority",
          "docs": [
            "Note: Currently does nothing."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "feeVault",
          "docs": [
            "Note: Currently does nothing."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "bankConfig",
          "type": {
            "defined": {
              "name": "kaminoConfigCompact"
            }
          }
        },
        {
          "name": "bankSeed",
          "type": "u64"
        }
      ]
    },
    {
      "name": "lendingPoolAddBankPermissionless",
      "docs": [
        "(permissionless) Add a staked collateral bank. Requires a valid SPL single-pool LST mint."
      ],
      "discriminator": [
        127,
        187,
        121,
        34,
        187,
        167,
        238,
        102
      ],
      "accounts": [
        {
          "name": "marginfiGroup",
          "writable": true,
          "relations": [
            "stakedSettings"
          ]
        },
        {
          "name": "stakedSettings"
        },
        {
          "name": "feePayer",
          "writable": true,
          "signer": true
        },
        {
          "name": "bankMint",
          "docs": [
            "Mint of the spl-single-pool LST (a PDA derived from `stake_pool`)",
            "",
            "because the sol_pool and stake_pool will not derive to a valid PDA which is also owned by",
            "the staking program and spl-single-pool program."
          ]
        },
        {
          "name": "solPool"
        },
        {
          "name": "poolOnramp"
        },
        {
          "name": "stakePool",
          "docs": [
            "this key.",
            "",
            "If derives the same `bank_mint`, then this must be the correct stake pool for that mint, and",
            "we can subsequently use it to validate the `sol_pool`"
          ]
        },
        {
          "name": "validatorVoteAccount",
          "docs": [
            "Validator vote account for this staked bank.",
            "",
            "vote -> stake_pool -> mint/stake/on-ramp."
          ]
        },
        {
          "name": "bank",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "marginfiGroup"
              },
              {
                "kind": "account",
                "path": "bankMint"
              },
              {
                "kind": "arg",
                "path": "bankSeed"
              }
            ]
          }
        },
        {
          "name": "liquidityVaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  113,
                  117,
                  105,
                  100,
                  105,
                  116,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "liquidityVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  113,
                  117,
                  105,
                  100,
                  105,
                  116,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "insuranceVaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  115,
                  117,
                  114,
                  97,
                  110,
                  99,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "insuranceVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  115,
                  117,
                  114,
                  97,
                  110,
                  99,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "feeVaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "feeVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "bankSeed",
          "type": "u64"
        }
      ]
    },
    {
      "name": "lendingPoolAddBankSolend",
      "docs": [
        "(admin) Add a Solend bank to the marginfi group"
      ],
      "discriminator": [
        81,
        233,
        203,
        199,
        47,
        226,
        0,
        68
      ],
      "accounts": [
        {
          "name": "group",
          "writable": true
        },
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "group"
          ]
        },
        {
          "name": "feePayer",
          "writable": true,
          "signer": true
        },
        {
          "name": "bankMint",
          "docs": [
            "Must match the mint used by `integration_acc_1`, Solend calls this the `liquidity.mint_pubkey`"
          ]
        },
        {
          "name": "bank",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "group"
              },
              {
                "kind": "account",
                "path": "bankMint"
              },
              {
                "kind": "arg",
                "path": "bankSeed"
              }
            ]
          }
        },
        {
          "name": "integrationAcc1",
          "docs": [
            "Solend reserve account that must match the bank mint"
          ]
        },
        {
          "name": "integrationAcc2",
          "docs": [
            "Obligation PDA for this bank in Solend",
            "Will be initialized and transferred to Solend in init_obligation instruction"
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  111,
                  108,
                  101,
                  110,
                  100,
                  95,
                  111,
                  98,
                  108,
                  105,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "liquidityVaultAuthority",
          "docs": [
            "Will be authority of the bank's liquidity vault. Used as intermediary for deposits/withdraws"
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  113,
                  117,
                  105,
                  100,
                  105,
                  116,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "liquidityVault",
          "docs": [
            "For Solend banks, the `liquidity_vault` never holds assets, but is instead used as an",
            "intermediary when depositing/withdrawing, e.g., withdrawn funds move from Solend -> here ->",
            "the user's token account."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  113,
                  117,
                  105,
                  100,
                  105,
                  116,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "insuranceVaultAuthority",
          "docs": [
            "Note: Currently does nothing."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  115,
                  117,
                  114,
                  97,
                  110,
                  99,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "insuranceVault",
          "docs": [
            "Note: Currently does nothing."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  115,
                  117,
                  114,
                  97,
                  110,
                  99,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "feeVaultAuthority",
          "docs": [
            "Note: Currently does nothing."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "feeVault",
          "docs": [
            "Note: Currently does nothing."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "bankConfig",
          "type": {
            "defined": {
              "name": "solendConfigCompact"
            }
          }
        },
        {
          "name": "bankSeed",
          "type": "u64"
        }
      ]
    },
    {
      "name": "lendingPoolAddBankWithSeed",
      "docs": [
        "(admin only) A copy of lending_pool_add_bank with an additional bank seed.",
        "This seed is used to create a PDA for the bank's signature.",
        "lending_pool_add_bank is preserved for backwards compatibility."
      ],
      "discriminator": [
        76,
        211,
        213,
        171,
        117,
        78,
        158,
        76
      ],
      "accounts": [
        {
          "name": "marginfiGroup",
          "writable": true
        },
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "marginfiGroup"
          ]
        },
        {
          "name": "feePayer",
          "docs": [
            "Pays to init accounts and pays `fee_state.bank_init_flat_sol_fee` lamports to the protocol"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "feeState",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "globalFeeWallet",
          "writable": true,
          "relations": [
            "feeState"
          ]
        },
        {
          "name": "bankMint"
        },
        {
          "name": "bank",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "marginfiGroup"
              },
              {
                "kind": "account",
                "path": "bankMint"
              },
              {
                "kind": "arg",
                "path": "bankSeed"
              }
            ]
          }
        },
        {
          "name": "liquidityVaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  113,
                  117,
                  105,
                  100,
                  105,
                  116,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "liquidityVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  113,
                  117,
                  105,
                  100,
                  105,
                  116,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "insuranceVaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  115,
                  117,
                  114,
                  97,
                  110,
                  99,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "insuranceVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  115,
                  117,
                  114,
                  97,
                  110,
                  99,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "feeVaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "feeVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "bankConfig",
          "type": {
            "defined": {
              "name": "bankConfigCompact"
            }
          }
        },
        {
          "name": "bankSeed",
          "type": "u64"
        }
      ]
    },
    {
      "name": "lendingPoolBackfillBankIsT22Flag",
      "docs": [
        "(permissionless) Backfill `IS_T22` on existing banks created before this flag existed.",
        "Also optionally backfills `bank_seed` in the same call.",
        "Pass `None` to skip seed backfill, `Some(seed)` to backfill (including `Some(0)`)."
      ],
      "discriminator": [
        189,
        14,
        205,
        160,
        172,
        46,
        157,
        52
      ],
      "accounts": [
        {
          "name": "bank",
          "writable": true
        },
        {
          "name": "group",
          "relations": [
            "bank"
          ]
        },
        {
          "name": "mint",
          "relations": [
            "bank"
          ]
        }
      ],
      "args": [
        {
          "name": "bankSeed",
          "type": {
            "option": "u64"
          }
        }
      ]
    },
    {
      "name": "lendingPoolBackfillStakedBankValidatorVoteAccount",
      "docs": [
        "(permissionless) Backfill validator vote account on existing staked-collateral banks.",
        "No-op if already set to the same validator vote account."
      ],
      "discriminator": [
        141,
        6,
        23,
        125,
        72,
        34,
        199,
        24
      ],
      "accounts": [
        {
          "name": "bank",
          "writable": true
        },
        {
          "name": "validatorVoteAccount"
        }
      ],
      "args": []
    },
    {
      "name": "lendingPoolClearCircuitBreaker",
      "docs": [
        "(admin or risk_admin) Clear an active circuit-breaker halt on a bank.",
        "* `reseed_reference` - If true, also zero the EMA reference so the next pulse reseeds it",
        "from live oracle data (use when clearing because the new price level is valid and the",
        "pre-halt reference would cause an immediate re-halt)."
      ],
      "discriminator": [
        64,
        73,
        106,
        46,
        213,
        86,
        31,
        48
      ],
      "accounts": [
        {
          "name": "group",
          "relations": [
            "bank"
          ]
        },
        {
          "name": "authority",
          "docs": [
            "Either `group.admin` or `group.risk_admin`. Validated in the handler."
          ],
          "signer": true
        },
        {
          "name": "bank",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "reseedReference",
          "type": "bool"
        }
      ]
    },
    {
      "name": "lendingPoolCloneBank",
      "docs": [
        "(admin only) Staging or localnet only, panics on mainnet",
        "This instruction is used to clone a bank to a new PDA."
      ],
      "discriminator": [
        214,
        93,
        17,
        236,
        177,
        228,
        78,
        17
      ],
      "accounts": [
        {
          "name": "marginfiGroup",
          "writable": true
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true,
          "relations": [
            "marginfiGroup"
          ]
        },
        {
          "name": "feePayer",
          "writable": true,
          "signer": true
        },
        {
          "name": "bankMint"
        },
        {
          "name": "sourceBank",
          "docs": [
            "Source bank to clone from mainnet program",
            ""
          ]
        },
        {
          "name": "bank",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "marginfiGroup"
              },
              {
                "kind": "account",
                "path": "bankMint"
              },
              {
                "kind": "arg",
                "path": "bankSeed"
              }
            ]
          }
        },
        {
          "name": "liquidityVaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  113,
                  117,
                  105,
                  100,
                  105,
                  116,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "liquidityVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  113,
                  117,
                  105,
                  100,
                  105,
                  116,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "insuranceVaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  115,
                  117,
                  114,
                  97,
                  110,
                  99,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "insuranceVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  115,
                  117,
                  114,
                  97,
                  110,
                  99,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "feeVaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "feeVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "bankSeed",
          "type": "u64"
        }
      ]
    },
    {
      "name": "lendingPoolCloneEmode",
      "docs": [
        "(admin or emode_admin) Copies emode settings from one bank to another. Useful when applying",
        "emode settings from e.g. one LST to another."
      ],
      "discriminator": [
        146,
        167,
        94,
        106,
        184,
        202,
        15,
        10
      ],
      "accounts": [
        {
          "name": "group",
          "relations": [
            "copyFromBank",
            "copyToBank"
          ]
        },
        {
          "name": "signer",
          "signer": true
        },
        {
          "name": "copyFromBank"
        },
        {
          "name": "copyToBank",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "lendingPoolCloseBank",
      "docs": [
        "(admin only) Close a bank. Requires CLOSE_ENABLED_FLAG and zero positions/shares.",
        "",
        "Pass `force_close = Some(true)` to bypass the CLOSE_ENABLED_FLAG and open-position checks",
        "(zero-shares/emissions are still required). Forcing a bank closed is **VERY DANGEROUS**.",
        "Only do it if a Bank was fundamentally broken in some way. The admin **MUST ENSURE** that:",
        "",
        "* **NO USER** has a Balance in this bank (zero-shares on the bank  is not sufficient to",
        "guarantee this, a user can have a zero-share Balance, this could brick their account.)",
        "* fee and insurance vault balances are withdrawn (unless you don't care if they are lost",
        "**FOREVER**).",
        "* all three vault token-account balances are zero (or you don't care if anything remaining",
        "is lost **FOREVER**), including the liquidity vault",
        "* all three outstanding-fee fields are zero (or you don't care if anything remaining is lost",
        "**FOREVER**)"
      ],
      "discriminator": [
        22,
        115,
        7,
        130,
        227,
        85,
        0,
        47
      ],
      "accounts": [
        {
          "name": "group",
          "writable": true,
          "relations": [
            "bank"
          ]
        },
        {
          "name": "bank",
          "writable": true
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true,
          "relations": [
            "group"
          ]
        }
      ],
      "args": [
        {
          "name": "forceClose",
          "type": {
            "option": "bool"
          }
        }
      ]
    },
    {
      "name": "lendingPoolCollectBankFees",
      "docs": [
        "(permissionless) Transfer accrued fees from the liquidity vault to insurance/fee/program",
        "vaults."
      ],
      "discriminator": [
        201,
        5,
        215,
        116,
        230,
        92,
        75,
        150
      ],
      "accounts": [
        {
          "name": "group",
          "relations": [
            "bank"
          ]
        },
        {
          "name": "bank",
          "writable": true
        },
        {
          "name": "liquidityVaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  113,
                  117,
                  105,
                  100,
                  105,
                  116,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "liquidityVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  113,
                  117,
                  105,
                  100,
                  105,
                  116,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "insuranceVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  115,
                  117,
                  114,
                  97,
                  110,
                  99,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "feeVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "feeState",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "feeAta",
          "docs": [
            "(validated in handler). Must already exist, may require initializing the ATA if it does not",
            "already exist prior to this ix."
          ],
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "lendingPoolConfigureBank",
      "docs": [
        "(admin only) Configure bank parameters. If the bank has `FREEZE_SETTINGS`, only",
        "deposit/borrow limits are updated and all other config changes are silently ignored."
      ],
      "discriminator": [
        121,
        173,
        156,
        40,
        93,
        148,
        56,
        237
      ],
      "accounts": [
        {
          "name": "group",
          "relations": [
            "bank"
          ]
        },
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "group"
          ]
        },
        {
          "name": "bank",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "bankConfigOpt",
          "type": {
            "defined": {
              "name": "bankConfigOpt"
            }
          }
        }
      ]
    },
    {
      "name": "lendingPoolConfigureBankEmode",
      "docs": [
        "(emode_admin only)"
      ],
      "discriminator": [
        17,
        175,
        91,
        57,
        239,
        86,
        49,
        71
      ],
      "accounts": [
        {
          "name": "group",
          "relations": [
            "bank"
          ]
        },
        {
          "name": "emodeAdmin",
          "signer": true,
          "relations": [
            "group"
          ]
        },
        {
          "name": "bank",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "emodeTag",
          "type": "u16"
        },
        {
          "name": "entries",
          "type": {
            "array": [
              {
                "defined": {
                  "name": "emodeEntry"
                }
              },
              10
            ]
          }
        }
      ]
    },
    {
      "name": "lendingPoolConfigureBankInterestOnly",
      "docs": [
        "(delegate_curve_admin only) Update interest rate config. Does nothing if bank has",
        "`FREEZE_SETTINGS`."
      ],
      "discriminator": [
        245,
        107,
        83,
        38,
        103,
        219,
        163,
        241
      ],
      "accounts": [
        {
          "name": "group",
          "relations": [
            "bank"
          ]
        },
        {
          "name": "delegateCurveAdmin",
          "signer": true,
          "relations": [
            "group"
          ]
        },
        {
          "name": "bank",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "interestRateConfig",
          "type": {
            "defined": {
              "name": "interestRateConfigOpt"
            }
          }
        }
      ]
    },
    {
      "name": "lendingPoolConfigureBankLimitsOnly",
      "docs": [
        "(delegate_limit_admin only) Update deposit/borrow/init limits only."
      ],
      "discriminator": [
        157,
        196,
        221,
        200,
        202,
        62,
        84,
        21
      ],
      "accounts": [
        {
          "name": "group",
          "relations": [
            "bank"
          ]
        },
        {
          "name": "delegateLimitAdmin",
          "signer": true,
          "relations": [
            "group"
          ]
        },
        {
          "name": "bank",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "depositLimit",
          "type": {
            "option": "u64"
          }
        },
        {
          "name": "borrowLimit",
          "type": {
            "option": "u64"
          }
        },
        {
          "name": "totalAssetValueInitLimit",
          "type": {
            "option": "u64"
          }
        }
      ]
    },
    {
      "name": "lendingPoolConfigureBankOracle",
      "docs": [
        "(admin only)"
      ],
      "discriminator": [
        209,
        82,
        255,
        171,
        124,
        21,
        71,
        81
      ],
      "accounts": [
        {
          "name": "group",
          "relations": [
            "bank"
          ]
        },
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "group"
          ]
        },
        {
          "name": "bank",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "setup",
          "type": "u8"
        },
        {
          "name": "oracle",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "lendingPoolEmissionsDeposit",
      "docs": [
        "(permissionless) Deposit same-bank emissions directly into liquidity vault and increase",
        "depositors' value via `asset_share_value`."
      ],
      "discriminator": [
        121,
        118,
        123,
        58,
        59,
        192,
        74,
        138
      ],
      "accounts": [
        {
          "name": "group",
          "relations": [
            "bank"
          ]
        },
        {
          "name": "bank",
          "writable": true
        },
        {
          "name": "mint",
          "relations": [
            "bank"
          ]
        },
        {
          "name": "emissionsFundingAccount",
          "docs": [
            "NOTE: This is a TokenAccount, spl transfer will validate it.",
            ""
          ],
          "writable": true
        },
        {
          "name": "depositor",
          "writable": true,
          "signer": true
        },
        {
          "name": "liquidityVault",
          "writable": true,
          "relations": [
            "bank"
          ]
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "lendingPoolForceTokenlessRepayComplete",
      "docs": [
        "(risk_admin only) - Signals all of a bank's liability have been deleveraged. Used if a bank",
        "still has liability dust after the risk admin has completed deleveraging all debts. The",
        "risk admin is trusted not to execute this until all non-dust debts have been deleveraged."
      ],
      "discriminator": [
        15,
        203,
        147,
        232,
        199,
        14,
        231,
        37
      ],
      "accounts": [
        {
          "name": "group",
          "relations": [
            "bank"
          ]
        },
        {
          "name": "riskAdmin",
          "signer": true,
          "relations": [
            "group"
          ]
        },
        {
          "name": "bank",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "lendingPoolHandleBankruptcy",
      "docs": [
        "(risk_admin or admin, unless `PERMISSIONLESS_BAD_DEBT_SETTLEMENT_FLAG` is set on the bank)",
        "Handle bad debt of a bankrupt marginfi account for a given bank. Covers bad debt from the",
        "insurance fund and socializes any remainder among depositors."
      ],
      "discriminator": [
        162,
        11,
        56,
        139,
        90,
        128,
        70,
        173
      ],
      "accounts": [
        {
          "name": "group",
          "relations": [
            "bank",
            "marginfiAccount"
          ]
        },
        {
          "name": "signer",
          "docs": [
            "Must be risk_admin or admin, unless the bank has PERMISSIONLESS_BAD_DEBT_SETTLEMENT_FLAG",
            "set, in which case any signer is accepted."
          ],
          "signer": true
        },
        {
          "name": "bank",
          "writable": true
        },
        {
          "name": "marginfiAccount",
          "writable": true
        },
        {
          "name": "liquidityVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  113,
                  117,
                  105,
                  100,
                  105,
                  116,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "insuranceVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  115,
                  117,
                  114,
                  97,
                  110,
                  99,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "insuranceVaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  115,
                  117,
                  114,
                  97,
                  110,
                  99,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "lendingPoolInitSameAssetEmodeRegistry",
      "docs": [
        "(admin or emode_admin only) Initialize the per-group same-asset e-mode registry."
      ],
      "discriminator": [
        217,
        78,
        227,
        223,
        147,
        231,
        213,
        108
      ],
      "accounts": [
        {
          "name": "group"
        },
        {
          "name": "signer",
          "writable": true,
          "signer": true
        },
        {
          "name": "sameAssetEmodeRegistry",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  97,
                  109,
                  101,
                  95,
                  97,
                  115,
                  115,
                  101,
                  116,
                  95,
                  101,
                  109,
                  111,
                  100,
                  101,
                  95,
                  114,
                  101,
                  103,
                  105,
                  115,
                  116,
                  114,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "group"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "lendingPoolPulseBankPriceCache",
      "docs": [
        "(Permissionless) Refresh the cached oracle price for a bank."
      ],
      "discriminator": [
        192,
        19,
        201,
        135,
        105,
        203,
        32,
        222
      ],
      "accounts": [
        {
          "name": "group",
          "relations": [
            "bank"
          ]
        },
        {
          "name": "bank",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "lendingPoolResizeGroupAccount",
      "docs": [
        "(permissionless) Resize the group account to the v2 layout size; `payer` funds the",
        "added rent."
      ],
      "discriminator": [
        97,
        221,
        69,
        96,
        204,
        162,
        174,
        250
      ],
      "accounts": [
        {
          "name": "group",
          "docs": [
            "undersized group can still be resized under the future (larger-struct) program."
          ],
          "writable": true
        },
        {
          "name": "payer",
          "docs": [
            "Funds the rent for the added account space."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "lendingPoolSetBankSameAssetEmodeEligibility",
      "docs": [
        "(admin or emode_admin only) Opt a bank in/out of same-asset e-mode participation."
      ],
      "discriminator": [
        149,
        50,
        162,
        236,
        150,
        119,
        9,
        47
      ],
      "accounts": [
        {
          "name": "group",
          "relations": [
            "bank",
            "sameAssetEmodeRegistry"
          ]
        },
        {
          "name": "signer",
          "signer": true
        },
        {
          "name": "bank",
          "writable": true
        },
        {
          "name": "sameAssetEmodeRegistry",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  97,
                  109,
                  101,
                  95,
                  97,
                  115,
                  115,
                  101,
                  116,
                  95,
                  101,
                  109,
                  111,
                  100,
                  101,
                  95,
                  114,
                  101,
                  103,
                  105,
                  115,
                  116,
                  114,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "group"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "enabled",
          "type": "bool"
        }
      ]
    },
    {
      "name": "lendingPoolSetFixedOraclePrice",
      "docs": [
        "(admin only)"
      ],
      "discriminator": [
        28,
        126,
        127,
        127,
        60,
        37,
        211,
        125
      ],
      "accounts": [
        {
          "name": "group",
          "relations": [
            "bank"
          ]
        },
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "group"
          ]
        },
        {
          "name": "bank",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "price",
          "type": {
            "defined": {
              "name": "wrappedI80f48"
            }
          }
        }
      ]
    },
    {
      "name": "lendingPoolUpdateFeesDestinationAccount",
      "docs": [
        "(admin only) Set the destination wallet for permissionless fee withdrawals."
      ],
      "discriminator": [
        102,
        4,
        121,
        243,
        237,
        110,
        95,
        13
      ],
      "accounts": [
        {
          "name": "group",
          "relations": [
            "bank"
          ]
        },
        {
          "name": "bank",
          "writable": true
        },
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "group"
          ]
        },
        {
          "name": "destinationAccount",
          "docs": [
            "Bank fees will be sent to this account which must be an ATA of the bank's mint."
          ]
        }
      ],
      "args": []
    },
    {
      "name": "lendingPoolWithdrawFees",
      "docs": [
        "(admin only) Withdraw collected group fees from the fee vault."
      ],
      "discriminator": [
        92,
        140,
        215,
        254,
        170,
        0,
        83,
        174
      ],
      "accounts": [
        {
          "name": "group",
          "relations": [
            "bank"
          ]
        },
        {
          "name": "bank"
        },
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "group"
          ]
        },
        {
          "name": "feeVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "feeVaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "dstTokenAccount",
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "lendingPoolWithdrawFeesPermissionless",
      "docs": [
        "(permissionless) Withdraw group fees to the pre-configured `fees_destination_account`."
      ],
      "discriminator": [
        57,
        245,
        1,
        208,
        130,
        18,
        145,
        113
      ],
      "accounts": [
        {
          "name": "group",
          "relations": [
            "bank"
          ]
        },
        {
          "name": "bank"
        },
        {
          "name": "feeVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "feeVaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "feesDestinationAccount",
          "writable": true,
          "relations": [
            "bank"
          ]
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "lendingPoolWithdrawInsurance",
      "docs": [
        "(admin only) Withdraw from the insurance vault."
      ],
      "discriminator": [
        108,
        60,
        60,
        246,
        104,
        79,
        159,
        243
      ],
      "accounts": [
        {
          "name": "group",
          "relations": [
            "bank"
          ]
        },
        {
          "name": "bank"
        },
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "group"
          ]
        },
        {
          "name": "insuranceVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  115,
                  117,
                  114,
                  97,
                  110,
                  99,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "insuranceVaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  115,
                  117,
                  114,
                  97,
                  110,
                  99,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "dstTokenAccount",
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "marginfiAccountClose",
      "docs": [
        "(account authority) Close a marginfi account. Requires all balances to be empty and no",
        "active flags (disabled, flashloan, receivership)."
      ],
      "discriminator": [
        186,
        221,
        93,
        34,
        50,
        97,
        194,
        241
      ],
      "accounts": [
        {
          "name": "marginfiAccount",
          "writable": true
        },
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "marginfiAccount"
          ]
        },
        {
          "name": "feePayer",
          "writable": true,
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "marginfiAccountCloseLiqRecord",
      "docs": [
        "(permissionless) Close a liquidation record PDA and return rent to the original payer.",
        "Rent always goes to `record_payer`. Fails if the account is in receivership or deleverage."
      ],
      "discriminator": [
        187,
        222,
        41,
        134,
        102,
        10,
        112,
        147
      ],
      "accounts": [
        {
          "name": "marginfiAccount",
          "writable": true,
          "relations": [
            "liquidationRecord"
          ]
        },
        {
          "name": "liquidationRecord",
          "writable": true,
          "relations": [
            "marginfiAccount"
          ]
        },
        {
          "name": "recordPayer",
          "docs": [
            "The wallet that originally paid to create this record.",
            "Rent is returned here via Anchor's `close` constraint."
          ],
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "marginfiAccountCloseOrder",
      "docs": [
        "(user) Close an existing Order, returning rent to the user"
      ],
      "discriminator": [
        212,
        223,
        79,
        182,
        172,
        183,
        205,
        237
      ],
      "accounts": [
        {
          "name": "group",
          "relations": [
            "marginfiAccount"
          ]
        },
        {
          "name": "marginfiAccount",
          "writable": true,
          "relations": [
            "order"
          ]
        },
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "order",
          "writable": true
        },
        {
          "name": "feeRecipient",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "marginfiAccountEndExecuteOrder",
      "docs": [
        "(permissionless keeper) End Order execution",
        "* Closes the Order (keeper keeps the rent)",
        "* Closes the borrow position involved in the Order, the lending position remains open",
        "* User health must be \"unchanged\" (within Order requirements i.e. minus slippage). Keeper",
        "may keep any slippage in excess of what was needed to complete the Order as profit.",
        "* `StartExecuteOrder` must appear earlier in the tx",
        "* Must appear last in the tx",
        "* CPI is forbidden",
        "* Returns rent for ephemeral accounts created during `StartExecuteOrder`"
      ],
      "discriminator": [
        115,
        42,
        20,
        93,
        121,
        84,
        178,
        83
      ],
      "accounts": [
        {
          "name": "group",
          "relations": [
            "marginfiAccount"
          ]
        },
        {
          "name": "marginfiAccount",
          "docs": [
            "The account owning the order"
          ],
          "writable": true,
          "relations": [
            "order"
          ]
        },
        {
          "name": "executor",
          "docs": [
            "The executioner ☠️"
          ],
          "signer": true,
          "relations": [
            "executeRecord"
          ]
        },
        {
          "name": "feeRecipient",
          "writable": true
        },
        {
          "name": "order",
          "writable": true,
          "relations": [
            "executeRecord"
          ]
        },
        {
          "name": "executeRecord",
          "docs": [
            "This keeps track of the relevant state to be checked at the end of execution."
          ],
          "writable": true
        },
        {
          "name": "feeState",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "marginfiAccountInitLiqRecord",
      "docs": [
        "(permissionless) Initialize a liquidation record PDA for a marginfi account. The fee_payer",
        "pays rent; the record is required for receivership liquidation."
      ],
      "discriminator": [
        236,
        213,
        238,
        126,
        147,
        251,
        164,
        8
      ],
      "accounts": [
        {
          "name": "marginfiAccount",
          "writable": true
        },
        {
          "name": "feePayer",
          "writable": true,
          "signer": true
        },
        {
          "name": "liquidationRecord",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  113,
                  95,
                  114,
                  101,
                  99,
                  111,
                  114,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "marginfiAccount"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "marginfiAccountInitialize",
      "docs": [
        "Initialize a marginfi account for a given group. The account is a fresh keypair, and must",
        "sign. If you are a CPI caller, consider using `marginfi_account_initialize_pda` instead, or",
        "create the account manually and use `transfer_to_new_account` to gift it to the owner you",
        "wish."
      ],
      "discriminator": [
        43,
        78,
        61,
        255,
        148,
        52,
        249,
        154
      ],
      "accounts": [
        {
          "name": "marginfiGroup"
        },
        {
          "name": "marginfiAccount",
          "writable": true,
          "signer": true
        },
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "feePayer",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "marginfiAccountInitializePda",
      "docs": [
        "The same as `marginfi_account_initialize`, except the created marginfi account uses a PDA",
        "(Program Derived Address)",
        "",
        "seeds:",
        "- marginfi_group",
        "- authority: The account authority (owner)",
        "- account_index: A u16 value to allow multiple accounts per authority",
        "- third_party_id: Optional u16 for third-party tagging. Seeds < PDA_FREE_THRESHOLD can be",
        "used freely. For a dedicated seed used by just your program (via CPI), contact us."
      ],
      "discriminator": [
        87,
        177,
        91,
        80,
        218,
        119,
        245,
        31
      ],
      "accounts": [
        {
          "name": "marginfiGroup"
        },
        {
          "name": "marginfiAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  103,
                  105,
                  110,
                  102,
                  105,
                  95,
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "marginfiGroup"
              },
              {
                "kind": "account",
                "path": "authority"
              },
              {
                "kind": "arg",
                "path": "accountIndex"
              },
              {
                "kind": "arg",
                "path": "third_party_id.unwrap_or(0)"
              }
            ]
          }
        },
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "feePayer",
          "writable": true,
          "signer": true
        },
        {
          "name": "instructionsSysvar",
          "docs": [
            "Instructions sysvar for CPI validation",
            ""
          ],
          "address": "Sysvar1nstructions1111111111111111111111111"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "accountIndex",
          "type": "u16"
        },
        {
          "name": "thirdPartyId",
          "type": {
            "option": "u16"
          }
        }
      ]
    },
    {
      "name": "marginfiAccountKeeperCloseOrder",
      "docs": [
        "(permissionless keeper) Close an existing Order after the user account was closed, or it no",
        "longer has the associated positions, or the user has executed",
        "`marginfi_account_set_keeper_close_flags`. Keeper keeps the rent."
      ],
      "discriminator": [
        128,
        114,
        71,
        46,
        194,
        71,
        186,
        106
      ],
      "accounts": [
        {
          "name": "marginfiAccount",
          "docs": [
            "marginfi account was closed.",
            "The ownership check is checked in the handler or/and type checks are made in the handler."
          ],
          "writable": true,
          "relations": [
            "order"
          ]
        },
        {
          "name": "feeRecipient",
          "writable": true
        },
        {
          "name": "order",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "marginfiAccountPlaceOrder",
      "docs": [
        "(user) Create a new Order.",
        "* bank_keys - Currently only two keys: the lending position and borrowing position in the",
        "users's Balances for which the order is being placed",
        "* trigger - the type of order (stop loss, take profit, or both), and the threshold at which",
        "to trigger the order, in dollars"
      ],
      "discriminator": [
        244,
        112,
        75,
        138,
        143,
        108,
        7,
        186
      ],
      "accounts": [
        {
          "name": "group",
          "relations": [
            "marginfiAccount"
          ]
        },
        {
          "name": "marginfiAccount",
          "writable": true
        },
        {
          "name": "feePayer",
          "writable": true,
          "signer": true
        },
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "marginfiAccount"
          ]
        },
        {
          "name": "order",
          "writable": true
        },
        {
          "name": "feeState",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "globalFeeWallet",
          "writable": true,
          "relations": [
            "feeState"
          ]
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "bankKeys",
          "type": {
            "vec": "pubkey"
          }
        },
        {
          "name": "trigger",
          "type": {
            "defined": {
              "name": "orderTrigger"
            }
          }
        }
      ]
    },
    {
      "name": "marginfiAccountSetFreeze",
      "docs": [
        "(admin only) Freeze or unfreeze a marginfi account. Frozen accounts can only be operated on",
        "by the group admin."
      ],
      "discriminator": [
        199,
        179,
        231,
        30,
        138,
        247,
        110,
        227
      ],
      "accounts": [
        {
          "name": "group",
          "relations": [
            "marginfiAccount"
          ]
        },
        {
          "name": "marginfiAccount",
          "writable": true
        },
        {
          "name": "admin",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "frozen",
          "type": "bool"
        }
      ]
    },
    {
      "name": "marginfiAccountSetKeeperCloseFlags",
      "docs": [
        "(user) Purge flags from some balances, enabling a Keeper to call",
        "`marginfi_account_keeper_close_order` on associated Orders. Typically, use",
        "`marginfi_account_close_order` instead if trying to close an Order."
      ],
      "discriminator": [
        82,
        163,
        165,
        222,
        212,
        255,
        33,
        210
      ],
      "accounts": [
        {
          "name": "group",
          "relations": [
            "marginfiAccount"
          ]
        },
        {
          "name": "marginfiAccount",
          "writable": true
        },
        {
          "name": "authority",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "bankKeysOpt",
          "type": {
            "option": {
              "vec": "pubkey"
            }
          }
        }
      ]
    },
    {
      "name": "marginfiAccountStartExecuteOrder",
      "docs": [
        "(permissionless keeper) Begin Order execution",
        "* Enables the Keeper to withdraw/repay associated positions until the end of the tx",
        "* Only one `StartExecuteOrder` is allowed per tx",
        "* Must appear before `EndExecuteOrder` in the tx, and before any instructions except certain",
        "allowed ones (compute budget, kamino refresh, etc)",
        "* `EndExecuteOrder` must also appear in the tx",
        "* CPI is forbidden",
        "* Costs a small amount of rent, which is returned at the end of the tx, make sure you have",
        "enough SOL to start the tx."
      ],
      "discriminator": [
        1,
        70,
        140,
        134,
        183,
        29,
        208,
        224
      ],
      "accounts": [
        {
          "name": "group",
          "relations": [
            "marginfiAccount"
          ]
        },
        {
          "name": "marginfiAccount",
          "docs": [
            "The account owning the order"
          ],
          "writable": true,
          "relations": [
            "order"
          ]
        },
        {
          "name": "feePayer",
          "writable": true,
          "signer": true
        },
        {
          "name": "executor",
          "docs": [
            "This account will have the authority to withdraw/repay as if they are the user authority",
            "until the end of the tx.",
            ""
          ]
        },
        {
          "name": "order",
          "writable": true
        },
        {
          "name": "executeRecord",
          "docs": [
            "This keeps track of the relevant state to be checked at the end of execution."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  120,
                  101,
                  99,
                  117,
                  116,
                  101,
                  95,
                  111,
                  114,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "order"
              }
            ]
          }
        },
        {
          "name": "instructionSysvar",
          "address": "Sysvar1nstructions1111111111111111111111111"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "marginfiAccountUpdateEmissionsDestinationAccount",
      "docs": [
        "(account authority) Set the wallet whose canonical ATA will receive off-chain emissions."
      ],
      "discriminator": [
        73,
        185,
        162,
        201,
        111,
        24,
        116,
        185
      ],
      "accounts": [
        {
          "name": "marginfiAccount",
          "writable": true
        },
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "destinationAccount",
          "docs": [
            "the canonical ATA for each emissions mint."
          ]
        }
      ],
      "args": []
    },
    {
      "name": "marginfiGroupConfigure",
      "docs": [
        "(admin only) Configure group admin keys and emode leverage caps. All admin keys must be",
        "provided on every call. Emode leverage caps are set if provided, otherwise the existing",
        "(non-zero) values are kept. Pass `Some(value)` to update, `None` to leave unchanged.",
        "Same-asset emode leverage is disabled by configuring both init and maint leverage to `1`;",
        "values below `1`, including `0`, are invalid.",
        "",
        "Note: `new_emissions_admin` is deprecated and currently has no on-chain effect."
      ],
      "discriminator": [
        62,
        199,
        81,
        78,
        33,
        13,
        236,
        61
      ],
      "accounts": [
        {
          "name": "marginfiGroup",
          "writable": true
        },
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "marginfiGroup"
          ]
        }
      ],
      "args": [
        {
          "name": "newAdmin",
          "type": {
            "option": "pubkey"
          }
        },
        {
          "name": "newEmodeAdmin",
          "type": {
            "option": "pubkey"
          }
        },
        {
          "name": "newCurveAdmin",
          "type": {
            "option": "pubkey"
          }
        },
        {
          "name": "newLimitAdmin",
          "type": {
            "option": "pubkey"
          }
        },
        {
          "name": "newFlowAdmin",
          "type": {
            "option": "pubkey"
          }
        },
        {
          "name": "newEmissionsAdmin",
          "type": {
            "option": "pubkey"
          }
        },
        {
          "name": "newMetadataAdmin",
          "type": {
            "option": "pubkey"
          }
        },
        {
          "name": "newRiskAdmin",
          "type": {
            "option": "pubkey"
          }
        },
        {
          "name": "emodeMaxInitLeverage",
          "type": {
            "option": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          }
        },
        {
          "name": "emodeMaxMaintLeverage",
          "type": {
            "option": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          }
        },
        {
          "name": "sameAssetEmodeInitLeverage",
          "type": {
            "option": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          }
        },
        {
          "name": "sameAssetEmodeMaintLeverage",
          "type": {
            "option": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          }
        }
      ]
    },
    {
      "name": "marginfiGroupInitialize",
      "docs": [
        "(admin only) Initialize a new marginfi group. The signer becomes the group admin."
      ],
      "discriminator": [
        255,
        67,
        67,
        26,
        94,
        31,
        34,
        20
      ],
      "accounts": [
        {
          "name": "marginfiGroup",
          "writable": true,
          "signer": true
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "feeState",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "panicPause",
      "docs": [
        "(global_fee_admin or pause_delegate_admin only) Pause the protocol. Auto-expires after 6",
        "hours. Limited to 3 pauses per day and 4 consecutive pauses."
      ],
      "discriminator": [
        76,
        164,
        123,
        25,
        4,
        43,
        79,
        165
      ],
      "accounts": [
        {
          "name": "pauseAuthority",
          "docs": [
            "Global fee admin or the dedicated pause delegate admin."
          ],
          "signer": true
        },
        {
          "name": "feeState",
          "docs": [
            "Global fee state account containing the panic state"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "panicUnpause",
      "docs": [
        "(global_fee_admin only) Unpause the protocol before auto-expiry."
      ],
      "discriminator": [
        236,
        107,
        194,
        242,
        99,
        51,
        121,
        128
      ],
      "accounts": [
        {
          "name": "globalFeeAdmin",
          "docs": [
            "Global fee admin only."
          ],
          "writable": true,
          "signer": true,
          "relations": [
            "feeState"
          ]
        },
        {
          "name": "feeState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "panicUnpausePermissionless",
      "docs": [
        "(permissionless) Unpause the protocol when pause time has expired"
      ],
      "discriminator": [
        245,
        139,
        50,
        159,
        213,
        62,
        91,
        248
      ],
      "accounts": [
        {
          "name": "feeState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "propagateFeeState",
      "docs": [
        "(Permissionless) Force any group to adopt the current FeeState settings"
      ],
      "discriminator": [
        64,
        3,
        166,
        194,
        129,
        21,
        101,
        155
      ],
      "accounts": [
        {
          "name": "feeState",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "marginfiGroup",
          "docs": [
            "Any group, this ix is permisionless and can propagate the fee to any group"
          ],
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "propagateStakedSettings",
      "docs": [
        "(permissionless) Propagate updated staked settings to a staked collateral bank."
      ],
      "discriminator": [
        210,
        30,
        152,
        69,
        130,
        99,
        222,
        170
      ],
      "accounts": [
        {
          "name": "marginfiGroup",
          "relations": [
            "stakedSettings"
          ]
        },
        {
          "name": "stakedSettings"
        },
        {
          "name": "bank",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "purgeDeleverageBalance",
      "docs": [
        "(risk admin only) Purge a user's lending balance on a bank being sunset, without paying the",
        "user anything. Only usable after all the debt has been settled on a bank in deleveraging",
        "mode, i.e. `TOKENLESS_REPAYMENTS_ALLOWED` and `TOKENLESS_REPAYMENTS_COMPLETE`. Used to clear",
        "abandoned lending positions in a now-worthless bank so it can be closed via",
        "`lending_pool_close_bank`."
      ],
      "discriminator": [
        132,
        187,
        25,
        149,
        181,
        59,
        253,
        136
      ],
      "accounts": [
        {
          "name": "group",
          "relations": [
            "marginfiAccount",
            "bank"
          ]
        },
        {
          "name": "marginfiAccount",
          "writable": true
        },
        {
          "name": "riskAdmin",
          "signer": true,
          "relations": [
            "group"
          ]
        },
        {
          "name": "bank",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "resizeGlobalFeeState",
      "docs": [
        "(permissionless) Resize the fee-state account to the v2 layout size; `payer` funds the",
        "added rent."
      ],
      "discriminator": [
        141,
        111,
        97,
        79,
        111,
        143,
        77,
        159
      ],
      "accounts": [
        {
          "name": "feeState",
          "docs": [
            "Not an AccountLoader so an undersized fee state can still be resized under the future",
            "(larger-struct) program."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "payer",
          "docs": [
            "Funds the rent for the added account space."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "solendDeposit",
      "docs": [
        "(user) Deposit into a Solend reserve through a marginfi account",
        "* amount - in the underlying token (e.g., USDC), in native decimals"
      ],
      "discriminator": [
        56,
        127,
        176,
        148,
        12,
        25,
        3,
        24
      ],
      "accounts": [
        {
          "name": "group",
          "relations": [
            "marginfiAccount",
            "bank"
          ]
        },
        {
          "name": "marginfiAccount",
          "writable": true
        },
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "bank",
          "writable": true
        },
        {
          "name": "signerTokenAccount",
          "docs": [
            "Owned by authority, the source account for the token deposit."
          ],
          "writable": true
        },
        {
          "name": "liquidityVaultAuthority",
          "docs": [
            "The bank's liquidity vault authority, which owns the Solend obligation"
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  113,
                  117,
                  105,
                  100,
                  105,
                  116,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "liquidityVault",
          "docs": [
            "Used as an intermediary to deposit tokens into Solend"
          ],
          "writable": true,
          "relations": [
            "bank"
          ]
        },
        {
          "name": "integrationAcc2",
          "docs": [
            "The Solend obligation account"
          ],
          "writable": true,
          "relations": [
            "bank"
          ]
        },
        {
          "name": "lendingMarket"
        },
        {
          "name": "lendingMarketAuthority",
          "docs": [
            "Derived from the lending market"
          ]
        },
        {
          "name": "integrationAcc1",
          "docs": [
            "The Solend reserve that holds liquidity"
          ],
          "writable": true,
          "relations": [
            "bank"
          ]
        },
        {
          "name": "mint",
          "docs": [
            "Bank's liquidity token mint (e.g., USDC)"
          ],
          "relations": [
            "bank"
          ]
        },
        {
          "name": "reserveLiquiditySupply",
          "docs": [
            "Reserve's liquidity supply SPL Token account"
          ],
          "writable": true
        },
        {
          "name": "reserveCollateralMint",
          "docs": [
            "The reserve's mint for cTokens"
          ],
          "writable": true
        },
        {
          "name": "reserveCollateralSupply",
          "docs": [
            "The reserve's collateral supply account (where cTokens are stored)"
          ],
          "writable": true
        },
        {
          "name": "userCollateral",
          "docs": [
            "The user's destination for cTokens (collateral). This is a temporary account owned by",
            "liquidity_vault_authority that will hold cTokens between deposit and obligation update."
          ],
          "writable": true
        },
        {
          "name": "pythPrice",
          "docs": [
            "Oracle accounts - required by Solend even if not actively used"
          ]
        },
        {
          "name": "switchboardFeed"
        },
        {
          "name": "solendProgram",
          "address": "So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo"
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "solendInitObligation",
      "docs": [
        "(permissionless) Initialize a Solend obligation for a marginfi bank",
        "Requires a minimum deposit to ensure the obligation remains active",
        "* amount - minimum deposit amount (at least 10 units) in native decimals"
      ],
      "discriminator": [
        81,
        96,
        123,
        149,
        218,
        116,
        235,
        196
      ],
      "accounts": [
        {
          "name": "feePayer",
          "docs": [
            "Pays to init the obligation and pays a nominal amount to ensure the obligation has a",
            "non-zero balance."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "bank"
        },
        {
          "name": "signerTokenAccount",
          "docs": [
            "The fee payer must provide a nominal amount of bank tokens so the obligation is not empty.",
            "This amount is irrecoverable and will prevent the obligation from ever being closed."
          ],
          "writable": true
        },
        {
          "name": "liquidityVaultAuthority",
          "docs": [
            "The liquidity vault authority (PDA that will own the Solend obligation)"
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  113,
                  117,
                  105,
                  100,
                  105,
                  116,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "liquidityVault",
          "docs": [
            "Used as an intermediary to deposit a nominal amount of token into the obligation."
          ],
          "writable": true,
          "relations": [
            "bank"
          ]
        },
        {
          "name": "integrationAcc2",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  111,
                  108,
                  101,
                  110,
                  100,
                  95,
                  111,
                  98,
                  108,
                  105,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          },
          "relations": [
            "bank"
          ]
        },
        {
          "name": "lendingMarket"
        },
        {
          "name": "lendingMarketAuthority",
          "docs": [
            "Derived from the lending market"
          ]
        },
        {
          "name": "integrationAcc1",
          "writable": true,
          "relations": [
            "bank"
          ]
        },
        {
          "name": "mint",
          "docs": [
            "Bank's liquidity token mint (e.g., USDC)"
          ],
          "writable": true,
          "relations": [
            "bank"
          ]
        },
        {
          "name": "reserveLiquiditySupply",
          "writable": true
        },
        {
          "name": "reserveCollateralMint",
          "docs": [
            "The reserve's mint for cTokens"
          ],
          "writable": true
        },
        {
          "name": "reserveCollateralSupply",
          "docs": [
            "The reserve's collateral supply account (where cTokens are stored)"
          ],
          "writable": true
        },
        {
          "name": "userCollateral",
          "docs": [
            "The user's destination for cTokens (collateral). This is a temporary account owned by",
            "liquidity_vault_authority that will hold cTokens between deposit and obligation update."
          ],
          "writable": true
        },
        {
          "name": "pythPrice",
          "docs": [
            "Oracle accounts - required by Solend even if not actively used"
          ]
        },
        {
          "name": "switchboardFeed"
        },
        {
          "name": "solendProgram",
          "address": "So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "solendWithdraw",
      "docs": [
        "(user) Withdraw from a Solend reserve through a marginfi account",
        "* amount - in collateral tokens (cTokens), in native decimals",
        "* if group rate limits are enabled, include the withdrawn bank's oracle group in",
        "`remaining_accounts`",
        "* withdraw_all - withdraw entire position if true"
      ],
      "discriminator": [
        238,
        144,
        170,
        199,
        21,
        72,
        155,
        36
      ],
      "accounts": [
        {
          "name": "group",
          "relations": [
            "marginfiAccount",
            "bank"
          ]
        },
        {
          "name": "marginfiAccount",
          "writable": true
        },
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "bank",
          "writable": true
        },
        {
          "name": "destinationTokenAccount",
          "docs": [
            "Token account that will receive the withdrawn tokens. Mint/owner are validated by the",
            "SPL transfer; the caller controls the destination."
          ],
          "writable": true
        },
        {
          "name": "liquidityVaultAuthority",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  113,
                  117,
                  105,
                  100,
                  105,
                  116,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "liquidityVault",
          "writable": true,
          "relations": [
            "bank"
          ]
        },
        {
          "name": "integrationAcc2",
          "docs": [
            "The Solend obligation account"
          ],
          "writable": true,
          "relations": [
            "bank"
          ]
        },
        {
          "name": "lendingMarket",
          "writable": true
        },
        {
          "name": "lendingMarketAuthority",
          "docs": [
            "Derived from the lending market"
          ]
        },
        {
          "name": "integrationAcc1",
          "docs": [
            "The Solend reserve that holds liquidity"
          ],
          "writable": true,
          "relations": [
            "bank"
          ]
        },
        {
          "name": "mint",
          "docs": [
            "Bank's liquidity token mint (e.g., USDC)"
          ],
          "relations": [
            "bank"
          ]
        },
        {
          "name": "reserveLiquiditySupply",
          "docs": [
            "Reserve's liquidity supply SPL Token account"
          ],
          "writable": true
        },
        {
          "name": "reserveCollateralMint",
          "docs": [
            "The reserve's mint for cTokens"
          ],
          "writable": true
        },
        {
          "name": "reserveCollateralSupply",
          "docs": [
            "The reserve's collateral supply account (where cTokens are stored)"
          ],
          "writable": true
        },
        {
          "name": "userCollateral",
          "docs": [
            "The user's destination for cTokens (collateral). This is a temporary account owned by",
            "liquidity_vault_authority that holds cTokens."
          ],
          "writable": true
        },
        {
          "name": "solendProgram",
          "address": "So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo"
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "withdrawAll",
          "type": {
            "option": "bool"
          }
        }
      ]
    },
    {
      "name": "startDeleverage",
      "docs": [
        "(risk_admin only) Begin forced deleverage on an account. Similar to start_liquidation but",
        "does not require the account to be unhealthy."
      ],
      "discriminator": [
        10,
        138,
        10,
        57,
        40,
        232,
        182,
        193
      ],
      "accounts": [
        {
          "name": "marginfiAccount",
          "docs": [
            "Account to deleverage"
          ],
          "writable": true
        },
        {
          "name": "liquidationRecord",
          "docs": [
            "The associated liquidation record PDA for the given `marginfi_account`"
          ],
          "writable": true,
          "relations": [
            "marginfiAccount"
          ]
        },
        {
          "name": "group",
          "relations": [
            "marginfiAccount"
          ]
        },
        {
          "name": "riskAdmin",
          "docs": [
            "The risk admin will have the authority to withdraw/repay as if they are the user authority",
            "until the end of the tx."
          ],
          "signer": true,
          "relations": [
            "group"
          ]
        },
        {
          "name": "instructionSysvar",
          "address": "Sysvar1nstructions1111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "startLiquidation",
      "docs": [
        "(permissionless) Begin receivership liquidation on an unhealthy account. Snapshots health",
        "and marks the account in receivership. Must have `end_liquidation` as the last ix in the tx."
      ],
      "discriminator": [
        244,
        93,
        90,
        214,
        192,
        166,
        191,
        21
      ],
      "accounts": [
        {
          "name": "marginfiAccount",
          "docs": [
            "Account under liquidation"
          ],
          "writable": true
        },
        {
          "name": "liquidationRecord",
          "docs": [
            "The associated liquidation record PDA for the given `marginfi_account`"
          ],
          "writable": true,
          "relations": [
            "marginfiAccount"
          ]
        },
        {
          "name": "group",
          "relations": [
            "marginfiAccount"
          ]
        },
        {
          "name": "liquidationReceiver",
          "docs": [
            "This account will have the authority to withdraw/repay as if they are the user authority",
            "until the end of the tx.",
            ""
          ]
        },
        {
          "name": "instructionSysvar",
          "address": "Sysvar1nstructions1111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "superAdminDeposit",
      "docs": [
        "(primary admin only) Deposit directly into a bank liquidity vault and raise",
        "`asset_share_value` proportionally. No marginfi account is involved."
      ],
      "discriminator": [
        241,
        189,
        199,
        17,
        207,
        225,
        64,
        75
      ],
      "accounts": [
        {
          "name": "group",
          "relations": [
            "bank"
          ]
        },
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "group"
          ]
        },
        {
          "name": "bank",
          "writable": true
        },
        {
          "name": "adminTokenAccount",
          "writable": true
        },
        {
          "name": "liquidityVault",
          "writable": true,
          "relations": [
            "bank"
          ]
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "superAdminWithdraw",
      "docs": [
        "(primary admin only) Withdraw directly from a bank liquidity vault and lower",
        "`asset_share_value` proportionally. No marginfi account is involved."
      ],
      "discriminator": [
        202,
        67,
        85,
        126,
        104,
        138,
        79,
        197
      ],
      "accounts": [
        {
          "name": "group",
          "relations": [
            "bank"
          ]
        },
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "group"
          ]
        },
        {
          "name": "bank",
          "writable": true
        },
        {
          "name": "destinationTokenAccount",
          "writable": true
        },
        {
          "name": "liquidityVaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  113,
                  117,
                  105,
                  100,
                  105,
                  116,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "bank"
              }
            ]
          }
        },
        {
          "name": "liquidityVault",
          "writable": true,
          "relations": [
            "bank"
          ]
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "syncIndexerFlags",
      "docs": [
        "(Permissionless) Batch-sync balance-derived indexer flags for existing accounts.",
        "Pass MarginfiAccounts as writable remaining_accounts."
      ],
      "discriminator": [
        171,
        146,
        145,
        43,
        190,
        175,
        9,
        32
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "transferToNewAccount",
      "docs": [
        "(account authority) Transfer all positions to a new account under a new authority. The old",
        "account is disabled. Pays a flat SOL fee to the protocol."
      ],
      "discriminator": [
        28,
        79,
        129,
        231,
        169,
        69,
        69,
        65
      ],
      "accounts": [
        {
          "name": "group",
          "relations": [
            "oldMarginfiAccount"
          ]
        },
        {
          "name": "oldMarginfiAccount",
          "writable": true
        },
        {
          "name": "newMarginfiAccount",
          "writable": true,
          "signer": true
        },
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "feePayer",
          "writable": true,
          "signer": true
        },
        {
          "name": "newAuthority"
        },
        {
          "name": "globalFeeWallet",
          "writable": true
        },
        {
          "name": "feeState",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "transferToNewAccountPda",
      "docs": [
        "(account authority) Same as `transfer_to_new_account` except the resulting account is a PDA",
        "",
        "seeds:",
        "- marginfi_group",
        "- authority: The account authority (owner)",
        "- account_index: A u16 value to allow multiple accounts per authority",
        "- third_party_id: Optional u16 for third-party tagging. Seeds < PDA_FREE_THRESHOLD can be",
        "used freely. For a dedicated seed used by just your program (via CPI), contact us."
      ],
      "discriminator": [
        172,
        210,
        224,
        220,
        146,
        212,
        253,
        49
      ],
      "accounts": [
        {
          "name": "group",
          "relations": [
            "oldMarginfiAccount"
          ]
        },
        {
          "name": "oldMarginfiAccount",
          "writable": true
        },
        {
          "name": "newMarginfiAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  103,
                  105,
                  110,
                  102,
                  105,
                  95,
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "group"
              },
              {
                "kind": "account",
                "path": "newAuthority"
              },
              {
                "kind": "arg",
                "path": "accountIndex"
              },
              {
                "kind": "arg",
                "path": "third_party_id.unwrap_or(0)"
              }
            ]
          }
        },
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "feePayer",
          "writable": true,
          "signer": true
        },
        {
          "name": "newAuthority"
        },
        {
          "name": "globalFeeWallet",
          "writable": true
        },
        {
          "name": "feeState",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "instructionsSysvar",
          "docs": [
            "Instructions sysvar for CPI validation"
          ],
          "address": "Sysvar1nstructions1111111111111111111111111"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "accountIndex",
          "type": "u16"
        },
        {
          "name": "thirdPartyId",
          "type": {
            "option": "u16"
          }
        }
      ]
    },
    {
      "name": "updateDeleverageWithdrawals",
      "docs": [
        "(delegate_flow_admin only) Update the deleverage daily withdraw outflow with",
        "aggregated data. The delegate flow admin aggregates",
        "`DeleverageWithdrawFlowEvent` events off-chain and calls this instruction at intervals."
      ],
      "discriminator": [
        56,
        3,
        181,
        118,
        27,
        247,
        207,
        227
      ],
      "accounts": [
        {
          "name": "marginfiGroup",
          "writable": true
        },
        {
          "name": "delegateFlowAdmin",
          "signer": true,
          "relations": [
            "marginfiGroup"
          ]
        }
      ],
      "args": [
        {
          "name": "outflowUsd",
          "type": "u32"
        },
        {
          "name": "updateSeq",
          "type": "u64"
        },
        {
          "name": "eventStartSlot",
          "type": "u64"
        },
        {
          "name": "eventEndSlot",
          "type": "u64"
        }
      ]
    },
    {
      "name": "updateGroupRateLimiter",
      "docs": [
        "(delegate_flow_admin only) Update the group rate limiter with aggregated",
        "inflow/outflow. The delegate flow admin aggregates",
        "`RateLimitFlowEvent` events off-chain, converts to USD, and calls this instruction at",
        "intervals to update group rate limiter state."
      ],
      "discriminator": [
        23,
        78,
        60,
        139,
        187,
        44,
        129,
        37
      ],
      "accounts": [
        {
          "name": "marginfiGroup",
          "writable": true
        },
        {
          "name": "delegateFlowAdmin",
          "signer": true,
          "relations": [
            "marginfiGroup"
          ]
        }
      ],
      "args": [
        {
          "name": "outflowUsd",
          "type": {
            "option": "u64"
          }
        },
        {
          "name": "inflowUsd",
          "type": {
            "option": "u64"
          }
        },
        {
          "name": "updateSeq",
          "type": "u64"
        },
        {
          "name": "eventStartSlot",
          "type": "u64"
        },
        {
          "name": "eventEndSlot",
          "type": "u64"
        }
      ]
    },
    {
      "name": "writeBankMetadata",
      "docs": [
        "(metadata admin only) Write ticker/description for an initialized bank. The bank account",
        "must exist; when its seed is on-chain, the canonical PDA is verified."
      ],
      "discriminator": [
        147,
        78,
        81,
        133,
        129,
        138,
        233,
        59
      ],
      "accounts": [
        {
          "name": "group",
          "relations": [
            "bank"
          ]
        },
        {
          "name": "bank",
          "docs": [
            "Must be initialized. The metadata-to-bank binding is enforced by `metadata.has_one = bank`,",
            "and `bank.has_one = group` ties this bank to the admin's group."
          ],
          "relations": [
            "metadata"
          ]
        },
        {
          "name": "metadataAdmin",
          "writable": true,
          "signer": true,
          "relations": [
            "group"
          ]
        },
        {
          "name": "metadata",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "ticker",
          "type": {
            "option": "bytes"
          }
        },
        {
          "name": "description",
          "type": {
            "option": "bytes"
          }
        }
      ]
    },
    {
      "name": "writeBankMetadataPreInit",
      "docs": [
        "(metadata admin only) Write ticker/description before bank initialization, for canonical",
        "seeded banks only."
      ],
      "discriminator": [
        224,
        124,
        22,
        73,
        60,
        209,
        80,
        170
      ],
      "accounts": [
        {
          "name": "group"
        },
        {
          "name": "bankMint"
        },
        {
          "name": "bank",
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "group"
              },
              {
                "kind": "account",
                "path": "bankMint"
              },
              {
                "kind": "arg",
                "path": "bankSeed"
              }
            ]
          },
          "relations": [
            "metadata"
          ]
        },
        {
          "name": "metadataAdmin",
          "writable": true,
          "signer": true,
          "relations": [
            "group"
          ]
        },
        {
          "name": "metadata",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "bankSeed",
          "type": "u64"
        },
        {
          "name": "ticker",
          "type": {
            "option": "bytes"
          }
        },
        {
          "name": "description",
          "type": {
            "option": "bytes"
          }
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "bank",
      "discriminator": [
        142,
        49,
        166,
        242,
        50,
        66,
        97,
        188
      ]
    },
    {
      "name": "bankMetadata",
      "discriminator": [
        49,
        207,
        31,
        34,
        67,
        225,
        169,
        186
      ]
    },
    {
      "name": "executeOrderRecord",
      "discriminator": [
        6,
        100,
        107,
        60,
        164,
        226,
        56,
        97
      ]
    },
    {
      "name": "feeState",
      "discriminator": [
        63,
        224,
        16,
        85,
        193,
        36,
        235,
        220
      ]
    },
    {
      "name": "liquidationRecord",
      "discriminator": [
        95,
        116,
        23,
        132,
        89,
        210,
        245,
        162
      ]
    },
    {
      "name": "marginfiAccount",
      "discriminator": [
        67,
        178,
        130,
        109,
        126,
        114,
        28,
        42
      ]
    },
    {
      "name": "marginfiGroup",
      "discriminator": [
        182,
        23,
        173,
        240,
        151,
        206,
        182,
        67
      ]
    },
    {
      "name": "order",
      "discriminator": [
        134,
        173,
        223,
        185,
        77,
        86,
        28,
        51
      ]
    },
    {
      "name": "sameAssetEmodeRegistry",
      "discriminator": [
        222,
        21,
        195,
        149,
        193,
        72,
        219,
        31
      ]
    },
    {
      "name": "stakedSettings",
      "discriminator": [
        157,
        140,
        6,
        77,
        89,
        173,
        173,
        125
      ]
    }
  ],
  "events": [
    {
      "name": "adminCloseAccountEvent",
      "discriminator": [
        166,
        92,
        180,
        81,
        158,
        251,
        225,
        73
      ]
    },
    {
      "name": "circuitBreakerAutoBrokenEvent",
      "discriminator": [
        104,
        30,
        251,
        194,
        213,
        139,
        21,
        230
      ]
    },
    {
      "name": "circuitBreakerClearedEvent",
      "discriminator": [
        97,
        244,
        85,
        48,
        246,
        155,
        29,
        219
      ]
    },
    {
      "name": "circuitBreakerTrippedEvent",
      "discriminator": [
        112,
        68,
        182,
        85,
        54,
        184,
        4,
        134
      ]
    },
    {
      "name": "deleverageEvent",
      "discriminator": [
        161,
        8,
        108,
        204,
        209,
        198,
        12,
        30
      ]
    },
    {
      "name": "deleverageWithdrawFlowEvent",
      "discriminator": [
        109,
        90,
        139,
        200,
        10,
        204,
        84,
        176
      ]
    },
    {
      "name": "driftClaimBadDebtEvent",
      "discriminator": [
        20,
        106,
        26,
        156,
        28,
        116,
        250,
        172
      ]
    },
    {
      "name": "editStakedSettingsEvent",
      "discriminator": [
        29,
        58,
        155,
        191,
        75,
        220,
        145,
        206
      ]
    },
    {
      "name": "healthPulseEvent",
      "discriminator": [
        183,
        159,
        218,
        110,
        61,
        220,
        65,
        1
      ]
    },
    {
      "name": "keeperCloseOrderEvent",
      "discriminator": [
        46,
        152,
        11,
        174,
        92,
        157,
        77,
        64
      ]
    },
    {
      "name": "lendingAccountBorrowEvent",
      "discriminator": [
        223,
        96,
        81,
        10,
        156,
        99,
        26,
        59
      ]
    },
    {
      "name": "lendingAccountDepositEvent",
      "discriminator": [
        161,
        54,
        237,
        217,
        105,
        248,
        122,
        151
      ]
    },
    {
      "name": "lendingAccountLiquidateEvent",
      "discriminator": [
        166,
        160,
        249,
        154,
        183,
        39,
        23,
        242
      ]
    },
    {
      "name": "lendingAccountRepayEvent",
      "discriminator": [
        16,
        220,
        55,
        111,
        7,
        80,
        16,
        25
      ]
    },
    {
      "name": "lendingAccountWithdrawEvent",
      "discriminator": [
        3,
        220,
        148,
        243,
        33,
        249,
        54,
        88
      ]
    },
    {
      "name": "lendingPoolBankAccrueInterestEvent",
      "discriminator": [
        104,
        117,
        187,
        156,
        111,
        154,
        106,
        186
      ]
    },
    {
      "name": "lendingPoolBankCollectFeesEvent",
      "discriminator": [
        101,
        119,
        97,
        250,
        169,
        175,
        156,
        253
      ]
    },
    {
      "name": "lendingPoolBankConfigureEvent",
      "discriminator": [
        246,
        35,
        233,
        110,
        93,
        152,
        235,
        40
      ]
    },
    {
      "name": "lendingPoolBankConfigureFrozenEvent",
      "discriminator": [
        24,
        10,
        55,
        18,
        49,
        150,
        157,
        179
      ]
    },
    {
      "name": "lendingPoolBankConfigureOracleEvent",
      "discriminator": [
        119,
        140,
        110,
        253,
        150,
        64,
        210,
        62
      ]
    },
    {
      "name": "lendingPoolBankCreateEvent",
      "discriminator": [
        236,
        220,
        201,
        63,
        239,
        126,
        136,
        249
      ]
    },
    {
      "name": "lendingPoolBankHandleBankruptcyEvent",
      "discriminator": [
        166,
        77,
        41,
        140,
        36,
        94,
        10,
        57
      ]
    },
    {
      "name": "lendingPoolBankSetFixedOraclePriceEvent",
      "discriminator": [
        65,
        72,
        8,
        85,
        229,
        20,
        90,
        26
      ]
    },
    {
      "name": "lendingPoolBankSetSameAssetEmodeEligibilityEvent",
      "discriminator": [
        186,
        247,
        119,
        107,
        251,
        215,
        15,
        79
      ]
    },
    {
      "name": "lendingPoolSuperAdminDepositEvent",
      "discriminator": [
        99,
        152,
        211,
        30,
        58,
        165,
        210,
        71
      ]
    },
    {
      "name": "lendingPoolSuperAdminWithdrawEvent",
      "discriminator": [
        107,
        168,
        232,
        181,
        144,
        161,
        252,
        37
      ]
    },
    {
      "name": "liquidationReceiverEvent",
      "discriminator": [
        40,
        131,
        224,
        220,
        151,
        83,
        24,
        230
      ]
    },
    {
      "name": "marginfiAccountCloseOrderEvent",
      "discriminator": [
        158,
        34,
        122,
        98,
        23,
        146,
        229,
        212
      ]
    },
    {
      "name": "marginfiAccountCreateEvent",
      "discriminator": [
        183,
        5,
        117,
        104,
        122,
        199,
        68,
        51
      ]
    },
    {
      "name": "marginfiAccountFreezeEvent",
      "discriminator": [
        219,
        219,
        57,
        178,
        75,
        86,
        146,
        122
      ]
    },
    {
      "name": "marginfiAccountPlaceOrderEvent",
      "discriminator": [
        1,
        105,
        79,
        28,
        142,
        242,
        99,
        145
      ]
    },
    {
      "name": "marginfiAccountTransferToNewAccount",
      "discriminator": [
        59,
        105,
        171,
        110,
        223,
        136,
        80,
        89
      ]
    },
    {
      "name": "marginfiGroupConfigureEvent",
      "discriminator": [
        241,
        104,
        172,
        167,
        41,
        195,
        199,
        170
      ]
    },
    {
      "name": "marginfiGroupCreateEvent",
      "discriminator": [
        233,
        125,
        61,
        14,
        98,
        240,
        136,
        253
      ]
    },
    {
      "name": "rateLimitFlowEvent",
      "discriminator": [
        229,
        5,
        73,
        200,
        0,
        107,
        105,
        109
      ]
    },
    {
      "name": "setKeeperCloseFlagsEvent",
      "discriminator": [
        193,
        230,
        93,
        128,
        117,
        87,
        96,
        21
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "internalLogicError",
      "msg": "Internal Marginfi logic error"
    },
    {
      "code": 6001,
      "name": "bankNotFound",
      "msg": "Invalid bank index"
    },
    {
      "code": 6002,
      "name": "lendingAccountBalanceNotFound",
      "msg": "Lending account balance not found"
    },
    {
      "code": 6003,
      "name": "bankAssetCapacityExceeded",
      "msg": "Bank deposit capacity exceeded"
    },
    {
      "code": 6004,
      "name": "invalidTransfer",
      "msg": "Invalid transfer"
    },
    {
      "code": 6005,
      "name": "missingPythOrBankAccount",
      "msg": "Missing Oracle, Bank, LST mint, or Sol Pool"
    },
    {
      "code": 6006,
      "name": "missingPythAccount",
      "msg": "Missing Pyth account"
    },
    {
      "code": 6007,
      "name": "missingBankAccount",
      "msg": "Missing Bank account"
    },
    {
      "code": 6008,
      "name": "invalidBankAccount",
      "msg": "Invalid Bank account"
    },
    {
      "code": 6009,
      "name": "riskEngineInitRejected",
      "msg": "RiskEngine rejected due to either bad health or stale oracles"
    },
    {
      "code": 6010,
      "name": "lendingAccountBalanceSlotsFull",
      "msg": "Lending account balance slots are full"
    },
    {
      "code": 6011,
      "name": "bankAlreadyExists",
      "msg": "Bank already exists"
    },
    {
      "code": 6012,
      "name": "zeroLiquidationAmount",
      "msg": "Amount to liquidate must be positive"
    },
    {
      "code": 6013,
      "name": "accountNotBankrupt",
      "msg": "Account is not bankrupt"
    },
    {
      "code": 6014,
      "name": "balanceNotBadDebt",
      "msg": "Account balance is not bad debt"
    },
    {
      "code": 6015,
      "name": "invalidConfig",
      "msg": "Invalid group config"
    },
    {
      "code": 6016,
      "name": "bankPaused",
      "msg": "Bank paused"
    },
    {
      "code": 6017,
      "name": "bankReduceOnly",
      "msg": "Bank is ReduceOnly mode"
    },
    {
      "code": 6018,
      "name": "bankAccountNotFound",
      "msg": "Bank is missing"
    },
    {
      "code": 6019,
      "name": "operationDepositOnly",
      "msg": "Operation is deposit-only"
    },
    {
      "code": 6020,
      "name": "operationWithdrawOnly",
      "msg": "Operation is withdraw-only"
    },
    {
      "code": 6021,
      "name": "operationBorrowOnly",
      "msg": "Operation is borrow-only"
    },
    {
      "code": 6022,
      "name": "operationRepayOnly",
      "msg": "Operation is repay-only"
    },
    {
      "code": 6023,
      "name": "noAssetFound",
      "msg": "No asset found"
    },
    {
      "code": 6024,
      "name": "noLiabilityFound",
      "msg": "No liability found"
    },
    {
      "code": 6025,
      "name": "invalidOracleSetup",
      "msg": "Invalid oracle setup"
    },
    {
      "code": 6026,
      "name": "illegalUtilizationRatio",
      "msg": "Invalid bank utilization ratio"
    },
    {
      "code": 6027,
      "name": "bankLiabilityCapacityExceeded",
      "msg": "Bank borrow cap exceeded"
    },
    {
      "code": 6028,
      "name": "invalidPrice",
      "msg": "Invalid Price"
    },
    {
      "code": 6029,
      "name": "isolatedAccountIllegalState",
      "msg": "Account can have only one liability when account is under isolated risk"
    },
    {
      "code": 6030,
      "name": "emissionsAlreadySetup",
      "msg": "Emissions already setup"
    },
    {
      "code": 6031,
      "name": "oracleNotSetup",
      "msg": "Oracle is not set"
    },
    {
      "code": 6032,
      "name": "invalidSwitchboardDecimalConversion",
      "msg": "Invalid switchboard decimal conversion"
    },
    {
      "code": 6033,
      "name": "cannotCloseOutstandingEmissions",
      "msg": "Cannot close balance because of outstanding emissions"
    },
    {
      "code": 6034,
      "name": "emissionsUpdateError",
      "msg": "Update emissions error"
    },
    {
      "code": 6035,
      "name": "accountDisabled",
      "msg": "Account disabled"
    },
    {
      "code": 6036,
      "name": "accountTempActiveBalanceLimitExceeded",
      "msg": "Account can't temporarily open 3 balances, please close a balance first"
    },
    {
      "code": 6037,
      "name": "accountInFlashloan",
      "msg": "Illegal action during flashloan"
    },
    {
      "code": 6038,
      "name": "illegalFlashloan",
      "msg": "Illegal flashloan"
    },
    {
      "code": 6039,
      "name": "illegalFlag",
      "msg": "Illegal flag"
    },
    {
      "code": 6040,
      "name": "illegalBalanceState",
      "msg": "Illegal balance state"
    },
    {
      "code": 6041,
      "name": "illegalAccountAuthorityTransfer",
      "msg": "Illegal account authority transfer"
    },
    {
      "code": 6042,
      "name": "unauthorized",
      "msg": "unauthorized"
    },
    {
      "code": 6043,
      "name": "illegalAction",
      "msg": "Invalid account authority"
    },
    {
      "code": 6044,
      "name": "t22MintRequired",
      "msg": "Token22 Banks require mint account as first remaining account"
    },
    {
      "code": 6045,
      "name": "invalidFeeAta",
      "msg": "Invalid ATA for global fee account"
    },
    {
      "code": 6046,
      "name": "addedStakedPoolManually",
      "msg": "Use add pool permissionless instead"
    },
    {
      "code": 6047,
      "name": "assetTagMismatch",
      "msg": "Staked SOL accounts can only deposit staked assets and borrow SOL"
    },
    {
      "code": 6048,
      "name": "stakePoolValidationFailed",
      "msg": "Stake pool validation failed: check the stake pool, mint, or sol pool"
    },
    {
      "code": 6049,
      "name": "switchboardStalePrice",
      "msg": "Switchboard oracle: stale price"
    },
    {
      "code": 6050,
      "name": "pythPushStalePrice",
      "msg": "Pyth Push oracle: stale price"
    },
    {
      "code": 6051,
      "name": "wrongNumberOfOracleAccounts",
      "msg": "Oracle error: wrong number of accounts"
    },
    {
      "code": 6052,
      "name": "wrongOracleAccountKeys",
      "msg": "Oracle error: wrong account keys"
    },
    {
      "code": 6053,
      "name": "stakeOraclesDisabled",
      "msg": "Stake oracles are temporarily disabled"
    },
    {
      "code": 6054,
      "name": "vacated3",
      "msg": "vacated3"
    },
    {
      "code": 6055,
      "name": "oracleMaxConfidenceExceeded",
      "msg": "Oracle max confidence exceeded: try again later"
    },
    {
      "code": 6056,
      "name": "pythPushInsufficientVerificationLevel",
      "msg": "Pyth Push oracle: insufficient verification level"
    },
    {
      "code": 6057,
      "name": "zeroAssetPrice",
      "msg": "Zero asset price"
    },
    {
      "code": 6058,
      "name": "zeroLiabilityPrice",
      "msg": "Zero liability price"
    },
    {
      "code": 6059,
      "name": "switchboardWrongAccountOwner",
      "msg": "Switchboard oracle: wrong account owner"
    },
    {
      "code": 6060,
      "name": "pythPushInvalidAccount",
      "msg": "Pyth Push oracle: invalid account"
    },
    {
      "code": 6061,
      "name": "switchboardInvalidAccount",
      "msg": "Switchboard oracle: invalid account"
    },
    {
      "code": 6062,
      "name": "mathError",
      "msg": "Math error"
    },
    {
      "code": 6063,
      "name": "invalidEmissionsDestinationAccount",
      "msg": "Invalid emissions destination account"
    },
    {
      "code": 6064,
      "name": "sameAssetAndLiabilityBanks",
      "msg": "Asset and liability bank cannot be the same"
    },
    {
      "code": 6065,
      "name": "overliquidationAttempt",
      "msg": "Trying to withdraw more assets than available"
    },
    {
      "code": 6066,
      "name": "noLiabilitiesInLiabilityBank",
      "msg": "Liability bank has no liabilities"
    },
    {
      "code": 6067,
      "name": "assetsInLiabilityBank",
      "msg": "Liability bank has assets"
    },
    {
      "code": 6068,
      "name": "healthyAccount",
      "msg": "Account is healthy and cannot be liquidated"
    },
    {
      "code": 6069,
      "name": "exhaustedLiability",
      "msg": "Liability payoff too severe, exhausted liability"
    },
    {
      "code": 6070,
      "name": "tooSeverePayoff",
      "msg": "Liability payoff too severe, liability balance has assets"
    },
    {
      "code": 6071,
      "name": "tooSevereLiquidation",
      "msg": "Liquidation too severe, account above maintenance requirement"
    },
    {
      "code": 6072,
      "name": "worseHealthPostLiquidation",
      "msg": "Liquidation would worsen account health"
    },
    {
      "code": 6073,
      "name": "integrationPositionLimitExceeded",
      "msg": "Exceeded the maximum allowed integration positions"
    },
    {
      "code": 6074,
      "name": "maxInitLeverageExceeded",
      "msg": "Maximum initial leverage exceeded"
    },
    {
      "code": 6075,
      "name": "badEmodeConfig",
      "msg": "The Emode config was invalid"
    },
    {
      "code": 6076,
      "name": "pythPushInvalidWindowSize",
      "msg": "TWAP window size does not match expected duration"
    },
    {
      "code": 6077,
      "name": "invalidFeesDestinationAccount",
      "msg": "Invalid fees destination account"
    },
    {
      "code": 6078,
      "name": "bankCannotClose",
      "msg": "Banks cannot close when they have open positions or emissions outstanding"
    },
    {
      "code": 6079,
      "name": "accountAlreadyMigrated",
      "msg": "Account already migrated"
    },
    {
      "code": 6080,
      "name": "protocolPaused",
      "msg": "Protocol is paused"
    },
    {
      "code": 6081,
      "name": "metadataTooLong",
      "msg": "Metadata is too long"
    },
    {
      "code": 6082,
      "name": "pauseLimitExceeded",
      "msg": "Pause limit exceeded"
    },
    {
      "code": 6083,
      "name": "protocolNotPaused",
      "msg": "Protocol is not paused"
    },
    {
      "code": 6084,
      "name": "bankKilledByBankruptcy",
      "msg": "Bank killed by bankruptcy: bank shutdown and value of all holdings is zero"
    },
    {
      "code": 6085,
      "name": "unexpectedLiquidationState",
      "msg": "Liquidation state issue. Check start before end, end last, and both unique"
    },
    {
      "code": 6086,
      "name": "startNotFirst",
      "msg": "Liquidation start must be first instruction (other than compute program ixes)"
    },
    {
      "code": 6087,
      "name": "startRepeats",
      "msg": "Only one liquidation event allowed per tx"
    },
    {
      "code": 6088,
      "name": "endNotLast",
      "msg": "The end instruction must be the last ix in the tx"
    },
    {
      "code": 6089,
      "name": "forbiddenIx",
      "msg": "Tried to call an instruction that is forbidden during liquidation"
    },
    {
      "code": 6090,
      "name": "liquidationPremiumTooHigh",
      "msg": "Seized too much of the asset relative to liability repaid"
    },
    {
      "code": 6091,
      "name": "notAllowedInCpi",
      "msg": "Start and end liquidation and flashloan must be top-level instructions"
    },
    {
      "code": 6092,
      "name": "zeroSupplyInStakePool",
      "msg": "Stake pool supply is zero: cannot compute price"
    },
    {
      "code": 6093,
      "name": "invalidGroup",
      "msg": "Invalid group: account constraint violated"
    },
    {
      "code": 6094,
      "name": "invalidLiquidityVault",
      "msg": "Invalid liquidity vault: account constraint violated"
    },
    {
      "code": 6095,
      "name": "invalidLiquidationRecord",
      "msg": "Invalid liquidation record: account constraint violated"
    },
    {
      "code": 6096,
      "name": "invalidLiquidationReceiver",
      "msg": "Invalid liquidation receiver: account constraint violated"
    },
    {
      "code": 6097,
      "name": "invalidEmissionsMint",
      "msg": "Invalid emissions mint: account constraint violated"
    },
    {
      "code": 6098,
      "name": "invalidMint",
      "msg": "Invalid mint: account constraint violated"
    },
    {
      "code": 6099,
      "name": "invalidFeeWallet",
      "msg": "Invalid fee wallet: account constraint violated"
    },
    {
      "code": 6100,
      "name": "fixedOraclePriceNegative",
      "msg": "Fixed oracle price must be zero or greater"
    },
    {
      "code": 6101,
      "name": "dailyWithdrawalLimitExceeded",
      "msg": "Daily withdrawal limit exceeded: try again later"
    },
    {
      "code": 6102,
      "name": "zeroWithdrawalLimit",
      "msg": "Cannot set daily withdrawal limit to zero"
    },
    {
      "code": 6103,
      "name": "accountFrozen",
      "msg": "Account is frozen by the group admin"
    },
    {
      "code": 6104,
      "name": "duplicateBalance",
      "msg": "Cannot reference duplicate balances"
    },
    {
      "code": 6105,
      "name": "invalidBalanceCount",
      "msg": "Invalid amount of balances referenced"
    },
    {
      "code": 6106,
      "name": "liquidatorOrderCloseNotAllowed",
      "msg": "Liquidator not allowed to close order"
    },
    {
      "code": 6107,
      "name": "orderTriggerNotMet",
      "msg": "Order trigger is yet to be met"
    },
    {
      "code": 6108,
      "name": "unexpectedOrderExecutionState",
      "msg": "Order execution state issue. Check not in flashloan, disabled, etc"
    },
    {
      "code": 6109,
      "name": "orderLiabilityNotClosed",
      "msg": "Order liability not closed"
    },
    {
      "code": 6110,
      "name": "invalidAssetOrLiabilitiesCount",
      "msg": "Invalid asset or liabilities count"
    },
    {
      "code": 6111,
      "name": "worseHealthPostExecution",
      "msg": "Account health can only worsen if account is healthy"
    },
    {
      "code": 6112,
      "name": "invalidOrderTakeProfitOrStopLoss",
      "msg": "TP must be > 0, SL must be > 0 and TP > SL if both are set"
    },
    {
      "code": 6113,
      "name": "invalidSlippage",
      "msg": "Max slippage must be less than 100%"
    },
    {
      "code": 6114,
      "name": "orderExecutionOverWithdrawal",
      "msg": "Executor withdrew too much: slippage or max fee constraint violated"
    },
    {
      "code": 6115,
      "name": "bankHourlyRateLimitExceeded",
      "msg": "Bank hourly rate limit exceeded: try again later"
    },
    {
      "code": 6116,
      "name": "bankDailyRateLimitExceeded",
      "msg": "Bank daily rate limit exceeded: try again later"
    },
    {
      "code": 6117,
      "name": "groupHourlyRateLimitExceeded",
      "msg": "Group hourly rate limit exceeded: try again later"
    },
    {
      "code": 6118,
      "name": "groupDailyRateLimitExceeded",
      "msg": "Group daily rate limit exceeded: try again later"
    },
    {
      "code": 6119,
      "name": "invalidRateLimitPrice",
      "msg": "Invalid rate limit price: pass oracle or pre-crank cache"
    },
    {
      "code": 6120,
      "name": "groupRateLimiterUpdateEmpty",
      "msg": "Group rate limiter admin update must include inflow and/or outflow"
    },
    {
      "code": 6121,
      "name": "groupRateLimiterUpdateInvalidSlotRange",
      "msg": "Group rate limiter admin update slot range is invalid"
    },
    {
      "code": 6122,
      "name": "groupRateLimiterUpdateFutureSlot",
      "msg": "Group rate limiter admin update cannot reference future slots"
    },
    {
      "code": 6123,
      "name": "groupRateLimiterUpdateStale",
      "msg": "Group rate limiter admin update is too stale"
    },
    {
      "code": 6124,
      "name": "groupRateLimiterUpdateOutOfOrderSlot",
      "msg": "Group rate limiter admin update slot progression is out of order"
    },
    {
      "code": 6125,
      "name": "groupRateLimiterUpdateOutOfOrderSeq",
      "msg": "Group rate limiter admin update sequence is out of order"
    },
    {
      "code": 6126,
      "name": "deleverageWithdrawalUpdateEmpty",
      "msg": "Deleverage withdrawal admin update must include outflow"
    },
    {
      "code": 6127,
      "name": "deleverageWithdrawalUpdateInvalidSlotRange",
      "msg": "Deleverage withdrawal admin update slot range is invalid"
    },
    {
      "code": 6128,
      "name": "deleverageWithdrawalUpdateFutureSlot",
      "msg": "Deleverage withdrawal admin update cannot reference future slots"
    },
    {
      "code": 6129,
      "name": "deleverageWithdrawalUpdateStale",
      "msg": "Deleverage withdrawal admin update is too stale"
    },
    {
      "code": 6130,
      "name": "deleverageWithdrawalUpdateOutOfOrderSlot",
      "msg": "Deleverage withdrawal admin update slot progression is out of order"
    },
    {
      "code": 6131,
      "name": "deleverageWithdrawalUpdateOutOfOrderSeq",
      "msg": "Deleverage withdrawal admin update sequence is out of order"
    },
    {
      "code": 6132,
      "name": "useSetFixedOraclePrice",
      "msg": "Use set_fixed_oracle_price instead"
    },
    {
      "code": 6133,
      "name": "invalidGlobalFeeWallet",
      "msg": "Provided global fee wallet does not match group fee state cache"
    },
    {
      "code": 6134,
      "name": "bankUninitialized",
      "msg": "Bank has not completed one-time initialization"
    },
    {
      "code": 6135,
      "name": "slippageTooHigh",
      "msg": "Max slippage exceeds the allowed cap"
    },
    {
      "code": 6200,
      "name": "wrongAssetTagForStandardInstructions",
      "msg": "Wrong asset tag for standard instructions, expected DEFAULT, SOL, or STAKED asset tag"
    },
    {
      "code": 6201,
      "name": "wrongAssetTagForKaminoInstructions",
      "msg": "Wrong asset tag for Kamino instructions, expected KAMINO asset tag"
    },
    {
      "code": 6202,
      "name": "cantAddPool",
      "msg": "Cannot create a kamino bank with this instruction, use add_bank_kamino"
    },
    {
      "code": 6203,
      "name": "kaminoReserveMintAddressMismatch",
      "msg": "Kamino reserve mint address doesn't match the bank mint address"
    },
    {
      "code": 6204,
      "name": "kaminoDepositFailed",
      "msg": "Deposit failed: obligation deposit amount increase did not match the expected increase, left - actual, right - expected"
    },
    {
      "code": 6205,
      "name": "kaminoWithdrawFailed",
      "msg": "Withdraw failed: token vault increase did not match the expected increase, left - actual, right - expected"
    },
    {
      "code": 6206,
      "name": "reserveStale",
      "msg": "Kamino Reserve data is stale - run refresh_reserve on kamino program first"
    },
    {
      "code": 6207,
      "name": "invalidObligationDepositCount",
      "msg": "Kamino obligation must have exactly one active deposit, at index 0"
    },
    {
      "code": 6208,
      "name": "obligationDepositReserveMismatch",
      "msg": "Kamino obligation deposit doesn't match the expected reserve"
    },
    {
      "code": 6209,
      "name": "obligationInitDepositInsufficient",
      "msg": "Failed to meet minimum deposit amount requirement for init obligation"
    },
    {
      "code": 6210,
      "name": "kaminoReserveValidationFailed",
      "msg": "Kamino reserve validation failed"
    },
    {
      "code": 6211,
      "name": "kaminoInvalidOracleSetup",
      "msg": "Invalid oracle setup: only KaminoPythPush and KaminoSwitchboardPull are supported"
    },
    {
      "code": 6212,
      "name": "maxMaintLeverageExceeded",
      "msg": "Maximum Maintenance leverage exceeded"
    },
    {
      "code": 6213,
      "name": "invalidKaminoReserve",
      "msg": "Invalid Kamino reserve: account constraint violated"
    },
    {
      "code": 6214,
      "name": "invalidKaminoObligation",
      "msg": "Invalid Kamino obligation: account constraint violated"
    },
    {
      "code": 6300,
      "name": "driftInvalidOracleSetup",
      "msg": "Invalid oracle setup: only DriftPythPull and DriftSwitchboardPull are supported"
    },
    {
      "code": 6301,
      "name": "driftSpotMarketMintMismatch",
      "msg": "Drift spot market mint does not match bank mint"
    },
    {
      "code": 6302,
      "name": "wrongBankAssetTagForDriftOperation",
      "msg": "Wrong bank asset tag for Drift operation"
    },
    {
      "code": 6303,
      "name": "cantUseStandardOperationsOnDriftAssets",
      "msg": "Cannot use standard operations on Drift assets"
    },
    {
      "code": 6304,
      "name": "driftSpotMarketValidationFailed",
      "msg": "Drift spot market validation failed"
    },
    {
      "code": 6305,
      "name": "driftInvalidSpotPositions",
      "msg": "Drift user has invalid spot positions (only first position can have balance)"
    },
    {
      "code": 6306,
      "name": "driftSpotPositionMarketMismatch",
      "msg": "Drift spot position market does not match bank's configured market"
    },
    {
      "code": 6307,
      "name": "driftInvalidPositionType",
      "msg": "Drift position has invalid balance type (must be deposit)"
    },
    {
      "code": 6308,
      "name": "driftScaledBalanceMismatch",
      "msg": "Drift scaled balance change does not match expected amount"
    },
    {
      "code": 6309,
      "name": "driftWithdrawFailed",
      "msg": "Drift withdrawal failed - token amount mismatch"
    },
    {
      "code": 6310,
      "name": "driftUserInitDepositInsufficient",
      "msg": "Drift user initial deposit insufficient (minimum 10 units required)"
    },
    {
      "code": 6311,
      "name": "invalidDriftAccount",
      "msg": "Invalid drift account"
    },
    {
      "code": 6312,
      "name": "driftAuthorityMismatch",
      "msg": "Drift authority mismatch"
    },
    {
      "code": 6313,
      "name": "driftInvalidHarvestPositionIndex",
      "msg": "Invalid harvest position index - must be between 2 and 7"
    },
    {
      "code": 6314,
      "name": "driftPositionEmpty",
      "msg": "Drift position is empty"
    },
    {
      "code": 6315,
      "name": "driftInvalidBalanceType",
      "msg": "Drift position has invalid balance type"
    },
    {
      "code": 6316,
      "name": "driftNoAdminDeposit",
      "msg": "No admin deposits found in Drift positions 2-7 for this market"
    },
    {
      "code": 6317,
      "name": "driftHarvestSameMarket",
      "msg": "Cannot harvest from the same market as the bank's main drift spot market"
    },
    {
      "code": 6318,
      "name": "driftBrickedAccount",
      "msg": "Drift account bricked: too many active deposits from admin operations"
    },
    {
      "code": 6319,
      "name": "driftMissingRewardOracle",
      "msg": "Drift reward oracle required when 2+ active deposits exist"
    },
    {
      "code": 6320,
      "name": "driftMissingRewardSpotMarket",
      "msg": "Drift reward spot market required when 2+ active deposits exist"
    },
    {
      "code": 6321,
      "name": "driftMissingRewardAccounts",
      "msg": "Drift account has admin deposits that require reward accounts to be provided"
    },
    {
      "code": 6322,
      "name": "driftSpotMarketStale",
      "msg": "Drift spot market is stale, interest needs to be updated"
    },
    {
      "code": 6323,
      "name": "invalidDriftSpotMarket",
      "msg": "Invalid Drift spot market: account constraint violated"
    },
    {
      "code": 6324,
      "name": "invalidDriftUser",
      "msg": "Invalid Drift user: account constraint violated"
    },
    {
      "code": 6325,
      "name": "invalidDriftUserStats",
      "msg": "Invalid Drift user stats: account constraint violated"
    },
    {
      "code": 6326,
      "name": "driftUnsupportedTokenDecimals",
      "msg": "Drift cannot support tokens with more than 19 decimals"
    },
    {
      "code": 6400,
      "name": "solendInvalidOracleSetup",
      "msg": "Invalid oracle setup: only SolendPythPull and SolendSwitchboardPull are supported"
    },
    {
      "code": 6401,
      "name": "solendReserveValidationFailed",
      "msg": "Solend reserve validation failed"
    },
    {
      "code": 6402,
      "name": "solendObligationOwnerMismatch",
      "msg": "Solend obligation owner mismatch"
    },
    {
      "code": 6403,
      "name": "wrongBankAssetTagForSolendOperation",
      "msg": "Wrong bank asset tag for Solend operation"
    },
    {
      "code": 6404,
      "name": "cantUseStandardOperationsOnSolendAssets",
      "msg": "Cannot use standard operations on Solend assets"
    },
    {
      "code": 6405,
      "name": "solendReserveMismatch",
      "msg": "Solend reserve mismatch"
    },
    {
      "code": 6406,
      "name": "solendReserveMintMismatch",
      "msg": "Solend reserve mint mismatch"
    },
    {
      "code": 6407,
      "name": "solendInvalidDepositPositions",
      "msg": "Solend obligation has invalid deposits (only first position can have balance)"
    },
    {
      "code": 6408,
      "name": "solendDepositPositionReserveMismatch",
      "msg": "Solend deposit position reserve does not match bank's configured reserve"
    },
    {
      "code": 6409,
      "name": "solendCTokenBalanceMismatch",
      "msg": "Solend cToken balance change does not match expected amount"
    },
    {
      "code": 6410,
      "name": "solendWithdrawFailed",
      "msg": "Solend withdrawal failed - token amount mismatch"
    },
    {
      "code": 6411,
      "name": "solendReserveStale",
      "msg": "Solend reserve is stale"
    },
    {
      "code": 6412,
      "name": "solendDepositFailed",
      "msg": "Solend deposit failed - collateral amount mismatch"
    },
    {
      "code": 6413,
      "name": "invalidSolendAccount",
      "msg": "Invalid Solend account owner"
    },
    {
      "code": 6414,
      "name": "invalidSolendAccountVersion",
      "msg": "Invalid Solend account version"
    },
    {
      "code": 6415,
      "name": "invalidSolendReserve",
      "msg": "Invalid Solend reserve: account constraint violated"
    },
    {
      "code": 6416,
      "name": "invalidSolendObligation",
      "msg": "Invalid Solend obligation: account constraint violated"
    },
    {
      "code": 6500,
      "name": "juplendInvalidOracleSetup",
      "msg": "Invalid oracle setup: only JuplendPythPull and JuplendSwitchboardPull are supported"
    },
    {
      "code": 6501,
      "name": "juplendLendingValidationFailed",
      "msg": "Juplend lending state validation failed"
    },
    {
      "code": 6502,
      "name": "wrongBankAssetTagForJuplendOperation",
      "msg": "Wrong bank asset tag for Juplend operation"
    },
    {
      "code": 6503,
      "name": "cantUseStandardOperationsOnJuplendAssets",
      "msg": "Cannot use standard operations on Juplend assets"
    },
    {
      "code": 6504,
      "name": "juplendLendingStale",
      "msg": "Juplend lending state is stale"
    },
    {
      "code": 6505,
      "name": "invalidJuplendLending",
      "msg": "Invalid Juplend lending: account constraint violated"
    },
    {
      "code": 6506,
      "name": "juplendLendingMintMismatch",
      "msg": "Juplend lending mint mismatch"
    },
    {
      "code": 6507,
      "name": "juplendBankAlreadyActivated",
      "msg": "Juplend bank is already activated"
    },
    {
      "code": 6508,
      "name": "invalidJuplendFTokenVault",
      "msg": "Invalid Juplend fToken vault"
    },
    {
      "code": 6509,
      "name": "juplendDepositFailed",
      "msg": "Juplend deposit failed"
    },
    {
      "code": 6510,
      "name": "juplendWithdrawFailed",
      "msg": "Juplend withdraw failed"
    },
    {
      "code": 6511,
      "name": "juplendInitPositionDepositInsufficient",
      "msg": "Juplend init position deposit insufficient"
    },
    {
      "code": 6512,
      "name": "invalidJuplendWithdrawIntermediaryAta",
      "msg": "Invalid Juplend withdraw intermediary ATA"
    },
    {
      "code": 6513,
      "name": "invalidResize",
      "msg": "Account is already at (or above) the target size"
    },
    {
      "code": 6600,
      "name": "bankCircuitBreakerHalted",
      "msg": "Bank is halted by oracle circuit breaker"
    },
    {
      "code": 6601,
      "name": "circuitBreakerAdminOnly",
      "msg": "Action requires risk admin while bank is circuit-breaker halted"
    },
    {
      "code": 6602,
      "name": "circuitBreakerInvalidConfig",
      "msg": "Invalid circuit breaker config"
    },
    {
      "code": 6603,
      "name": "circuitBreakerRequiresWarmCache",
      "msg": "Circuit breaker cannot be enabled until the oracle price cache is warm (call pulse first)"
    },
    {
      "code": 6604,
      "name": "circuitBreakerPriceJump",
      "msg": "Oracle price deviates too far from the circuit breaker reference; action rejected"
    },
    {
      "code": 6800,
      "name": "scopeInvalidAccount",
      "msg": "Scope oracle account is not owned by the Scope program or is malformed"
    },
    {
      "code": 6801,
      "name": "scopeInvalidEntry",
      "msg": "Scope entry index is out of range or the entry has never been refreshed"
    },
    {
      "code": 6802,
      "name": "scopeStalePrice",
      "msg": "Scope price is stale"
    },
    {
      "code": 6803,
      "name": "useConfigureBankOracleScope",
      "msg": "Use lending_pool_configure_bank_oracle_scope; Scope requires an entry index"
    }
  ],
  "types": [
    {
      "name": "accountEventHeader",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "signer",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "marginfiAccount",
            "type": "pubkey"
          },
          {
            "name": "marginfiAccountAuthority",
            "type": "pubkey"
          },
          {
            "name": "marginfiGroup",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "adminCloseAccountEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "header",
            "type": {
              "defined": {
                "name": "accountEventHeader"
              }
            }
          },
          {
            "name": "globalFeeWallet",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "balance",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "active",
            "docs": [
              "Whether this balance slot is in use (nonzero = active)"
            ],
            "type": "u8"
          },
          {
            "name": "bankPk",
            "docs": [
              "The bank this balance corresponds to"
            ],
            "type": "pubkey"
          },
          {
            "name": "bankAssetTag",
            "docs": [
              "Inherited from the bank when the position is first created and CANNOT BE CHANGED after that.",
              "Note that all balances created before the addition of this feature use `ASSET_TAG_DEFAULT`"
            ],
            "type": "u8"
          },
          {
            "name": "tag",
            "docs": [
              "Tag used by orders to reference this balance (0 means unused/unassigned).",
              "A tag may also have a non-zero value while having no orders."
            ],
            "type": "u16"
          },
          {
            "name": "pad0",
            "type": {
              "array": [
                "u8",
                4
              ]
            }
          },
          {
            "name": "assetShares",
            "docs": [
              "The user's asset (deposit) shares in the bank. Multiply by `bank.asset_share_value` for",
              "the token amount."
            ],
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "liabilityShares",
            "docs": [
              "The user's liability (borrow) shares in the bank. Multiply by `bank.liability_share_value`",
              "for the token amount."
            ],
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "emissionsOutstanding",
            "docs": [
              "Unclaimed emissions rewards for this position"
            ],
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "lastUpdate",
            "docs": [
              "Unix timestamp (u64) of the last emissions calculation for this position"
            ],
            "type": "u64"
          },
          {
            "name": "padding",
            "docs": [
              "Reserved for future use"
            ],
            "type": {
              "array": [
                "u64",
                1
              ]
            }
          }
        ]
      }
    },
    {
      "name": "bank",
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mint",
            "docs": [
              "The SPL token mint this bank manages"
            ],
            "type": "pubkey"
          },
          {
            "name": "mintDecimals",
            "docs": [
              "Number of decimals of the `mint`. Must be < 24."
            ],
            "type": "u8"
          },
          {
            "name": "group",
            "docs": [
              "The `MarginfiGroup` this bank belongs to"
            ],
            "type": "pubkey"
          },
          {
            "name": "pad0",
            "type": {
              "array": [
                "u8",
                7
              ]
            }
          },
          {
            "name": "assetShareValue",
            "docs": [
              "Monotonically increases as interest rate accumulates. For typical banks, a user's asset",
              "value in token = (number of shares the user has * asset_share_value).",
              "* A float (arbitrary decimals)",
              "* Initially 1"
            ],
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "liabilityShareValue",
            "docs": [
              "Monotonically increases as interest rate accumulates. For typical banks, a user's liabilty",
              "value in token = (number of shares the user has * liability_share_value)",
              "* A float (arbitrary decimals)",
              "* Initially 1"
            ],
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "liquidityVault",
            "docs": [
              "The SPL token account holding deposited liquidity"
            ],
            "type": "pubkey"
          },
          {
            "name": "liquidityVaultBump",
            "docs": [
              "PDA bump for the liquidity vault"
            ],
            "type": "u8"
          },
          {
            "name": "liquidityVaultAuthorityBump",
            "docs": [
              "PDA bump for the liquidity vault authority"
            ],
            "type": "u8"
          },
          {
            "name": "insuranceVault",
            "docs": [
              "The SPL token account holding insurance fund tokens"
            ],
            "type": "pubkey"
          },
          {
            "name": "insuranceVaultBump",
            "docs": [
              "PDA bump for the insurance vault"
            ],
            "type": "u8"
          },
          {
            "name": "insuranceVaultAuthorityBump",
            "docs": [
              "PDA bump for the insurance vault authority"
            ],
            "type": "u8"
          },
          {
            "name": "pad1",
            "type": {
              "array": [
                "u8",
                4
              ]
            }
          },
          {
            "name": "collectedInsuranceFeesOutstanding",
            "docs": [
              "Fees collected and pending withdraw for the `insurance_vault`"
            ],
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "feeVault",
            "docs": [
              "The SPL token account holding collected group fees"
            ],
            "type": "pubkey"
          },
          {
            "name": "feeVaultBump",
            "docs": [
              "PDA bump for the fee vault"
            ],
            "type": "u8"
          },
          {
            "name": "feeVaultAuthorityBump",
            "docs": [
              "PDA bump for the fee vault authority"
            ],
            "type": "u8"
          },
          {
            "name": "pad2",
            "type": {
              "array": [
                "u8",
                6
              ]
            }
          },
          {
            "name": "collectedGroupFeesOutstanding",
            "docs": [
              "Fees collected and pending withdraw for the `fee_vault`"
            ],
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "totalLiabilityShares",
            "docs": [
              "Sum of all liability shares held by all borrowers in this bank.",
              "Multiply by `liability_share_value` to get the total liability amount in native token units."
            ],
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "totalAssetShares",
            "docs": [
              "Sum of all asset shares held by all depositors in this bank.",
              "Multiply by `asset_share_value` to get the total asset amount in native token units.",
              "* For Kamino banks, this is the quantity of collateral tokens (NOT liquidity tokens) in the",
              "bank, and also uses `mint_decimals`, though the mint itself will always show (6) decimals",
              "exactly (i.e Kamino ignores this and treats it as if it was using `mint_decimals`)"
            ],
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "lastUpdate",
            "docs": [
              "Unix timestamp (i64) of the last interest accrual"
            ],
            "type": "i64"
          },
          {
            "name": "config",
            "docs": [
              "The bank's configuration parameters (weights, limits, oracle setup, interest rate config)"
            ],
            "type": {
              "defined": {
                "name": "bankConfig"
              }
            }
          },
          {
            "name": "flags",
            "docs": [
              "Bank flags bitfield (u64).",
              "",
              "- Bit 0 (1): `EMISSIONS_FLAG_BORROW_ACTIVE` — borrow-side emissions are active",
              "- Bit 1 (2): `EMISSIONS_FLAG_LENDING_ACTIVE` — lending-side emissions are active",
              "- Bit 2 (4): `PERMISSIONLESS_BAD_DEBT_SETTLEMENT_FLAG` — anyone can settle bad debt",
              "- Bit 3 (8): `FREEZE_SETTINGS` — bank configuration is frozen (only limits can change)",
              "- Bit 4 (16): `CLOSE_ENABLED_FLAG` — bank can be closed (set at creation for banks >= 0.1.4)",
              "- Bit 5 (32): `TOKENLESS_REPAYMENTS_ALLOWED` — risk admin can repay debt without tokens",
              "- Bit 6 (64): `TOKENLESS_REPAYMENTS_COMPLETE` — all debt cleared, lender purge enabled",
              "- Bit 7 (128): `IS_T22` — 1 if T22, 0 if token classic",
              "- Bit 8 (256): `BANK_SEED_KNOWN` — bank is known to be PDA/seed-derived. If not set, bank",
              "may still be a PDA, but created before this flag launched (1.8 or earlier) or is a legacy",
              "keypair-based bank.",
              "- Bit 9 (512): `STAKED_ORACLE_DISABLED` — staked oracle pricing is temporarily disabled.",
              "- Bit 10 (1024): `STAKED_ORACLE_PRICE_USES_ONRAMP` — staked oracle pricing includes the SPL",
              "single-pool on-ramp account in NAV.",
              "- Bit 11 (2048): `CIRCUIT_BREAKER_ENABLED` — oracle deviation breaker active on this bank",
              "- Bit 12 (4096): `BANK_SAME_ASSET_EMODE_ELIGIBLE` — bank may participate in same-asset e-mode."
            ],
            "type": "u64"
          },
          {
            "name": "emissionsRate",
            "docs": [
              "Emissions APR. Number of emitted tokens (emissions_mint) per 1e(bank.mint_decimal) tokens",
              "(bank mint) (native amount) per 1 YEAR."
            ],
            "type": "u64"
          },
          {
            "name": "emissionsRemaining",
            "docs": [
              "Remaining emissions tokens available for distribution"
            ],
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "emissionsMint",
            "docs": [
              "The SPL token mint used for emissions rewards"
            ],
            "type": "pubkey"
          },
          {
            "name": "collectedProgramFeesOutstanding",
            "docs": [
              "Fees collected and pending withdraw for the `FeeState.global_fee_wallet`'s canonical ATA for `mint`"
            ],
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "emode",
            "docs": [
              "Controls this bank's emode configuration, which enables some banks to treat the assets of",
              "certain other banks more preferentially as collateral."
            ],
            "type": {
              "defined": {
                "name": "emodeSettings"
              }
            }
          },
          {
            "name": "feesDestinationAccount",
            "docs": [
              "Set with `update_fees_destination_account`. Fees can be withdrawn to the canonical ATA of",
              "this wallet without the admin's input (withdraw_fees_permissionless). If pubkey default, the",
              "bank doesn't support this feature, and the fees must be collected manually (withdraw_fees)."
            ],
            "type": "pubkey"
          },
          {
            "name": "cache",
            "docs": [
              "Cached bank metrics (interest rates, oracle price, etc.)"
            ],
            "type": {
              "defined": {
                "name": "bankCache"
              }
            }
          },
          {
            "name": "lendingPositionCount",
            "docs": [
              "Number of user lending positions currently open in this bank",
              "* For banks created prior to 0.1.4, this is the number of positions opened/closed after",
              "0.1.4 goes live, and may be negative.",
              "* For banks created in 0.1.4 or later, this is the number of positions open in total, and",
              "the bank may safely be closed if this is zero. Will never go negative."
            ],
            "type": "i32"
          },
          {
            "name": "borrowingPositionCount",
            "docs": [
              "Number of user borrowing positions currently open in this bank",
              "* For banks created prior to 0.1.4, this is the number of positions opened/closed after",
              "0.1.4 goes live, and may be negative.",
              "* For banks created in 0.1.4 or later, this is the number of positions open in total, and",
              "the bank may safely be closed if this is zero. Will never go negative."
            ],
            "type": "i32"
          },
          {
            "name": "liquidationLiquidatorFee",
            "docs": [
              "Fee the liquidator earns when liquidating against this bank's liability. Decode with",
              "`u32_to_centi` (`u32::MAX` = 100%).",
              "* 0 falls back to the default (`DEFAULT_LIQUIDATION_FEE` = 2.5%)."
            ],
            "type": "u32"
          },
          {
            "name": "liquidationInsuranceFee",
            "docs": [
              "Fee routed to this bank's insurance fund on a liquidation against its liability. Decode",
              "with `u32_to_centi` (`u32::MAX` = 100%).",
              "* 0 falls back to the default (`DEFAULT_LIQUIDATION_FEE` = 2.5%)."
            ],
            "type": "u32"
          },
          {
            "name": "padding0",
            "docs": [
              "Reserved for future use"
            ],
            "type": {
              "array": [
                "u8",
                8
              ]
            }
          },
          {
            "name": "integrationAcc1",
            "docs": [
              "Integration account slot 1 (default Pubkey for non-integrations).",
              "- Kamino: reserve",
              "- Drift: spot market",
              "- Solend: reserve",
              "- JupLend: lending state",
              "- Staked Collateral: Validator vote account"
            ],
            "type": "pubkey"
          },
          {
            "name": "integrationAcc2",
            "docs": [
              "Integration account slot 2 (default Pubkey for non-integrations).",
              "- Kamino: obligation",
              "- Drift: user",
              "- Solend: obligation",
              "- JupLend: fToken vault"
            ],
            "type": "pubkey"
          },
          {
            "name": "integrationAcc3",
            "docs": [
              "Integration account slot 3 (default Pubkey for non-integrations).",
              "- Drift: user stats",
              "- JupLend: withdraw intermediary ATA (ATA of liquidity_vault_authority for bank mint)"
            ],
            "type": "pubkey"
          },
          {
            "name": "rateLimiter",
            "docs": [
              "Rate limiter for controlling withdraw/borrow outflow.",
              "Tracks net outflow (outflows - inflows) in native tokens."
            ],
            "type": {
              "defined": {
                "name": "bankRateLimiter"
              }
            }
          },
          {
            "name": "pad0",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "bankSeed",
            "docs": [
              "* `0` for legacy banks created via `lending_pool_add_bank` (created via keypair, not a PDA),",
              "or pre-backfill banks (1.8 or earlier) where seed remains unknown.",
              "* Otherwise the `bank_seed: u64` argument passed when creating the bank.",
              "* Use `flags & BANK_SEED_KNOWN` to verify this value has known seed provenance."
            ],
            "type": "u64"
          },
          {
            "name": "cbHaltStartedAt",
            "docs": [
              "Unix-seconds when the current halt started, zero if not halted."
            ],
            "type": "i64"
          },
          {
            "name": "cbHaltEndedAt",
            "docs": [
              "Unix-seconds when the current halt's tier duration ends. Tier stays sticky past this for",
              "the escalation window; a fresh breach within the window ratchets to the next tier."
            ],
            "type": "i64"
          },
          {
            "name": "cbTier",
            "docs": [
              "0 = operational, 1..=3 = escalating halt severity."
            ],
            "type": "u8"
          },
          {
            "name": "cbTier3ConsecutiveTrips",
            "docs": [
              "Consecutive tier-3 trips with no clean escalation-window between them. Hitting",
              "`CB_MAX_TIER3_BEFORE_CIRCUIT_BREAK` forces the bank to `CircuitBroken`."
            ],
            "type": "u8"
          },
          {
            "name": "cbPreBreakState",
            "docs": [
              "`BankOperationalState` (as `u8`) the bank held before the breaker forced it to",
              "`CircuitBroken`. Restored by `clear_circuit_breaker`. Meaningless unless",
              "`operational_state == CircuitBroken`."
            ],
            "type": "u8"
          },
          {
            "name": "cbPad",
            "type": {
              "array": [
                "u8",
                5
              ]
            }
          },
          {
            "name": "cbLastObservedSlot",
            "docs": [
              "Solana slot of the last counted CB observation; used for slot-level dedup."
            ],
            "type": "u64"
          },
          {
            "name": "cbLastOracleSourceTime",
            "docs": [
              "Publisher-side timestamp of the last counted CB observation; rejects re-reads of the same",
              "publication across multiple Solana slots. Zero when the adapter doesn't expose one."
            ],
            "type": "i64"
          },
          {
            "name": "cbReferencePrice",
            "docs": [
              "EMA reference price used by the circuit breaker, in the multiplier-adjusted effective-price",
              "domain the risk engine uses. Frozen while halted, zero until the first observation after",
              "enable."
            ],
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "cbWindowReferencePrice",
            "docs": [
              "Long-window reference price (same multiplier-adjusted domain as `cb_reference_price`) used",
              "to catch slow oracle walking that stays below the per-observation breaker threshold."
            ],
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "cbWindowStartedAt",
            "docs": [
              "Unix-seconds when `cb_window_reference_price` was anchored."
            ],
            "type": "i64"
          },
          {
            "name": "cbFrozenSecondsPending",
            "docs": [
              "Frozen halt seconds from halt intervals overwritten or cleared before `accrue_interest`",
              "consumed them. Non-zero only when the halt record changes without a preceding accrual, i.e.",
              "a paused pulse; the next accrual excludes these on top of the current halt. Zero normally."
            ],
            "type": "u64"
          },
          {
            "name": "padding1",
            "type": {
              "array": [
                "u64",
                2
              ]
            }
          }
        ]
      }
    },
    {
      "name": "bankCache",
      "docs": [
        "A read-only cache of the bank's key metrics, e.g. spot interest/fee rates."
      ],
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "baseRate",
            "docs": [
              "Actual (spot) interest/fee rates of the bank, based on utilization",
              "* APR (annual percentage rate) values",
              "* From 0-1000%, as u32, e.g. u32::MAX = 1000%, u32::MAX/2 = 500%, etc"
            ],
            "type": "u32"
          },
          {
            "name": "lendingRate",
            "docs": [
              "Equivalent to `base_rate` * utilization",
              "* From 0-1000%, as u32, e.g. u32::MAX = 1000%, u32::MAX/2 = 500%, etc"
            ],
            "type": "u32"
          },
          {
            "name": "borrowingRate",
            "docs": [
              "Equivalent to `base_rate` * (1 + ir_fees) + fixed_fees",
              "* From 0-1000%, as u32, e.g. u32::MAX = 1000%, u32::MAX/2 = 500%, etc"
            ],
            "type": "u32"
          },
          {
            "name": "interestAccumulatedFor",
            "docs": [
              "* in seconds"
            ],
            "type": "u32"
          },
          {
            "name": "accumulatedSinceLastUpdate",
            "docs": [
              "equivalent to (share value increase in the last `interest_accumulated_for` seconds *",
              "shares), i.e. the delta in `asset_share_value`, in token.",
              "* Note: if the tx that triggered this cache update increased or decreased the net shares,",
              "this value still reports using the PRE-CHANGE share amount, since interest is always",
              "earned on that amount.",
              "* in token, in native decimals, as I80F48"
            ],
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "lastOraclePrice",
            "docs": [
              "Oracle price used in the last instruction that consumed an oracle price",
              "* Only updated when instruction uses an oracle price, not updated for operations that don't",
              "require prices (e.g., deposit, repay)",
              "* Price in USD, with no price bias",
              "* Zero if never updated"
            ],
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "lastOraclePriceTimestamp",
            "docs": [
              "Unix timestamp (seconds) when last_oracle_price was last updated",
              "* Used to determine staleness of cached price",
              "* Zero if never updated"
            ],
            "type": "i64"
          },
          {
            "name": "lastOraclePriceConfidence",
            "docs": [
              "Confidence interval reported by the oracle when last_oracle_price was fetched",
              "* Always non-negative",
              "* Zero if never updated",
              "* Pyth: confidence * 2.12",
              "* Switchboard: price * oracle_max_confidence / U32_MAX"
            ],
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "liqCacheFlags",
            "docs": [
              "Liquidation cache flags, set during receivership flow.",
              "* 1 (LIQ_CACHE_LOCKED_FLAG) - We \"lock\" the liquidation cache when writing to it in Start",
              "Liquidate as an additional safeguard, if the liquidation prices stored here were to be",
              "edited between start and end, it would completely break the risk engine. End validates that",
              "the lock is set, panics if not, and removes it - which prevents footguns if the cache was",
              "e.g. accidently set to default. The lock is also removed when a Balance is closed via",
              "withdraw_all, repay_all, or close_balance, but only when the account has",
              "ACCOUNT_IN_RECEIVERSHIP set, so that operations on unrelated accounts sharing the same",
              "bank do not interfere with an in-progress liquidation."
            ],
            "type": "u8"
          },
          {
            "name": "cbCachePad",
            "type": {
              "array": [
                "u8",
                7
              ]
            }
          },
          {
            "name": "priceMultiplier",
            "docs": [
              "For integration banks, this is the exchange rate of cToken/token or similar. The \"real\"",
              "price of one deposited token is `price_multiplier` * `last_oracle_price`, we split it here",
              "for consumers who are only interested in reading the oracle price and are applying the",
              "multiplier already elsewhere."
            ],
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "liquidationPriceRt",
            "docs": [
              "Cached real-time price for receivership liquidation."
            ],
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "liquidationPriceRtConfidence",
            "docs": [
              "Cached real-time price confidence for receivership liquidation."
            ],
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "liquidationPriceTwap",
            "docs": [
              "Cached TWAP price for receivership liquidation."
            ],
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "liquidationPriceTwapConfidence",
            "docs": [
              "Cached TWAP price confidence for receivership liquidation."
            ],
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          }
        ]
      }
    },
    {
      "name": "bankConfig",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "assetWeightInit",
            "docs": [
              "Discount factor for asset values in initial margin calculation (0 to 1).",
              "E.g., 0.8 means assets count as 80% of their value for borrowing purposes."
            ],
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "assetWeightMaint",
            "docs": [
              "Discount factor for asset values in maintenance margin calculation (0 to 2).",
              "Used for liquidation eligibility. Generally >= asset_weight_init."
            ],
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "liabilityWeightInit",
            "docs": [
              "Premium factor for liability values in initial margin calculation (>= 1).",
              "E.g., 1.2 means liabilities count as 120% of their value for borrowing purposes."
            ],
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "liabilityWeightMaint",
            "docs": [
              "Premium factor for liability values in maintenance margin calculation (>= 1).",
              "Used for liquidation eligibility. Generally <= liability_weight_init."
            ],
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "depositLimit",
            "docs": [
              "Maximum total deposits allowed in this bank, in native token units (0 = no limit)"
            ],
            "type": "u64"
          },
          {
            "name": "interestRateConfig",
            "docs": [
              "Interest rate model configuration"
            ],
            "type": {
              "defined": {
                "name": "interestRateConfig"
              }
            }
          },
          {
            "name": "operationalState",
            "docs": [
              "Current operational state of the bank (Paused, Operational, ReduceOnly, KilledByBankruptcy)"
            ],
            "type": {
              "defined": {
                "name": "bankOperationalState"
              }
            }
          },
          {
            "name": "oracleSetup",
            "docs": [
              "Oracle type used for price feeds"
            ],
            "type": {
              "defined": {
                "name": "oracleSetup"
              }
            }
          },
          {
            "name": "oracleKeys",
            "docs": [
              "Oracle account keys (usage depends on oracle_setup type)"
            ],
            "type": {
              "array": [
                "pubkey",
                5
              ]
            }
          },
          {
            "name": "cbWindowMaxUpBps",
            "docs": [
              "CB long-window upward move cap in bps; `0` uses the `CB_WINDOW_MAX_UP_BPS` default."
            ],
            "type": "u16"
          },
          {
            "name": "cbWindowMaxDownBps",
            "docs": [
              "CB long-window downward move cap in bps; `0` uses the `CB_WINDOW_MAX_DOWN_BPS` default."
            ],
            "type": "u16"
          },
          {
            "name": "pad0",
            "type": {
              "array": [
                "u8",
                2
              ]
            }
          },
          {
            "name": "borrowLimit",
            "docs": [
              "Maximum total borrows allowed in this bank, in native token units (0 = no limit)"
            ],
            "type": "u64"
          },
          {
            "name": "riskTier",
            "docs": [
              "Risk tier for this bank (Collateral or Isolated)"
            ],
            "type": {
              "defined": {
                "name": "riskTier"
              }
            }
          },
          {
            "name": "assetTag",
            "docs": [
              "Determines what kinds of assets users of this bank can interact with. Options:",
              "* `ASSET_TAG_DEFAULT` (0) - A regular asset that can be comingled with any other regular",
              "asset or with `ASSET_TAG_SOL`",
              "* `ASSET_TAG_SOL` (1) - Accounts with a SOL position can comingle with **either**",
              "`ASSET_TAG_DEFAULT` or `ASSET_TAG_STAKED` positions, but not both",
              "* `ASSET_TAG_STAKED` (2) - Staked SOL assets. Accounts with a STAKED position can only",
              "deposit other STAKED assets or SOL (`ASSET_TAG_SOL`) and can only borrow SOL",
              "* `ASSET_TAG_KAMINO` (3) - Treated the same as `ASSET_TAG_DEFAULT`",
              "* `ASSET_TAG_DRIFT` (4) - Treated the same as `ASSET_TAG_DEFAULT`",
              "* `ASSET_TAG_SOLEND` (5) - Treated the same as `ASSET_TAG_DEFAULT`"
            ],
            "type": "u8"
          },
          {
            "name": "configFlags",
            "docs": [
              "Flags for various config options",
              "* 1 - Always set if bank created in 0.1.4 or later, or if migrated to the new pyth oracle",
              "setup from a prior version. Not set in 0.1.3 or earlier banks using pyth that have not yet",
              "migrated. Does nothing for banks that use switchboard.",
              "* 2, 4, 8, 16, etc - reserved for future use."
            ],
            "type": "u8"
          },
          {
            "name": "pad1",
            "type": {
              "array": [
                "u8",
                1
              ]
            }
          },
          {
            "name": "cbWindowSeconds",
            "docs": [
              "CB long-window length in seconds; `0` uses the `CB_WINDOW_SECONDS` default."
            ],
            "type": "u32"
          },
          {
            "name": "totalAssetValueInitLimit",
            "docs": [
              "USD denominated limit for calculating asset value for initialization margin requirements.",
              "Example, if total SOL deposits are equal to $1M and the limit it set to $500K, then SOL",
              "assets will be discounted by 50%.",
              "",
              "In other words the max value of liabilities that can be backed by the asset is $500K. This",
              "is useful for limiting the damage of oracle attacks.",
              "",
              "Value is UI USD value, for example value 100 -> $100"
            ],
            "type": "u64"
          },
          {
            "name": "oracleMaxAge",
            "docs": [
              "Time window in seconds for the oracle price feed to be considered live."
            ],
            "type": "u16"
          },
          {
            "name": "scopeEntryIndex",
            "docs": [
              "Entry index into the Scope OraclePrices price list. Only read when",
              "oracle_setup == OracleSetup::Scope; ignored (and zero) for every other setup.",
              "Occupies what was previously _padding0, so the layout is unchanged."
            ],
            "type": "u16"
          },
          {
            "name": "oracleMaxConfidence",
            "docs": [
              "A %, as u32, e.g. 100% = u32::MAX, 50% = u32::MAX/2, etc.",
              "",
              "Oracle confidence configuration. Semantics depend on the oracle type:",
              "* Pyth: Maximum allowed confidence interval. Prices exceeding this threshold are rejected.",
              "- 0 defaults to 10%.",
              "* Switchboard: Confidence spread used for price biasing.",
              "- 0 disables confidence adjustment.",
              "- Non-zero: confidence = price * oracle_max_confidence / U32_MAX.",
              "- Clamped to MAX_CONF_INTERVAL (5% of price)."
            ],
            "type": "u32"
          },
          {
            "name": "fixedPrice",
            "docs": [
              "Stored oracle price for `OracleSetup::Fixed`, otherwise does nothing"
            ],
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "cbDeviationBpsTiers",
            "docs": [
              "Deviation thresholds in basis points for tiers 1/2/3, strictly monotonic."
            ],
            "type": {
              "array": [
                "u16",
                3
              ]
            }
          },
          {
            "name": "cbTierDurationsSeconds",
            "docs": [
              "Halt durations in seconds for tiers 1/2/3, strictly monotonic."
            ],
            "type": {
              "array": [
                "u16",
                3
              ]
            }
          },
          {
            "name": "cbEscalationWindowMult",
            "docs": [
              "Escalation window multiplier: a re-breach within `prev_tier_duration * mult` seconds",
              "after a halt ends ratchets to the next tier."
            ],
            "type": "u8"
          },
          {
            "name": "cbConfigPad",
            "type": "u8"
          },
          {
            "name": "cbEmaAlphaBps",
            "docs": [
              "EMA smoothing factor for the reference price, in basis points (e.g. 1000 = α=0.1)."
            ],
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "bankConfigCompact",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "assetWeightInit",
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "assetWeightMaint",
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "liabilityWeightInit",
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "liabilityWeightMaint",
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "depositLimit",
            "type": "u64"
          },
          {
            "name": "interestRateConfig",
            "type": {
              "defined": {
                "name": "interestRateConfigCompact"
              }
            }
          },
          {
            "name": "operationalState",
            "type": {
              "defined": {
                "name": "bankOperationalState"
              }
            }
          },
          {
            "name": "borrowLimit",
            "type": "u64"
          },
          {
            "name": "riskTier",
            "type": {
              "defined": {
                "name": "riskTier"
              }
            }
          },
          {
            "name": "assetTag",
            "docs": [
              "Determines what kinds of assets users of this bank can interact with. Options:",
              "* `ASSET_TAG_DEFAULT` (0) - A regular asset that can be comingled with any other regular",
              "asset or with `ASSET_TAG_SOL`",
              "* `ASSET_TAG_SOL` (1) - Accounts with a SOL position can comingle with **either**",
              "`ASSET_TAG_DEFAULT` or `ASSET_TAG_STAKED` positions, but not both",
              "* `ASSET_TAG_STAKED` (2) - Staked SOL assets. Accounts with a STAKED position can only",
              "deposit other STAKED assets or SOL (`ASSET_TAG_SOL`) and can only borrow SOL",
              "* `ASSET_TAG_KAMINO` (3) - Treated the same as `ASSET_TAG_DEFAULT`",
              "* `ASSET_TAG_DRIFT` (4) - Treated the same as `ASSET_TAG_DEFAULT`",
              "* `ASSET_TAG_SOLEND` (5) - Treated the same as `ASSET_TAG_DEFAULT`"
            ],
            "type": "u8"
          },
          {
            "name": "configFlags",
            "docs": [
              "Flags for various config options",
              "* 1 - Always set if bank created in 0.1.4 or later, or if migrated to the new oracle setup",
              "from a prior version. Not set in 0.1.3 or earlier banks that have not yet migrated.",
              "* 2, 4, 8, 16, etc - reserved for future use."
            ],
            "type": "u8"
          },
          {
            "name": "pad0",
            "type": {
              "array": [
                "u8",
                5
              ]
            }
          },
          {
            "name": "totalAssetValueInitLimit",
            "docs": [
              "USD denominated limit for calculating asset value for initialization margin requirements.",
              "Example, if total SOL deposits are equal to $1M and the limit it set to $500K, then SOL",
              "assets will be discounted by 50%.",
              "",
              "In other words the max value of liabilities that can be backed by the asset is $500K. This",
              "is useful for limiting the damage of oracle attacks.",
              "",
              "Value is UI USD value, for example value 100 -> $100"
            ],
            "type": "u64"
          },
          {
            "name": "oracleMaxAge",
            "docs": [
              "Time window in seconds for the oracle price feed to be considered live."
            ],
            "type": "u16"
          },
          {
            "name": "oracleMaxConfidence",
            "docs": [
              "A %, as u32, e.g. 100% = u32::MAX, 50% = u32::MAX/2, etc.",
              "",
              "Oracle confidence configuration. Semantics depend on the oracle type.",
              "* Pyth: Maximum allowed confidence interval. Prices exceeding this threshold are rejected.",
              "- 0 defaults to 10%.",
              "* Switchboard: Confidence spread used for price biasing.",
              "- 0 disables confidence adjustment.",
              "- Non-zero: confidence = price * oracle_max_confidence / U32_MAX.",
              "- Clamped to MAX_CONF_INTERVAL (5% of price)."
            ],
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "bankConfigOpt",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "assetWeightInit",
            "type": {
              "option": {
                "defined": {
                  "name": "wrappedI80f48"
                }
              }
            }
          },
          {
            "name": "assetWeightMaint",
            "type": {
              "option": {
                "defined": {
                  "name": "wrappedI80f48"
                }
              }
            }
          },
          {
            "name": "liabilityWeightInit",
            "type": {
              "option": {
                "defined": {
                  "name": "wrappedI80f48"
                }
              }
            }
          },
          {
            "name": "liabilityWeightMaint",
            "type": {
              "option": {
                "defined": {
                  "name": "wrappedI80f48"
                }
              }
            }
          },
          {
            "name": "depositLimit",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "borrowLimit",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "operationalState",
            "type": {
              "option": {
                "defined": {
                  "name": "bankOperationalState"
                }
              }
            }
          },
          {
            "name": "interestRateConfig",
            "type": {
              "option": {
                "defined": {
                  "name": "interestRateConfigOpt"
                }
              }
            }
          },
          {
            "name": "riskTier",
            "type": {
              "option": {
                "defined": {
                  "name": "riskTier"
                }
              }
            }
          },
          {
            "name": "assetTag",
            "type": {
              "option": "u8"
            }
          },
          {
            "name": "totalAssetValueInitLimit",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "oracleMaxConfidence",
            "type": {
              "option": "u32"
            }
          },
          {
            "name": "oracleMaxAge",
            "type": {
              "option": "u16"
            }
          },
          {
            "name": "permissionlessBadDebtSettlement",
            "type": {
              "option": "bool"
            }
          },
          {
            "name": "freezeSettings",
            "type": {
              "option": "bool"
            }
          },
          {
            "name": "tokenlessRepaymentsAllowed",
            "type": {
              "option": "bool"
            }
          },
          {
            "name": "liquidationLiquidatorFee",
            "docs": [
              "Per-bank liquidation fees, encoded as `u32_to_centi` (`u32::MAX` = 100%; 0 => default 2.5%)."
            ],
            "type": {
              "option": "u32"
            }
          },
          {
            "name": "liquidationInsuranceFee",
            "type": {
              "option": "u32"
            }
          },
          {
            "name": "circuitBreakerEnabled",
            "type": {
              "option": "bool"
            }
          },
          {
            "name": "cbDeviationBpsTiers",
            "type": {
              "option": {
                "array": [
                  "u16",
                  3
                ]
              }
            }
          },
          {
            "name": "cbTierDurationsSeconds",
            "type": {
              "option": {
                "array": [
                  "u16",
                  3
                ]
              }
            }
          },
          {
            "name": "cbEscalationWindowMult",
            "type": {
              "option": "u8"
            }
          },
          {
            "name": "cbEmaAlphaBps",
            "type": {
              "option": "u16"
            }
          },
          {
            "name": "cbWindowSeconds",
            "type": {
              "option": "u32"
            }
          },
          {
            "name": "cbWindowMaxUpBps",
            "type": {
              "option": "u16"
            }
          },
          {
            "name": "cbWindowMaxDownBps",
            "type": {
              "option": "u16"
            }
          }
        ]
      }
    },
    {
      "name": "bankMetadata",
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bank",
            "docs": [
              "Bank this metadata corresponds to"
            ],
            "type": "pubkey"
          },
          {
            "name": "placeholder",
            "type": "u64"
          },
          {
            "name": "ticker",
            "docs": [
              "The token's ticker name, e.g. USDC",
              "* utf-8"
            ],
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          },
          {
            "name": "description",
            "docs": [
              "The token's plain english description, e.g US Dollar Coin",
              "* utf-8"
            ],
            "type": {
              "array": [
                "u8",
                128
              ]
            }
          },
          {
            "name": "dataBlob",
            "docs": [
              "Reserved for future use. Room for a very small icon or something else cool"
            ],
            "type": {
              "array": [
                "u8",
                256
              ]
            }
          },
          {
            "name": "endDescriptionByte",
            "docs": [
              "The last data byte in description (padding follows)"
            ],
            "type": "u16"
          },
          {
            "name": "endDataBlob",
            "docs": [
              "The last data byte in data_blob (padding follows)"
            ],
            "type": "u16"
          },
          {
            "name": "endTickerByte",
            "docs": [
              "The last data byte in ticker (padding follows)"
            ],
            "type": "u8"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "pad0",
            "type": {
              "array": [
                "u8",
                2
              ]
            }
          }
        ]
      }
    },
    {
      "name": "bankOperationalState",
      "repr": {
        "kind": "rust"
      },
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "paused"
          },
          {
            "name": "operational"
          },
          {
            "name": "reduceOnly"
          },
          {
            "name": "killedByBankruptcy"
          },
          {
            "name": "uninitialized"
          },
          {
            "name": "reduceOnlyWithBorrowingPower"
          },
          {
            "name": "circuitBroken"
          }
        ]
      }
    },
    {
      "name": "bankRateLimiter",
      "docs": [
        "Per-bank rate limiting configuration and state.",
        "Tracks net outflow in native tokens."
      ],
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "hourly",
            "docs": [
              "Hourly window rate limiter (native tokens)."
            ],
            "type": {
              "defined": {
                "name": "rateLimitWindow"
              }
            }
          },
          {
            "name": "daily",
            "docs": [
              "Daily window rate limiter (native tokens)."
            ],
            "type": {
              "defined": {
                "name": "rateLimitWindow"
              }
            }
          }
        ]
      }
    },
    {
      "name": "circuitBreakerAutoBrokenEvent",
      "docs": [
        "Emitted when consecutive tier-3 trips force a bank into `CircuitBroken`."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "consecutiveTier3Trips",
            "type": "u8"
          },
          {
            "name": "currentTimestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "circuitBreakerClearedEvent",
      "docs": [
        "Emitted when a halt is cleared (admin override or escalation-window expiry)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "priorTier",
            "type": "u8"
          },
          {
            "name": "reason",
            "docs": [
              "One of the `CB_CLEAR_REASON_*` constants."
            ],
            "type": "u8"
          },
          {
            "name": "currentTimestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "circuitBreakerTrippedEvent",
      "docs": [
        "Emitted when the per-bank oracle circuit breaker trips or escalates a halt."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "tier",
            "type": "u8"
          },
          {
            "name": "deviationBps",
            "type": "u64"
          },
          {
            "name": "haltStartedAt",
            "type": "i64"
          },
          {
            "name": "haltEndedAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "deleverageEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "marginfiAccount",
            "type": "pubkey"
          },
          {
            "name": "riskAdmin",
            "type": "pubkey"
          },
          {
            "name": "deleverageeAssetsSeized",
            "type": "f64"
          },
          {
            "name": "deleverageeLiabilityRepaid",
            "type": "f64"
          }
        ]
      }
    },
    {
      "name": "deleverageWithdrawFlowEvent",
      "docs": [
        "Emitted for deleverage-only withdraw outflows.",
        "The delegate flow admin aggregates these off-chain and",
        "updates the deleverage daily withdraws via `update_deleverage_withdrawals`."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "group",
            "type": "pubkey"
          },
          {
            "name": "bank",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "outflowUsd",
            "docs": [
              "Equity-denominated outflow value in USD, rounded to integer."
            ],
            "type": "u32"
          },
          {
            "name": "currentTimestamp",
            "docs": [
              "Unix timestamp when the flow was recorded"
            ],
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "driftClaimBadDebtEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "header",
            "type": {
              "defined": {
                "name": "groupEventHeader"
              }
            }
          },
          {
            "name": "bank",
            "type": "pubkey"
          },
          {
            "name": "claimMint",
            "type": "pubkey"
          },
          {
            "name": "distributor",
            "type": "pubkey"
          },
          {
            "name": "claimStatus",
            "type": "pubkey"
          },
          {
            "name": "liquidityVaultAuthority",
            "type": "pubkey"
          },
          {
            "name": "globalFeeWallet",
            "type": "pubkey"
          },
          {
            "name": "requestedAmount",
            "type": "u64"
          },
          {
            "name": "receivedAmount",
            "type": "u64"
          },
          {
            "name": "sweptAmount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "driftConfigCompact",
      "docs": [
        "Used to configure Drift banks. A simplified version of `BankConfigCompact` which omits most",
        "values related to interest since Drift banks cannot earn interest or be borrowed from."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "oracle",
            "type": "pubkey"
          },
          {
            "name": "assetWeightInit",
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "assetWeightMaint",
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "depositLimit",
            "type": "u64"
          },
          {
            "name": "oracleSetup",
            "docs": [
              "Either `DriftPythPull` or `DriftSwitchboardPull`"
            ],
            "type": {
              "defined": {
                "name": "oracleSetup"
              }
            }
          },
          {
            "name": "operationalState",
            "docs": [
              "Bank operational state - allows starting banks in paused state"
            ],
            "type": {
              "defined": {
                "name": "bankOperationalState"
              }
            }
          },
          {
            "name": "riskTier",
            "docs": [
              "Risk tier - determines if assets can be borrowed in isolation"
            ],
            "type": {
              "defined": {
                "name": "riskTier"
              }
            }
          },
          {
            "name": "configFlags",
            "docs": [
              "Config flags for future-proofing"
            ],
            "type": "u8"
          },
          {
            "name": "totalAssetValueInitLimit",
            "type": "u64"
          },
          {
            "name": "oracleMaxAge",
            "type": "u16"
          },
          {
            "name": "oracleMaxConfidence",
            "docs": [
              "Oracle confidence threshold (0 = use default 10%)"
            ],
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "editStakedSettingsEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "group",
            "type": "pubkey"
          },
          {
            "name": "settings",
            "type": {
              "defined": {
                "name": "stakedSettingsEditConfig"
              }
            }
          }
        ]
      }
    },
    {
      "name": "emodeConfig",
      "docs": [
        "An emode configuration. Each bank has one such configuration, but this may also be the",
        "intersection of many configurations (see `reconcile_emode_configs`). For example, the risk",
        "engine creates such an intersection from all the emode config of all banks the user is borrowing",
        "from."
      ],
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "entries",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "emodeEntry"
                  }
                },
                10
              ]
            }
          }
        ]
      }
    },
    {
      "name": "emodeEntry",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "collateralBankEmodeTag",
            "docs": [
              "emode_tag of the bank(s) whose collateral you wish to treat preferentially."
            ],
            "type": "u16"
          },
          {
            "name": "flags",
            "docs": [
              "* APPLIES_TO_ISOLATED (1) - (NOT YET IMPLEMENTED) if set, isolated banks with this tag",
              "also benefit. If not set, isolated banks continue to offer zero collateral, even if they",
              "use this tag.",
              "* 2, 4, 8, 16, 32, etc - reserved for future use"
            ],
            "type": "u8"
          },
          {
            "name": "pad0",
            "type": {
              "array": [
                "u8",
                5
              ]
            }
          },
          {
            "name": "assetWeightInit",
            "docs": [
              "Note: If set below the collateral bank's weight, does nothing."
            ],
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "assetWeightMaint",
            "docs": [
              "Note: If set below the collateral bank's weight, does nothing."
            ],
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          }
        ]
      }
    },
    {
      "name": "emodeSettings",
      "docs": [
        "Controls the bank's e-mode configuration, allowing certain collateral sources to be treated more",
        "favorably as collateral when used to borrow from this bank."
      ],
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "emodeTag",
            "docs": [
              "This bank's NON-unique id that other banks will use to determine what emode rate to use when",
              "this bank is offered as collateral.",
              "",
              "For example, all stablecoin banks might share the same emode_tag, and in their entries, each",
              "such stablecoin bank will recognize that collateral sources with this \"stable\" tag get",
              "preferential weights. When a new stablecoin is added that is considered riskier, it may get",
              "a new, less favorable emode tag, and eventually get upgraded to the same one as the other",
              "stables",
              "",
              "* 0 is in an invalid tag and will do nothing."
            ],
            "type": "u16"
          },
          {
            "name": "pad0",
            "type": {
              "array": [
                "u8",
                6
              ]
            }
          },
          {
            "name": "timestamp",
            "docs": [
              "Unix timestamp from the system clock when emode state was last updated"
            ],
            "type": "i64"
          },
          {
            "name": "flags",
            "docs": [
              "EMODE_ON (1) - If set, at least one entry is configured",
              "2, 4, 8, etc, Reserved for future use"
            ],
            "type": "u64"
          },
          {
            "name": "emodeConfig",
            "type": {
              "defined": {
                "name": "emodeConfig"
              }
            }
          }
        ]
      }
    },
    {
      "name": "executeOrderBalanceRecord",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bank",
            "type": "pubkey"
          },
          {
            "name": "isAsset",
            "type": "u8"
          },
          {
            "name": "pad0",
            "type": {
              "array": [
                "u8",
                5
              ]
            }
          },
          {
            "name": "tag",
            "type": "u16"
          },
          {
            "name": "shares",
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          }
        ]
      }
    },
    {
      "name": "executeOrderRecord",
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "order",
            "type": "pubkey"
          },
          {
            "name": "executor",
            "type": "pubkey"
          },
          {
            "name": "balanceStates",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "executeOrderBalanceRecord"
                  }
                },
                14
              ]
            }
          },
          {
            "name": "activeBalanceCount",
            "type": "u8"
          },
          {
            "name": "inactiveBalanceCount",
            "type": "u8"
          },
          {
            "name": "reserved0",
            "type": {
              "array": [
                "u8",
                6
              ]
            }
          },
          {
            "name": "orderStartHealth",
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          }
        ]
      }
    },
    {
      "name": "feeState",
      "docs": [
        "Unique per-program. The Program Owner uses this account to administrate fees collected by the protocol"
      ],
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "key",
            "docs": [
              "The fee state's own key. A PDA derived from just `b\"feestate\"`"
            ],
            "type": "pubkey"
          },
          {
            "name": "globalFeeAdmin",
            "docs": [
              "Can modify fees, pause the protocol, etc"
            ],
            "type": "pubkey"
          },
          {
            "name": "globalFeeWallet",
            "docs": [
              "The base wallet for all protocol fees. All SOL fees go to this wallet. All non-SOL fees go",
              "to the cannonical ATA of this wallet for that asset."
            ],
            "type": "pubkey"
          },
          {
            "name": "accountTransferFee",
            "docs": [
              "Flat fee in lamports paid to the global fee wallet when initiating an account transfer",
              "(anti-spam; 5,000,000 lamports ~= $0.50). A stored 0 means \"use the default\"",
              "(`DEFAULT_ACCOUNT_TRANSFER_FEE_LAMPORTS`), which preserves the legacy fee for FeeStates",
              "created before this field existed."
            ],
            "type": "u32"
          },
          {
            "name": "placeholder0",
            "type": {
              "array": [
                "u8",
                4
              ]
            }
          },
          {
            "name": "bankInitFlatSolFee",
            "docs": [
              "Flat fee assessed when a new bank is initialized, in lamports.",
              "* In SOL, in native decimals."
            ],
            "type": "u32"
          },
          {
            "name": "bumpSeed",
            "type": "u8"
          },
          {
            "name": "padding0",
            "type": {
              "array": [
                "u8",
                3
              ]
            }
          },
          {
            "name": "liquidationMaxFee",
            "docs": [
              "Liquidators can claim at this premium, when liquidating an asset in receivership",
              "liquidation, e.g. (1 + this) * amount repaid >= asset seized",
              "* A percentage"
            ],
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "programFeeFixed",
            "docs": [
              "Fee collected by the program owner from all groups",
              "* A percentage"
            ],
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "programFeeRate",
            "docs": [
              "Fee collected by the program owner from all groups",
              "* A percentage"
            ],
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "panicState",
            "docs": [
              "When the global admin pauses the protocol in the event of an emergency, information about",
              "the pause duration will be stored here and propagated to groups."
            ],
            "type": {
              "defined": {
                "name": "panicState"
              }
            }
          },
          {
            "name": "placeholder1",
            "type": "u64"
          },
          {
            "name": "liquidationFlatSolFee",
            "docs": [
              "Flat fee assessed for insurance/program use when a liquidation is executed",
              "* In SOL, in native decimals."
            ],
            "type": "u32"
          },
          {
            "name": "orderInitFlatSolFee",
            "docs": [
              "Flat fee assessed for preventing spam use when creating an order",
              "* In SOL, in native decimals."
            ],
            "type": "u32"
          },
          {
            "name": "orderExecutionMaxFee",
            "docs": [
              "Take-profit Orders can be executed at this premium, which Keepers are allowed to keep (no",
              "pun intended) e.g. (1 + this) * amount repaid >= asset seized",
              "* A percentage"
            ],
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "pauseDelegateAdmin",
            "docs": [
              "Can pause (not unpause) the protocol, but cannot modify any fee configuration."
            ],
            "type": "pubkey"
          },
          {
            "name": "reserved0",
            "docs": [
              "Reserved for future use (e.g. the variable-borrow premium settings). Accounts created",
              "before the struct grew to this size are v1-sized (`8 + V1_LEN` bytes) and must be",
              "grown via `resize_global_fee_state` before this program version can load them; the new",
              "bytes are zero-filled."
            ],
            "type": {
              "array": [
                "u64",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "feeStateCache",
      "docs": [
        "Cached fee configuration propagated from the global FeeState"
      ],
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "globalFeeWallet",
            "docs": [
              "The wallet that receives program-level fees"
            ],
            "type": "pubkey"
          },
          {
            "name": "programFeeFixed",
            "docs": [
              "Fixed fee APR charged to borrowers (program-level)"
            ],
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "programFeeRate",
            "docs": [
              "Proportional fee rate on interest (program-level)"
            ],
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "lastUpdate",
            "docs": [
              "Unix timestamp of the last fee state propagation"
            ],
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "groupEventHeader",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "signer",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "marginfiGroup",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "groupRateLimiter",
      "docs": [
        "Per-group rate limiting configuration and state.",
        "Tracks aggregate net outflow in USD."
      ],
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "hourly",
            "docs": [
              "Hourly window rate limiter (USD)."
            ],
            "type": {
              "defined": {
                "name": "rateLimitWindow"
              }
            }
          },
          {
            "name": "daily",
            "docs": [
              "Daily window rate limiter (USD)."
            ],
            "type": {
              "defined": {
                "name": "rateLimitWindow"
              }
            }
          }
        ]
      }
    },
    {
      "name": "healthCache",
      "docs": [
        "A read-only cache of the internal risk engine's information. Only valid in borrow/withdraw if",
        "the tx does not fail. To see the state in any context, e.g. to figure out if the risk engine is",
        "failing due to some bad price information, use `pulse_health`."
      ],
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "assetValue",
            "docs": [
              "Internal risk engine asset value, using initial weight (e.g. what is used for borrowing",
              "purposes), with all confidence adjustments, and other discounts on price.",
              "* Uses EMA price",
              "* In dollars"
            ],
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "liabilityValue",
            "docs": [
              "Internal risk engine liability value, using initial weight (e.g. what is used for borrowing",
              "purposes), with all confidence adjustments, and other discounts on price.",
              "* Uses EMA price",
              "* In dollars"
            ],
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "assetValueMaint",
            "docs": [
              "Internal risk engine asset value, using maintenance weight (e.g. what is used for",
              "liquidation purposes), with all confidence adjustments.",
              "* Zero if the risk engine failed to load",
              "* Uses SPOT price",
              "* In dollars"
            ],
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "liabilityValueMaint",
            "docs": [
              "Internal risk engine liability value, using maintenance weight (e.g. what is used for",
              "liquidation purposes), with all confidence adjustments.",
              "* Zero if the risk engine failed to load",
              "* Uses SPOT price",
              "* In dollars"
            ],
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "assetValueEquity",
            "docs": [
              "The \"true\" value of assets without any confidence or weight adjustments. Internally, used",
              "only for bankruptcies.",
              "* Zero if the risk engine failed to load",
              "* Uses EMA price",
              "* In dollars"
            ],
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "liabilityValueEquity",
            "docs": [
              "The \"true\" value of liabilities without any confidence or weight adjustments.",
              "Internally, used only for bankruptcies.",
              "* Zero if the risk engine failed to load",
              "* Uses EMA price",
              "* In dollars"
            ],
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "timestamp",
            "docs": [
              "Unix timestamp from the system clock when this cache was last updated"
            ],
            "type": "i64"
          },
          {
            "name": "flags",
            "docs": [
              "The flags that indicate the state of the health cache. This is a u32 bitfield, where each",
              "bit represents a flag.",
              "",
              "* HEALTHY = 1 - If set, the account cannot be liquidated. If 0, the account is unhealthy and",
              "can be liquidated.",
              "* ENGINE STATUS = 2 - If set, the engine did not error during the last health pulse. If 0,",
              "the engine would have errored and this cache is likely invalid. `RiskEngineInitRejected`",
              "is ignored and will allow the flag to be set anyways.",
              "* ORACLE OK = 4 - If set, the engine did not error due to an oracle issue. If 0, engine was",
              "passed a bad bank or oracle account, or an oracle was stale. Check the order in which",
              "accounts were passed and ensure each balance has the correct banks/oracles, and that",
              "oracle cranks ran recently enough. Check `internal_err` and `err_index` for more details",
              "in some circumstances. Invalid if generated after borrow/withdraw (these instructions will",
              "ignore oracle issues if health is still satisfactory with some balance zeroed out).",
              "* 8, 16, 32, 64, 128, etc - reserved for future use"
            ],
            "type": "u32"
          },
          {
            "name": "mrgnErr",
            "docs": [
              "If the engine errored, look here for the error code. If the engine returns ok, you may also",
              "check here to see if the risk engine rejected this tx (3009)."
            ],
            "type": "u32"
          },
          {
            "name": "prices",
            "docs": [
              "Each price corresponds to that index of Balances in the LendingAccount. Useful for debugging",
              "or liquidator consumption, to determine how a user's position is priced internally.",
              "* An f64 stored as bytes"
            ],
            "type": {
              "array": [
                {
                  "array": [
                    "u8",
                    8
                  ]
                },
                16
              ]
            }
          },
          {
            "name": "internalErr",
            "docs": [
              "Errors in asset oracles are ignored (with prices treated as zero). If you see a zero price",
              "and the `ORACLE_OK` flag is not set, check here to see what error was ignored internally."
            ],
            "type": "u32"
          },
          {
            "name": "errIndex",
            "docs": [
              "Index in `balances` where `internal_err` appeared"
            ],
            "type": "u8"
          },
          {
            "name": "programVersion",
            "docs": [
              "Since 0.1.3, the version will be encoded here. See PROGRAM_VERSION."
            ],
            "type": "u8"
          },
          {
            "name": "pad0",
            "type": {
              "array": [
                "u8",
                2
              ]
            }
          },
          {
            "name": "internalLiqErr",
            "docs": [
              "Error code from the liquidation health check during the last health pulse (0 if none)"
            ],
            "type": "u32"
          },
          {
            "name": "internalBankruptcyErr",
            "docs": [
              "Error code from the bankruptcy check during the last health pulse (0 if none)"
            ],
            "type": "u32"
          },
          {
            "name": "reserved0",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "reserved1",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          }
        ]
      }
    },
    {
      "name": "healthPulseEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "account",
            "type": "pubkey"
          },
          {
            "name": "healthCache",
            "type": {
              "defined": {
                "name": "healthCache"
              }
            }
          }
        ]
      }
    },
    {
      "name": "indexerFlags",
      "docs": [
        "On-chain flags for indexer tranching. Each flag is a full byte so off-chain consumers can",
        "filter accounts via `memcmp`. Balance-derived flags are synced automatically on every",
        "balance-mutating instruction. Pulse-derived flags are updated in `pulse_health`."
      ],
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "isLendingOnly",
            "docs": [
              "1 if the account has no liabilities"
            ],
            "type": "u8"
          },
          {
            "name": "isEmpty",
            "docs": [
              "1 if the account has no balances above the dust threshold"
            ],
            "type": "u8"
          },
          {
            "name": "isSingleBorrower",
            "docs": [
              "1 if the account has exactly one liability position"
            ],
            "type": "u8"
          },
          {
            "name": "hasEverBeenLiquidated",
            "docs": [
              "1 if the account has ever entered receivership (liquidation or deleverage), permanent."
            ],
            "type": "u8"
          },
          {
            "name": "hasEverBeenDeleveraged",
            "docs": [
              "1 if the account has ever been forcibly deleveraged (permanent, never unset)"
            ],
            "type": "u8"
          },
          {
            "name": "hasBeenBankrupted",
            "docs": [
              "1 if `handle_bankruptcy` has ever been executed on this account (permanent, never unset)"
            ],
            "type": "u8"
          },
          {
            "name": "hasIsolated",
            "docs": [
              "1 if the account has any liability on a bank with `RiskTier::Isolated`. Note: Not",
              "authoritative due to a variety of edge cases, such as a Bank being configured from",
              "Collateral -> Isolated after the user deposits. Set at borrow time and refreshed best-effort",
              "by pulse from live bank state. Cleared by balance-derived sync only when liability count",
              "reaches zero."
            ],
            "type": "u8"
          },
          {
            "name": "hasStaked",
            "docs": [
              "1 if the account has a STAKED asset tag position"
            ],
            "type": "u8"
          },
          {
            "name": "hasKamino",
            "docs": [
              "1 if the account has a KAMINO asset tag position"
            ],
            "type": "u8"
          },
          {
            "name": "hasDrift",
            "docs": [
              "1 if the account has a DRIFT asset tag position"
            ],
            "type": "u8"
          },
          {
            "name": "hasJuplend",
            "docs": [
              "1 if the account has a JUPLEND asset tag position"
            ],
            "type": "u8"
          },
          {
            "name": "wasLiquidatable",
            "docs": [
              "1 if maintenance health was negative at last pulse"
            ],
            "type": "u8"
          },
          {
            "name": "wasUnderwater",
            "docs": [
              "1 if equity health was negative at last pulse"
            ],
            "type": "u8"
          },
          {
            "name": "wasActive30d",
            "docs": [
              "1 if account was active within the last 30 days. Raised to 1 on every",
              "balance-mutating instruction; can only transition 1 → 0 at pulse time, when the",
              "elapsed-since-`last_update` check fails.",
              "Combined with `is_empty`, indicates an account pending closure."
            ],
            "type": "u8"
          },
          {
            "name": "wasActive60d",
            "docs": [
              "1 if account was active within the last 60 days. Raised to 1 on every",
              "balance-mutating instruction; can only transition 1 → 0 at pulse time, when the",
              "elapsed-since-`last_update` check fails.",
              "Combined with `is_empty`, indicates an account eligible for permissionless close."
            ],
            "type": "u8"
          },
          {
            "name": "hasTrivialBalance",
            "docs": [
              "1 if net equity value was greater than $0 and less than $1 at last pulse"
            ],
            "type": "u8"
          },
          {
            "name": "pad",
            "type": {
              "array": [
                "u8",
                8
              ]
            }
          }
        ]
      }
    },
    {
      "name": "interestRateConfig",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "placeholder0",
            "docs": [
              "DEPRECATED placeholder field. Formerly used for legacy curve math."
            ],
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "placeholder1",
            "docs": [
              "DEPRECATED placeholder field. Formerly used for legacy curve math."
            ],
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "placeholder2",
            "docs": [
              "DEPRECATED placeholder field. Formerly used for legacy curve math."
            ],
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "insuranceFeeFixedApr",
            "docs": [
              "Goes to insurance, funds `collected_insurance_fees_outstanding`"
            ],
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "insuranceIrFee",
            "docs": [
              "Goes to insurance, funds `collected_insurance_fees_outstanding`"
            ],
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "protocolFixedFeeApr",
            "docs": [
              "Earned by the group, goes to `collected_group_fees_outstanding`"
            ],
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "protocolIrFee",
            "docs": [
              "Earned by the group, goes to `collected_group_fees_outstanding`"
            ],
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "protocolOriginationFee",
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "zeroUtilRate",
            "docs": [
              "The base rate at utilization = 0",
              "* a %, as u32, out of 1000%, e.g. 100% = 0.1 * u32::MAX"
            ],
            "type": "u32"
          },
          {
            "name": "hundredUtilRate",
            "docs": [
              "The base rate at utilization = 100",
              "* a %, as u32, out of 1000%, e.g. 100% = 0.1 * u32::MAX"
            ],
            "type": "u32"
          },
          {
            "name": "points",
            "docs": [
              "The base rate at various points between 0 and 100%, exclusive. Essentially a piece-wise",
              "linear curve.",
              "* always in ascending order, e.g. points[0] = first kink point, points[1] = second kink",
              "point, and so forth.",
              "* points where util = 0 are unused"
            ],
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "ratePoint"
                  }
                },
                5
              ]
            }
          },
          {
            "name": "curveType",
            "docs": [
              "Determines which interest rate curve implementation is active.",
              "- 0 (`INTEREST_CURVE_LEGACY`) is deprecated and unsupported.",
              "- 1 (`INTEREST_CURVE_SEVEN_POINT`) is the active multi-point curve."
            ],
            "type": "u8"
          },
          {
            "name": "pad0",
            "type": {
              "array": [
                "u8",
                7
              ]
            }
          },
          {
            "name": "padding1",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "padding2",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "padding3",
            "type": {
              "array": [
                "u8",
                8
              ]
            }
          }
        ]
      }
    },
    {
      "name": "interestRateConfigCompact",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "insuranceFeeFixedApr",
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "insuranceIrFee",
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "protocolFixedFeeApr",
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "protocolIrFee",
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "protocolOriginationFee",
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "zeroUtilRate",
            "docs": [
              "The base rate at utilization = 0",
              "* a %, as u32, out of 1000%, e.g. 100% = 0.1 * u32::MAX"
            ],
            "type": "u32"
          },
          {
            "name": "hundredUtilRate",
            "docs": [
              "The base rate at utilization = 100",
              "* a %, as u32, out of 1000%, e.g. 100% = 0.1 * u32::MAX"
            ],
            "type": "u32"
          },
          {
            "name": "points",
            "docs": [
              "The base rate at various points between 0 and 100%, exclusive. Essentially a piece-wise",
              "linear curve.",
              "* always in ascending order, e.g. points[0] = first kink point, points[1] = second kink",
              "point, and so forth.",
              "* points where util = 0 are unused"
            ],
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "ratePoint"
                  }
                },
                5
              ]
            }
          }
        ]
      }
    },
    {
      "name": "interestRateConfigOpt",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "insuranceFeeFixedApr",
            "type": {
              "option": {
                "defined": {
                  "name": "wrappedI80f48"
                }
              }
            }
          },
          {
            "name": "insuranceIrFee",
            "type": {
              "option": {
                "defined": {
                  "name": "wrappedI80f48"
                }
              }
            }
          },
          {
            "name": "protocolFixedFeeApr",
            "type": {
              "option": {
                "defined": {
                  "name": "wrappedI80f48"
                }
              }
            }
          },
          {
            "name": "protocolIrFee",
            "type": {
              "option": {
                "defined": {
                  "name": "wrappedI80f48"
                }
              }
            }
          },
          {
            "name": "protocolOriginationFee",
            "type": {
              "option": {
                "defined": {
                  "name": "wrappedI80f48"
                }
              }
            }
          },
          {
            "name": "zeroUtilRate",
            "docs": [
              "The base rate at utilization = 0",
              "* a %, as u32, out of 1000%, e.g. 100% = 0.1 * u32::MAX"
            ],
            "type": {
              "option": "u32"
            }
          },
          {
            "name": "hundredUtilRate",
            "docs": [
              "The base rate at utilization = 100",
              "* a %, as u32, out of 1000%, e.g. 100% = 0.1 * u32::MAX"
            ],
            "type": {
              "option": "u32"
            }
          },
          {
            "name": "points",
            "docs": [
              "The base rate at various points between 0 and 100%, exclusive. Essentially a piece-wise",
              "linear curve.",
              "* always in ascending order, e.g. points[0] = first kink point, points[1] = second kink",
              "point, and so forth.",
              "* points where util = 0 are unused"
            ],
            "type": {
              "option": {
                "array": [
                  {
                    "defined": {
                      "name": "ratePoint"
                    }
                  },
                  5
                ]
              }
            }
          }
        ]
      }
    },
    {
      "name": "juplendConfigCompact",
      "docs": [
        "Used to configure JupLend banks. A simplified version of `BankConfigCompact` which omits most",
        "values related to interest since JupLend banks cannot earn interest or be borrowed from.",
        "",
        "Note: JupLend banks do not take an Operational State, they always start in `Uninitialized`",
        "state and are set to `Operational` via `juplend_init_position` (seed deposit + protocol fToken",
        "vault)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "oracle",
            "type": "pubkey"
          },
          {
            "name": "assetWeightInit",
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "assetWeightMaint",
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "depositLimit",
            "docs": [
              "Cap in **fToken units**, not underlying. As `token_exchange_price` grows, the same",
              "cap admits more underlying — re-tune against the current rate."
            ],
            "type": "u64"
          },
          {
            "name": "oracleSetup",
            "docs": [
              "Either `JuplendPythPull` or `JuplendSwitchboardPull`"
            ],
            "type": {
              "defined": {
                "name": "oracleSetup"
              }
            }
          },
          {
            "name": "riskTier",
            "docs": [
              "Isolated or Collateral"
            ],
            "type": {
              "defined": {
                "name": "riskTier"
              }
            }
          },
          {
            "name": "configFlags",
            "docs": [
              "Config flags for future-proofing, currently ignored"
            ],
            "type": "u8"
          },
          {
            "name": "totalAssetValueInitLimit",
            "docs": [
              "In $"
            ],
            "type": "u64"
          },
          {
            "name": "oracleMaxAge",
            "docs": [
              "In seconds"
            ],
            "type": "u16"
          },
          {
            "name": "oracleMaxConfidence",
            "docs": [
              "Oracle confidence threshold (0 = use default 10%)"
            ],
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "kaminoConfigCompact",
      "docs": [
        "Used to configure Kamino banks. A simplified version of `BankConfigCompact` which omits most",
        "values related to interest since Kamino banks cannot earn interest or be borrowed against."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "oracle",
            "type": "pubkey"
          },
          {
            "name": "assetWeightInit",
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "assetWeightMaint",
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "depositLimit",
            "docs": [
              "Cap in **Kamino collateral units**, not underlying. As the reserve collateral",
              "exchange rate grows, the same cap admits more underlying — re-tune against the",
              "current rate."
            ],
            "type": "u64"
          },
          {
            "name": "oracleSetup",
            "docs": [
              "Either `KaminoPythPush` or `KaminoSwitchboardPull`"
            ],
            "type": {
              "defined": {
                "name": "oracleSetup"
              }
            }
          },
          {
            "name": "operationalState",
            "docs": [
              "Bank operational state - allows starting banks in paused state"
            ],
            "type": {
              "defined": {
                "name": "bankOperationalState"
              }
            }
          },
          {
            "name": "riskTier",
            "docs": [
              "Risk tier - determines if assets can be borrowed in isolation"
            ],
            "type": {
              "defined": {
                "name": "riskTier"
              }
            }
          },
          {
            "name": "configFlags",
            "docs": [
              "Config flags for future-proofing"
            ],
            "type": "u8"
          },
          {
            "name": "totalAssetValueInitLimit",
            "type": "u64"
          },
          {
            "name": "oracleMaxAge",
            "docs": [
              "Currently unused: Kamino's oracle age applies to kamino banks."
            ],
            "type": "u16"
          },
          {
            "name": "oracleMaxConfidence",
            "docs": [
              "Oracle confidence threshold (0 = use default 10%)"
            ],
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "keeperCloseOrderEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "header",
            "type": {
              "defined": {
                "name": "accountEventHeader"
              }
            }
          },
          {
            "name": "order",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "lending",
      "docs": [
        "Minimal representation of the on-chain JupLend `Lending` account.",
        "",
        "Notes:",
        "- We intentionally use a **zero-copy** layout here to match how other integrations load large",
        "external accounts (and to avoid paying Borsh (de)serialization cost on every access).",
        "- `repr(C, packed)` keeps the byte layout identical to a field-by-field serialization",
        "(i.e. no implicit padding). This is important because `Pubkey` has alignment=1 while `u64`",
        "has alignment=8; using plain `repr(C)` would insert padding before the first `u64`."
      ],
      "serialization": "bytemuck",
      "repr": {
        "kind": "c",
        "packed": true
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "fTokenMint",
            "type": "pubkey"
          },
          {
            "name": "lendingId",
            "type": "u16"
          },
          {
            "name": "decimals",
            "docs": [
              "number of decimals for the fToken, same as underlying mint"
            ],
            "type": "u8"
          },
          {
            "name": "rewardsRateModel",
            "docs": [
              "PDA of rewards rate model (LRRM)"
            ],
            "type": "pubkey"
          },
          {
            "name": "liquidityExchangePrice",
            "docs": [
              "exchange price in the liquidity layer (no rewards)"
            ],
            "type": "u64"
          },
          {
            "name": "tokenExchangePrice",
            "docs": [
              "exchange price between fToken and underlying (with rewards)"
            ],
            "type": "u64"
          },
          {
            "name": "lastUpdateTimestamp",
            "docs": [
              "unix timestamp when exchange prices were updated last"
            ],
            "type": "u64"
          },
          {
            "name": "tokenReservesLiquidity",
            "type": "pubkey"
          },
          {
            "name": "supplyPositionOnLiquidity",
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "lendingAccount",
      "docs": [
        "The lending account holds up to 16 balance positions for a user."
      ],
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "balances",
            "docs": [
              "Array of balance positions (max 16). Sorted in descending order by bank_pk."
            ],
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "balance"
                  }
                },
                16
              ]
            }
          },
          {
            "name": "lastTagUsed",
            "docs": [
              "Last allocated balance tag (u16), used to find the next unused tag."
            ],
            "type": "u16"
          },
          {
            "name": "pad1",
            "docs": [
              "Reserved for future use"
            ],
            "type": {
              "array": [
                "u8",
                6
              ]
            }
          },
          {
            "name": "padding",
            "docs": [
              "Reserved for future use"
            ],
            "type": {
              "array": [
                "u64",
                7
              ]
            }
          }
        ]
      }
    },
    {
      "name": "lendingAccountBorrowEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "header",
            "type": {
              "defined": {
                "name": "accountEventHeader"
              }
            }
          },
          {
            "name": "bank",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "shareAmount",
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          }
        ]
      }
    },
    {
      "name": "lendingAccountDepositEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "header",
            "type": {
              "defined": {
                "name": "accountEventHeader"
              }
            }
          },
          {
            "name": "bank",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "shareAmount",
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          }
        ]
      }
    },
    {
      "name": "lendingAccountLiquidateEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "header",
            "type": {
              "defined": {
                "name": "accountEventHeader"
              }
            }
          },
          {
            "name": "liquidateeMarginfiAccount",
            "type": "pubkey"
          },
          {
            "name": "liquidateeMarginfiAccountAuthority",
            "type": "pubkey"
          },
          {
            "name": "assetBank",
            "type": "pubkey"
          },
          {
            "name": "assetMint",
            "type": "pubkey"
          },
          {
            "name": "liabilityBank",
            "type": "pubkey"
          },
          {
            "name": "liabilityMint",
            "type": "pubkey"
          },
          {
            "name": "liquidateePreHealth",
            "type": "f64"
          },
          {
            "name": "liquidateePostHealth",
            "type": "f64"
          },
          {
            "name": "preBalances",
            "type": {
              "defined": {
                "name": "liquidationBalances"
              }
            }
          },
          {
            "name": "postBalances",
            "type": {
              "defined": {
                "name": "liquidationBalances"
              }
            }
          }
        ]
      }
    },
    {
      "name": "lendingAccountRepayEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "header",
            "type": {
              "defined": {
                "name": "accountEventHeader"
              }
            }
          },
          {
            "name": "bank",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "closeBalance",
            "type": "bool"
          },
          {
            "name": "shareAmount",
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          }
        ]
      }
    },
    {
      "name": "lendingAccountWithdrawEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "header",
            "type": {
              "defined": {
                "name": "accountEventHeader"
              }
            }
          },
          {
            "name": "bank",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "closeBalance",
            "type": "bool"
          },
          {
            "name": "shareAmount",
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          }
        ]
      }
    },
    {
      "name": "lendingPoolBankAccrueInterestEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "header",
            "type": {
              "defined": {
                "name": "groupEventHeader"
              }
            }
          },
          {
            "name": "bank",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "delta",
            "type": "u64"
          },
          {
            "name": "feesCollected",
            "type": "f64"
          },
          {
            "name": "insuranceCollected",
            "type": "f64"
          }
        ]
      }
    },
    {
      "name": "lendingPoolBankCollectFeesEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "header",
            "type": {
              "defined": {
                "name": "groupEventHeader"
              }
            }
          },
          {
            "name": "bank",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "groupFeesCollected",
            "type": "f64"
          },
          {
            "name": "groupFeesOutstanding",
            "type": "f64"
          },
          {
            "name": "insuranceFeesCollected",
            "type": "f64"
          },
          {
            "name": "insuranceFeesOutstanding",
            "type": "f64"
          }
        ]
      }
    },
    {
      "name": "lendingPoolBankConfigureEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "header",
            "type": {
              "defined": {
                "name": "groupEventHeader"
              }
            }
          },
          {
            "name": "bank",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "config",
            "type": {
              "defined": {
                "name": "bankConfigOpt"
              }
            }
          }
        ]
      }
    },
    {
      "name": "lendingPoolBankConfigureFrozenEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "header",
            "type": {
              "defined": {
                "name": "groupEventHeader"
              }
            }
          },
          {
            "name": "bank",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "depositLimit",
            "type": "u64"
          },
          {
            "name": "borrowLimit",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "lendingPoolBankConfigureOracleEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "header",
            "type": {
              "defined": {
                "name": "groupEventHeader"
              }
            }
          },
          {
            "name": "bank",
            "type": "pubkey"
          },
          {
            "name": "oracleSetup",
            "type": "u8"
          },
          {
            "name": "oracle",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "lendingPoolBankCreateEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "header",
            "type": {
              "defined": {
                "name": "groupEventHeader"
              }
            }
          },
          {
            "name": "bank",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "lendingPoolBankHandleBankruptcyEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "header",
            "type": {
              "defined": {
                "name": "accountEventHeader"
              }
            }
          },
          {
            "name": "bank",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "badDebt",
            "type": "f64"
          },
          {
            "name": "coveredAmount",
            "type": "f64"
          },
          {
            "name": "socializedAmount",
            "type": "f64"
          }
        ]
      }
    },
    {
      "name": "lendingPoolBankSetFixedOraclePriceEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "header",
            "type": {
              "defined": {
                "name": "groupEventHeader"
              }
            }
          },
          {
            "name": "bank",
            "type": "pubkey"
          },
          {
            "name": "price",
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          }
        ]
      }
    },
    {
      "name": "lendingPoolBankSetSameAssetEmodeEligibilityEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "header",
            "type": {
              "defined": {
                "name": "groupEventHeader"
              }
            }
          },
          {
            "name": "bank",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "enabled",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "lendingPoolSuperAdminDepositEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "header",
            "type": {
              "defined": {
                "name": "groupEventHeader"
              }
            }
          },
          {
            "name": "bank",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "transferAmount",
            "docs": [
              "Amount requested in SPL transfer instruction."
            ],
            "type": "u64"
          },
          {
            "name": "vaultInflowAmount",
            "docs": [
              "Assumed vault inflow. Token-2022 transfer fees are not handled by this instruction path."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "lendingPoolSuperAdminWithdrawEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "header",
            "type": {
              "defined": {
                "name": "groupEventHeader"
              }
            }
          },
          {
            "name": "bank",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "vaultOutflowAmount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "liquidationBalances",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "liquidateeAssetBalance",
            "type": "f64"
          },
          {
            "name": "liquidateeLiabilityBalance",
            "type": "f64"
          },
          {
            "name": "liquidatorAssetBalance",
            "type": "f64"
          },
          {
            "name": "liquidatorLiabilityBalance",
            "type": "f64"
          },
          {
            "name": "liquidatorLiabilityBankAssetBalance",
            "type": "f64"
          }
        ]
      }
    },
    {
      "name": "liquidationCache",
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "assetValueMaint",
            "docs": [
              "Internal risk engine asset value snapshot taken when liquidation begins, using maintenance",
              "weight with all confidence adjustments.",
              "* Uses SPOT price",
              "* In dollars"
            ],
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "liabilityValueMaint",
            "docs": [
              "Internal risk engine liability value snapshot taken when liquidation begins, using",
              "maintenance weight with all confidence adjustments.",
              "* Uses SPOT price",
              "* In dollars"
            ],
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "assetValueEquity",
            "docs": [
              "Actual cash value of assets pre-liquidation (inclusive of price adjustment for oracle",
              "confidence, but without any weights)",
              "* Liquidator is allowed to seize up to `liability_value_equity` - this amount",
              "* Uses EMA price",
              "* In dollars"
            ],
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "liabilityValueEquity",
            "docs": [
              "Actual cash value of liabilities pre-liquidation (inclusive of price adjustment for oracle",
              "confidence, but without any weights)",
              "* Liquidator is allowed to seize up to this amount - `asset_value_equity`",
              "* Uses EMA price",
              "* In dollars"
            ],
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "placeholder",
            "type": "u64"
          },
          {
            "name": "reserved0",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "liquidationEntry",
      "docs": [
        "Used to record key details of the last few liquidation events on the account"
      ],
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "assetAmountSeized",
            "docs": [
              "Dollar amount seized",
              "* An f64 stored as bytes"
            ],
            "type": {
              "array": [
                "u8",
                8
              ]
            }
          },
          {
            "name": "liabAmountRepaid",
            "docs": [
              "Dollar amount repaid",
              "* An f64 stored as bytes"
            ],
            "type": {
              "array": [
                "u8",
                8
              ]
            }
          },
          {
            "name": "placeholder0",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          },
          {
            "name": "reserved0",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          }
        ]
      }
    },
    {
      "name": "liquidationReceiverEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "marginfiAccount",
            "type": "pubkey"
          },
          {
            "name": "liquidationReceiver",
            "type": "pubkey"
          },
          {
            "name": "liquidateeAssetsSeized",
            "type": "f64"
          },
          {
            "name": "liquidateeLiabilityRepaid",
            "type": "f64"
          },
          {
            "name": "lampsFeePaid",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "liquidationRecord",
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "key",
            "docs": [
              "This account's own key. A PDA derived from `marginfi_account`"
            ],
            "type": "pubkey"
          },
          {
            "name": "marginfiAccount",
            "docs": [
              "Account this record tracks"
            ],
            "type": "pubkey"
          },
          {
            "name": "recordPayer",
            "docs": [
              "The key that paid to create this account. At some point, we may allow this wallet to reclaim",
              "the rent paid to open a record."
            ],
            "type": "pubkey"
          },
          {
            "name": "liquidationReceiver",
            "docs": [
              "The liquidator taking receivership of the `marginfi_account` to complete a liquidation. Pays",
              "the liquidation fee.",
              "* Always pubkey default unless actively within a liquidation event."
            ],
            "type": "pubkey"
          },
          {
            "name": "entries",
            "docs": [
              "Basic historical data for the last few liquidation events on this account"
            ],
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "liquidationEntry"
                  }
                },
                4
              ]
            }
          },
          {
            "name": "cache",
            "type": {
              "defined": {
                "name": "liquidationCache"
              }
            }
          },
          {
            "name": "reserved0",
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          },
          {
            "name": "reserved2",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "reserved3",
            "type": {
              "array": [
                "u8",
                8
              ]
            }
          }
        ]
      }
    },
    {
      "name": "marginfiAccount",
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "group",
            "type": "pubkey"
          },
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "lendingAccount",
            "type": {
              "defined": {
                "name": "lendingAccount"
              }
            }
          },
          {
            "name": "accountFlags",
            "docs": [
              "The flags that indicate the state of the account. This is u64 bitfield, where each bit",
              "represents a flag.",
              "",
              "Flags:MarginfiAccount",
              "- 1: `ACCOUNT_DISABLED` - Indicates that the account is disabled and no further actions can",
              "be taken on it.",
              "- 2: `ACCOUNT_IN_FLASHLOAN` - Only set when an account is within a flash loan, e.g. when",
              "start_flashloan is called, then unset when the flashloan ends.",
              "- 4: `ACCOUNT_FLAG_DEPRECATED` - Deprecated, available for future use",
              "- 8: `ACCOUNT_TRANSFER_AUTHORITY_DEPRECATED` - the admin has flagged with account to be",
              "moved, original owner can now call `set_account_transfer_authority`",
              "- 16: `ACCOUNT_IN_RECEIVERSHIP` - the account is eligible to be liquidated and has entered",
              "receivership, a liquidator is able to control borrows and withdraws until the end of the",
              "tx. This flag will only appear within a tx.",
              "- 32: `ACCOUNT_IN_DELEVERAGE - the account is being deleveraged by the risk admin",
              "- 64: `ACCOUNT_FROZEN` - the admin has frozen the account; only the group admin may perform",
              "actions until unfrozen."
            ],
            "type": "u64"
          },
          {
            "name": "emissionsDestinationAccount",
            "docs": [
              "Wallet whose canonical ATA receives off-chain emissions distributions."
            ],
            "type": "pubkey"
          },
          {
            "name": "healthCache",
            "type": {
              "defined": {
                "name": "healthCache"
              }
            }
          },
          {
            "name": "migratedFrom",
            "docs": [
              "If this account was migrated from another one, store the original account key"
            ],
            "type": "pubkey"
          },
          {
            "name": "migratedTo",
            "docs": [
              "If this account has been migrated to another one, store the destination account key"
            ],
            "type": "pubkey"
          },
          {
            "name": "lastUpdate",
            "docs": [
              "Unix timestamp (u64) of the last account interaction. Note: Bank.last_update uses i64."
            ],
            "type": "u64"
          },
          {
            "name": "accountIndex",
            "docs": [
              "If a PDA-based account, the account index, a seed used to derive the PDA that can be chosen",
              "arbitrarily (0.1.5 or later). Otherwise, does nothing."
            ],
            "type": "u16"
          },
          {
            "name": "thirdPartyIndex",
            "docs": [
              "If a PDA-based account (0.1.5 or later), a \"vendor specific\" id. Values < PDA_FREE_THRESHOLD",
              "can be used by anyone with no restrictions. Values >= PDA_FREE_THRESHOLD can only be used by",
              "a particular program via CPI. These values require being added to a list, contact us for",
              "more details. For legacy non-pda accounts, does nothing.",
              "",
              "Note: use a unique seed to tag accounts related to some particular program or campaign so",
              "you can easily fetch them all later."
            ],
            "type": "u16"
          },
          {
            "name": "bump",
            "docs": [
              "This account's bump, if a PDA-based account (0.1.5 or later). Otherwise, does nothing."
            ],
            "type": "u8"
          },
          {
            "name": "activeOrders",
            "docs": [
              "Count of how many Orders this account has active. One is added when an Order is opened, and",
              "subtracted when an Order is executed or cancelled.",
              "* Accounts cannot open more than u8::MAX orders. Sorry power users: hopefully 256 stop",
              "losses is enough for you."
            ],
            "type": "u8"
          },
          {
            "name": "pad0",
            "type": {
              "array": [
                "u8",
                2
              ]
            }
          },
          {
            "name": "liquidationRecord",
            "docs": [
              "Stores information related to liquidations made against this account. A pda of this",
              "account's key, and \"liq_record\"",
              "* Typically pubkey default if this account has never been liquidated or close to liquidation",
              "* Opening this account is permissionless. Typically the liquidator pays, but e.g. we may",
              "also charge the user if they are opening a risky position on the front end."
            ],
            "type": "pubkey"
          },
          {
            "name": "indexerFlags",
            "type": {
              "defined": {
                "name": "indexerFlags"
              }
            }
          },
          {
            "name": "padding0",
            "type": {
              "array": [
                "u64",
                4
              ]
            }
          }
        ]
      }
    },
    {
      "name": "marginfiAccountCloseOrderEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "header",
            "type": {
              "defined": {
                "name": "accountEventHeader"
              }
            }
          },
          {
            "name": "order",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "marginfiAccountCreateEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "header",
            "type": {
              "defined": {
                "name": "accountEventHeader"
              }
            }
          }
        ]
      }
    },
    {
      "name": "marginfiAccountFreezeEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "header",
            "type": {
              "defined": {
                "name": "accountEventHeader"
              }
            }
          },
          {
            "name": "frozen",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "marginfiAccountPlaceOrderEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "header",
            "type": {
              "defined": {
                "name": "accountEventHeader"
              }
            }
          },
          {
            "name": "order",
            "type": "pubkey"
          },
          {
            "name": "trigger",
            "type": {
              "defined": {
                "name": "orderTriggerType"
              }
            }
          },
          {
            "name": "stopLoss",
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "takeProfit",
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "tags",
            "type": {
              "array": [
                "u16",
                2
              ]
            }
          }
        ]
      }
    },
    {
      "name": "marginfiAccountTransferToNewAccount",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "header",
            "type": {
              "defined": {
                "name": "accountEventHeader"
              }
            }
          },
          {
            "name": "oldAccount",
            "type": "pubkey"
          },
          {
            "name": "oldAccountAuthority",
            "type": "pubkey"
          },
          {
            "name": "newAccountAuthority",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "marginfiGroup",
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "docs": [
              "Broadly able to modify anything, and can set/remove other admins at will."
            ],
            "type": "pubkey"
          },
          {
            "name": "groupFlags",
            "docs": [
              "Bitmask for group settings flags.",
              "* Bit 0 (1): `PROGRAM_FEES_ENABLED` — If set, program-level fees are enabled.",
              "* Bits 1-63: Reserved for future use."
            ],
            "type": "u64"
          },
          {
            "name": "feeStateCache",
            "docs": [
              "Caches information from the global `FeeState` so the FeeState can be omitted on certain ixes"
            ],
            "type": {
              "defined": {
                "name": "feeStateCache"
              }
            }
          },
          {
            "name": "banks",
            "docs": [
              "For groups initialized in versions 0.1.2 or greater, this is an authoritative count",
              "of the number of banks under this group. For groups initialized prior to 0.1.2,",
              "a non-authoritative count of the number of banks initiated after 0.1.2 went live."
            ],
            "type": "u16"
          },
          {
            "name": "pad0",
            "type": {
              "array": [
                "u8",
                6
              ]
            }
          },
          {
            "name": "emodeAdmin",
            "docs": [
              "This admin can configure collateral ratios above (but not below) the collateral ratio of",
              "certain banks, e.g. allow SOL to count as 90% collateral when borrowing an LST instead of",
              "the default rate."
            ],
            "type": "pubkey"
          },
          {
            "name": "delegateCurveAdmin",
            "docs": [
              "Can modify the fields in `config.interest_rate_config` but nothing else, for every bank",
              "under this group"
            ],
            "type": "pubkey"
          },
          {
            "name": "delegateLimitAdmin",
            "docs": [
              "Can modify the `deposit_limit`, `borrow_limit`, `total_asset_value_init_limit` but nothing",
              "else, for every bank under this group"
            ],
            "type": "pubkey"
          },
          {
            "name": "delegateEmissionsAdmin",
            "docs": [
              "DEPRECATED: currently has no on-chain authority.",
              "Preserved in account layout for backward compatibility and historical metadata only."
            ],
            "type": "pubkey"
          },
          {
            "name": "panicStateCache",
            "docs": [
              "When program keeper temporarily puts the program into panic mode, information about the",
              "duration of the lockup will be available here."
            ],
            "type": {
              "defined": {
                "name": "panicStateCache"
              }
            }
          },
          {
            "name": "deleverageWithdrawWindowCache",
            "docs": [
              "Keeps track of the liquidity withdrawn from the group over the day as a result of",
              "deleverages. Used as a protection mechanism against too big (and unwanted) withdrawals (e.g.",
              "when the risk admin is compromised)."
            ],
            "type": {
              "defined": {
                "name": "withdrawWindowCache"
              }
            }
          },
          {
            "name": "riskAdmin",
            "docs": [
              "Can run bankruptcy and forced deleverage ixes to e.g. sunset risky/illiquid assets"
            ],
            "type": "pubkey"
          },
          {
            "name": "metadataAdmin",
            "docs": [
              "Can modify a Bank's metadata, and nothing else."
            ],
            "type": "pubkey"
          },
          {
            "name": "emodeMaxInitLeverage",
            "docs": [
              "Maximum leverage allowed for emode positions (initial margin), stored as u32 basis.",
              "Use `u32_to_basis` to convert to I80F48. Range: 1-100."
            ],
            "type": "u32"
          },
          {
            "name": "emodeMaxMaintLeverage",
            "docs": [
              "Maximum leverage allowed for emode positions (maintenance margin), stored as u32 basis.",
              "Must be > emode_max_init_leverage. Range: 1-100."
            ],
            "type": "u32"
          },
          {
            "name": "sameAssetEmodeInitLeverage",
            "docs": [
              "Encoded same-asset automatic emode leverage for initial margin.",
              "Decode with `u32_to_basis`. Same-asset treatment is disabled when the decoded leverage is",
              "less than or equal to 1 and also requires each participating bank to opt in."
            ],
            "type": "u32"
          },
          {
            "name": "sameAssetEmodeMaintLeverage",
            "docs": [
              "Encoded same-asset automatic emode leverage for maintenance margin.",
              "Decode with `u32_to_basis`. Ordering is validated in decoded space."
            ],
            "type": "u32"
          },
          {
            "name": "rateLimiter",
            "docs": [
              "Rate limiter for controlling aggregate withdraw/borrow outflow across all banks.",
              "Tracks net outflow in USD."
            ],
            "type": {
              "defined": {
                "name": "groupRateLimiter"
              }
            }
          },
          {
            "name": "rateLimiterLastAdminUpdateSlot",
            "docs": [
              "Last slot covered by an admin group rate limiter aggregation update."
            ],
            "type": "u64"
          },
          {
            "name": "rateLimiterLastAdminUpdateSeq",
            "docs": [
              "Monotonic sequence number for admin group rate limiter updates.",
              "This is used to enforce strict ordering and prevent duplicate/replayed batches",
              "when slot ranges overlap or multiple updates happen in the same slot."
            ],
            "type": "u64"
          },
          {
            "name": "deleverageWithdrawLastAdminUpdateSlot",
            "docs": [
              "Last slot covered by an admin deleverage withdraw-limit aggregation update."
            ],
            "type": "u64"
          },
          {
            "name": "deleverageWithdrawLastAdminUpdateSeq",
            "docs": [
              "Monotonic sequence number for admin deleverage withdraw-limit updates."
            ],
            "type": "u64"
          },
          {
            "name": "delegateFlowAdmin",
            "docs": [
              "Can modify flow-control status for the group, i.e. update the withdraw caches with flow",
              "information from banks. Typically this is a hot wallet that lives in e.g. some cron job. If",
              "compromised, flow control can be effectively disabled until the admin is restored, which",
              "does not itself compromise any funds, and is merely annoying."
            ],
            "type": "pubkey"
          },
          {
            "name": "padding0",
            "type": {
              "array": [
                {
                  "array": [
                    "u64",
                    2
                  ]
                },
                2
              ]
            }
          },
          {
            "name": "padding1",
            "type": {
              "array": [
                {
                  "array": [
                    "u64",
                    2
                  ]
                },
                32
              ]
            }
          },
          {
            "name": "padding2",
            "type": {
              "array": [
                {
                  "array": [
                    "u64",
                    32
                  ]
                },
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "marginfiGroupConfigureEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "header",
            "type": {
              "defined": {
                "name": "groupEventHeader"
              }
            }
          },
          {
            "name": "admin",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "flags",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "marginfiGroupCreateEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "header",
            "type": {
              "defined": {
                "name": "groupEventHeader"
              }
            }
          }
        ]
      }
    },
    {
      "name": "minimalObligation",
      "docs": [
        "A minimal copy of Kamino's Obligation for zero-copy deserialization"
      ],
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "tag",
            "type": "u64"
          },
          {
            "name": "lastUpdateSlot",
            "docs": [
              "Kamino obligations are only good for one slot, e.g. `refresh_obligation` must have run within the",
              "same slot as any ix that needs a non-stale obligation e.g. withdraw."
            ],
            "type": "u64"
          },
          {
            "name": "lastUpdateStale",
            "docs": [
              "True if the obligation is stale, which will cause various ixes like withdraw to fail. Typically",
              "set to true in any tx that modifies obligation balance, and set to false at the end of a",
              "successful `refresh_obligation`",
              "* 0 = false, 1 = true"
            ],
            "type": "u8"
          },
          {
            "name": "lastUpdatePriceStatus",
            "docs": [
              "Each bit represents a passed check in price status.",
              "* 63 = all checks passed",
              "",
              "Otherwise:",
              "* PRICE_LOADED =        0b_0000_0001; // 1",
              "* PRICE_AGE_CHECKED =   0b_0000_0010; // 2",
              "* TWAP_CHECKED =        0b_0000_0100; // 4",
              "* TWAP_AGE_CHECKED =    0b_0000_1000; // 8",
              "* HEURISTIC_CHECKED =   0b_0001_0000; // 16",
              "* PRICE_USAGE_ALLOWED = 0b_0010_0000; // 32"
            ],
            "type": "u8"
          },
          {
            "name": "lastUpdatePlaceholder",
            "type": {
              "array": [
                "u8",
                6
              ]
            }
          },
          {
            "name": "lendingMarket",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "docs": [
              "For mrgn banks, the bank's Liquidity Vault Authority (a pda which can be derived if the bank",
              "key is known)"
            ],
            "type": "pubkey"
          },
          {
            "name": "deposits",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "minimalObligationCollateral"
                  }
                },
                8
              ]
            }
          },
          {
            "name": "lowestReserveDepositLiquidationLtv",
            "type": "u64"
          },
          {
            "name": "depositedValueSf",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "paddingPart1",
            "type": {
              "array": [
                "u8",
                512
              ]
            }
          },
          {
            "name": "paddingPart2",
            "type": {
              "array": [
                "u8",
                512
              ]
            }
          },
          {
            "name": "paddingPart3",
            "type": {
              "array": [
                "u8",
                512
              ]
            }
          },
          {
            "name": "paddingPart4",
            "type": {
              "array": [
                "u8",
                512
              ]
            }
          },
          {
            "name": "paddingPart5a",
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          },
          {
            "name": "paddingPart5c",
            "type": {
              "array": [
                "u8",
                24
              ]
            }
          }
        ]
      }
    },
    {
      "name": "minimalObligationCollateral",
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "depositReserve",
            "type": "pubkey"
          },
          {
            "name": "depositedAmount",
            "docs": [
              "In collateral token (NOT liquidity token), use `collateral_to_liquidity` to convert back to",
              "liquidity token!",
              "* Always 6 decimals"
            ],
            "type": "u64"
          },
          {
            "name": "marketValueSf",
            "docs": [
              "* In dollars, based on last oracle price update",
              "* Actually an I68F60, stored as a u128 (i.e. BN) in Kamino.",
              "* A float (arbitrary decimals)"
            ],
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "borrowedAmountAgainstThisCollateralInElevationGroup",
            "type": "u64"
          },
          {
            "name": "padding",
            "type": {
              "array": [
                "u64",
                9
              ]
            }
          }
        ]
      }
    },
    {
      "name": "minimalReserve",
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "version",
            "type": "u64"
          },
          {
            "name": "slot",
            "docs": [
              "Kamino reserves are only good for one slot, e.g. `refresh_reserve` must have run within the",
              "same slot as any ix that needs a non-stale reserve e.g. withdraw."
            ],
            "type": "u64"
          },
          {
            "name": "stale",
            "docs": [
              "True if the reserve is stale, which will cause various ixes like withdraw to fail. Typically",
              "set to true in any tx that modifies reserve balance, and set to false at the end of a",
              "successful `refresh_reserve`",
              "* 0 = false, 1 = true"
            ],
            "type": "u8"
          },
          {
            "name": "priceStatus",
            "docs": [
              "Each bit represents a passed check in price status.",
              "* 63 = all checks passed",
              "",
              "Otherwise:",
              "* PRICE_LOADED =        0b_0000_0001; // 1",
              "* PRICE_AGE_CHECKED =   0b_0000_0010; // 2",
              "* TWAP_CHECKED =        0b_0000_0100; // 4",
              "* TWAP_AGE_CHECKED =    0b_0000_1000; // 8",
              "* HEURISTIC_CHECKED =   0b_0001_0000; // 16",
              "* PRICE_USAGE_ALLOWED = 0b_0010_0000; // 32"
            ],
            "type": "u8"
          },
          {
            "name": "placeholder",
            "type": {
              "array": [
                "u8",
                6
              ]
            }
          },
          {
            "name": "lendingMarket",
            "type": "pubkey"
          },
          {
            "name": "farmCollateral",
            "type": "pubkey"
          },
          {
            "name": "farmDebt",
            "type": "pubkey"
          },
          {
            "name": "mintPubkey",
            "type": "pubkey"
          },
          {
            "name": "supplyVault",
            "docs": [
              "* A PDA"
            ],
            "type": "pubkey"
          },
          {
            "name": "feeVault",
            "docs": [
              "* A PDA"
            ],
            "type": "pubkey"
          },
          {
            "name": "availableAmount",
            "docs": [
              "In simple terms: (amount in supply vault - outstanding borrows)",
              "* In token, with `mint_decimals`"
            ],
            "type": "u64"
          },
          {
            "name": "borrowedAmountSf",
            "docs": [
              "* In token, with `mint_decimals`",
              "* Actually an I68F60, stored as a u128 (i.e. BN) in Kamino."
            ],
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "marketPriceSf",
            "docs": [
              "* Actually an I68F60, stored as a u128 (i.e. BN) in Kamino."
            ],
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "marketPriceLastUpdatedTs",
            "type": "u64"
          },
          {
            "name": "mintDecimals",
            "type": "u64"
          },
          {
            "name": "depositLimitCrossedTimestamp",
            "type": "u64"
          },
          {
            "name": "borrowLimitCrossedTimestamp",
            "type": "u64"
          },
          {
            "name": "cumulativeBorrowRateBsf",
            "type": {
              "array": [
                "u8",
                48
              ]
            }
          },
          {
            "name": "accumulatedProtocolFeesSf",
            "docs": [
              "* In token, with `mint_decimals`",
              "* Actually an I68F60, stored as a u128 (i.e. BN) in Kamino."
            ],
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "accumulatedReferrerFeesSf",
            "docs": [
              "* In token, with `mint_decimals`",
              "* Actually an I68F60, stored as a u128 (i.e. BN) in Kamino."
            ],
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "pendingReferrerFeesSf",
            "docs": [
              "* In token, with `mint_decimals`",
              "* Actually an I68F60, stored as a u128 (i.e. BN) in Kamino."
            ],
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "absoluteReferralRateSf",
            "docs": [
              "* In token, with `mint_decimals`",
              "* Actually an I68F60, stored as a u128 (i.e. BN) in Kamino."
            ],
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "tokenProgram",
            "docs": [
              "Token or Token22. If token22, note that Kamino does not support all Token22 extensions."
            ],
            "type": "pubkey"
          },
          {
            "name": "padding2Part1",
            "type": {
              "array": [
                "u8",
                256
              ]
            }
          },
          {
            "name": "padding2Part2",
            "type": {
              "array": [
                "u8",
                128
              ]
            }
          },
          {
            "name": "padding2Part3",
            "type": {
              "array": [
                "u8",
                24
              ]
            }
          },
          {
            "name": "padding3",
            "type": {
              "array": [
                "u8",
                512
              ]
            }
          },
          {
            "name": "paddingPart1",
            "type": {
              "array": [
                "u8",
                512
              ]
            }
          },
          {
            "name": "paddingPart2",
            "type": {
              "array": [
                "u8",
                512
              ]
            }
          },
          {
            "name": "paddingPart3",
            "type": {
              "array": [
                "u8",
                128
              ]
            }
          },
          {
            "name": "paddingPart4",
            "type": {
              "array": [
                "u8",
                48
              ]
            }
          },
          {
            "name": "collateralMintPubkey",
            "docs": [
              "Mints collateral tokens",
              "* A PDA",
              "* technically 6 decimals, but uses `mint_decimals` regardless for all purposes",
              "* authority = lending_market_authority"
            ],
            "type": "pubkey"
          },
          {
            "name": "mintTotalSupply",
            "docs": [
              "Total number of collateral tokens",
              "* uses `mint_decimals`, even though it's technically 6 decimals under the hood"
            ],
            "type": "u64"
          },
          {
            "name": "collateralSupplyVault",
            "docs": [
              "* A PDA"
            ],
            "type": "pubkey"
          },
          {
            "name": "padding1ReserveCollateral",
            "type": {
              "array": [
                "u8",
                512
              ]
            }
          },
          {
            "name": "padding2ReserveCollateral",
            "type": {
              "array": [
                "u8",
                512
              ]
            }
          },
          {
            "name": "padding4Part1",
            "type": {
              "array": [
                "u8",
                4096
              ]
            }
          },
          {
            "name": "padding4Part2",
            "type": {
              "array": [
                "u8",
                512
              ]
            }
          },
          {
            "name": "padding4Part3",
            "type": {
              "array": [
                "u8",
                256
              ]
            }
          },
          {
            "name": "padding4Part4",
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          },
          {
            "name": "padding4Part5",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "padding4Part6",
            "type": {
              "array": [
                "u8",
                8
              ]
            }
          }
        ]
      }
    },
    {
      "name": "minimalSpotMarket",
      "docs": [
        "Minimal representation of Drift's SpotMarket account",
        "Only includes the fields we actually need for marginfi integration",
        "https://github.com/drift-labs/protocol-v2/tree/master/programs/drift/src/state/spot_market.rs#L35"
      ],
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pubkey",
            "docs": [
              "The address of the spot market. It is a pda of the market index"
            ],
            "type": "pubkey"
          },
          {
            "name": "oracle",
            "docs": [
              "The oracle used to price the markets deposits/borrows"
            ],
            "type": "pubkey"
          },
          {
            "name": "mint",
            "docs": [
              "The token mint of the market"
            ],
            "type": "pubkey"
          },
          {
            "name": "vault",
            "docs": [
              "The vault used to store the market's deposits"
            ],
            "type": "pubkey"
          },
          {
            "name": "padding1",
            "type": {
              "array": [
                {
                  "array": [
                    "u64",
                    4
                  ]
                },
                9
              ]
            }
          },
          {
            "name": "padding2",
            "type": {
              "array": [
                "u8",
                8
              ]
            }
          },
          {
            "name": "depositBalance",
            "docs": [
              "All the fields we need for testing (stored as raw bytes for simplicity)"
            ],
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "borrowBalance",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "cumulativeDepositInterest",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "cumulativeBorrowInterest",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "padding3",
            "type": {
              "array": [
                "u64",
                9
              ]
            }
          },
          {
            "name": "lastInterestTs",
            "docs": [
              "Last time the cumulative deposit and borrow interest was updated",
              "Offset: 568 bytes from start of struct (including discriminator)"
            ],
            "type": "u64"
          },
          {
            "name": "padding4",
            "type": {
              "array": [
                "u64",
                13
              ]
            }
          },
          {
            "name": "decimals",
            "type": "u32"
          },
          {
            "name": "marketIndex",
            "type": "u16"
          },
          {
            "name": "padding5",
            "type": {
              "array": [
                "u16",
                24
              ]
            }
          },
          {
            "name": "padding6",
            "type": {
              "array": [
                "u8",
                1
              ]
            }
          },
          {
            "name": "poolId",
            "type": "u8"
          },
          {
            "name": "padding7",
            "docs": [
              "Padding to reach 776 bytes total (including discriminator)"
            ],
            "type": {
              "array": [
                "u64",
                5
              ]
            }
          }
        ]
      }
    },
    {
      "name": "minimalUser",
      "docs": [
        "Minimal representation of Drift's User account",
        "Only includes the fields we actually need"
      ],
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "docs": [
              "The owner/authority of the account"
            ],
            "type": "pubkey"
          },
          {
            "name": "delegate",
            "docs": [
              "An addresses that can control the account on the authority's behalf"
            ],
            "type": "pubkey"
          },
          {
            "name": "name",
            "docs": [
              "Encoded display name for the account"
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "spotPositions",
            "docs": [
              "The user's spot positions (8 positions)"
            ],
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "spotPosition"
                  }
                },
                8
              ]
            }
          },
          {
            "name": "padding1",
            "docs": [
              "Skip to the fields we need at the end"
            ],
            "type": {
              "array": [
                "u64",
                256
              ]
            }
          },
          {
            "name": "padding2",
            "type": {
              "array": [
                "u64",
                128
              ]
            }
          },
          {
            "name": "padding3",
            "type": {
              "array": [
                "u64",
                64
              ]
            }
          },
          {
            "name": "padding4",
            "type": {
              "array": [
                "u64",
                32
              ]
            }
          },
          {
            "name": "padding5",
            "type": {
              "array": [
                "u64",
                8
              ]
            }
          },
          {
            "name": "padding6",
            "type": {
              "array": [
                "u64",
                2
              ]
            }
          },
          {
            "name": "padding7",
            "type": {
              "array": [
                "u16",
                1
              ]
            }
          },
          {
            "name": "subAccountId",
            "docs": [
              "Sub account id for this user account"
            ],
            "type": "u16"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "userStatus"
              }
            }
          },
          {
            "name": "padding8",
            "type": {
              "array": [
                "u8",
                27
              ]
            }
          }
        ]
      }
    },
    {
      "name": "oracleSetup",
      "repr": {
        "kind": "rust"
      },
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "none"
          },
          {
            "name": "pythLegacy"
          },
          {
            "name": "switchboardV2"
          },
          {
            "name": "pythPushOracle"
          },
          {
            "name": "switchboardPull"
          },
          {
            "name": "stakedWithPythPush"
          },
          {
            "name": "kaminoPythPush"
          },
          {
            "name": "kaminoSwitchboardPull"
          },
          {
            "name": "fixed"
          },
          {
            "name": "driftPythPull"
          },
          {
            "name": "driftSwitchboardPull"
          },
          {
            "name": "solendPythPull"
          },
          {
            "name": "solendSwitchboardPull"
          },
          {
            "name": "fixedKamino"
          },
          {
            "name": "fixedDrift"
          },
          {
            "name": "juplendPythPull"
          },
          {
            "name": "juplendSwitchboardPull"
          },
          {
            "name": "fixedJuplend"
          },
          {
            "name": "scope"
          },
          {
            "name": "pythMsol"
          },
          {
            "name": "kaminoMsol"
          },
          {
            "name": "juplendMsol"
          },
          {
            "name": "pythLst"
          },
          {
            "name": "kaminoLst"
          },
          {
            "name": "juplendLst"
          },
          {
            "name": "ptPyth"
          },
          {
            "name": "ptFixed"
          }
        ]
      }
    },
    {
      "name": "order",
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "marginfiAccount",
            "type": "pubkey"
          },
          {
            "name": "stopLoss",
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "takeProfit",
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "createdAt",
            "docs": [
              "Unix timestamp (seconds) when the order was created. Reads 0 for orders created before this",
              "field existed (it was previously a reserved placeholder; same 8 bytes, so layout-compatible)."
            ],
            "type": "i64"
          },
          {
            "name": "maxSlippage",
            "docs": [
              "* a %, as u32, out of 100%, e.g. 50% = .5 * u32::MAX"
            ],
            "type": "u32"
          },
          {
            "name": "pad0",
            "type": {
              "array": [
                "u8",
                4
              ]
            }
          },
          {
            "name": "tags",
            "docs": [
              "Active tags (currently 2). Remaining capacity is stored in padding for layout compatibility.",
              "Padding byte `ORDER_TAG_PADDING - 1` stores the tag count for forward compatibility. (u16 *",
              "2 = 4 bytes)"
            ],
            "type": {
              "array": [
                "u16",
                2
              ]
            }
          },
          {
            "name": "pad1",
            "type": {
              "array": [
                "u8",
                4
              ]
            }
          },
          {
            "name": "tagsPadding",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "trigger",
            "docs": [
              "Stop Loss (0), Take Profit (1), or Both (2)"
            ],
            "type": {
              "defined": {
                "name": "orderTriggerType"
              }
            }
          },
          {
            "name": "bump",
            "docs": [
              "Bump to derive this pda"
            ],
            "type": "u8"
          },
          {
            "name": "pad2",
            "type": {
              "array": [
                "u8",
                6
              ]
            }
          },
          {
            "name": "reserved1",
            "type": {
              "array": [
                {
                  "array": [
                    "u8",
                    32
                  ]
                },
                4
              ]
            }
          }
        ]
      }
    },
    {
      "name": "orderTrigger",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "stopLoss",
            "fields": [
              {
                "name": "threshold",
                "type": {
                  "defined": {
                    "name": "wrappedI80f48"
                  }
                }
              },
              {
                "name": "maxSlippage",
                "type": "u32"
              }
            ]
          },
          {
            "name": "takeProfit",
            "fields": [
              {
                "name": "threshold",
                "type": {
                  "defined": {
                    "name": "wrappedI80f48"
                  }
                }
              },
              {
                "name": "maxSlippage",
                "type": "u32"
              }
            ]
          },
          {
            "name": "both",
            "fields": [
              {
                "name": "stopLoss",
                "type": {
                  "defined": {
                    "name": "wrappedI80f48"
                  }
                }
              },
              {
                "name": "takeProfit",
                "type": {
                  "defined": {
                    "name": "wrappedI80f48"
                  }
                }
              },
              {
                "name": "maxSlippage",
                "type": "u32"
              }
            ]
          }
        ]
      }
    },
    {
      "name": "orderTriggerType",
      "repr": {
        "kind": "rust"
      },
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "stopLoss"
          },
          {
            "name": "takeProfit"
          },
          {
            "name": "both"
          }
        ]
      }
    },
    {
      "name": "panicState",
      "docs": [
        "Panic state for emergency protocol pausing"
      ],
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pauseFlags",
            "docs": [
              "Whether the protocol is currently paused (1 = paused, 0 = not paused)"
            ],
            "type": "u8"
          },
          {
            "name": "dailyPauseCount",
            "docs": [
              "Number of times paused today (resets every 24 hours)"
            ],
            "type": "u8"
          },
          {
            "name": "consecutivePauseCount",
            "docs": [
              "Number of consecutive pauses (resets when unpause happens)"
            ],
            "type": "u8"
          },
          {
            "name": "reserved",
            "type": {
              "array": [
                "u8",
                5
              ]
            }
          },
          {
            "name": "pauseStartTimestamp",
            "docs": [
              "Timestamp when the current pause started (0 if not paused)",
              "* When a pause is extended before expiring, this could be in the future."
            ],
            "type": "i64"
          },
          {
            "name": "lastDailyResetTimestamp",
            "docs": [
              "Timestamp of the last daily reset (for tracking daily pause count)"
            ],
            "type": "i64"
          },
          {
            "name": "reservedSpace",
            "docs": [
              "Reserved for future use (making total struct 32 bytes)"
            ],
            "type": {
              "array": [
                "u8",
                8
              ]
            }
          }
        ]
      }
    },
    {
      "name": "panicStateCache",
      "docs": [
        "Cached panic state information for fast checking during user operations"
      ],
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pauseFlags",
            "docs": [
              "Whether the protocol is currently paused (1 = paused, 0 = not paused)"
            ],
            "type": "u8"
          },
          {
            "name": "reserved",
            "type": {
              "array": [
                "u8",
                7
              ]
            }
          },
          {
            "name": "pauseStartTimestamp",
            "docs": [
              "Timestamp when the current pause started (0 if not paused)"
            ],
            "type": "i64"
          },
          {
            "name": "lastCacheUpdate",
            "docs": [
              "Timestamp when this cache was last updated"
            ],
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "rateLimitFlowEvent",
      "docs": [
        "Emitted when a bank-level inflow or outflow is recorded.",
        "The delegate flow admin aggregates these off-chain and",
        "updates the group rate limiter via `update_group_rate_limiter`."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "group",
            "type": "pubkey"
          },
          {
            "name": "bank",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "flowDirection",
            "docs": [
              "0 = outflow (withdraw/borrow), 1 = inflow (deposit/repay)"
            ],
            "type": "u8"
          },
          {
            "name": "nativeAmount",
            "docs": [
              "Amount in native tokens"
            ],
            "type": "u64"
          },
          {
            "name": "mintDecimals",
            "type": "u8"
          },
          {
            "name": "currentTimestamp",
            "docs": [
              "Unix timestamp when the flow was recorded"
            ],
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "rateLimitWindow",
      "docs": [
        "A sliding window rate limiter that tracks net outflow over a time window.",
        "Uses weighted blend of previous and current windows for smooth transitions.",
        "",
        "Net outflow = (withdraws + borrows) - (deposits + repays).",
        "A negative net outflow increases remaining capacity for subsequent outflows."
      ],
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "maxOutflow",
            "docs": [
              "Maximum net outflow allowed per window (0 = disabled).",
              "For bank-level: denominated in native tokens.",
              "For group-level: denominated in USD."
            ],
            "type": "u64"
          },
          {
            "name": "windowDuration",
            "docs": [
              "Window duration in seconds (e.g., 3600 for hourly, 86400 for daily)."
            ],
            "type": "u64"
          },
          {
            "name": "windowStart",
            "docs": [
              "Unix timestamp when the current window started."
            ],
            "type": "i64"
          },
          {
            "name": "prevWindowOutflow",
            "docs": [
              "Net outflow accumulated in the previous window.",
              "Signed to allow tracking when inflows exceed outflows."
            ],
            "type": "i64"
          },
          {
            "name": "curWindowOutflow",
            "docs": [
              "Net outflow accumulated in the current window.",
              "Signed to allow tracking when inflows exceed outflows."
            ],
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "ratePoint",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "util",
            "docs": [
              "The utilization rate where `rate` applies",
              "* a %, as u32, out of 100%, e.g. 50% = .5 * u32::MAX"
            ],
            "type": "u32"
          },
          {
            "name": "rate",
            "docs": [
              "The base rate that applies",
              "* a %, as u32, out of 1000%, e.g. 100% = 0.1 * u32::MAX"
            ],
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "riskTier",
      "repr": {
        "kind": "rust"
      },
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "collateral"
          },
          {
            "name": "isolated"
          }
        ]
      }
    },
    {
      "name": "sameAssetEmodeBank",
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bank",
            "type": "pubkey"
          },
          {
            "name": "groupIndex",
            "docs": [
              "Index into `SameAssetEmodeRegistry.groups`."
            ],
            "type": "u8"
          },
          {
            "name": "padding",
            "type": {
              "array": [
                "u8",
                7
              ]
            }
          }
        ]
      }
    },
    {
      "name": "sameAssetEmodeGroup",
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "oracleKey",
            "docs": [
              "The canonical price source, matching `Bank.config.oracle_keys[0]`."
            ],
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "sameAssetEmodeRegistry",
      "docs": [
        "Read-only archive of same-asset-emode banks. Enables the emode admin to see, at a glance, which",
        "banks are participating in same-asset-emode."
      ],
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "padding0",
            "type": "u64"
          },
          {
            "name": "key",
            "docs": [
              "This registry's own key."
            ],
            "type": "pubkey"
          },
          {
            "name": "group",
            "docs": [
              "Group for which this registry applies."
            ],
            "type": "pubkey"
          },
          {
            "name": "bankCount",
            "type": "u16"
          },
          {
            "name": "groupCount",
            "type": "u8"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "padding1",
            "type": {
              "array": [
                "u8",
                4
              ]
            }
          },
          {
            "name": "groups",
            "docs": [
              "Describes the same-asset-emode groupings that exist"
            ],
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "sameAssetEmodeGroup"
                  }
                },
                32
              ]
            }
          },
          {
            "name": "banks",
            "docs": [
              "Describes which bank belongs to which group"
            ],
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "sameAssetEmodeBank"
                  }
                },
                128
              ]
            }
          },
          {
            "name": "padding2",
            "type": {
              "array": [
                "u8",
                1024
              ]
            }
          },
          {
            "name": "padding3",
            "type": {
              "array": [
                "u8",
                512
              ]
            }
          },
          {
            "name": "padding4",
            "type": {
              "array": [
                "u8",
                256
              ]
            }
          }
        ]
      }
    },
    {
      "name": "setKeeperCloseFlagsEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "header",
            "type": {
              "defined": {
                "name": "accountEventHeader"
              }
            }
          },
          {
            "name": "bankKeys",
            "type": {
              "option": {
                "vec": "pubkey"
              }
            }
          }
        ]
      }
    },
    {
      "name": "solendConfigCompact",
      "docs": [
        "Used to configure Solend banks. A simplified version of `BankConfigCompact` which omits most",
        "values related to interest since Solend banks cannot earn interest or be borrowed against."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "oracle",
            "type": "pubkey"
          },
          {
            "name": "assetWeightInit",
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "assetWeightMaint",
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "depositLimit",
            "docs": [
              "Cap in **Solend collateral units**, not underlying. As the reserve collateral",
              "exchange rate grows, the same cap admits more underlying — re-tune against the",
              "current rate."
            ],
            "type": "u64"
          },
          {
            "name": "oracleSetup",
            "docs": [
              "Either `SolendPythPull` or `SolendSwitchboardPull`"
            ],
            "type": {
              "defined": {
                "name": "oracleSetup"
              }
            }
          },
          {
            "name": "operationalState",
            "docs": [
              "Bank operational state - allows starting banks in paused state"
            ],
            "type": {
              "defined": {
                "name": "bankOperationalState"
              }
            }
          },
          {
            "name": "riskTier",
            "docs": [
              "Risk tier - determines if assets can be borrowed in isolation"
            ],
            "type": {
              "defined": {
                "name": "riskTier"
              }
            }
          },
          {
            "name": "configFlags",
            "docs": [
              "Config flags for future-proofing"
            ],
            "type": "u8"
          },
          {
            "name": "totalAssetValueInitLimit",
            "type": "u64"
          },
          {
            "name": "oracleMaxAge",
            "type": "u16"
          },
          {
            "name": "oracleMaxConfidence",
            "docs": [
              "Oracle confidence threshold (0 = use default 10%)"
            ],
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "solendMinimalReserve",
      "serialization": "bytemuck",
      "repr": {
        "kind": "c",
        "packed": true
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "lastUpdateSlot",
            "docs": [
              "Last slot when supply and rates updated"
            ],
            "type": "u64"
          },
          {
            "name": "lastUpdateStale",
            "docs": [
              "True when marked stale"
            ],
            "type": "u8"
          },
          {
            "name": "lendingMarket",
            "docs": [
              "Lending market address"
            ],
            "type": "pubkey"
          },
          {
            "name": "liquidityMintPubkey",
            "type": "pubkey"
          },
          {
            "name": "liquidityMintDecimals",
            "type": "u8"
          },
          {
            "name": "liquiditySupplyPubkey",
            "type": "pubkey"
          },
          {
            "name": "liquidityPythOraclePubkey",
            "type": "pubkey"
          },
          {
            "name": "liquiditySwitchboardOraclePubkey",
            "type": "pubkey"
          },
          {
            "name": "liquidityAvailableAmount",
            "type": "u64"
          },
          {
            "name": "liquidityBorrowedAmountWads",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "liquidityCumulativeBorrowRateWads",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "liquidityMarketPrice",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "collateralMintPubkey",
            "type": "pubkey"
          },
          {
            "name": "collateralMintTotalSupply",
            "type": "u64"
          },
          {
            "name": "collateralSupplyPubkey",
            "type": "pubkey"
          },
          {
            "name": "configOptimalUtilizationRate",
            "type": "u8"
          },
          {
            "name": "configLoanToValueRatio",
            "type": "u8"
          },
          {
            "name": "configLiquidationBonus",
            "type": "u8"
          },
          {
            "name": "configLiquidationThreshold",
            "type": "u8"
          },
          {
            "name": "paddingToFees64",
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          },
          {
            "name": "paddingToFees6",
            "type": {
              "array": [
                "u8",
                6
              ]
            }
          },
          {
            "name": "liquidityAccumulatedProtocolFeesWads",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "paddingFinal128",
            "type": {
              "array": [
                "u8",
                128
              ]
            }
          },
          {
            "name": "paddingFinal64",
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          },
          {
            "name": "paddingFinal32",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "paddingFinal6",
            "type": {
              "array": [
                "u8",
                6
              ]
            }
          }
        ]
      }
    },
    {
      "name": "spotBalanceType",
      "repr": {
        "kind": "rust"
      },
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "deposit"
          },
          {
            "name": "borrow"
          }
        ]
      }
    },
    {
      "name": "spotPosition",
      "docs": [
        "Minimal representation of a spot position within a User account"
      ],
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "scaledBalance",
            "docs": [
              "The scaled balance of the position.",
              "* Precision: SPOT_BALANCE_PRECISION"
            ],
            "type": "u64"
          },
          {
            "name": "openBids",
            "docs": [
              "How many spot bids the user has open",
              "* Precision: token mint precision"
            ],
            "type": "i64"
          },
          {
            "name": "openAsks",
            "docs": [
              "How many spot asks the user has open",
              "* Precision: token mint precision"
            ],
            "type": "i64"
          },
          {
            "name": "cumulativeDeposits",
            "docs": [
              "The cumulative deposits/borrows a user has made",
              "* Precision: token mint precision"
            ],
            "type": "i64"
          },
          {
            "name": "marketIndex",
            "docs": [
              "The market index of the corresponding spot market"
            ],
            "type": "u16"
          },
          {
            "name": "balanceType",
            "docs": [
              "Whether the position is deposit or borrow"
            ],
            "type": {
              "defined": {
                "name": "spotBalanceType"
              }
            }
          },
          {
            "name": "openOrders",
            "docs": [
              "Number of open orders"
            ],
            "type": "u8"
          },
          {
            "name": "padding",
            "docs": [
              "Padding"
            ],
            "type": {
              "array": [
                "u8",
                4
              ]
            }
          }
        ]
      }
    },
    {
      "name": "stakedSettings",
      "docs": [
        "Unique per-group. Staked Collateral banks created under a group automatically use these",
        "settings. Groups that have not created this struct cannot create staked collateral banks. When",
        "this struct updates, changes must be permissionlessly propagated to staked collateral banks.",
        "Administrators can also edit the bank manually, i.e. with configure_bank, to temporarily make",
        "changes such as raising the deposit limit for a single bank."
      ],
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "key",
            "docs": [
              "This account's own key. A PDA derived from `marginfi_group` and `STAKED_SETTINGS_SEED`"
            ],
            "type": "pubkey"
          },
          {
            "name": "marginfiGroup",
            "docs": [
              "Group for which these settings apply"
            ],
            "type": "pubkey"
          },
          {
            "name": "oracle",
            "docs": [
              "Generally, the Pyth push oracle for SOL"
            ],
            "type": "pubkey"
          },
          {
            "name": "assetWeightInit",
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "assetWeightMaint",
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "depositLimit",
            "type": "u64"
          },
          {
            "name": "totalAssetValueInitLimit",
            "type": "u64"
          },
          {
            "name": "oracleMaxAge",
            "type": "u16"
          },
          {
            "name": "riskTier",
            "type": {
              "defined": {
                "name": "riskTier"
              }
            }
          },
          {
            "name": "pad0",
            "type": {
              "array": [
                "u8",
                5
              ]
            }
          },
          {
            "name": "flags",
            "docs": [
              "Desired bitmask for staked-bank transition flags. These bits are copied to `Bank.flags`",
              "when staked settings are propagated or when a new staked bank is created.",
              "* Bit 9 (512): `STAKED_ORACLE_DISABLED` — staked oracle pricing is temporarily disabled.",
              "* Bit 10 (1024): `STAKED_ORACLE_PRICE_USES_ONRAMP` — staked oracle pricing includes the SPL",
              "single-pool on-ramp account in NAV."
            ],
            "type": "u64"
          },
          {
            "name": "reserved1",
            "docs": [
              "The following values are irrelevant because staked collateral positions do not support",
              "borrowing."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "reserved2",
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          }
        ]
      }
    },
    {
      "name": "stakedSettingsConfig",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "oracle",
            "type": "pubkey"
          },
          {
            "name": "assetWeightInit",
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "assetWeightMaint",
            "type": {
              "defined": {
                "name": "wrappedI80f48"
              }
            }
          },
          {
            "name": "depositLimit",
            "type": "u64"
          },
          {
            "name": "totalAssetValueInitLimit",
            "type": "u64"
          },
          {
            "name": "oracleMaxAge",
            "type": "u16"
          },
          {
            "name": "riskTier",
            "docs": [
              "WARN: You almost certainly want \"Collateral\", using Isolated risk tier makes the asset",
              "worthless as collateral, and is generally useful only when creating a staked collateral pool",
              "for rewards purposes only."
            ],
            "type": {
              "defined": {
                "name": "riskTier"
              }
            }
          }
        ]
      }
    },
    {
      "name": "stakedSettingsEditConfig",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "oracle",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "assetWeightInit",
            "type": {
              "option": {
                "defined": {
                  "name": "wrappedI80f48"
                }
              }
            }
          },
          {
            "name": "assetWeightMaint",
            "type": {
              "option": {
                "defined": {
                  "name": "wrappedI80f48"
                }
              }
            }
          },
          {
            "name": "depositLimit",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "totalAssetValueInitLimit",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "oracleMaxAge",
            "type": {
              "option": "u16"
            }
          },
          {
            "name": "riskTier",
            "docs": [
              "WARN: You almost certainly want \"Collateral\", using Isolated risk tier makes the asset",
              "worthless as collateral, making all outstanding accounts eligible to be liquidated, and is",
              "generally useful only when creating a staked collateral pool for rewards purposes only."
            ],
            "type": {
              "option": {
                "defined": {
                  "name": "riskTier"
                }
              }
            }
          }
        ]
      }
    },
    {
      "name": "userStatus",
      "repr": {
        "kind": "rust"
      },
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "active"
          },
          {
            "name": "beingLiquidated"
          },
          {
            "name": "bankrupt"
          },
          {
            "name": "reduceOnly"
          },
          {
            "name": "advancedLp"
          },
          {
            "name": "protectedMakerOrders"
          }
        ]
      }
    },
    {
      "name": "withdrawWindowCache",
      "docs": [
        "Tracks deleverage withdrawal limits to protect against compromised risk admin"
      ],
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "dailyLimit",
            "docs": [
              "Maximum USD value that can be withdrawn per day via deleverage (0 = no limit)"
            ],
            "type": "u32"
          },
          {
            "name": "withdrawnToday",
            "docs": [
              "USD value withdrawn today via deleverage (approximate, rounded)"
            ],
            "type": "u32"
          },
          {
            "name": "lastDailyResetTimestamp",
            "docs": [
              "Unix timestamp of the last daily counter reset"
            ],
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "wrappedI80f48",
      "serialization": "bytemuck",
      "repr": {
        "kind": "c",
        "align": 8
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "value",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          }
        ]
      }
    }
  ]
};
