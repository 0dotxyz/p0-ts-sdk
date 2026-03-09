/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL was extracted from the compiled @jup-ag/lend SDK.
 */
export type JupLend = {
  address: "jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9";
  metadata: {
    name: "lending";
    version: "0.1.0";
    spec: "0.1.0";
    description: "Created with Anchor";
  };
  instructions: [
    {
      name: "deposit";
      discriminator: [242, 35, 198, 137, 82, 225, 242, 182];
      accounts: [
        { name: "signer"; writable: true; signer: true },
        { name: "depositor_token_account"; writable: true },
        { name: "recipient_token_account"; writable: true },
        { name: "mint" },
        { name: "lending_admin" },
        { name: "lending"; writable: true },
        { name: "f_token_mint"; writable: true },
        { name: "supply_token_reserves_liquidity"; writable: true },
        { name: "lending_supply_position_on_liquidity"; writable: true },
        { name: "rate_model" },
        { name: "vault"; writable: true },
        { name: "liquidity"; writable: true },
        { name: "liquidity_program"; writable: true },
        { name: "rewards_rate_model" },
        { name: "token_program" },
        { name: "associated_token_program" },
        { name: "system_program" },
      ];
      args: [{ name: "assets"; type: "u64" }];
      returns: "u64";
    },
    {
      name: "mint";
      discriminator: [51, 57, 225, 47, 182, 146, 137, 166];
      accounts: [
        { name: "signer"; writable: true; signer: true },
        { name: "depositor_token_account"; writable: true },
        { name: "recipient_token_account"; writable: true },
        { name: "mint" },
        { name: "lending_admin" },
        { name: "lending"; writable: true },
        { name: "f_token_mint"; writable: true },
        { name: "supply_token_reserves_liquidity"; writable: true },
        { name: "lending_supply_position_on_liquidity"; writable: true },
        { name: "rate_model" },
        { name: "vault"; writable: true },
        { name: "liquidity"; writable: true },
        { name: "liquidity_program"; writable: true },
        { name: "rewards_rate_model" },
        { name: "token_program" },
        { name: "associated_token_program" },
        { name: "system_program" },
      ];
      args: [{ name: "shares"; type: "u64" }];
      returns: "u64";
    },
    {
      name: "withdraw";
      discriminator: [183, 18, 70, 156, 148, 109, 161, 34];
      accounts: [
        { name: "signer"; writable: true; signer: true },
        { name: "owner_token_account"; writable: true },
        { name: "recipient_token_account"; writable: true },
        { name: "lending_admin" },
        { name: "lending"; writable: true },
        { name: "mint" },
        { name: "f_token_mint"; writable: true },
        { name: "supply_token_reserves_liquidity"; writable: true },
        { name: "lending_supply_position_on_liquidity"; writable: true },
        { name: "rate_model" },
        { name: "vault"; writable: true },
        { name: "claim_account"; writable: true },
        { name: "liquidity"; writable: true },
        { name: "liquidity_program"; writable: true },
        { name: "rewards_rate_model" },
        { name: "token_program" },
        { name: "associated_token_program" },
        { name: "system_program" },
      ];
      args: [{ name: "amount"; type: "u64" }];
      returns: "u64";
    },
    {
      name: "redeem";
      discriminator: [184, 12, 86, 149, 70, 196, 97, 225];
      accounts: [
        { name: "signer"; writable: true; signer: true },
        { name: "owner_token_account"; writable: true },
        { name: "recipient_token_account"; writable: true },
        { name: "lending_admin" },
        { name: "lending"; writable: true },
        { name: "mint" },
        { name: "f_token_mint"; writable: true },
        { name: "supply_token_reserves_liquidity"; writable: true },
        { name: "lending_supply_position_on_liquidity"; writable: true },
        { name: "rate_model" },
        { name: "vault"; writable: true },
        { name: "claim_account"; writable: true },
        { name: "liquidity"; writable: true },
        { name: "liquidity_program"; writable: true },
        { name: "rewards_rate_model" },
        { name: "token_program" },
        { name: "associated_token_program" },
        { name: "system_program" },
      ];
      args: [{ name: "shares"; type: "u64" }];
      returns: "u64";
    },
    {
      name: "rebalance";
      discriminator: [108, 158, 77, 9, 210, 52, 88, 62];
      accounts: [
        { name: "signer"; writable: true; signer: true },
        { name: "depositor_token_account"; writable: true },
        { name: "lending_admin" },
        { name: "lending"; writable: true },
        { name: "mint" },
        { name: "f_token_mint"; writable: true },
        { name: "supply_token_reserves_liquidity"; writable: true },
        { name: "lending_supply_position_on_liquidity"; writable: true },
        { name: "rate_model"; writable: true },
        { name: "vault"; writable: true },
        { name: "liquidity"; writable: true },
        { name: "liquidity_program"; writable: true },
        { name: "rewards_rate_model" },
        { name: "token_program" },
        { name: "associated_token_program" },
        { name: "system_program" },
      ];
      args: [];
    },
    {
      name: "update_rate";
      discriminator: [24, 225, 53, 189, 72, 212, 225, 178];
      accounts: [
        { name: "lending"; writable: true },
        { name: "mint" },
        { name: "f_token_mint" },
        { name: "supply_token_reserves_liquidity" },
        { name: "rewards_rate_model" },
      ];
      args: [];
    },
  ];
  accounts: [
    { name: "Lending"; discriminator: [135, 199, 82, 16, 249, 131, 182, 241] },
    {
      name: "LendingAdmin";
      discriminator: [42, 8, 33, 220, 163, 40, 210, 5];
    },
    {
      name: "LendingRewardsRateModel";
      discriminator: [166, 72, 71, 131, 172, 74, 166, 181];
    },
    {
      name: "TokenReserve";
      discriminator: [21, 18, 59, 135, 120, 20, 31, 12];
    },
    {
      name: "UserSupplyPosition";
      discriminator: [202, 219, 136, 118, 61, 177, 21, 146];
    },
  ];
  types: [
    {
      name: "Lending";
      type: {
        kind: "struct";
        fields: [
          { name: "mint"; type: "pubkey" },
          { name: "f_token_mint"; type: "pubkey" },
          { name: "lending_id"; type: "u16" },
          { name: "decimals"; type: "u8" },
          { name: "rewards_rate_model"; type: "pubkey" },
          { name: "liquidity_exchange_price"; type: "u64" },
          { name: "token_exchange_price"; type: "u64" },
          { name: "last_update_timestamp"; type: "u64" },
          { name: "token_reserves_liquidity"; type: "pubkey" },
          { name: "supply_position_on_liquidity"; type: "pubkey" },
          { name: "bump"; type: "u8" },
        ];
      };
    },
    {
      name: "LendingAdmin";
      type: {
        kind: "struct";
        fields: [
          { name: "authority"; type: "pubkey" },
          { name: "liquidity_program"; type: "pubkey" },
          { name: "rebalancer"; type: "pubkey" },
          { name: "next_lending_id"; type: "u16" },
          { name: "auths"; type: { vec: "pubkey" } },
          { name: "bump"; type: "u8" },
        ];
      };
    },
    {
      name: "LendingRewardsRateModel";
      type: {
        kind: "struct";
        fields: [
          { name: "mint"; type: "pubkey" },
          { name: "start_tvl"; type: "u64" },
          { name: "duration"; type: "u64" },
          { name: "start_time"; type: "u64" },
          { name: "yearly_reward"; type: "u64" },
          { name: "next_duration"; type: "u64" },
          { name: "next_reward_amount"; type: "u64" },
          { name: "bump"; type: "u8" },
        ];
      };
    },
  ];
};
