/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/gamma_vault.json`.
 */
export type GammaVault = {
  "address": "GaMmanX9i4jGmqDZZD2tbD6B2v9p21btenPneMXnTczV",
  "metadata": {
    "name": "gammaVault",
    "version": "2.2.0",
    "spec": "0.1.0",
    "description": "Gamma Protocol vault program — LP vaults with instant deposits, escrow withdrawals, and performance fees"
  },
  "instructions": [
    {
      "name": "assessFees",
      "docs": [
        "Assess scheduled performance fees (keeper)."
      ],
      "discriminator": [
        224,
        15,
        195,
        19,
        125,
        145,
        2,
        100
      ],
      "accounts": [
        {
          "name": "fundAuthority",
          "signer": true,
          "relations": [
            "lpVault"
          ]
        },
        {
          "name": "lpVault",
          "writable": true
        },
        {
          "name": "sharesMint",
          "writable": true,
          "relations": [
            "lpVault"
          ]
        },
        {
          "name": "feeRecipientAccount",
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "closeDepositReceipt",
      "docs": [
        "Close a deposit receipt and reclaim rent."
      ],
      "discriminator": [
        216,
        104,
        127,
        60,
        88,
        217,
        184,
        15
      ],
      "accounts": [
        {
          "name": "user",
          "docs": [
            "User who owns the deposit receipt."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "lpVault",
          "docs": [
            "The vault this receipt is associated with."
          ]
        },
        {
          "name": "depositReceipt",
          "docs": [
            "Deposit receipt to close. Rent is returned to user."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  112,
                  111,
                  115,
                  105,
                  116,
                  95,
                  114,
                  101,
                  99,
                  101,
                  105,
                  112,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "user"
              },
              {
                "kind": "account",
                "path": "lpVault"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "completeWithdrawal",
      "docs": [
        "User claims their withdrawal from escrow.",
        "Burns shares and transfers assets to user's wallet."
      ],
      "discriminator": [
        107,
        98,
        134,
        131,
        74,
        120,
        174,
        121
      ],
      "accounts": [
        {
          "name": "user",
          "docs": [
            "User claiming the withdrawal."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "lpVault",
          "docs": [
            "LpVault (needed for shares_mint validation)."
          ]
        },
        {
          "name": "assetsMint",
          "docs": [
            "Mint of the vault assets."
          ],
          "relations": [
            "lpVault"
          ]
        },
        {
          "name": "sharesMint",
          "docs": [
            "Mint for vault shares."
          ],
          "writable": true,
          "relations": [
            "lpVault"
          ]
        },
        {
          "name": "userAssetAta",
          "docs": [
            "User's asset token account (destination for claimed assets)."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "user"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "assetsMint"
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
          "name": "withdrawEscrow",
          "docs": [
            "User's withdraw escrow."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  119,
                  105,
                  116,
                  104,
                  100,
                  114,
                  97,
                  119,
                  95,
                  101,
                  115,
                  99,
                  114,
                  111,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "user"
              },
              {
                "kind": "account",
                "path": "lpVault"
              }
            ]
          }
        },
        {
          "name": "escrowAssetsAccount",
          "docs": [
            "Escrow's asset token account (source of assets)."
          ],
          "writable": true,
          "relations": [
            "withdrawEscrow"
          ]
        },
        {
          "name": "escrowSharesAccount",
          "docs": [
            "Escrow's share token account (shares to burn)."
          ],
          "writable": true,
          "relations": [
            "withdrawEscrow"
          ]
        },
        {
          "name": "withdrawReceipt",
          "docs": [
            "User's withdraw receipt."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  119,
                  105,
                  116,
                  104,
                  100,
                  114,
                  97,
                  119,
                  95,
                  114,
                  101,
                  99,
                  101,
                  105,
                  112,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "user"
              },
              {
                "kind": "account",
                "path": "lpVault"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "docs": [
            "System program."
          ],
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "tokenProgram",
          "docs": [
            "Token program."
          ]
        },
        {
          "name": "associatedTokenProgram",
          "docs": [
            "Associated token program."
          ],
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        }
      ],
      "args": []
    },
    {
      "name": "crossChainDepositAndBridge",
      "docs": [
        "Authenticated BNB/DLN ingress, native Gamma deposit accounting, and",
        "dePort share send in one atomic Gamma instruction. The bridging logic and",
        "the deBridge SDK are compiled only under the non-default `cross-chain`",
        "feature; the default (production) build keeps this entrypoint present but",
        "hard-disabled (it rejects before any state transition)."
      ],
      "discriminator": [
        191,
        64,
        193,
        191,
        223,
        242,
        234,
        122
      ],
      "accounts": [
        {
          "name": "crossChainConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  114,
                  111,
                  115,
                  115,
                  95,
                  99,
                  104,
                  97,
                  105,
                  110,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "crossChainVaultRoute",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  114,
                  111,
                  115,
                  115,
                  95,
                  99,
                  104,
                  97,
                  105,
                  110,
                  95,
                  114,
                  111,
                  117,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "lpVault"
              }
            ]
          }
        },
        {
          "name": "crossChainIntent",
          "docs": [
            "Heap-boxed to keep Anchor's generated account parser below the SBF",
            "4 KiB stack-frame limit without changing the ordered account ABI."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  114,
                  111,
                  115,
                  115,
                  95,
                  99,
                  104,
                  97,
                  105,
                  110,
                  95,
                  105,
                  110,
                  116,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  112,
                  111,
                  115,
                  105,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "extcallMeta"
              }
            ]
          }
        },
        {
          "name": "extcallMeta"
        },
        {
          "name": "extcallAuthority",
          "docs": [
            "DLN's externally supplied CPI signer. Hook expense/reward funds",
            "first-use rent and the exact native fee transferred to Gamma's sender."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "extcallWallet",
          "writable": true
        },
        {
          "name": "crossChainSender",
          "docs": [
            "only when calling deBridge. The handler verifies owner and data before",
            "funding it with the live native fixed fee."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  114,
                  111,
                  115,
                  115,
                  95,
                  99,
                  104,
                  97,
                  105,
                  110,
                  95,
                  115,
                  101,
                  110,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "lpVault"
              }
            ]
          }
        },
        {
          "name": "crossChainSenderShareWallet",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "crossChainSender"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "sharesMint"
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
          "name": "depositReceipt",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  112,
                  111,
                  115,
                  105,
                  116,
                  95,
                  114,
                  101,
                  99,
                  101,
                  105,
                  112,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "extcallAuthority"
              },
              {
                "kind": "account",
                "path": "lpVault"
              }
            ]
          }
        },
        {
          "name": "instructions",
          "address": "Sysvar1nstructions1111111111111111111111111"
        },
        {
          "name": "lpVault",
          "writable": true,
          "relations": [
            "withdrawalPolicy",
            "depositPolicy"
          ]
        },
        {
          "name": "withdrawalPolicy",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  119,
                  105,
                  116,
                  104,
                  100,
                  114,
                  97,
                  119,
                  97,
                  108,
                  95,
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "lpVault"
              }
            ]
          }
        },
        {
          "name": "depositPolicy",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  112,
                  111,
                  115,
                  105,
                  116,
                  95,
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "lpVault"
              }
            ]
          }
        },
        {
          "name": "assetsAccount",
          "writable": true,
          "relations": [
            "lpVault"
          ]
        },
        {
          "name": "assetsMint",
          "relations": [
            "lpVault"
          ]
        },
        {
          "name": "sharesMint",
          "writable": true,
          "relations": [
            "lpVault"
          ]
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "crossChainDepositArgs"
            }
          }
        }
      ]
    },
    {
      "name": "deposit",
      "docs": [
        "Deposit assets and receive shares instantly.",
        "Requires NAV to be fresh (within nav_max_staleness)."
      ],
      "discriminator": [
        242,
        35,
        198,
        137,
        82,
        225,
        242,
        182
      ],
      "accounts": [
        {
          "name": "user",
          "docs": [
            "User depositing into the vault."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "lpVault",
          "docs": [
            "LpVault to deposit into."
          ],
          "writable": true,
          "relations": [
            "withdrawalPolicy",
            "depositPolicy"
          ]
        },
        {
          "name": "withdrawalPolicy",
          "docs": [
            "Withdrawal policy for net capacity accounting. Deposits offset usage."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  119,
                  105,
                  116,
                  104,
                  100,
                  114,
                  97,
                  119,
                  97,
                  108,
                  95,
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "lpVault"
              }
            ]
          }
        },
        {
          "name": "depositPolicy",
          "docs": [
            "Hard capacity shared by all deposit sources."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  112,
                  111,
                  115,
                  105,
                  116,
                  95,
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "lpVault"
              }
            ]
          }
        },
        {
          "name": "assetsAccount",
          "docs": [
            "Token account for vault assets."
          ],
          "writable": true,
          "relations": [
            "lpVault"
          ]
        },
        {
          "name": "userAssetAta",
          "docs": [
            "User's asset token account (source of deposit)."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "user"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "assetsMint"
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
          "name": "userShareAta",
          "docs": [
            "User's share token account (destination for minted shares)."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "user"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "sharesMint"
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
          "name": "depositReceipt",
          "docs": [
            "Deposit receipt account",
            "Derived from user pubkey and lp_vault pubkey."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  112,
                  111,
                  115,
                  105,
                  116,
                  95,
                  114,
                  101,
                  99,
                  101,
                  105,
                  112,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "user"
              },
              {
                "kind": "account",
                "path": "lpVault"
              }
            ]
          }
        },
        {
          "name": "assetsMint",
          "docs": [
            "Mint of the vault assets."
          ],
          "relations": [
            "lpVault"
          ]
        },
        {
          "name": "sharesMint",
          "docs": [
            "Mint for vault shares."
          ],
          "writable": true,
          "relations": [
            "lpVault"
          ]
        },
        {
          "name": "systemProgram",
          "docs": [
            "System program."
          ],
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "tokenProgram",
          "docs": [
            "Token program."
          ]
        },
        {
          "name": "associatedTokenProgram",
          "docs": [
            "Associated token program."
          ],
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
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
      "name": "fulfillWithdrawal",
      "docs": [
        "Fulfill pending withdrawals by transferring assets to user's escrow.",
        "Called by keeper when liquidity is available."
      ],
      "discriminator": [
        57,
        37,
        123,
        221,
        103,
        93,
        162,
        176
      ],
      "accounts": [
        {
          "name": "signer",
          "docs": [
            "Keeper signer. Must be the vault's fund_authority or keeper_authority."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "user"
        },
        {
          "name": "lpVault",
          "docs": [
            "LpVault."
          ],
          "writable": true,
          "relations": [
            "withdrawalPolicy"
          ]
        },
        {
          "name": "withdrawalPolicy",
          "docs": [
            "Withdrawal policy used to retain the configured base-asset fee."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  119,
                  105,
                  116,
                  104,
                  100,
                  114,
                  97,
                  119,
                  97,
                  108,
                  95,
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "lpVault"
              }
            ]
          }
        },
        {
          "name": "assetsAccount",
          "docs": [
            "Vault's asset token account."
          ],
          "writable": true,
          "relations": [
            "lpVault"
          ]
        },
        {
          "name": "assetsMint",
          "docs": [
            "Mint of the vault assets."
          ],
          "relations": [
            "lpVault"
          ]
        },
        {
          "name": "sharesMint",
          "docs": [
            "Mint for vault shares."
          ],
          "relations": [
            "lpVault"
          ]
        },
        {
          "name": "withdrawEscrow",
          "docs": [
            "User's withdraw escrow."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  119,
                  105,
                  116,
                  104,
                  100,
                  114,
                  97,
                  119,
                  95,
                  101,
                  115,
                  99,
                  114,
                  111,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "user"
              },
              {
                "kind": "account",
                "path": "lpVault"
              }
            ]
          }
        },
        {
          "name": "escrowAssetsAccount",
          "docs": [
            "Escrow's asset token account (destination for assets)."
          ],
          "writable": true,
          "relations": [
            "withdrawEscrow"
          ]
        },
        {
          "name": "withdrawReceipt",
          "docs": [
            "User's withdraw receipt."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  119,
                  105,
                  116,
                  104,
                  100,
                  114,
                  97,
                  119,
                  95,
                  114,
                  101,
                  99,
                  101,
                  105,
                  112,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "user"
              },
              {
                "kind": "account",
                "path": "lpVault"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "docs": [
            "Token program."
          ]
        }
      ],
      "args": []
    },
    {
      "name": "initGlobalConfig",
      "discriminator": [
        140,
        136,
        214,
        48,
        87,
        0,
        120,
        255
      ],
      "accounts": [
        {
          "name": "signer",
          "docs": [
            "Signer initializing the GlobalConfig. MUST be the program's",
            "BPFLoaderUpgradeable upgrade authority (proven by the constraints on",
            "`program` + `program_data` below). Becomes the super_admin; the only",
            "later rotation path is `update_admin_authorities`, which is likewise",
            "gated on the upgrade authority. On a fresh deploy, call init BEFORE",
            "finalizing the program (a finalized/`--final` program has no upgrade",
            "authority → init AND rotation impossible) and while a plain deployer",
            "keypair (not a multisig PDA) still holds it."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "globalConfig",
          "docs": [
            "Global config account. Derived with a single str."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "program",
          "docs": [
            "This program's own account; ties `program_data` to this program so the",
            "upgrade-authority check below cannot be satisfied with an unrelated",
            "program's ProgramData."
          ],
          "address": "GaMmanX9i4jGmqDZZD2tbD6B2v9p21btenPneMXnTczV"
        },
        {
          "name": "programData",
          "docs": [
            "ProgramData account holding the program's upgrade authority. Gate: the",
            "signer must equal the upgrade authority. `programdata_address()` returns",
            "`Ok(None)` for a non-upgradeable load and a revoked authority is `None`,",
            "so a `None` on either side fails closed."
          ]
        },
        {
          "name": "systemProgram",
          "docs": [
            "System program."
          ],
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "createAuthority",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "initLpVault",
      "discriminator": [
        40,
        247,
        24,
        8,
        152,
        98,
        18,
        220
      ],
      "accounts": [
        {
          "name": "signer",
          "docs": [
            "User creating the vault."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "lpVault",
          "docs": [
            "Lp vault being created."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "arg",
                "path": "vaultName"
              },
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "assetsMint"
              }
            ]
          }
        },
        {
          "name": "globalConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "sharesMint",
          "docs": [
            "Mint for shares, minted on deposit."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  104,
                  97,
                  114,
                  101,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "lpVault"
              }
            ]
          }
        },
        {
          "name": "assetsMint",
          "docs": [
            "Mint of the assets, USDC, maybe configurable."
          ]
        },
        {
          "name": "assetsAccount",
          "docs": [
            "Token account for main asset."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  105,
                  110,
                  95,
                  97,
                  115,
                  115,
                  101,
                  116,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "lpVault"
              }
            ]
          }
        },
        {
          "name": "pendingSharesAccount",
          "docs": [
            "Token account where shares are held during queued (illiquid) withdrawals."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  101,
                  110,
                  100,
                  105,
                  110,
                  103,
                  95,
                  115,
                  104,
                  97,
                  114,
                  101,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "lpVault"
              }
            ]
          }
        },
        {
          "name": "withdrawalPolicy",
          "docs": [
            "Withdrawal policy PDA for retained fees and net outflow caps."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  119,
                  105,
                  116,
                  104,
                  100,
                  114,
                  97,
                  119,
                  97,
                  108,
                  95,
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "lpVault"
              }
            ]
          }
        },
        {
          "name": "depositPolicy",
          "docs": [
            "Shared hard deposit capacity. New vaults start fail-closed until their",
            "fund authority explicitly configures this policy."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  112,
                  111,
                  115,
                  105,
                  116,
                  95,
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "lpVault"
              }
            ]
          }
        },
        {
          "name": "feeRecipientAccount",
          "docs": [
            "Optional fee recipient token account (shares mint).",
            "Required when initializing with performance_fee_bps > 0."
          ],
          "optional": true
        },
        {
          "name": "systemProgram",
          "docs": [
            "System program."
          ],
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "tokenProgram",
          "docs": [
            "Can either be spl-token or token-2022."
          ]
        }
      ],
      "args": [
        {
          "name": "fundAuthority",
          "type": "pubkey"
        },
        {
          "name": "navMaxStaleness",
          "type": "u64"
        },
        {
          "name": "vaultName",
          "type": "string"
        },
        {
          "name": "decimals",
          "type": "u8"
        },
        {
          "name": "performanceFeeBps",
          "type": "u16"
        },
        {
          "name": "assessmentIntervalSecs",
          "type": "i64"
        },
        {
          "name": "keeperAuthority",
          "type": {
            "option": "pubkey"
          }
        }
      ]
    },
    {
      "name": "initializeCrossChainConfig",
      "docs": [
        "Initialize Gamma's program-owned cross-chain control plane. The",
        "existing Gamma upgrade authority is the only initializer and the",
        "circuit breaker always starts paused."
      ],
      "discriminator": [
        162,
        136,
        180,
        13,
        95,
        156,
        67,
        223
      ],
      "accounts": [
        {
          "name": "signer",
          "writable": true,
          "signer": true
        },
        {
          "name": "crossChainConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  114,
                  111,
                  115,
                  115,
                  95,
                  99,
                  104,
                  97,
                  105,
                  110,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "program",
          "address": "GaMmanX9i4jGmqDZZD2tbD6B2v9p21btenPneMXnTczV"
        },
        {
          "name": "programData"
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
        }
      ]
    },
    {
      "name": "receiveCrossChainWithdrawal",
      "docs": [
        "Future withdrawal intake shape. The handler and route configuration",
        "remain independently hard-disabled until the continuation is complete."
      ],
      "discriminator": [
        17,
        163,
        45,
        124,
        66,
        193,
        202,
        124
      ],
      "accounts": [
        {
          "name": "crossChainConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  114,
                  111,
                  115,
                  115,
                  95,
                  99,
                  104,
                  97,
                  105,
                  110,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "crossChainVaultRoute",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  114,
                  111,
                  115,
                  115,
                  95,
                  99,
                  104,
                  97,
                  105,
                  110,
                  95,
                  114,
                  111,
                  117,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "lpVault"
              }
            ]
          }
        },
        {
          "name": "crossChainIntent",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  114,
                  111,
                  115,
                  115,
                  95,
                  99,
                  104,
                  97,
                  105,
                  110,
                  95,
                  105,
                  110,
                  116,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "const",
                "value": [
                  119,
                  105,
                  116,
                  104,
                  100,
                  114,
                  97,
                  119,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "submission"
              }
            ]
          }
        },
        {
          "name": "submission"
        },
        {
          "name": "submissionAuthority",
          "writable": true,
          "signer": true
        },
        {
          "name": "inboundShareWallet",
          "writable": true
        },
        {
          "name": "shareEscrow",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "crossChainVaultRoute"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "sharesMint"
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
          "name": "instructions",
          "address": "Sysvar1nstructions1111111111111111111111111"
        },
        {
          "name": "lpVault",
          "relations": [
            "withdrawalPolicy"
          ]
        },
        {
          "name": "withdrawalPolicy",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  119,
                  105,
                  116,
                  104,
                  100,
                  114,
                  97,
                  119,
                  97,
                  108,
                  95,
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "lpVault"
              }
            ]
          }
        },
        {
          "name": "sharesMint"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "crossChainWithdrawalArgs"
            }
          }
        }
      ]
    },
    {
      "name": "setDepositPolicy",
      "docs": [
        "Configure the hard shared deposit capacity or pause deposits. The",
        "policy applies equally to native and cross-chain deposit callers."
      ],
      "discriminator": [
        56,
        138,
        17,
        74,
        222,
        84,
        14,
        210
      ],
      "accounts": [
        {
          "name": "fundAuthority",
          "signer": true,
          "relations": [
            "lpVault"
          ]
        },
        {
          "name": "payer",
          "docs": [
            "Payer for initializing the policy on pre-upgrade vaults."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "lpVault"
        },
        {
          "name": "depositPolicy",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  112,
                  111,
                  115,
                  105,
                  116,
                  95,
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "lpVault"
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
          "name": "capacityAssets",
          "type": "u64"
        },
        {
          "name": "depositsPaused",
          "type": "bool"
        }
      ]
    },
    {
      "name": "setFeeConfig",
      "docs": [
        "Configure or disable performance fee settings."
      ],
      "discriminator": [
        221,
        222,
        52,
        206,
        114,
        198,
        64,
        91
      ],
      "accounts": [
        {
          "name": "fundAuthority",
          "docs": [
            "Operator / fund authority."
          ],
          "signer": true,
          "relations": [
            "lpVault"
          ]
        },
        {
          "name": "lpVault",
          "writable": true
        },
        {
          "name": "sharesMint",
          "writable": true,
          "relations": [
            "lpVault"
          ]
        },
        {
          "name": "feeRecipientAccount",
          "docs": [
            "Token account that will receive fee shares.",
            "Required when enabling fees (performance_fee_bps > 0) or when",
            "mid-window settlement is needed (accrued fees must be settled",
            "to the old recipient before changing config).",
            "Omit when disabling with no accrued fees.",
            "Mutable because it may be the destination of a MintTo CPI during mid-window settlement."
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "performanceFeeBps",
          "type": "u16"
        },
        {
          "name": "assessmentIntervalSecs",
          "type": "i64"
        }
      ]
    },
    {
      "name": "setKeeperAuthority",
      "docs": [
        "Set or remove the keeper authority on a vault.",
        "When set, this key can call fulfill_withdrawal in addition to fund_authority."
      ],
      "discriminator": [
        29,
        124,
        191,
        114,
        184,
        243,
        33,
        155
      ],
      "accounts": [
        {
          "name": "fundAuthority",
          "docs": [
            "Fund authority — only they can change keeper authority."
          ],
          "signer": true,
          "relations": [
            "lpVault"
          ]
        },
        {
          "name": "payer",
          "docs": [
            "Payer for any reallocation rent."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "lpVault",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "keeperAuthority",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "setMetadata",
      "discriminator": [
        78,
        157,
        75,
        242,
        151,
        20,
        121,
        144
      ],
      "accounts": [
        {
          "name": "fundAuthority",
          "docs": [
            "Fund authority - only they can set metadata."
          ],
          "writable": true,
          "signer": true,
          "relations": [
            "lpVault"
          ]
        },
        {
          "name": "lpVault",
          "docs": [
            "LpVault that owns the shares_mint."
          ]
        },
        {
          "name": "sharesMint",
          "docs": [
            "Shares mint for which we're setting metadata."
          ],
          "writable": true,
          "relations": [
            "lpVault"
          ]
        },
        {
          "name": "metadataAccount",
          "docs": [
            "Seeds: [\"metadata\", token_metadata_program_id, mint]"
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
                "kind": "const",
                "value": [
                  11,
                  112,
                  101,
                  177,
                  227,
                  209,
                  124,
                  69,
                  56,
                  157,
                  82,
                  127,
                  107,
                  4,
                  195,
                  205,
                  88,
                  184,
                  108,
                  115,
                  26,
                  160,
                  253,
                  181,
                  73,
                  182,
                  209,
                  188,
                  3,
                  248,
                  41,
                  70
                ]
              },
              {
                "kind": "account",
                "path": "sharesMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                11,
                112,
                101,
                177,
                227,
                209,
                124,
                69,
                56,
                157,
                82,
                127,
                107,
                4,
                195,
                205,
                88,
                184,
                108,
                115,
                26,
                160,
                253,
                181,
                73,
                182,
                209,
                188,
                3,
                248,
                41,
                70
              ]
            }
          }
        },
        {
          "name": "tokenMetadataProgram",
          "address": "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
        },
        {
          "name": "systemProgram",
          "docs": [
            "System program."
          ],
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "rent",
          "docs": [
            "Rent sysvar."
          ],
          "address": "SysvarRent111111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "name",
          "type": "string"
        },
        {
          "name": "symbol",
          "type": "string"
        },
        {
          "name": "uri",
          "type": "string"
        }
      ]
    },
    {
      "name": "setWithdrawalPolicy",
      "docs": [
        "Configure retained withdrawal fees and net withdrawal caps."
      ],
      "discriminator": [
        3,
        223,
        67,
        81,
        69,
        30,
        203,
        150
      ],
      "accounts": [
        {
          "name": "fundAuthority",
          "docs": [
            "Fund authority for the vault."
          ],
          "signer": true,
          "relations": [
            "lpVault"
          ]
        },
        {
          "name": "payer",
          "docs": [
            "Payer for creating the policy account on existing vaults."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "lpVault"
        },
        {
          "name": "withdrawalPolicy",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  119,
                  105,
                  116,
                  104,
                  100,
                  114,
                  97,
                  119,
                  97,
                  108,
                  95,
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "lpVault"
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
          "name": "withdrawalFeeBps",
          "type": "u16"
        },
        {
          "name": "hourlyWithdrawalCapBps",
          "type": "u16"
        },
        {
          "name": "dailyWithdrawalCapBps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "updateAdminAuthorities",
      "docs": [
        "Rotate super_admin, create_authority, and permissioned_creation",
        "atomically. Recovery instruction gated on the program's",
        "BPFLoaderUpgradeable upgrade authority (NOT the current super_admin),",
        "so a compromised or lost super_admin can be replaced."
      ],
      "discriminator": [
        41,
        241,
        142,
        184,
        75,
        212,
        72,
        171
      ],
      "accounts": [
        {
          "name": "signer",
          "docs": [
            "Signer rotating the authorities. MUST be the program's",
            "BPFLoaderUpgradeable upgrade authority (proven by the constraints on",
            "`program` + `program_data` below)."
          ],
          "signer": true
        },
        {
          "name": "globalConfig",
          "docs": [
            "The global config account being rotated. Unique in the program.",
            "Deliberately no `has_one = super_admin`: see the struct docs."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "program",
          "docs": [
            "This program's own account; ties `program_data` to this program so the",
            "upgrade-authority check below cannot be satisfied with an unrelated",
            "program's ProgramData."
          ],
          "address": "GaMmanX9i4jGmqDZZD2tbD6B2v9p21btenPneMXnTczV"
        },
        {
          "name": "programData",
          "docs": [
            "ProgramData account holding the program's upgrade authority. Gate: the",
            "signer must equal the upgrade authority. `programdata_address()` returns",
            "`Ok(None)` for a non-upgradeable load and a revoked authority is `None`,",
            "so a `None` on either side fails closed."
          ]
        }
      ],
      "args": [
        {
          "name": "newSuperAdmin",
          "type": "pubkey"
        },
        {
          "name": "newCreateAuthority",
          "type": "pubkey"
        },
        {
          "name": "newPermissionedCreation",
          "type": "bool"
        }
      ]
    },
    {
      "name": "updateCrossChainConfig",
      "discriminator": [
        79,
        141,
        137,
        119,
        118,
        242,
        249,
        118
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "crossChainConfig"
          ]
        },
        {
          "name": "crossChainConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  114,
                  111,
                  115,
                  115,
                  95,
                  99,
                  104,
                  97,
                  105,
                  110,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "newAdmin",
          "type": "pubkey"
        },
        {
          "name": "depositsPaused",
          "type": "bool"
        }
      ]
    },
    {
      "name": "updateGlobalConfig",
      "discriminator": [
        164,
        84,
        130,
        189,
        111,
        58,
        250,
        200
      ],
      "accounts": [
        {
          "name": "superAdmin",
          "docs": [
            "The signer must be the global_config super_admin."
          ],
          "writable": true,
          "signer": true,
          "relations": [
            "globalConfig"
          ]
        },
        {
          "name": "globalConfig",
          "docs": [
            "The global config account. Unique in the program."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "newCreateAuthority",
          "type": "pubkey"
        },
        {
          "name": "isCreationPermissioned",
          "type": "bool"
        }
      ]
    },
    {
      "name": "updateNav",
      "docs": [
        "Update the vault's NAV. Called by fund_authority (operator)."
      ],
      "discriminator": [
        56,
        16,
        234,
        109,
        155,
        165,
        5,
        0
      ],
      "accounts": [
        {
          "name": "fundAuthority",
          "docs": [
            "Fund authority - only they can update NAV."
          ],
          "signer": true,
          "relations": [
            "lpVault"
          ]
        },
        {
          "name": "lpVault",
          "writable": true
        },
        {
          "name": "sharesMint",
          "relations": [
            "lpVault"
          ]
        }
      ],
      "args": [
        {
          "name": "newNav",
          "type": "u64"
        }
      ]
    },
    {
      "name": "updateNavChecked",
      "docs": [
        "Atomically update NAV only when the vault still matches the state read",
        "by the caller. This prevents deposits, withdrawals, fee assessments, or",
        "another NAV publish from invalidating an off-chain NAV calculation",
        "between preflight and transaction execution."
      ],
      "discriminator": [
        2,
        235,
        178,
        75,
        223,
        26,
        72,
        144
      ],
      "accounts": [
        {
          "name": "fundAuthority",
          "docs": [
            "Fund authority - only they can update NAV."
          ],
          "signer": true,
          "relations": [
            "lpVault"
          ]
        },
        {
          "name": "lpVault",
          "writable": true
        },
        {
          "name": "sharesMint",
          "relations": [
            "lpVault"
          ]
        }
      ],
      "args": [
        {
          "name": "newNav",
          "type": "u64"
        },
        {
          "name": "expectedNav",
          "type": "u64"
        },
        {
          "name": "expectedTotalShares",
          "type": "u64"
        },
        {
          "name": "expectedNavUpdatedAt",
          "type": "i64"
        }
      ]
    },
    {
      "name": "updateNavMaxStaleness",
      "docs": [
        "Update the NAV max staleness window on a vault."
      ],
      "discriminator": [
        212,
        225,
        120,
        109,
        83,
        96,
        40,
        17
      ],
      "accounts": [
        {
          "name": "fundAuthority",
          "docs": [
            "Fund authority — only they can change vault config."
          ],
          "signer": true,
          "relations": [
            "lpVault"
          ]
        },
        {
          "name": "lpVault",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "navMaxStaleness",
          "type": "u64"
        }
      ]
    },
    {
      "name": "upsertCrossChainVaultRoute",
      "discriminator": [
        10,
        80,
        62,
        8,
        145,
        215,
        7,
        31
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true,
          "relations": [
            "crossChainConfig"
          ]
        },
        {
          "name": "crossChainConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  114,
                  111,
                  115,
                  115,
                  95,
                  99,
                  104,
                  97,
                  105,
                  110,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "crossChainVaultRoute",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  114,
                  111,
                  115,
                  115,
                  95,
                  99,
                  104,
                  97,
                  105,
                  110,
                  95,
                  114,
                  111,
                  117,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "lpVault"
              }
            ]
          }
        },
        {
          "name": "lpVault"
        },
        {
          "name": "assetsMint"
        },
        {
          "name": "sharesMint"
        },
        {
          "name": "shareEscrow",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "crossChainVaultRoute"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "sharesMint"
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
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        }
      ],
      "args": [
        {
          "name": "bnbUsdc",
          "type": {
            "array": [
              "u8",
              20
            ]
          }
        },
        {
          "name": "bnbUsdt",
          "type": {
            "array": [
              "u8",
              20
            ]
          }
        },
        {
          "name": "depositsEnabled",
          "type": "bool"
        },
        {
          "name": "withdrawalsEnabled",
          "type": "bool"
        }
      ]
    },
    {
      "name": "withdraw",
      "docs": [
        "Withdraw shares for assets.",
        "If vault has sufficient liquidity: instant withdrawal.",
        "If illiquid: creates WithdrawReceipt, shares go to pending account."
      ],
      "discriminator": [
        183,
        18,
        70,
        156,
        148,
        109,
        161,
        34
      ],
      "accounts": [
        {
          "name": "user",
          "docs": [
            "User withdrawing from the vault."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "lpVault",
          "docs": [
            "LpVault to withdraw from."
          ],
          "writable": true,
          "relations": [
            "withdrawalPolicy"
          ]
        },
        {
          "name": "withdrawalPolicy",
          "docs": [
            "Withdrawal policy for retained asset fees and net withdrawal caps."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  119,
                  105,
                  116,
                  104,
                  100,
                  114,
                  97,
                  119,
                  97,
                  108,
                  95,
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "lpVault"
              }
            ]
          }
        },
        {
          "name": "assetsAccount",
          "docs": [
            "Token account for vault assets."
          ],
          "writable": true,
          "relations": [
            "lpVault"
          ]
        },
        {
          "name": "userShareAta",
          "docs": [
            "User's share token account (source of shares)."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "user"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "sharesMint"
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
          "name": "assetsMint",
          "docs": [
            "Mint of the vault assets."
          ],
          "relations": [
            "lpVault"
          ]
        },
        {
          "name": "sharesMint",
          "docs": [
            "Mint for vault shares (mutable for fee mint CPI)."
          ],
          "writable": true,
          "relations": [
            "lpVault"
          ]
        },
        {
          "name": "feeRecipientAccount",
          "docs": [
            "Token account that receives fee shares on withdrawal.",
            "Required when `has_fee_config()` is true; omit otherwise.",
            "Mutable because it is the destination of a MintTo CPI."
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "withdrawEscrow",
          "docs": [
            "Withdraw escrow - holds assets and shares until user claims."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  119,
                  105,
                  116,
                  104,
                  100,
                  114,
                  97,
                  119,
                  95,
                  101,
                  115,
                  99,
                  114,
                  111,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "user"
              },
              {
                "kind": "account",
                "path": "lpVault"
              }
            ]
          }
        },
        {
          "name": "escrowAssetsAccount",
          "docs": [
            "Escrow's asset token account (holds USDC for user to claim)."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "withdrawEscrow"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "assetsMint"
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
          "name": "escrowSharesAccount",
          "docs": [
            "Escrow's share token account (holds shares until burned on claim)."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "withdrawEscrow"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "sharesMint"
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
          "name": "withdrawReceipt",
          "docs": [
            "Withdraw receipt - tracks pending and claimable amounts (accumulates)."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  119,
                  105,
                  116,
                  104,
                  100,
                  114,
                  97,
                  119,
                  95,
                  114,
                  101,
                  99,
                  101,
                  105,
                  112,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "user"
              },
              {
                "kind": "account",
                "path": "lpVault"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "docs": [
            "System program."
          ],
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "tokenProgram",
          "docs": [
            "Token program."
          ]
        },
        {
          "name": "associatedTokenProgram",
          "docs": [
            "Associated token program."
          ],
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        }
      ],
      "args": [
        {
          "name": "sharesAmount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "withdrawAssets",
      "docs": [
        "Withdraw assets from vault to operator wallet for investment."
      ],
      "discriminator": [
        202,
        105,
        54,
        155,
        56,
        33,
        207,
        254
      ],
      "accounts": [
        {
          "name": "fundAuthority",
          "writable": true,
          "signer": true,
          "relations": [
            "lpVault"
          ]
        },
        {
          "name": "lpVault"
        },
        {
          "name": "assetsAccount",
          "writable": true,
          "relations": [
            "lpVault"
          ]
        },
        {
          "name": "authorityAssetAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "fundAuthority"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "assetsMint"
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
          "name": "assetsMint",
          "relations": [
            "lpVault"
          ]
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "crossChainConfig",
      "discriminator": [
        74,
        146,
        238,
        67,
        67,
        21,
        3,
        218
      ]
    },
    {
      "name": "crossChainIntent",
      "discriminator": [
        37,
        183,
        58,
        87,
        62,
        179,
        16,
        114
      ]
    },
    {
      "name": "crossChainVaultRoute",
      "discriminator": [
        48,
        216,
        186,
        31,
        186,
        216,
        19,
        166
      ]
    },
    {
      "name": "depositPolicy",
      "discriminator": [
        159,
        243,
        65,
        242,
        81,
        27,
        41,
        167
      ]
    },
    {
      "name": "depositReceipt",
      "discriminator": [
        64,
        175,
        24,
        183,
        138,
        109,
        70,
        78
      ]
    },
    {
      "name": "globalConfig",
      "discriminator": [
        149,
        8,
        156,
        202,
        160,
        252,
        176,
        217
      ]
    },
    {
      "name": "lpVault",
      "discriminator": [
        189,
        45,
        167,
        23,
        91,
        118,
        105,
        190
      ]
    },
    {
      "name": "withdrawEscrow",
      "discriminator": [
        161,
        63,
        221,
        55,
        116,
        204,
        131,
        11
      ]
    },
    {
      "name": "withdrawReceipt",
      "discriminator": [
        132,
        238,
        44,
        182,
        207,
        9,
        124,
        140
      ]
    },
    {
      "name": "withdrawalPolicy",
      "discriminator": [
        52,
        231,
        68,
        59,
        247,
        250,
        119,
        244
      ]
    }
  ],
  "events": [
    {
      "name": "adminAuthoritiesUpdated",
      "discriminator": [
        1,
        164,
        87,
        62,
        157,
        85,
        1,
        113
      ]
    },
    {
      "name": "crossChainConfigUpdated",
      "discriminator": [
        50,
        228,
        95,
        17,
        86,
        48,
        61,
        70
      ]
    },
    {
      "name": "crossChainDepositCompleted",
      "discriminator": [
        45,
        209,
        209,
        207,
        158,
        87,
        232,
        168
      ]
    },
    {
      "name": "crossChainIntentReplayAccepted",
      "discriminator": [
        221,
        50,
        69,
        6,
        52,
        30,
        90,
        159
      ]
    },
    {
      "name": "crossChainVaultRouteUpdated",
      "discriminator": [
        181,
        72,
        59,
        8,
        36,
        234,
        89,
        88
      ]
    },
    {
      "name": "crossChainWithdrawalEscrowed",
      "discriminator": [
        72,
        146,
        194,
        25,
        142,
        51,
        182,
        26
      ]
    },
    {
      "name": "depositPolicyUpdated",
      "discriminator": [
        190,
        38,
        79,
        160,
        80,
        143,
        90,
        255
      ]
    },
    {
      "name": "feeConfigUpdated",
      "discriminator": [
        45,
        50,
        42,
        173,
        193,
        67,
        52,
        244
      ]
    },
    {
      "name": "feesAssessed",
      "discriminator": [
        210,
        177,
        59,
        191,
        116,
        251,
        25,
        131
      ]
    },
    {
      "name": "withdrawalFeeRetained",
      "discriminator": [
        105,
        104,
        190,
        198,
        168,
        231,
        18,
        182
      ]
    },
    {
      "name": "withdrawalFeesSettled",
      "discriminator": [
        106,
        253,
        199,
        177,
        101,
        104,
        38,
        219
      ]
    },
    {
      "name": "withdrawalPolicyUpdated",
      "discriminator": [
        252,
        196,
        144,
        224,
        210,
        3,
        71,
        66
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "arithmeticError",
      "msg": "Arithmetic error!"
    },
    {
      "code": 6001,
      "name": "obsoleteVaultData",
      "msg": "LpVault data is outdated!"
    },
    {
      "code": 6002,
      "name": "staleNav",
      "msg": "NAV is stale - operator must update NAV before this operation!"
    },
    {
      "code": 6003,
      "name": "unauthorized",
      "msg": "Signer is not an authority!"
    },
    {
      "code": 6004,
      "name": "invalidMint",
      "msg": "Invalid mint extension!"
    },
    {
      "code": 6005,
      "name": "nameTooLong",
      "msg": "LP Vault name is too long!"
    },
    {
      "code": 6006,
      "name": "blockedDeposit",
      "msg": "Deposits are blocked - NAV is zero!"
    },
    {
      "code": 6007,
      "name": "insufficientLiquidity",
      "msg": "Insufficient liquid assets for instant withdrawal!"
    },
    {
      "code": 6008,
      "name": "invalidShareAmount",
      "msg": "Invalid share amount!"
    },
    {
      "code": 6009,
      "name": "invalidDepositAmount",
      "msg": "Invalid deposit amount!"
    },
    {
      "code": 6010,
      "name": "noPendingWithdrawal",
      "msg": "No pending withdrawal to fulfill!"
    },
    {
      "code": 6011,
      "name": "noClaimableAssets",
      "msg": "No claimable assets to withdraw!"
    },
    {
      "code": 6012,
      "name": "feeRecipientNotConfigured",
      "msg": "Fee recipient is not configured!"
    },
    {
      "code": 6013,
      "name": "invalidPerformanceFeeBps",
      "msg": "Invalid performance fee - must be <= MAX_PERFORMANCE_FEE_BPS!"
    },
    {
      "code": 6014,
      "name": "invalidFeeRecipient",
      "msg": "Invalid fee recipient account!"
    },
    {
      "code": 6015,
      "name": "assessmentTooEarly",
      "msg": "Assessment interval has not elapsed!"
    },
    {
      "code": 6016,
      "name": "invalidAssessmentInterval",
      "msg": "Invalid assessment interval!"
    },
    {
      "code": 6017,
      "name": "navUpdateTooLarge",
      "msg": "NAV update would change share price by more than the allowed maximum!"
    },
    {
      "code": 6018,
      "name": "invalidWithdrawalFeeBps",
      "msg": "Invalid withdrawal fee - must be <= MAX_WITHDRAWAL_FEE_BPS!"
    },
    {
      "code": 6019,
      "name": "invalidWithdrawalCapBps",
      "msg": "Invalid withdrawal cap - must be <= 10000 bps!"
    },
    {
      "code": 6020,
      "name": "hourlyWithdrawalCapExceeded",
      "msg": "Withdrawal exceeds hourly vault capacity!"
    },
    {
      "code": 6021,
      "name": "dailyWithdrawalCapExceeded",
      "msg": "Withdrawal exceeds daily vault capacity!"
    },
    {
      "code": 6022,
      "name": "invalidWithdrawalPolicy",
      "msg": "Invalid withdrawal policy account!"
    },
    {
      "code": 6023,
      "name": "invalidAuthority",
      "msg": "New authority cannot be the default (all-zeros) pubkey!"
    },
    {
      "code": 6024,
      "name": "navUpdateStateMismatch",
      "msg": "Vault NAV state changed since the expected state was read!"
    },
    {
      "code": 6025,
      "name": "invalidDepositPolicy",
      "msg": "Invalid deposit policy account!"
    },
    {
      "code": 6026,
      "name": "depositsPaused",
      "msg": "Deposits are paused for this vault!"
    },
    {
      "code": 6027,
      "name": "depositCapacityExceeded",
      "msg": "Deposit would exceed the vault capacity!"
    },
    {
      "code": 6028,
      "name": "invalidCrossChainRoute",
      "msg": "Invalid cross-chain vault route"
    },
    {
      "code": 6029,
      "name": "crossChainRouteDisabled",
      "msg": "Cross-chain vault route is disabled"
    },
    {
      "code": 6030,
      "name": "invalidEvmAddress",
      "msg": "Invalid BNB address"
    },
    {
      "code": 6031,
      "name": "crossChainTokenNotAllowed",
      "msg": "BNB token is not allowlisted"
    },
    {
      "code": 6032,
      "name": "crossChainIntentExpired",
      "msg": "Cross-chain intent deadline has expired"
    },
    {
      "code": 6033,
      "name": "invalidCrossChainAmount",
      "msg": "Invalid cross-chain amount"
    },
    {
      "code": 6034,
      "name": "crossChainMinimumOutputNotMet",
      "msg": "Cross-chain minimum output cannot be met"
    },
    {
      "code": 6035,
      "name": "crossChainIntentReplayConflict",
      "msg": "Conflicting replay of an existing cross-chain intent"
    },
    {
      "code": 6036,
      "name": "invalidCrossChainIntentState",
      "msg": "Invalid cross-chain intent state"
    },
    {
      "code": 6037,
      "name": "invalidDebridgeCaller",
      "msg": "Caller is not the authenticated deBridge execution program"
    },
    {
      "code": 6038,
      "name": "invalidDebridgeMetadata",
      "msg": "Invalid deBridge execution metadata account"
    },
    {
      "code": 6039,
      "name": "invalidDebridgeSubmissionAuthority",
      "msg": "Invalid deBridge submission authority"
    },
    {
      "code": 6040,
      "name": "invalidDebridgeDeliveryBalance",
      "msg": "Invalid deBridge delivery balance invariant"
    },
    {
      "code": 6041,
      "name": "invalidDebridgeSendAccounts",
      "msg": "Invalid deBridge send account boundary"
    },
    {
      "code": 6042,
      "name": "crossChainExternalBindingUnavailable",
      "msg": "Cross-chain external protocol binding is not activated"
    },
    {
      "code": 6043,
      "name": "crossChainConfigurationRequiresPause",
      "msg": "Cross-chain route configuration requires deposits to be paused"
    },
    {
      "code": 6044,
      "name": "invalidDebridgeOutboundBalance",
      "msg": "deBridge did not debit the exact outbound share amount"
    }
  ],
  "types": [
    {
      "name": "adminAuthoritiesUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "oldSuperAdmin",
            "type": "pubkey"
          },
          {
            "name": "newSuperAdmin",
            "type": "pubkey"
          },
          {
            "name": "oldCreateAuthority",
            "type": "pubkey"
          },
          {
            "name": "newCreateAuthority",
            "type": "pubkey"
          },
          {
            "name": "oldPermissionedCreation",
            "type": "bool"
          },
          {
            "name": "newPermissionedCreation",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "crossChainConfig",
      "docs": [
        "Program-wide administration for Gamma-owned cross-chain entrypoints.",
        "Initialization is upgrade-authority gated and always starts paused."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "depositsPaused",
            "docs": [
              "Global deposit-only circuit breaker. Withdrawal intake has its own hard",
              "executable gate and remains unavailable in this release."
            ],
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "crossChainConfigUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "oldAdmin",
            "type": "pubkey"
          },
          {
            "name": "newAdmin",
            "type": "pubkey"
          },
          {
            "name": "depositsPaused",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "crossChainDepositArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "beneficiary",
            "docs": [
              "BNB recipient of the managed deAsset. This is order payload data; DLN's",
              "public Solana metadata does not prove it is the source transaction maker."
            ],
            "type": {
              "array": [
                "u8",
                20
              ]
            }
          },
          {
            "name": "sourceToken",
            "docs": [
              "Declared hook payload value only. The published ExtcallMeta layout does",
              "not expose the DLN CreatedOrder giveOffer, so this field cannot prove",
              "which BNB token funded the order."
            ],
            "type": {
              "array": [
                "u8",
                20
              ]
            }
          },
          {
            "name": "depositAmount",
            "docs": [
              "Declared destination take-token tranche. This is not the BNB",
              "CreatedOrder give amount, which may use different decimals and terms."
            ],
            "type": "u64"
          },
          {
            "name": "minBnbShares",
            "docs": [
              "Minimum shares after deBridge transfer fees."
            ],
            "type": "u64"
          },
          {
            "name": "deadline",
            "type": "i64"
          },
          {
            "name": "nonce",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "crossChainDepositCompleted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "intent",
            "type": "pubkey"
          },
          {
            "name": "replayKey",
            "type": "pubkey"
          },
          {
            "name": "lpVault",
            "type": "pubkey"
          },
          {
            "name": "nativeSender",
            "docs": [
              "Gamma-derived signer recorded by deBridge as `nativeSender`."
            ],
            "type": "pubkey"
          },
          {
            "name": "beneficiary",
            "type": {
              "array": [
                "u8",
                20
              ]
            }
          },
          {
            "name": "depositedAssets",
            "type": "u64"
          },
          {
            "name": "bridgedShares",
            "type": "u64"
          },
          {
            "name": "nonce",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "crossChainIntent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "version",
            "type": "u8"
          },
          {
            "name": "kind",
            "docs": [
              "1 = deposit, 2 = withdrawal."
            ],
            "type": "u8"
          },
          {
            "name": "status",
            "type": "u8"
          },
          {
            "name": "route",
            "type": "pubkey"
          },
          {
            "name": "replayKey",
            "docs": [
              "Opaque deBridge-owned account used as the replay key."
            ],
            "type": "pubkey"
          },
          {
            "name": "beneficiary",
            "type": {
              "array": [
                "u8",
                20
              ]
            }
          },
          {
            "name": "sourceOrOutputToken",
            "type": {
              "array": [
                "u8",
                20
              ]
            }
          },
          {
            "name": "inputAmount",
            "type": "u64"
          },
          {
            "name": "minimumOutput",
            "docs": [
              "Deposit intents store the six-decimal minimum shares here; withdrawal",
              "intents store the six-decimal minimum native Solana vault assets here."
            ],
            "type": "u64"
          },
          {
            "name": "minOutputAmountRaw",
            "docs": [
              "Authenticated minimum final BNB USDC/USDT output for withdrawals,",
              "encoded as a fixed-width unsigned U256 in big-endian order."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "actualOutput",
            "docs": [
              "Actual native share output for the implemented deposit path."
            ],
            "type": "u64"
          },
          {
            "name": "deadline",
            "type": "i64"
          },
          {
            "name": "nonce",
            "type": "u64"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "updatedAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "crossChainIntentReplayAccepted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "intent",
            "type": "pubkey"
          },
          {
            "name": "replayKey",
            "type": "pubkey"
          },
          {
            "name": "status",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "crossChainVaultRoute",
      "docs": [
        "Per-vault BNB route owned directly by the Gamma program."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "lpVault",
            "type": "pubkey"
          },
          {
            "name": "assetsMint",
            "type": "pubkey"
          },
          {
            "name": "sharesMint",
            "type": "pubkey"
          },
          {
            "name": "shareEscrow",
            "type": "pubkey"
          },
          {
            "name": "bnbUsdc",
            "type": {
              "array": [
                "u8",
                20
              ]
            }
          },
          {
            "name": "bnbUsdt",
            "type": {
              "array": [
                "u8",
                20
              ]
            }
          },
          {
            "name": "depositsEnabled",
            "type": "bool"
          },
          {
            "name": "withdrawalsEnabled",
            "type": "bool"
          },
          {
            "name": "escrowedShares",
            "docs": [
              "Native shares received from dePort but not yet consumed by a bound",
              "Gamma-withdrawal/DLN-return implementation."
            ],
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "crossChainVaultRouteUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "route",
            "type": "pubkey"
          },
          {
            "name": "lpVault",
            "type": "pubkey"
          },
          {
            "name": "depositsEnabled",
            "type": "bool"
          },
          {
            "name": "withdrawalsEnabled",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "crossChainWithdrawalArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "beneficiary",
            "docs": [
              "Authenticated external-call payload and final BNB recipient."
            ],
            "type": {
              "array": [
                "u8",
                20
              ]
            }
          },
          {
            "name": "outputToken",
            "type": {
              "array": [
                "u8",
                20
              ]
            }
          },
          {
            "name": "sharesAmount",
            "type": "u64"
          },
          {
            "name": "minVaultAssets",
            "docs": [
              "Minimum six-decimal native Solana vault assets after Gamma fees."
            ],
            "type": "u64"
          },
          {
            "name": "minOutputAmountRaw",
            "docs": [
              "Minimum final BNB output in 18-decimal raw units, fixed-width U256 BE."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "deadline",
            "type": "i64"
          },
          {
            "name": "nonce",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "crossChainWithdrawalEscrowed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "intent",
            "type": "pubkey"
          },
          {
            "name": "replayKey",
            "type": "pubkey"
          },
          {
            "name": "lpVault",
            "type": "pubkey"
          },
          {
            "name": "beneficiary",
            "type": {
              "array": [
                "u8",
                20
              ]
            }
          },
          {
            "name": "shares",
            "type": "u64"
          },
          {
            "name": "minVaultAssets",
            "docs": [
              "Six-decimal native Solana vault-asset floor."
            ],
            "type": "u64"
          },
          {
            "name": "minOutputAmountRaw",
            "docs": [
              "Unsigned U256 big-endian final BNB USDC/USDT floor (18 decimals)."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "nonce",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "depositPolicy",
      "docs": [
        "Per-vault deposit controls shared by every deposit source, including",
        "Solana-native users and cross-chain adapters.",
        "",
        "This is intentionally a separate PDA rather than a field on `LpVault` so",
        "existing vault accounts do not require a layout migration. Existing vaults",
        "fail closed after the program upgrade until their policy PDA is initialized",
        "by the fund authority."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "lpVault",
            "docs": [
              "Vault this policy belongs to."
            ],
            "type": "pubkey"
          },
          {
            "name": "capacityAssets",
            "docs": [
              "Maximum post-deposit NAV in the vault asset's base units."
            ],
            "type": "u64"
          },
          {
            "name": "depositsPaused",
            "docs": [
              "Emergency switch for deposits. Withdrawals do not consult this field."
            ],
            "type": "bool"
          },
          {
            "name": "bump",
            "docs": [
              "PDA derivation bump."
            ],
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "depositPolicyUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "oldCapacityAssets",
            "type": "u64"
          },
          {
            "name": "newCapacityAssets",
            "type": "u64"
          },
          {
            "name": "oldDepositsPaused",
            "type": "bool"
          },
          {
            "name": "newDepositsPaused",
            "type": "bool"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "depositReceipt",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bump",
            "docs": [
              "PDA bump seed."
            ],
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "feeConfigUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "oldFeeRecipient",
            "type": "pubkey"
          },
          {
            "name": "newFeeRecipient",
            "type": "pubkey"
          },
          {
            "name": "oldFeeBps",
            "type": "u16"
          },
          {
            "name": "newFeeBps",
            "type": "u16"
          },
          {
            "name": "assessmentIntervalSecs",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "feesAssessed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "profitAssets",
            "type": "u64"
          },
          {
            "name": "feeAssets",
            "type": "u64"
          },
          {
            "name": "feeSharesMinted",
            "type": "u64"
          },
          {
            "name": "newPps",
            "type": "u64"
          },
          {
            "name": "checkpointPps",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "globalConfig",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "superAdmin",
            "docs": [
              "Key with the ability to update the GlobalConfig. Rotatable only via",
              "`update_admin_authorities` (gated on the program upgrade authority)."
            ],
            "type": "pubkey"
          },
          {
            "name": "permissionedCreation",
            "docs": [
              "When true InitializeLpVault requires create_authority to be a signer"
            ],
            "type": "bool"
          },
          {
            "name": "createAuthority",
            "docs": [
              "The key with authority to call `InitializeLpVault`"
            ],
            "type": "pubkey"
          },
          {
            "name": "bump",
            "docs": [
              "Bump for increased efficiency."
            ],
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "lpVault",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "assetsAccount",
            "docs": [
              "USDC TokenAccount where users deposit, funds agent operations."
            ],
            "type": "pubkey"
          },
          {
            "name": "pendingSharesAccount",
            "docs": [
              "TokenAccount where shares are held during queued (illiquid) withdrawals."
            ],
            "type": "pubkey"
          },
          {
            "name": "sharesMint",
            "docs": [
              "Derived mint (created on initialize) that represents LP tokens or shares."
            ],
            "type": "pubkey"
          },
          {
            "name": "assetsMint",
            "docs": [
              "Mint corresponding to the asset, most of the time USDC."
            ],
            "type": "pubkey"
          },
          {
            "name": "fundAuthority",
            "docs": [
              "Pubkey authorized to withdraw assets from assets_account and update NAV."
            ],
            "type": "pubkey"
          },
          {
            "name": "nav",
            "docs": [
              "Current Net Asset Value (total vault value in asset decimals)."
            ],
            "type": "u64"
          },
          {
            "name": "totalShares",
            "docs": [
              "Total shares outstanding (cached for efficiency). May temporarily diverge",
              "from shares_mint.supply during the escrow withdrawal flow (between",
              "fulfill_withdrawal and complete_withdrawal)."
            ],
            "type": "u64"
          },
          {
            "name": "navUpdatedAt",
            "docs": [
              "Timestamp for when NAV was last updated."
            ],
            "type": "i64"
          },
          {
            "name": "navMaxStaleness",
            "docs": [
              "Maximum NAV staleness for user operations (in seconds).",
              "Deposits and withdrawals fail if NAV is older than this."
            ],
            "type": "u64"
          },
          {
            "name": "bump",
            "docs": [
              "PDA derivation bump, stored for CU saving purposes."
            ],
            "type": "u8"
          },
          {
            "name": "vaultName",
            "type": "string"
          },
          {
            "name": "pendingWithdrawalValue",
            "docs": [
              "Total value of pending withdrawals awaiting liquidity.",
              "When a withdrawal cannot be fulfilled instantly due to insufficient",
              "liquid assets, the value is tracked here. This is approximate — the",
              "value recorded at withdrawal time may differ from the value at",
              "fulfillment time (recomputed at current NAV). Used for operator",
              "visibility only, not for critical calculations."
            ],
            "type": "u64"
          },
          {
            "name": "feeRecipient",
            "docs": [
              "Shares token account that receives fee shares. Pubkey::default() = disabled."
            ],
            "type": "pubkey"
          },
          {
            "name": "performanceFeeBps",
            "docs": [
              "Performance fee rate in basis points (2000 = 20%). 0 = disabled."
            ],
            "type": "u16"
          },
          {
            "name": "assessmentIntervalSecs",
            "docs": [
              "How often scheduled fees are assessed (seconds). E.g., 86400 = 24h."
            ],
            "type": "i64"
          },
          {
            "name": "lastAssessmentTimestamp",
            "docs": [
              "Unix timestamp of last fee event (scheduled or withdrawal-triggered)."
            ],
            "type": "i64"
          },
          {
            "name": "pricePerShareAtLastAssessment",
            "docs": [
              "PPS at last fee event, scaled by PRICE_SCALE. High-water mark for fees."
            ],
            "type": "u64"
          },
          {
            "name": "keeperAuthority",
            "docs": [
              "Optional keeper authority. When set (non-default), this key can call",
              "fulfill_withdrawal in addition to fund_authority. Allows the keeper",
              "process to use a separate key from the agent/fund_authority.",
              "Pubkey::default() = not set (only fund_authority can fulfill)."
            ],
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "withdrawEscrow",
      "docs": [
        "Escrow account that holds assets and shares for a pending withdrawal.",
        "Each user has one escrow per vault, derived as PDA from [WITHDRAW_ESCROW_SEED, user, vault]."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "user",
            "docs": [
              "User who owns this escrow."
            ],
            "type": "pubkey"
          },
          {
            "name": "lpVault",
            "docs": [
              "The vault this escrow is associated with."
            ],
            "type": "pubkey"
          },
          {
            "name": "escrowAssetsAccount",
            "docs": [
              "Token account holding escrowed assets (USDC)."
            ],
            "type": "pubkey"
          },
          {
            "name": "escrowSharesAccount",
            "docs": [
              "Token account holding escrowed shares (for burning on claim)."
            ],
            "type": "pubkey"
          },
          {
            "name": "bump",
            "docs": [
              "PDA derivation bump."
            ],
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "withdrawReceipt",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "user",
            "docs": [
              "User requesting withdrawal."
            ],
            "type": "pubkey"
          },
          {
            "name": "lpVault",
            "docs": [
              "Vault where the user has invested."
            ],
            "type": "pubkey"
          },
          {
            "name": "pendingShares",
            "docs": [
              "Shares waiting for liquidity (keeper needs to fulfill these).",
              "These shares are held in the escrow_shares_account."
            ],
            "type": "u64"
          },
          {
            "name": "claimableShares",
            "docs": [
              "Shares that have been fulfilled and are ready to claim.",
              "These shares are also in escrow_shares_account, waiting to be burned on claim."
            ],
            "type": "u64"
          },
          {
            "name": "claimableAssets",
            "docs": [
              "Asset value ready to claim (held in escrow_assets_account)."
            ],
            "type": "u64"
          },
          {
            "name": "oldestPendingAt",
            "docs": [
              "Timestamp of the earliest pending withdrawal (for NAV staleness checks)."
            ],
            "type": "i64"
          },
          {
            "name": "bump",
            "docs": [
              "PDA derivation bump, stored for CU saving purposes."
            ],
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "withdrawalFeeRetained",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "grossAssets",
            "type": "u64"
          },
          {
            "name": "feeAssets",
            "type": "u64"
          },
          {
            "name": "netAssets",
            "type": "u64"
          },
          {
            "name": "withdrawalFeeBps",
            "type": "u16"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "withdrawalFeesSettled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "sharesWithdrawn",
            "type": "u64"
          },
          {
            "name": "assetValue",
            "type": "u64"
          },
          {
            "name": "feeSharesMinted",
            "type": "u64"
          },
          {
            "name": "prorationElapsed",
            "type": "i64"
          },
          {
            "name": "prorationInterval",
            "type": "i64"
          },
          {
            "name": "ppsAfterFees",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "withdrawalPolicy",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "lpVault",
            "docs": [
              "Vault this policy belongs to."
            ],
            "type": "pubkey"
          },
          {
            "name": "withdrawalFeeBps",
            "docs": [
              "Base-asset fee retained in the vault on withdrawal. 30 = 0.30%."
            ],
            "type": "u16"
          },
          {
            "name": "hourlyWithdrawalCapBps",
            "docs": [
              "Max net withdrawal accepted per hour as bps of current NAV. 0 = disabled."
            ],
            "type": "u16"
          },
          {
            "name": "dailyWithdrawalCapBps",
            "docs": [
              "Max net withdrawal accepted per day as bps of current NAV. 0 = disabled."
            ],
            "type": "u16"
          },
          {
            "name": "hourlyWithdrawnAssets",
            "docs": [
              "Net withdrawn assets counted in the current hourly window."
            ],
            "type": "u64"
          },
          {
            "name": "dailyWithdrawnAssets",
            "docs": [
              "Net withdrawn assets counted in the current daily window."
            ],
            "type": "u64"
          },
          {
            "name": "hourlyWindowStart",
            "docs": [
              "Start timestamp for the current hourly cap window."
            ],
            "type": "i64"
          },
          {
            "name": "dailyWindowStart",
            "docs": [
              "Start timestamp for the current daily cap window."
            ],
            "type": "i64"
          },
          {
            "name": "bump",
            "docs": [
              "PDA derivation bump."
            ],
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "withdrawalPolicyUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "withdrawalFeeBps",
            "type": "u16"
          },
          {
            "name": "hourlyWithdrawalCapBps",
            "type": "u16"
          },
          {
            "name": "dailyWithdrawalCapBps",
            "type": "u16"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    }
  ]
};

